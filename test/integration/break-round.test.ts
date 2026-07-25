import { describe, it, expect } from "vitest";
import { readFile, writeFile } from "fs/promises";
import {
  withTempFile,
  setupIntegrationTest,
  getText,
  extractHash,
  anchorAt,
} from "../support/fixtures";
import {
  applyEdits,
  parseEdits,
  changedRange,
  lineHash,
  lineHashes,
} from "../../src/hashline";
import { normReq } from "../../src/replace-normalize";

// Adversarial break round. These tests assert the contract the tool claims
// ("no breakage, no rework"; anchors detect drift; literal content is written
// literally). Failures are findings, not test bugs.

describe("BREAK: stale-anchor detection blind spots", () => {
  it("rejects an anchor when the line gained trailing whitespace on disk", async () => {
    const file = "alpha\nbeta\ngamma\n";
    await withTempFile("ws-drift.txt", file, async ({ cwd, path }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);
      const read1 = await readTool.execute("r1", { path: "ws-drift.txt" }, undefined, undefined, ctx);
      const betaAnchor = extractHash(getText(read1).split("\n").find((l) => l.endsWith("│beta"))!);

      // External change: beta gains trailing spaces. Content on disk differs
      // from what the anchor was read against.
      await writeFile(path, "alpha\nbeta   \ngamma\n");

      await expect(
        editTool.execute(
          "e1",
          { path: "ws-drift.txt", changes: [{ hash_range_inclusive: [betaAnchor, betaAnchor], content_lines: ["BETA"] }] },
          undefined, undefined, ctx,
        ),
      ).rejects.toThrow(/E_STALE_ANCHOR/);
    });
  });

  it("rejects an anchor when the line was replaced by hash-colliding content", async () => {
    // 12-bit hash space: find two different lines with the same lineHash.
    const seen = new Map<string, string>();
    let a = "", b = "";
    for (let i = 0; i < 20000; i++) {
      const candidate = `v${i}`;
      const h = lineHash(candidate);
      const prior = seen.get(h);
      if (prior !== undefined) {
        a = prior;
        b = candidate;
        break;
      }
      seen.set(h, candidate);
    }
    expect(a).not.toBe("");

    const file = `top\n${a}\nbottom\n`;
    await withTempFile("collide.txt", file, async ({ cwd, path }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);
      const read1 = await readTool.execute("r1", { path: "collide.txt" }, undefined, undefined, ctx);
      const anchor = extractHash(getText(read1).split("\n").find((l) => l.endsWith(`│${a}`))!);

      // External change: line 2 replaced by different content with the same hash.
      await writeFile(path, `top\n${b}\nbottom\n`);

      await expect(
        editTool.execute(
          "e1",
          { path: "collide.txt", changes: [{ hash_range_inclusive: [anchor, anchor], content_lines: ["overwritten"] }] },
          undefined, undefined, ctx,
        ),
      ).rejects.toThrow(/E_STALE_ANCHOR/);
    });
  });
});

describe("BREAK: input gates reject legitimate literal content", () => {
  it("writes a literal line that happens to look like a diff-preview '+' row", async () => {
    const file = "a\nb\n";
    await withTempFile("plus-row.txt", file, async ({ cwd, path }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);
      const read1 = await readTool.execute("r1", { path: "plus-row.txt" }, undefined, undefined, ctx);
      const anchor = extractHash(getText(read1).split("\n")[0]!);

      // Legitimate content, e.g. documentation about this very tool.
      await editTool.execute(
        "e1",
        { path: "plus-row.txt", changes: [{ hash_range_inclusive: [anchor, anchor], content_lines: ["+1:aB│example"] }] },
        undefined, undefined, ctx,
      );

      expect(await readFile(path, "utf-8")).toBe("+1:aB│example\nb\n");
    });
  });

  it("writes a literal column-aligned negative number line", async () => {
    const file = "a\nb\n";
    await withTempFile("minus-col.txt", file, async ({ cwd, path }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);
      const read1 = await readTool.execute("r1", { path: "minus-col.txt" }, undefined, undefined, ctx);
      const anchor = extractHash(getText(read1).split("\n")[0]!);

      // "-3    total" is plain data (negative value, 4-space column), not a diff row.
      await editTool.execute(
        "e1",
        { path: "minus-col.txt", changes: [{ hash_range_inclusive: [anchor, anchor], content_lines: ["-3    total"] }] },
        undefined, undefined, ctx,
      );

      expect(await readFile(path, "utf-8")).toBe("-3    total\nb\n");
    });
  });

  it("writes a literal line that coincides with a real file anchor prefix", async () => {
    const file = "a\nb\n";
    await withTempFile("bare-prefix.txt", file, async ({ cwd, path }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);
      const read1 = await readTool.execute("r1", { path: "bare-prefix.txt" }, undefined, undefined, ctx);
      const lines = getText(read1).split("\n");
      const anchor1 = extractHash(lines[0]!); // real anchor for line 1
      const anchor2 = extractHash(lines[1]!);

      // Literal content that quotes line 1's own anchor (e.g. a log or doc).
      const literal = `${anchor1}│quoted`;
      await editTool.execute(
        "e1",
        { path: "bare-prefix.txt", changes: [{ hash_range_inclusive: [anchor2, anchor2], content_lines: [literal] }] },
        undefined, undefined, ctx,
      );

      expect(await readFile(path, "utf-8")).toBe(`a\n${literal}\n`);
    });
  });
});

describe("BREAK: span math on deletions", () => {
  it("deletes two adjacent lines when the second is the final line without a trailing newline", () => {
    const content = "a\nb\nc";
    const hashes = lineHashes(content);
    const edits = parseEdits([
      { content_lines: [], hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)] },
      { content_lines: [], hash_range_inclusive: [anchorAt(hashes, 3), anchorAt(hashes, 3)] },
    ]);

    const result = applyEdits(content, edits);
    expect(result.content).toBe("a");
  });

  it("deletes two non-adjacent lines including the final line (control: should pass)", () => {
    const content = "a\nb\nc\nd";
    const hashes = lineHashes(content);
    const edits = parseEdits([
      { content_lines: [], hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)] },
      { content_lines: [], hash_range_inclusive: [anchorAt(hashes, 4), anchorAt(hashes, 4)] },
    ]);

    const result = applyEdits(content, edits);
    expect(result.content).toBe("a\nc");
  });

  it("rejects two edits targeting the same range with different content (control: should pass)", () => {
    const content = "a\nb\nc";
    const hashes = lineHashes(content);
    const edits = parseEdits([
      { content_lines: ["x"], hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)] },
      { content_lines: ["y"], hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)] },
    ]);

    expect(() => applyEdits(content, edits)).toThrow(/E_EDIT_CONFLICT/);
  });

  it("empties a file that contains only a blank line", () => {
    const content = "\n";
    const hashes = lineHashes(content);
    const edits = parseEdits([
      { content_lines: [], hash_range_inclusive: [anchorAt(hashes, 1), anchorAt(hashes, 1)] },
    ]);

    const result = applyEdits(content, edits);
    expect(result.content).toBe("");
  });
});

describe("BREAK: changedRange accuracy", () => {
  it("reports the full range of a multi-line prepend", () => {
    // Lines 1-2 are new; line 3 is the old line 1.
    expect(changedRange("z\n", "a\nb\nz\n")).toEqual({
      firstChangedLine: 1,
      lastChangedLine: 2,
    });
  });
});

describe("BREAK: request normalization ambiguity", () => {
  it("rejects a request carrying both 'changes' and 'edits'", () => {
    expect(() =>
      normReq({
        path: "f.txt",
        changes: [{ content_lines: ["from-changes"], hash_range_inclusive: ["1:aB", "1:aB"] }],
        edits: [{ content_lines: ["from-edits"], hash_range_inclusive: ["1:aB", "1:aB"] }],
      }),
    ).toThrow(/E_BAD_SHAPE/);
  });
});

describe("BREAK: line-ending fidelity", () => {
  it("leaves untouched lines byte-identical in a mixed-endings file", async () => {
    const file = "one\ntwo\r\nthree\n";
    await withTempFile("mixed.txt", file, async ({ cwd, path }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);
      const read1 = await readTool.execute("r1", { path: "mixed.txt" }, undefined, undefined, ctx);
      const anchor = extractHash(getText(read1).split("\n").find((l) => l.endsWith("│one"))!);

      await editTool.execute(
        "e1",
        { path: "mixed.txt", changes: [{ hash_range_inclusive: [anchor, anchor], content_lines: ["ONE"] }] },
        undefined, undefined, ctx,
      );

      // Only line 1 was edited; line 2's CRLF must survive.
      expect(await readFile(path, "utf-8")).toBe("ONE\ntwo\r\nthree\n");
    });
  });

  it("preserves BOM and uniform CRLF endings (control: should pass)", async () => {
    const file = "﻿one\r\ntwo\r\n";
    await withTempFile("bom-crlf.txt", file, async ({ cwd, path }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);
      const read1 = await readTool.execute("r1", { path: "bom-crlf.txt" }, undefined, undefined, ctx);
      const anchor = extractHash(getText(read1).split("\n").find((l) => l.endsWith("│two"))!);

      await editTool.execute(
        "e1",
        { path: "bom-crlf.txt", changes: [{ hash_range_inclusive: [anchor, anchor], content_lines: ["TWO"] }] },
        undefined, undefined, ctx,
      );

      expect(await readFile(path, "utf-8")).toBe("﻿one\r\nTWO\r\n");
    });
  });
});
