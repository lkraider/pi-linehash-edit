import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, readFile, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileChecksum, readChecksum } from "../src/checksum";
import { applyEdits, parseEdits, changedRange } from "../src/line-edit";
import { visLines } from "../src/utils";
import { fmtReadPreviewStreamed, sparsePreview, sparseRows } from "../src/read";
import { buildToolDef, execPipeline } from "../src/replace";
import { genDiff, decodeNormalized } from "../src/replace-diff";
import extension from "../index";
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

  it("rejects copied rows even when the copied text was edited", () => {
    // Edited copies used to slip the verbatim-equality guard and get written into the file — corruption.
    expect(() => applyEdits("hello", parseEdits([{ range: [1, 1], content_lines: ["1│goodbye"] }]))).toThrow("E_COPIED_ROW");
    // The deepseek failure mode: whole-region echo of read output.
    expect(() => applyEdits("a\nb\nc", parseEdits([{ range: [1, 3], content_lines: ["1│A", "2│B", "3│C"] }]))).toThrow("E_COPIED_ROW");
  });

  it("keeps legitimate content that happens to start with digits then a bar", () => {
    // Counterfactuals a naive "^\\d+│" or "prefix-in-range" guard would wrongly reject.
    // Out-of-position number: real content, not a copy of any read row.
    expect(applyEdits("x\ny\nz", parseEdits([{ range: [2, 2], content_lines: ["42│answer"] }])).content).toBe("x\n42│answer\nz");
    // A file that genuinely uses "N│" columns must stay editable.
    expect(applyEdits("1│Alice\n2│Bob\n3│Carol", parseEdits([{ range: [2, 2], content_lines: ["2│Robert"] }])).content).toBe("1│Alice\n2│Robert\n3│Carol");
  });

  it("edits empty files and preserves terminal newline", () => {
    expect(applyEdits("", parseEdits([{ range: [1, 1], content_lines: ["x"] }])).content).toBe("x");
    expect(applyEdits("a\n", parseEdits([{ range: [1, 1], content_lines: ["b"] }])).content).toBe("b\n");
    expect(() => applyEdits("a\n", parseEdits([{ range: [2, 2], content_lines: ["x"] }]))).toThrow("E_BAD_RANGE");
  });
});

describe("applyEdits properties", () => {
  // Safety net for the P2 refactor (collapse the three sorts / repeated splits). Everything below is
  // pinned EXCEPT warning emission order, which the refactor is allowed to change (asserted as a set).
  const ALPHA = ["a", "b", "c", "d", ""]; // duplicates + empty lines so noop/dup/deletion all fire
  const rng = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  const pick = <T>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const byRegion = (a: { first: number }, b: { first: number }) => a.first - b.first;
  const nonEmpty = (xs: string[]) => xs.filter(x => x.length);
  const firstDiff = (a: string[], b: string[]) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i + 1; return undefined; };
  const lineCountOf = (content: string) => Math.max(1, visLines(content).length);
  const isNoop = (lines: string[], e: Edit) => { const t = lines.slice(e.range[0] - 1, e.range[1]); return t.length === e.content_lines.length && t.every((l, k) => l === e.content_lines[k]); };
  type Edit = { range: [number, number]; content_lines: string[] };

  const genContent = (r: () => number) => { const n = Math.floor(r() * 7); const body = Array.from({ length: n }, () => pick(r, ALPHA)).join("\n"); return n > 0 && r() < 0.5 ? body + "\n" : body; };
  function genDisjointEdits(r: () => number, lineCount: number): Edit[] {
    const edits: Edit[] = [];
    for (let pos = 1; pos <= lineCount;) {
      if (r() < 0.45) { pos += 1 + Math.floor(r() * 2); continue; }
      const start = pos, end = Math.min(lineCount, start + Math.floor(r() * 3));
      edits.push({ range: [start, end], content_lines: Array.from({ length: Math.floor(r() * 4) }, () => pick(r, ALPHA)) });
      pos = end + 1;
    }
    return edits;
  }
  const shuffle = (r: () => number, xs: Edit[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
  // Independent oracle: walk the original lines, substituting each disjoint range in ascending order.
  function oracle(content: string, edits: Edit[]): string {
    const lines = content.split("\n"), out: string[] = []; let cursor = 1;
    for (const e of [...edits].sort((a, b) => a.range[0] - b.range[0])) {
      for (; cursor < e.range[0]; cursor++) out.push(lines[cursor - 1]!);
      out.push(...e.content_lines); cursor = e.range[1] + 1;
    }
    for (; cursor <= lines.length; cursor++) out.push(lines[cursor - 1]!);
    return out.join("\n");
  }
  // Region formula restated to lock it across the refactor; output correctness is proven independently
  // by the content oracle above, so this only guards that regions keep tracking the same positions.
  function oracleRegions(content: string, edits: Edit[]) {
    const lines = content.split("\n"), outCount = Math.max(1, visLines(oracle(content, edits)).length);
    const regions: { first: number; last: number }[] = [];
    let shift = 0;
    for (const e of edits.filter(x => !isNoop(lines, x)).sort((a, b) => a.range[0] - b.range[0])) {
      const start = e.range[0] + shift, last = e.content_lines.length ? start + e.content_lines.length - 1 : Math.max(1, start);
      regions.push({ first: Math.min(start, outCount), last: Math.min(last, outCount) });
      shift += e.content_lines.length - (e.range[1] - e.range[0] + 1);
    }
    return regions;
  }

  it("content matches an independent oracle and is invariant under input reordering", () => {
    const r = rng(1);
    for (let iter = 0; iter < 500; iter++) {
      const content = genContent(r), edits = genDisjointEdits(r, lineCountOf(content));
      const applied = applyEdits(content, parseEdits(edits));
      expect(applied.content).toBe(oracle(content, edits));
      const reordered = applyEdits(content, parseEdits(shuffle(r, edits)));
      expect(reordered.content).toBe(applied.content);
      expect([...reordered.changedRegions].sort(byRegion)).toEqual([...applied.changedRegions].sort(byRegion));
    }
  });

  it("flags exactly the edits whose target already equals the replacement, and excludes them from regions", () => {
    const r = rng(2);
    for (let iter = 0; iter < 500; iter++) {
      const content = genContent(r), lines = content.split("\n"), edits = genDisjointEdits(r, lineCountOf(content));
      const applied = applyEdits(content, parseEdits(edits)), noop = new Set(applied.noopEdits ?? []);
      edits.forEach((e, i) => expect(noop.has(i)).toBe(isNoop(lines, e)));
      expect(applied.changedRegions.length).toBe(edits.length - noop.size);
    }
  });

  it("each non-noop region indexes exactly its replacement content in output coordinates", () => {
    const r = rng(3);
    for (let iter = 0; iter < 500; iter++) {
      const content = genContent(r), lines = content.split("\n"), edits = genDisjointEdits(r, lineCountOf(content));
      const applied = applyEdits(content, parseEdits(edits));
      const out = visLines(applied.content), outCount = Math.max(1, out.length);
      expect(applied.changedRegions).toEqual(oracleRegions(content, edits)); // refactor lock (formula restated)
      const nonNoop = edits.filter(e => !isNoop(lines, e)).sort((a, b) => a.range[0] - b.range[0]);
      expect(applied.changedRegions.length).toBe(nonNoop.length);
      applied.changedRegions.forEach((reg, k) => {
        expect(reg.first).toBeGreaterThanOrEqual(1); expect(reg.last).toBeLessThanOrEqual(outCount); expect(reg.first).toBeLessThanOrEqual(reg.last);
        // First is non-decreasing; a collapsed deletion region may touch the next, so not strictly >.
        if (k > 0) expect(reg.first).toBeGreaterThanOrEqual(applied.changedRegions[k - 1]!.first);
        // Independent correctness (no formula re-encoding): an interior region indexes exactly its own
        // replacement content. EOF regions can mark a trailing-newline change with no visible line to
        // point at, so those are covered only by the formula lock above.
        const e = nonNoop[k]!;
        if (!e.content_lines.length) expect(reg.first).toBe(reg.last); // deletion collapses to a point
        else if (reg.last < outCount) expect(out.slice(reg.first - 1, reg.last)).toEqual(e.content_lines);
      });
    }
  });

  it("emits W_DUP exactly when a replacement abuts a matching surviving neighbor (order not pinned)", () => {
    const r = rng(4);
    for (let iter = 0; iter < 500; iter++) {
      const content = genContent(r), lines = content.split("\n"), edits = genDisjointEdits(r, lineCountOf(content));
      const applied = applyEdits(content, parseEdits(edits)), expected: string[] = [];
      edits.forEach((e, i) => {
        if (isNoop(lines, e)) return;
        const ne = nonEmpty(e.content_lines), before = lines[e.range[0] - 2], after = lines[e.range[1]];
        if (ne[0] !== undefined && ne[0] === before) expected.push(`[W_DUP] Edit ${i}: content_lines starts with the preceding surviving line.`);
        if (ne.at(-1) !== undefined && ne.at(-1) === after) expected.push(`[W_DUP] Edit ${i}: content_lines ends with the next surviving line.`);
      });
      expect([...(applied.warnings ?? [])].sort()).toEqual(expected.sort());
    }
  });

  it("firstChangedLine marks the first differing line; unchanged output reports neither bound", () => {
    const r = rng(5);
    for (let iter = 0; iter < 500; iter++) {
      const content = genContent(r), edits = genDisjointEdits(r, lineCountOf(content));
      const applied = applyEdits(content, parseEdits(edits));
      // Exact, independent of the diff internals. (Deleting the last line legitimately points one past EOF.)
      expect(applied.firstChangedLine).toBe(firstDiff(content.split("\n"), applied.content.split("\n")));
      if (applied.content === content) { expect(applied.firstChangedLine).toBeUndefined(); expect(applied.lastChangedLine).toBeUndefined(); }
      else expect(applied.lastChangedLine).toBeGreaterThanOrEqual(applied.firstChangedLine!);
    }
  });

  it("rejects overlap regardless of order, allows adjacency, rejects out-of-bounds", () => {
    expect(() => applyEdits("a\nb\nc", parseEdits([{ range: [1, 2], content_lines: ["X"] }, { range: [2, 3], content_lines: ["Y"] }]))).toThrow("E_EDIT_CONFLICT");
    expect(() => applyEdits("a\nb\nc", parseEdits([{ range: [2, 3], content_lines: ["Y"] }, { range: [1, 2], content_lines: ["X"] }]))).toThrow("E_EDIT_CONFLICT");
    expect(applyEdits("a\nb\nc", parseEdits([{ range: [1, 1], content_lines: ["X"] }, { range: [2, 2], content_lines: ["Y"] }])).content).toBe("X\nY\nc");
    expect(() => applyEdits("a\nb", parseEdits([{ range: [2, 3], content_lines: ["x"] }]))).toThrow("E_BAD_RANGE");
    expect(() => applyEdits("a\nb", parseEdits([{ range: [3, 3], content_lines: ["x"] }]))).toThrow("E_BAD_RANGE");
  });

  it("shifts later regions by the growth of earlier edits", () => {
    const applied = applyEdits("a\nb\nc", parseEdits([{ range: [1, 1], content_lines: ["x", "y", "z"] }, { range: [3, 3], content_lines: ["C"] }]));
    expect(applied.content).toBe("x\ny\nz\nb\nC");
    expect(applied.changedRegions).toEqual([{ first: 1, last: 3 }, { first: 5, last: 5 }]);
  });
});

describe("changedRange properties", () => {
  const rng = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
  const ALPHA = ["a", "b", "c", ""];
  const commonPrefix = (a: string[], b: string[]) => { let i = 0; while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++; return i; };

  it("returns null iff equal, with an unchanged prefix and an unchanged suffix aligned to the original", () => {
    const r = rng(9);
    for (let iter = 0; iter < 3000; iter++) {
      const a = Array.from({ length: Math.floor(r() * 6) }, () => ALPHA[Math.floor(r() * ALPHA.length)]!);
      const b = Array.from({ length: Math.floor(r() * 6) }, () => ALPHA[Math.floor(r() * ALPHA.length)]!);
      const aStr = a.join("\n"), bStr = b.join("\n"), cr = changedRange(aStr, bStr);
      if (aStr === bStr) { expect(cr).toBeNull(); continue; }
      expect(cr).not.toBeNull();
      // Compare on the split representation changedRange operates on ([] and [""] both join to "").
      const al = aStr.split("\n"), bl = bStr.split("\n"), first = cr!.firstChangedLine, last = cr!.lastChangedLine;
      expect(first).toBe(commonPrefix(al, bl) + 1);            // first = one past the longest common prefix
      expect(last).toBeGreaterThanOrEqual(first);
      expect(bl.slice(0, first - 1)).toEqual(al.slice(0, first - 1)); // everything before the window is unchanged
      const suffixLen = bl.length - last;
      if (suffixLen > 0) expect(bl.slice(last)).toEqual(al.slice(al.length - suffixLen)); // tail after window matches original tail
    }
  });

  it("pins unambiguous edits and documents the trailing-deletion convention", () => {
    expect(changedRange("x\ny\nz", "x\ny\nz")).toBeNull();
    expect(changedRange("x\ny\nz", "x\nN\ny\nz")).toEqual({ firstChangedLine: 2, lastChangedLine: 2 }); // middle insert
    expect(changedRange("x\ny\nz", "x\nP\nQ\nz")).toEqual({ firstChangedLine: 2, lastChangedLine: 3 }); // one line -> two
    expect(changedRange("x\ny\nz", "x\nz")).toEqual({ firstChangedLine: 2, lastChangedLine: 2 });       // middle delete
    expect(changedRange("y\nz", "x\ny\nz")).toEqual({ firstChangedLine: 1, lastChangedLine: 1 });       // leading insert
    expect(changedRange("a\nb", "x\ny")).toEqual({ firstChangedLine: 1, lastChangedLine: 2 });          // full replace
    expect(changedRange("a", "a\nb")).toEqual({ firstChangedLine: 2, lastChangedLine: 2 });             // append
    // Pure trailing deletion points one past the new end (the removed line's old number); auto-read clamps it.
    expect(changedRange("a\nb\nc", "a\nb")).toEqual({ firstChangedLine: 3, lastChangedLine: 3 });
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

  it("hands back the current checksum and region content on stale, so recovery needs no extra read", async () => {
    const { path, dir } = await fixture("a\nb\nc"); const read = await readChecksum(path);
    await writeFile(path, "a\nCHANGED\nc"); const current = await readChecksum(path);
    const err = await execPipeline({ path, checksum: read.checksum, changes: [{ range: [2, 2], content_lines: ["B"] }] }, dir, 4).catch(e => String(e));
    expect(err).toContain("E_STALE_CHECKSUM");
    expect(err).toContain(current.checksum);   // fresh checksum, computed independently — retry needs no read
    expect(err).toContain("CHANGED");          // current content of the region the model tried to edit
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

describe("decodeNormalized", () => {
  it("single-pass decodes valid UTF-8 and falls back on invalid bytes with BOM and mixed endings intact", () => {
    expect(decodeNormalized(Buffer.from("x\ny\n"))).toEqual({ normalized: "x\ny\n", bom: "", originalEnding: "\n", hadMixedEndings: false, hadUtf8DecodeErrors: false });
    // BOM + CRLF then LF (mixed) + a lone invalid byte: the fallback path must strip the BOM,
    // report the decode error, normalize endings, and keep U+FFFD for the bad byte.
    const raw = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0x62, 0x0a, 0xff]);
    expect(decodeNormalized(raw)).toEqual({ normalized: "a\nb\n�", bom: "﻿", originalEnding: "\r\n", hadMixedEndings: true, hadUtf8DecodeErrors: true });
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
