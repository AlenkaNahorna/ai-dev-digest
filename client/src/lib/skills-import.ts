const decoder = new TextDecoder();
export const MAX_SKILL_ARCHIVE_BYTES = 10 * 1024 * 1024;
export const MAX_SKILL_ENTRIES = 100;
export const MAX_SKILL_BODY_BYTES = 256 * 1024;

function u16(view: DataView, offset: number) { return view.getUint16(offset, true); }
function u32(view: DataView, offset: number) { return view.getUint32(offset, true); }

async function readDecompressedBytes(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("The markdown skill body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Extracts only the core markdown file from a ZIP. No archive entry is executed. */
export async function readSkillFile(file: File): Promise<string> {
  if (file.size > MAX_SKILL_ARCHIVE_BYTES) throw new Error("The skill file must be smaller than 10 MB.");
  if (!file.name.toLowerCase().endsWith(".zip")) {
    const content = await (typeof file.text === "function" ? file.text() : new Response(file).text());
    if (new TextEncoder().encode(content).byteLength > MAX_SKILL_BODY_BYTES) throw new Error("The markdown skill body is too large.");
    return content;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (u32(view, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("The archive is not a valid ZIP file.");
  const count = u16(view, eocd + 10);
  if (count > MAX_SKILL_ENTRIES) throw new Error("The archive contains too many files.");
  const centralOffset = u32(view, eocd + 16);
  const entries: Array<{ name: string; method: number; compressed: number; localOffset: number }> = [];
  let cursor = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (u32(view, cursor) !== 0x02014b50) throw new Error("The archive has an invalid directory.");
    const nameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    entries.push({
      name: decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength)),
      method: u16(view, cursor + 10),
      compressed: u32(view, cursor + 20),
      localOffset: u32(view, cursor + 42),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  const markdown = entries
    .filter((entry) => !entry.name.endsWith("/") && entry.name.toLowerCase().endsWith(".md"))
    .sort((a, b) => Number(b.name.toLowerCase().endsWith("skill.md")) - Number(a.name.toLowerCase().endsWith("skill.md")) || a.name.length - b.name.length)[0];
  if (!markdown) throw new Error("The archive does not contain a markdown skill file.");
  if (markdown.compressed > MAX_SKILL_BODY_BYTES) throw new Error("The markdown skill body is too large.");
  const local = markdown.localOffset;
  if (u32(view, local) !== 0x04034b50) throw new Error("The archive has an invalid file entry.");
  const nameLength = u16(view, local + 26);
  const extraLength = u16(view, local + 28);
  const start = local + 30 + nameLength + extraLength;
  const compressed = bytes.slice(start, start + markdown.compressed);
  let content: Uint8Array;
  if (markdown.method === 0) content = compressed;
  else if (markdown.method === 8) {
    const decompressed = new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).body;
    if (!decompressed) throw new Error("The archive could not be decompressed.");
    content = await readDecompressedBytes(decompressed, MAX_SKILL_BODY_BYTES);
  }
  else throw new Error("The archive uses an unsupported compression method.");
  if (content.byteLength > MAX_SKILL_BODY_BYTES) throw new Error("The markdown skill body is too large.");
  return decoder.decode(content);
}
