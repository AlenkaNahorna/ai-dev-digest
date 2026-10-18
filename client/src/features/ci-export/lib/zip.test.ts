import { describe, it, expect } from "vitest";
import { buildZip, crc32 } from "./zip";

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("buildZip", () => {
  const files = [
    { path: ".github/workflows/devdigest-review.yml", contents: "name: DevDigest Review\n" },
    { path: ".devdigest/memory.jsonl", contents: "\n" },
    { path: ".devdigest/skills/ünï.md", contents: "# skill" },
  ];
  const zip = buildZip(files, new Date(2026, 9, 18, 20, 17, 0));
  const v = dv(zip);

  it("writes the end-of-central-directory record with the entry count", () => {
    const eocd = zip.length - 22;
    expect(v.getUint32(eocd, true)).toBe(0x06054b50);
    expect(v.getUint16(eocd + 10, true)).toBe(files.length);
    // central dir ends exactly where the EOCD begins
    expect(v.getUint32(eocd + 16, true) + v.getUint32(eocd + 12, true)).toBe(eocd);
  });

  it("stores each file uncompressed with a correct CRC and name", () => {
    let pos = 0;
    for (const f of files) {
      expect(v.getUint32(pos, true)).toBe(0x04034b50);
      expect(v.getUint16(pos + 8, true)).toBe(0); // STORE
      const data = new TextEncoder().encode(f.contents);
      expect(v.getUint32(pos + 14, true)).toBe(crc32(data));
      expect(v.getUint32(pos + 18, true)).toBe(data.length);
      const nameLen = v.getUint16(pos + 26, true);
      const name = new TextDecoder().decode(zip.slice(pos + 30, pos + 30 + nameLen));
      expect(name).toBe(f.path);
      const body = zip.slice(pos + 30 + nameLen, pos + 30 + nameLen + data.length);
      expect(new TextDecoder().decode(body)).toBe(f.contents);
      pos += 30 + nameLen + data.length;
    }
  });

  it("strips a leading slash so entries are repo-relative", () => {
    const z = buildZip([{ path: "/a/b.txt", contents: "x" }]);
    const nameLen = dv(z).getUint16(26, true);
    expect(new TextDecoder().decode(z.slice(30, 30 + nameLen))).toBe("a/b.txt");
  });
});
