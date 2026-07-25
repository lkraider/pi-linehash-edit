import { describe, expect, it } from "vitest";
import {
  applyEdits,
  lineHashes,
  parseEdits,
} from "../../src/hashline";
import { anchorAt } from "../support/fixtures";

describe("applyEdits — recovery scenarios", () => {
  it("rejects reversed range (start > end)", async () => {
    const content = "a\nb\nc\nd\ne";
    const hashes = await lineHashes(content);
    expect(() =>
      applyEdits(content, parseEdits([
        { hash_range_inclusive: [anchorAt(hashes, 4), anchorAt(hashes, 2)], content_lines: ["X"] },
      ]))
    ).toThrow(/E_BAD_OP/);
  });

  it("rejects overlapping edits", async () => {
    const content = "a\nb\nc\nd\ne";
    const hashes = await lineHashes(content);
    expect(() =>
      applyEdits(content, parseEdits([
        { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: ["X", "Y"] },
        { hash_range_inclusive: [anchorAt(hashes, 3), anchorAt(hashes, 4)], content_lines: ["Y"] },
      ]))
    ).toThrow(/E_EDIT_CONFLICT/);
  });

  it("rejects stale anchor", async () => {
    const content = "a\nb\nc\nd\ne";
    const hashes = await lineHashes(content);
    expect(() =>
      applyEdits(content, parseEdits([
        { hash_range_inclusive: [anchorAt(hashes, 1), anchorAt(hashes, 2)], content_lines: ["X", "Y"] },
      ]), undefined, ["STALE", "STALE", "STALE", "STALE", "STALE"])
    ).toThrow(/E_STALE_ANCHOR/);
  });

  it("never reports ambiguity: a shared hash at the wrong line is stale, not ambiguous", () => {
    const content = "b\nx\nb";
    const hashes = lineHashes(content);
    expect(hashes[0]).toBe(hashes[2]);

    expect(() =>
      applyEdits(content, parseEdits([
        { hash_range_inclusive: [`2:${hashes[0]}`, `2:${hashes[0]}`], content_lines: ["X"] },
      ]))
    ).toThrow(/E_STALE_ANCHOR/);
  });

  it("rejects unknown fields in edit items", () => {
    const edits = [{ hash_range_inclusive: ["1:ZZ", "1:ZZ"], content_lines: ["x"], extra: true }] as any;
    expect(() => parseEdits(edits)).toThrow(/unknown or unsupported fields/);
  });

  it("rejects missing content_lines", () => {
    const edits = [{ hash_range_inclusive: ["1:ZZ", "1:ZZ"] }] as any;
    expect(() => parseEdits(edits)).toThrow(/requires a "content_lines" field/);
  });

  it("rejects null content_lines", () => {
    const edits = [{ hash_range_inclusive: ["1:ZZ", "1:ZZ"], content_lines: null }] as any;
    expect(() => parseEdits(edits)).toThrow(/content_lines" must be a string array/);
  });

  it("rejects string content_lines", () => {
    const edits = [{ hash_range_inclusive: ["1:ZZ", "1:ZZ"], content_lines: "hello\nworld\n" }] as any;
    expect(() => parseEdits(edits)).toThrow(/must be a native JSON array of strings, not a JSON string/);
  });

  it("rejects malformed hash_range_inclusive", () => {
    const edits = [{ hash_range_inclusive: ["not-valid", "not-valid"] as [string, string], content_lines: ["x"] }];
    expect(() => parseEdits(edits)).toThrow(/Invalid anchor/);
  });

  it("rejects bare hash prefix in content_lines", async () => {
    const content = "a\nb\nc\nd\ne";
    const hashes = await lineHashes(content);
    expect(() =>
      applyEdits(content, parseEdits([
        { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)] as [string, string], content_lines: [`${anchorAt(hashes, 2)}│b`, "X"] },
      ]))
    ).toThrow(/E_BARE_HASH_PREFIX/);
  });

  it("rejects copied diff '+' rows whose anchor is real and inside the range", async () => {
    const content = "a\nb\nc";
    const hashes = await lineHashes(content);
    expect(() =>
      applyEdits(content, parseEdits([
        { hash_range_inclusive: [anchorAt(hashes, 1), anchorAt(hashes, 1)] as [string, string], content_lines: [`+${anchorAt(hashes, 1)}│new`] },
      ]))
    ).toThrow(/E_BARE_HASH_PREFIX/);
  });

  it("warns on unicode escape sequences in content", async () => {
    const content = "a\nb\nc";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEdits([
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)], content_lines: ["\\uDDDD"] },
    ]));
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("\\uDDDD");
  });

  it("handles tab characters in content_lines", async () => {
    const content = "a\nb\nc";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEdits([
      { hash_range_inclusive: [anchorAt(hashes, 3), anchorAt(hashes, 3)], content_lines: ["\t\treplaced"] },
    ]));
    expect(result.content).toBe("a\nb\n\t\treplaced");
  });

  it("preserves literal tab in content_lines", async () => {
    const content = "a\nb\nc";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEdits([
      { hash_range_inclusive: [anchorAt(hashes, 3), anchorAt(hashes, 3)], content_lines: ["\t\treplaced"] },
    ]));
    expect(result.content).toContain("\t\treplaced");
  });

  it("handles multiple edits in one call", async () => {
    const content = "a\nb\nc\nd\ne";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEdits([
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)], content_lines: ["x1", "x2", "x3"] },
      { hash_range_inclusive: [anchorAt(hashes, 4), anchorAt(hashes, 4)], content_lines: ["y1"] },
    ]));
    expect(result.content).toBe("a\nx1\nx2\nx3\nc\ny1\ne");
  });

  it("detects noop when content unchanged", async () => {
    const content = "a\nb\nc";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEdits([
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)], content_lines: ["b"] },
    ]));
    expect(result.noopEdits).toHaveLength(1);
  });

  it("detects noop for range", async () => {
    const content = "a\nb\nc\nd";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEdits([
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: ["b", "c"] },
    ]));
    expect(result.noopEdits).toHaveLength(1);
  });

  it("handles empty edits array", () => {
    const result = applyEdits("hello\nworld", []);
    expect(result.content).toBe("hello\nworld");
  });

  it("handles single-line file", async () => {
    const content = "hello";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEdits([
      { hash_range_inclusive: [anchorAt(hashes, 1), anchorAt(hashes, 1)], content_lines: ["world"] },
    ]));
    expect(result.content).toBe("world");
  });

  it("handles append to last line", async () => {
    const content = "a\nb";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEdits([
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)], content_lines: ["b", "c"] },
    ]));
    expect(result.content).toBe("a\nb\nc");
  });

  it("handles delete of first line", async () => {
    const content = "a\nb\nc";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEdits([
      { hash_range_inclusive: [anchorAt(hashes, 1), anchorAt(hashes, 1)], content_lines: [] },
    ]));
    expect(result.content).toBe("b\nc");
  });

  it("handles delete of last line", async () => {
    const content = "a\nb\nc";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEdits([
      { hash_range_inclusive: [anchorAt(hashes, 3), anchorAt(hashes, 3)], content_lines: [] },
    ]));
    expect(result.content).toBe("a\nb");
  });

  it("handles replace of entire file", async () => {
    const content = "a\nb\nc";
    const hashes = await lineHashes(content);
    const result = applyEdits(content, parseEdits([
      { hash_range_inclusive: [anchorAt(hashes, 1), anchorAt(hashes, 3)], content_lines: ["x", "y"] },
    ]));
    expect(result.content).toBe("x\ny");
  });
});
