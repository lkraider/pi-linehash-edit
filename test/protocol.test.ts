import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, readFile, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileChecksum, readChecksum } from "../src/checksum";
import { applyEdits, parseEdits } from "../src/line-edit";
import { fmtReadPreviewStreamed } from "../src/read";
import { buildToolDef, execPipeline } from "../src/replace";
import { genDiff } from "../src/replace-diff";
import extension, { sparsePreview, sparseRows } from "../index";
import { toCwd } from "../src/paths";
import { MAX_BYTES } from "../src/constants";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";

const checksumHook = vi.hoisted(() => ({ beforeRead: undefined as undefined | (() => void | Promise<void>) }));
vi.mock("../src/checksum", async importOriginal => {
  const original = await importOriginal<typeof import("../src/checksum")>();
  return { ...original, readChecksum: async (...args: Parameters<typeof original.readChecksum>) => { await checksumHook.beforeRead?.(); return original.readChecksum(...args); } };
});

const dirs: string[] = [];
async function fixture(content: string | Buffer, name = "file.txt") {
  const dir = await mkdtemp(join(tmpdir(), "checksum-edit-")); dirs.push(dir);
  const path = join(dir, name); await writeFile(path, content); return { dir, path };
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe("checksum", () => {
  it("has fixed shape, is deterministic, path-bound, and byte-sensitive", () => {
    const a = fileChecksum("/a", Buffer.from("x"));
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(fileChecksum("/a", Buffer.from("x"))).toBe(a);
    expect(fileChecksum("/b", Buffer.from("x"))).not.toBe(a);
    for (const raw of ["x ", "x\n", "\ufeffx", "x\r\n"]) expect(fileChecksum("/a", Buffer.from(raw))).not.toBe(a);
    expect(fileChecksum("/a", Buffer.from("collision-4-0-66"))).not.toBe(fileChecksum("/a", Buffer.from("collision-4-0-170")));
  });

  it("binds identical bytes to distinct canonical targets", async () => {
    const { dir, path } = await fixture("same", "a.txt");
    const other = join(dir, "b.txt"); await writeFile(other, "same");
    expect((await readChecksum(path)).checksum).not.toBe((await readChecksum(other)).checksum);
  });

  it("rejects oversized files before reading contents", async () => {
    const { path } = await fixture("");
    await truncate(path, MAX_BYTES + 1);
    await expect(readChecksum(path)).rejects.toThrow("E_FILE_TOO_LARGE");
  });

  it("normalizes model-added path prefixes", () => {
    expect(toCwd("@file.txt", "/tmp")).toBe("/tmp/file.txt");
    expect(toCwd("@/tmp/file.txt", "/elsewhere")).toBe("/tmp/file.txt");
  });

  it("binds symlink and target to one canonical mutation target", async () => {
    const { dir, path } = await fixture("same"); const link = join(dir, "link"); await symlink(path, link);
    expect((await readChecksum(link)).checksum).toBe((await readChecksum(path)).checksum);
  });

  it("full and paginated reads carry one whole-file checksum", async () => {
    const { path } = await fixture("a\nb\nc\n");
    const full = await fmtReadPreviewStreamed(path, {}), partial = await fmtReadPreviewStreamed(path, { offset: 2, limit: 1 });
    expect(full.checksum).toBe(partial.checksum);
    expect(full.text).toContain(`checksum:${full.checksum}`);
    expect(partial.text).toContain("2│b");
  });
});

describe("numeric edit", () => {
  it("applies bulk ranges against original positions", () => {
    const result = applyEdits("a\nb\nc\nd", parseEdits([
      { range: [2, 2], content_lines: ["B", "B2"] },
      { range: [4, 4], content_lines: ["D"] },
    ]));
    expect(result.content).toBe("a\nB\nB2\nc\nD");
    expect(result.changedRegions).toEqual([{ first: 2, last: 3 }, { first: 5, last: 5 }]);
    const shifted = applyEdits("a\nb\nc\nd\ne", parseEdits([
      { range: [2, 2], content_lines: ["B", "B2"] },
      { range: [4, 4], content_lines: [] },
    ]));
    expect(shifted.content).toBe("a\nB\nB2\nc\ne");
    expect(shifted.changedRegions).toEqual([{ first: 2, last: 3 }, { first: 5, last: 5 }]);
  });

  it("rejects overlap, invalid ranges, copied rows, and embedded line breaks", () => {
    expect(() => applyEdits("a\nb", parseEdits([{ range: [1, 2], content_lines: [] }, { range: [2, 2], content_lines: [] }]))).toThrow("E_EDIT_CONFLICT");
    expect(() => applyEdits("a\nb", parseEdits([{ range: [1, 1], content_lines: ["a"] }, { range: [1, 2], content_lines: ["A"] }]))).toThrow("E_EDIT_CONFLICT");
    expect(() => parseEdits([{ range: [0, 1], content_lines: [] }])).toThrow("E_BAD_RANGE");
    expect(() => parseEdits([{ range: [1.5, 2], content_lines: [] }])).toThrow("E_BAD_RANGE");
    expect(() => applyEdits("a", parseEdits([{ range: [2, 2], content_lines: [] }]))).toThrow("E_BAD_RANGE");
    expect(() => parseEdits([null] as any)).toThrow("E_BAD_SHAPE");
    expect(() => parseEdits([{ range: [1, 1], content_lines: ["a\nb"] }])).toThrow("line break");
    expect(() => applyEdits("a", parseEdits([{ range: [1, 1], content_lines: ["1│a"] }]))).toThrow("E_COPIED_ROW");
    expect(() => applyEdits("a\nb", parseEdits([{ range: [2, 2], content_lines: ["1│a"] }]))).toThrow("E_COPIED_ROW");
  });

  it("edits empty files and preserves terminal newline", () => {
    expect(applyEdits("", parseEdits([{ range: [1, 1], content_lines: ["x"] }])).content).toBe("x");
    expect(applyEdits("a\n", parseEdits([{ range: [1, 1], content_lines: ["b"] }])).content).toBe("b\n");
    expect(() => applyEdits("a\n", parseEdits([{ range: [2, 2], content_lines: ["x"] }]))).toThrow("E_BAD_RANGE");
  });
});

describe("replace guard", () => {
  it("rejects every class of post-read raw-byte change", async () => {
    const mutations = [
      "a\nX\nc",
      "a\nb\nb\nc",
      "z\na\nb\nc",
      "\ufeffa\nb\nc",
      "a\r\nb\r\nc",
      "a\nb \nc",
    ];
    for (const mutation of mutations) {
      const { path, dir } = await fixture("a\nb\nc"); const read = await readChecksum(path);
      await writeFile(path, mutation);
      await expect(execPipeline({ path, checksum: read.checksum, changes: [{ range: [1, 1], content_lines: ["A"] }] }, dir, 4)).rejects.toThrow("E_STALE_CHECKSUM");
    }
  });

  it("validates edits before file I/O and does not warn that a noop normalizes endings", async () => {
    await expect(execPipeline({ path: "/missing", checksum: fileChecksum("/missing", Buffer.alloc(0)), changes: [null] } as any, ".", 4)).rejects.toThrow("E_BAD_SHAPE");
    const { path, dir } = await fixture("a\r\nb\n"); const read = await readChecksum(path);
    const result = await execPipeline({ path, checksum: read.checksum, changes: [{ range: [1, 1], content_lines: ["a"] }] }, dir, 4);
    expect(result.warnings).toEqual([]);
  });

  it("is stateless and returns the new checksum after atomic write", async () => {
    const { path, dir } = await fixture("a\nb"); const read = await readChecksum(path);
    const tool = buildToolDef() as any;
    const result = await tool.execute("id", { path, checksum: read.checksum, changes: [{ range: [2, 2], content_lines: ["B"] }] }, undefined, undefined, { cwd: dir });
    expect(await readFile(path, "utf8")).toBe("a\nB");
    expect(result.details.checksum).toBe((await readChecksum(path)).checksum);
  });

  it("rechecks the checksum immediately before writing", async () => {
    const { path, dir } = await fixture("a\nb"); const read = await readChecksum(path);
    let reads = 0;
    checksumHook.beforeRead = async () => { if (++reads === 2) await writeFile(path, "raced"); };
    try {
      await expect((buildToolDef() as any).execute("id", { path, checksum: read.checksum, changes: [{ range: [1, 1], content_lines: ["A"] }] }, undefined, undefined, { cwd: dir })).rejects.toThrow("E_STALE_CHECKSUM");
      expect(await readFile(path, "utf8")).toBe("raced");
    } finally { checksumHook.beforeRead = undefined; }
  });

  it("edits symlink targets consistently and preserves permissions", async () => {
    const { dir, path } = await fixture("a", "target.txt"); const link = join(dir, "link.txt"); await symlink(path, link); await chmod(path, 0o640);
    const read = await readChecksum(link);
    const result = await (buildToolDef() as any).execute("id", { path: link, checksum: read.checksum, changes: [{ range: [1, 1], content_lines: ["A"] }] }, undefined, undefined, { cwd: dir });
    expect(await readFile(path, "utf8")).toBe("A");
    expect((await stat(path)).mode & 0o777).toBe(0o640);
    expect(result.details.checksum).toBe((await readChecksum(path)).checksum);
  });

  it("rewrites invalid UTF-8 explicitly and warns on mixed endings", async () => {
    const invalid = await fixture(Buffer.from([0x61, 0xff])); const invalidRead = await fmtReadPreviewStreamed(invalid.path, {});
    expect(invalidRead.hadUtf8DecodeErrors).toBe(true);
    const invalidResult = await (buildToolDef() as any).execute("id", { path: invalid.path, checksum: invalidRead.checksum, changes: [{ range: [1, 1], content_lines: ["ok"] }] }, undefined, undefined, { cwd: invalid.dir });
    expect(invalidResult.content[0].text).toContain("rewrote the file as UTF-8");
    expect(await readFile(invalid.path, "utf8")).toBe("ok");
    const mixed = await fixture("a\r\nb\n"); const mixedRead = await readChecksum(mixed.path);
    const result = await (buildToolDef() as any).execute("id", { path: mixed.path, checksum: mixedRead.checksum, changes: [{ range: [1, 1], content_lines: ["A"] }] }, undefined, undefined, { cwd: mixed.dir });
    expect(result.content[0].text).toContain("W_MIXED_EOL");
    expect(await readFile(mixed.path, "utf8")).toBe("A\r\nb\r\n");
  });

  it("rejects missing and malformed checksums", async () => {
    const tool = buildToolDef() as any;
    await expect(tool.execute("id", { path: "x", changes: [{ range: [1, 1], content_lines: [] }] }, undefined, undefined, { cwd: "." })).rejects.toThrow("E_BAD_CHECKSUM");
    await expect(tool.execute("id", { path: "x", checksum: "bad", changes: [{ range: [1, 1], content_lines: [] }] }, undefined, undefined, { cwd: "." })).rejects.toThrow("E_BAD_CHECKSUM");
  });
});

describe("diff summary", () => {
  it("keeps late-file context and line numbers accurate", () => {
    const original = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`);
    const changed = [...original]; changed[99] = "changed";
    const result = genDiff(original.join("\n"), changed.join("\n"), 2);
    expect(result.firstChangedLine).toBe(100);
    expect(result.diff).toBe(" 98│line 98\n 99│line 99\n-line 100\n+100│changed\n 101│line 101\n 102│line 102");
  });
});

describe("sparse auto-read allocation", () => {
  it("prioritizes every changed row then shares context", () => {
    const result = sparseRows(1000, [{ first: 100, last: 100 }, { first: 900, last: 900 }], 10, 32);
    expect(result.rows).toContain(100); expect(result.rows).toContain(900);
    expect(result.rows.some(n => n < 100)).toBe(true); expect(result.rows.some(n => n > 900)).toBe(true);
  });

  it("gives each window context before adding a second side", () => {
    const regions = [100, 300, 500, 700].map(first => ({ first, last: first }));
    const result = sparseRows(1000, regions, 8, 32);
    for (const region of regions) expect(result.rows).toContain(region.first - 1);
  });

  it("marks changed regions omitted by mandatory cap", () => {
    const result = sparseRows(100, [{ first: 1, last: 10 }, { first: 90, last: 100 }], 12, 0);
    expect(result.omitted).toEqual([{ first: 90, last: 100 }]);
  });

  it("preserves hard caps while marking omitted mandatory output", () => {
    const content = Array.from({ length: 5000 }, (_, i) => `${i + 1}-${"x".repeat(100)}`).join("\n");
    const preview = sparsePreview(content, fileChecksum("/x", Buffer.from(content)), [{ first: 1, last: 5000 }]);
    expect(Buffer.byteLength(preview)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
    expect(preview.split("\n").length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
    expect(preview).toContain("Changed regions omitted by cap: 1-5000");
  });

  it("does not spend row budget on distant-window separators", () => {
    const content = Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`).join("\n");
    const regions = Array.from({ length: 1500 }, (_, i) => ({ first: i * 2 + 1, last: i * 2 + 1 }));
    const preview = sparsePreview(content, fileChecksum("/x", Buffer.from(content)), regions);
    expect(preview).toContain("2999│line 2999");
    expect(preview).not.toContain("omitted");
    expect(preview.split("\n").length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
  });

  it("deduplicates only the matching replace checksum", async () => {
    const { path, dir } = await fixture("a");
    const checksum = (await readChecksum(path)).checksum;
    let toolResult: any;
    extension({ registerTool() {}, registerCommand() {}, on(name: string, handler: any) { if (name === "tool_result") toolResult = handler; }, getActiveTools() { return []; }, setActiveTools() {} } as any);
    const run = async (shown: string) => toolResult({ toolName: "replace", isError: false, input: { path }, details: { changedRegions: [{ first: 1, last: 1 }] }, content: [{ type: "text", text: `checksum:${shown}` }] }, { cwd: dir });
    const same = (await run(checksum)).content.map((part: any) => part.text).join("\n");
    expect(same.split(`checksum:${checksum}`).length - 1).toBe(1);
    const prior = fileChecksum(path, Buffer.from("prior"));
    const changed = (await run(prior)).content.map((part: any) => part.text).join("\n");
    expect(changed).toContain(`checksum:${prior}`);
    expect(changed).toContain(`checksum:${checksum}`);
  });
});
