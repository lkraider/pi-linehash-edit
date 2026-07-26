import { describe, expect, it } from "vitest";
import {
  applyEdits,
  lineHashes,
} from "../../src/hashline";
import { anchorAt, fakeAnchor, parseEditsIn } from "../support/fixtures";

describe("resAnchor (via resolveEdits)", () => {
  it("resolves a line:hash anchor that matches the current line exactly", () => {
    const content = "a\nb\nc\nd\ne";
    const hashes = lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: ["X", "Y"] },
    ]));
    expect(result.content).toBe("a\nX\nY\nd\ne");
  });

  it("reports stale for a line number beyond the file", () => {
    const content = "a\nb\nc\nd\ne";
    expect(() =>
      applyEdits(content, parseEditsIn(content, [
        { hash_range_inclusive: [fakeAnchor(99), fakeAnchor(99)], content_lines: ["X"] },
      ]))
    ).toThrow(/E_STALE_ANCHOR/);
  });

  it("reports stale (never ambiguous) when the hash is right but claimed at the wrong line", () => {
    const content = "a\nb\nc\nd\ne";
    const hashes = lineHashes(content);
    const cHash = hashes[2]!;
    expect(() =>
      applyEdits(content, parseEditsIn(content, [
        { hash_range_inclusive: [`1:${cHash}`, `1:${cHash}`], content_lines: ["X"] },
      ]))
    ).toThrow(/E_STALE_ANCHOR/);
  });

  it("addresses one of two lines sharing a hash by line number, never ambiguously", () => {
    const content = "b\nx\nb";
    const hashes = lineHashes(content);
    expect(hashes[0]).toBe(hashes[2]);

    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 3), anchorAt(hashes, 3)], content_lines: ["LAST"] },
    ]));
    expect(result.content).toBe("b\nx\nLAST");
  });
});

describe("checkBoundaryDup (via resolveEdits) — [W_DUP] warning, no auto-fix", () => {
  it("warns on trailing duplication, keeps the duplicate literally", () => {
    const content = "a\nb\nc\nd";
    const hashes = lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: ["X", "d"] },
    ]));
    expect(result.content).toBe("a\nX\nd\nd");
    expect(result.warnings?.some((w) => w.startsWith("[W_DUP]") && w.includes("ends with"))).toBe(true);
  });

  it("warns on leading duplication, keeps the duplicate literally", () => {
    const content = "a\nb\nc\nd";
    const hashes = lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: ["a", "X"] },
    ]));
    expect(result.content).toBe("a\na\nX\nd");
    expect(result.warnings?.some((w) => w.startsWith("[W_DUP]") && w.includes("starts with"))).toBe(true);
  });

  it("does not warn when replacement does not duplicate adjacent lines", () => {
    const content = "a\nb\nc\nd";
    const hashes = lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: ["X", "Y"] },
    ]));
    expect(result.warnings?.some((w) => w.startsWith("[W_DUP]")) ?? false).toBe(false);
  });

  it("does not warn when replacement edge is empty string", () => {
    const content = "a\nb\nc\nd";
    const hashes = lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: [] },
    ]));
    expect(result.warnings?.some((w) => w.startsWith("[W_DUP]")) ?? false).toBe(false);
  });

  it("warns on trailing duplication when content_lines has trailing empty lines", () => {
    const content = "a\nb\nc\nd";
    const hashes = lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: ["X", "d", ""] },
    ]));
    expect(result.content).toBe("a\nX\nd\n\nd");
    expect(result.warnings?.some((w) => w.startsWith("[W_DUP]") && w.includes("ends with") && w.includes("d"))).toBe(true);
  });

  it("warns on leading duplication when content_lines has leading empty lines", () => {
    const content = "a\nb\nc\nd";
    const hashes = lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: ["", "a", "X"] },
    ]));
    expect(result.content).toBe("a\n\na\nX\nd");
    expect(result.warnings?.some((w) => w.startsWith("[W_DUP]") && w.includes("starts with") && w.includes("a"))).toBe(true);
  });

  it("warns twice when both trailing and leading duplicate in one edit", () => {
    const content = "a\nb\nc\nd";
    const hashes = lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: ["a", "d"] },
    ]));
    expect(result.content).toBe("a\na\nd\nd");
    const dupWarnings = result.warnings?.filter((w) => w.startsWith("[W_DUP]")) ?? [];
    expect(dupWarnings).toHaveLength(2);
  });
});

describe("editToSpan (via applyEdits)", () => {
  it("branch: non-empty replacement in middle of file", async () => {
    const content = "a\nb\nc\nd\ne";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: ["X", "Y"] },
    ]));
    expect(result.content).toBe("a\nX\nY\nd\ne");
  });

  it("branch: empty replacement (deletion) in middle of file", async () => {
    const content = "a\nb\nc\nd\ne";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: [] },
    ]));
    expect(result.content).toBe("a\nd\ne");
  });

  it("branch: empty replacement covering entire file", async () => {
    const content = "a\nb\nc";
    const hashes = await lineHashes(content);
    expect(() =>
      applyEdits(content, parseEditsIn(content, [
        { hash_range_inclusive: [anchorAt(hashes, 1), anchorAt(hashes, 3)], content_lines: [] },
      ]))
    ).toThrow(/E_WOULD_EMPTY/);
  });

  it("branch: empty replacement ending at last line (not full file)", async () => {
    const content = "a\nb\nc\nd\ne";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 3), anchorAt(hashes, 5)], content_lines: [] },
    ]));
    expect(result.content).toBe("a\nb");
  });

  it("branch: noop detection returns null span", async () => {
    const content = "a\nb\nc";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)], content_lines: ["b"] },
    ]));
    expect(result.noopEdits).toHaveLength(1);
  });

  it("branch: replacement at first line", async () => {
    const content = "a\nb\nc";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 1), anchorAt(hashes, 1)], content_lines: ["X"] },
    ]));
    expect(result.content).toBe("X\nb\nc");
  });

  it("branch: replacement at last line", async () => {
    const content = "a\nb\nc";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 3), anchorAt(hashes, 3)], content_lines: ["X"] },
    ]));
    expect(result.content).toBe("a\nb\nX");
  });

  it("branch: deletion of first line only", async () => {
    const content = "a\nb\nc";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 1), anchorAt(hashes, 1)], content_lines: [] },
    ]));
    expect(result.content).toBe("b\nc");
  });

  it("branch: deletion of last line only", async () => {
    const content = "a\nb\nc";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 3), anchorAt(hashes, 3)], content_lines: [] },
    ]));
    expect(result.content).toBe("a\nb");
  });
});

describe("assemble (via applyEdits)", () => {
  it("applies multiple non-overlapping edits in correct order", async () => {
    const content = "a\nb\nc\nd\ne";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 1), anchorAt(hashes, 1)], content_lines: ["A"] },
      { hash_range_inclusive: [anchorAt(hashes, 3), anchorAt(hashes, 3)], content_lines: ["C"] },
      { hash_range_inclusive: [anchorAt(hashes, 5), anchorAt(hashes, 5)], content_lines: ["E"] },
    ]));
    expect(result.content).toBe("A\nb\nC\nd\nE");
  });

  it("applies edits bottom-up so earlier edits don't shift later offsets", async () => {
    const content = "a\nb\nc\nd\ne";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 1), anchorAt(hashes, 1)], content_lines: [] },
      { hash_range_inclusive: [anchorAt(hashes, 5), anchorAt(hashes, 5)], content_lines: [] },
    ]));
    expect(result.content).toBe("b\nc\nd");
  });
});

describe("editsToSpans (via applyEdits)", () => {
  it("deduplicates identical edits", async () => {
    const content = "a\nb\nc\nd\ne";
    const hashes = await lineHashes(content);
    const hash = anchorAt(hashes, 2);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [hash, hash], content_lines: ["X"] },
      { hash_range_inclusive: [hash, hash], content_lines: ["X"] },
    ]));
    expect(result.content).toBe("a\nX\nc\nd\ne");
  });

  it("throws on overlapping edits", async () => {
    const content = "a\nb\nc\nd\ne";
    const hashes = await lineHashes(content);
    expect(() =>
      applyEdits(content, parseEditsIn(content, [
        { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: ["X"] },
        { hash_range_inclusive: [anchorAt(hashes, 3), anchorAt(hashes, 3)], content_lines: ["Y"] },
      ]))
    ).toThrow(/E_EDIT_CONFLICT/);
  });
});

describe("[W_DUP] warning via applyEdits", () => {
  it("warns on trailing duplication, keeps the duplicate literally", () => {
    const content = "before\nold one\nold two\nafter";
    const hashes = lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: ["new one", "new two", "after"] },
    ]));
    expect(result.warnings?.some((w) => w.startsWith("[W_DUP]") && w.includes("ends with") && w.includes("after"))).toBe(true);
    expect(result.content).toBe("before\nnew one\nnew two\nafter\nafter");
  });

  it("warns on leading duplication, keeps the duplicate literally", () => {
    const content = "before\nold one\nold two\nafter";
    const hashes = lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: ["before", "new one", "new two"] },
    ]));
    expect(result.warnings?.some((w) => w.startsWith("[W_DUP]") && w.includes("starts with") && w.includes("before"))).toBe(true);
    expect(result.content).toBe("before\nbefore\nnew one\nnew two\nafter");
  });

  it("warns twice when both leading and trailing duplicate in one edit", () => {
    const content = "ctx1\nctx2\nold1\nold2\nctx3\nctx4";
    const hashes = lineHashes(content);
    const result = applyEdits(content, parseEditsIn(content, [
      { hash_range_inclusive: [anchorAt(hashes, 3), anchorAt(hashes, 4)], content_lines: ["ctx2", "dup", "dup", "ctx3"] },
    ]));
    const dupWarnings = result.warnings?.filter((w) => w.startsWith("[W_DUP]")) ?? [];
    expect(dupWarnings).toHaveLength(2);
    expect(result.content).toBe("ctx1\nctx2\nctx2\ndup\ndup\nctx3\nctx3\nctx4");
  });
});
