import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { snapshotTag, readSnapshot } from "../src/snapshot";
import { applyEdits, parseEdits } from "../src/hashline";
import { fmtReadPreviewStreamed } from "../src/read";
import { buildToolDef, execPipeline } from "../src/replace";
import { genDiff } from "../src/replace-diff";
import { sparseRows } from "../index";

const dirs: string[] = [];
async function fixture(content: string | Buffer, name = "file.txt") {
  const dir = await mkdtemp(join(tmpdir(), "linehash-v2-")); dirs.push(dir);
  const path = join(dir, name); await writeFile(path, content); return { dir, path };
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe("snapshot v2", () => {
  it("has fixed shape, is deterministic, path-bound, and byte-sensitive", () => {
    const a = snapshotTag("/a", Buffer.from("x"));
    expect(a).toMatch(/^s2:[A-Za-z0-9_-]{22}$/);
    expect(snapshotTag("/a", Buffer.from("x"))).toBe(a);
    expect(snapshotTag("/b", Buffer.from("x"))).not.toBe(a);
    for (const raw of ["x ", "x\n", "\ufeffx", "x\r\n"]) expect(snapshotTag("/a", Buffer.from(raw))).not.toBe(a);
  });

  it("binds symlink and target to one canonical mutation target", async () => {
    const { dir, path } = await fixture("same"); const link = join(dir, "link"); await symlink(path, link);
    expect((await readSnapshot(link)).snapshot).toBe((await readSnapshot(path)).snapshot);
  });

  it("full and paginated reads carry one whole-file snapshot", async () => {
    const { path } = await fixture("a\nb\nc\n");
    const full = await fmtReadPreviewStreamed(path, {}), partial = await fmtReadPreviewStreamed(path, { offset: 2, limit: 1 });
    expect(full.snapshot).toBe(partial.snapshot);
    expect(full.text).toContain(`snapshot:${full.snapshot}`);
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
  });

  it("rejects overlap, invalid ranges, copied rows, and embedded line breaks", () => {
    expect(() => applyEdits("a\nb", parseEdits([{ range: [1, 2], content_lines: [] }, { range: [2, 2], content_lines: [] }]))).toThrow("E_EDIT_CONFLICT");
    expect(() => applyEdits("a\nb", parseEdits([{ range: [1, 1], content_lines: ["a"] }, { range: [1, 2], content_lines: ["A"] }]))).toThrow("E_EDIT_CONFLICT");
    expect(() => parseEdits([{ range: [0, 1], content_lines: [] }])).toThrow("E_BAD_RANGE");
    expect(() => parseEdits([null] as any)).toThrow("E_BAD_SHAPE");
    expect(() => parseEdits([{ range: [1, 1], content_lines: ["a\nb"] }])).toThrow("line break");
    expect(() => applyEdits("a", parseEdits([{ range: [1, 1], content_lines: ["1│a"] }]))).toThrow("E_COPIED_ROW");
  });

  it("edits empty files and preserves terminal newline", () => {
    expect(applyEdits("", parseEdits([{ range: [1, 1], content_lines: ["x"] }])).content).toBe("x");
    expect(applyEdits("a\n", parseEdits([{ range: [1, 1], content_lines: ["b"] }])).content).toBe("b\n");
    expect(() => applyEdits("a\n", parseEdits([{ range: [2, 2], content_lines: ["x"] }]))).toThrow("E_BAD_RANGE");
  });
});

describe("replace guard", () => {
  it("rejects any unrelated post-read byte change", async () => {
    const { path, dir } = await fixture("a\nb\nc"); const snap = await readSnapshot(path);
    await writeFile(path, "a\nb \nc");
    await expect(execPipeline({ path, snapshot: snap.snapshot, changes: [{ range: [1, 1], content_lines: ["A"] }] }, dir, 4)).rejects.toThrow("E_STALE_SNAPSHOT");
  });

  it("validates edits before file I/O and does not warn that a noop normalizes endings", async () => {
    await expect(execPipeline({ path: "/missing", snapshot: snapshotTag("/missing", Buffer.alloc(0)), changes: [null] } as any, ".", 4)).rejects.toThrow("E_BAD_SHAPE");
    const { path, dir } = await fixture("a\r\nb\n"); const snap = await readSnapshot(path);
    const result = await execPipeline({ path, snapshot: snap.snapshot, changes: [{ range: [1, 1], content_lines: ["a"] }] }, dir, 4);
    expect(result.warnings).toEqual([]);
  });

  it("is stateless and returns the new snapshot after atomic write", async () => {
    const { path, dir } = await fixture("a\nb"); const snap = await readSnapshot(path);
    const tool = buildToolDef() as any;
    const result = await tool.execute("id", { path, snapshot: snap.snapshot, changes: [{ range: [2, 2], content_lines: ["B"] }] }, undefined, undefined, { cwd: dir });
    expect(await readFile(path, "utf8")).toBe("a\nB");
    expect(result.details.snapshot).toBe((await readSnapshot(path)).snapshot);
  });

  it("rejects legacy requests concisely", async () => {
    const tool = buildToolDef() as any;
    await expect(tool.execute("id", { path: "x", changes: [{ hash_range_inclusive: ["1", "1"], content_lines: [] }] }, undefined, undefined, { cwd: "." })).rejects.toThrow("E_LEGACY_SHAPE");
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

  it("marks changed regions omitted by mandatory cap", () => {
    const result = sparseRows(100, [{ first: 1, last: 10 }, { first: 90, last: 100 }], 12, 0);
    expect(result.omitted).toEqual([{ first: 90, last: 100 }]);
  });
});
