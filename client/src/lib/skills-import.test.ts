import { describe, expect, it } from "vitest";
import { readSkillFile } from "./skills-import";
import { buildSkillDiff, MAX_DIFF_LINES } from "./skill-diff";

function storedZip(name: string, content: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const contentBytes = new TextEncoder().encode(content);
  const local = new Uint8Array(30 + nameBytes.length + contentBytes.length);
  const central = new Uint8Array(46 + nameBytes.length);
  const end = new Uint8Array(22);
  const write = (target: Uint8Array, offset: number, value: number) => new DataView(target.buffer).setUint32(offset, value, true);
  const write16 = (target: Uint8Array, offset: number, value: number) => new DataView(target.buffer).setUint16(offset, value, true);
  write(local, 0, 0x04034b50); write16(local, 8, 0); write16(local, 18, contentBytes.length); write16(local, 22, contentBytes.length); write16(local, 26, nameBytes.length); local.set(nameBytes, 30); local.set(contentBytes, 30 + nameBytes.length);
  write(central, 0, 0x02014b50); write16(central, 10, 0); write16(central, 20, contentBytes.length); write16(central, 24, contentBytes.length); write16(central, 28, nameBytes.length); write(central, 42, 0); central.set(nameBytes, 46);
  write(end, 0, 0x06054b50); write16(end, 8, 1); write16(end, 10, 1); write(end, 12, central.length); write(end, 16, local.length); write16(end, 20, 0);
  const result = new Uint8Array(local.length + central.length + end.length); result.set(local); result.set(central, local.length); result.set(end, local.length + central.length); return result;
}

describe("skill import and diff helpers", () => {
  it("reads markdown as text", async () => {
    await expect(readSkillFile({ name: "skill.md", text: () => Promise.resolve("# Skill\nCheck edges") } as File)).resolves.toBe("# Skill\nCheck edges");
  });

  it("extracts only the markdown core from a ZIP", async () => {
    const zip = storedZip("skill/SKILL.md", "# Imported\nCheck edges");
    await expect(readSkillFile({ name: "skill.zip", arrayBuffer: () => Promise.resolve(zip.buffer) } as File)).resolves.toBe("# Imported\nCheck edges");
  });

  it("returns a detailed line diff", () => {
    expect(buildSkillDiff("a\nb\nc", "a\nx\nc\nd")).toEqual([
      { kind: "context", line: "a" },
      { kind: "removed", line: "b" },
      { kind: "added", line: "x" },
      { kind: "context", line: "c" },
      { kind: "added", line: "d" },
    ]);
  });

  it("bounds diff work for oversized versions", async () => {
    expect(buildSkillDiff(Array(MAX_DIFF_LINES + 1).fill("a").join("\n"), "b")).toEqual([
      { kind: "context", line: "Diff is too large to render safely. Compare these versions outside the browser." },
    ]);
  });
});
