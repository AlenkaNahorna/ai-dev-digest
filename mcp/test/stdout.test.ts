import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUESTS = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'stdout-test', version: '0.0.0' },
    },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'get_blast_radius', arguments: { repo: 'acme/payments-api', pr: 482 } },
  },
];

describe('stdio transport hygiene', () => {
  it('writes only JSON-RPC messages to stdout; logs go to stderr', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: packageRoot,
      env: { ...process.env, DEVDIGEST_API_URL: 'http://127.0.0.1:1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr += chunk));

    const answered = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no tools/call reply; stderr: ${stderr}`)), 12_000);
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        if (stdout.split('\n').some((line) => line.includes('"id":3'))) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on('error', reject);
    });

    for (const request of REQUESTS) child.stdin.write(`${JSON.stringify(request)}\n`);
    try {
      await answered;
    } finally {
      child.kill();
    }

    const lines = stdout.split('\n').filter((line) => line.trim() !== '');
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      const message = JSON.parse(line) as { jsonrpc?: string };
      expect(message.jsonrpc).toBe('2.0');
    }
    expect(stderr).toContain('[devdigest-mcp]');
  });
});
