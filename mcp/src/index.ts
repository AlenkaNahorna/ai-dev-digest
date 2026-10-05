import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { composeServer } from './compose.js';
import { parseWaitMs } from './domain/wait-budget.js';

/**
 * Entry point of the local stdio MCP server. stdout carries ONLY JSON-RPC;
 * every diagnostic goes to stderr.
 */
const DEFAULT_API_URL = 'http://127.0.0.1:3001';

function log(message: string): void {
  process.stderr.write(`[devdigest-mcp] ${message}\n`);
}

// A stray console.log (ours or a dependency's) would corrupt the protocol stream.
console.log = (...args: unknown[]): void => log(args.map(String).join(' '));
console.info = console.log;

async function main(): Promise<void> {
  const apiUrl = process.env['DEVDIGEST_API_URL'] ?? DEFAULT_API_URL;
  const waitMs = parseWaitMs(process.env['DEVDIGEST_MCP_WAIT_MS']);
  const server = composeServer({ apiUrl, log, waitMs });
  await server.connect(new StdioServerTransport());
  log(`ready (API ${apiUrl}, run wait limit ${waitMs} ms)`);
}

main().catch((error: unknown) => {
  log(`fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exit(1);
});
