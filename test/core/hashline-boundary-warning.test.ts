import { describe, expect, it } from "vitest";
import { applyEdits, lineHashes } from "../../src/hashline";
import { anchorAt, parseEditsIn } from "../support/fixtures";

describe("boundary duplication [W_DUP] warning", () => {
  it("warns for trailing duplication (content_lines ends with the next surviving line)", () => {
    const file = "before\nline1\nline2\nafter\n";
    const hashes = lineHashes(file);

    const result = applyEdits(file, parseEditsIn(file, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: ["new1", "new2", "after"] },
    ]));

    expect(result.warnings?.some((w) => w.startsWith("[W_DUP]") && w.includes("ends with") && w.includes("after"))).toBe(true);
    expect(result.content).toContain("new2\nafter\nafter");
  });

  it("warns for leading duplication (content_lines starts with the preceding line)", () => {
    const file = "before\nline1\nline2\nafter\n";
    const hashes = lineHashes(file);

    const result = applyEdits(file, parseEditsIn(file, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: ["before", "new1", "new2"] },
    ]));

    expect(result.warnings?.some((w) => w.startsWith("[W_DUP]") && w.includes("starts with") && w.includes("before"))).toBe(true);
    expect(result.content).toContain("before\nbefore\nnew1");
  });

  it("does not warn when there is no boundary match", () => {
    const file = "before\nline1\nline2\nafter\n";
    const hashes = lineHashes(file);

    const result = applyEdits(file, parseEditsIn(file, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: ["new1", "new2"] },
    ]));

    expect(result.warnings?.some((w) => w.startsWith("[W_DUP]")) ?? false).toBe(false);
  });

  it("warns for both trailing and leading duplication when both boundaries match", () => {
    const file = "before\nline1\nline2\nafter\n";
    const hashes = lineHashes(file);

    const result = applyEdits(file, parseEditsIn(file, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 3)], content_lines: ["before", "new1", "after"] },
    ]));

    const dupWarnings = result.warnings?.filter((w) => w.startsWith("[W_DUP]")) ?? [];
    expect(dupWarnings).toHaveLength(2);
  });

  it("warns for a duplicated structural delimiter (}), keeping it literal", () => {
    const file = "if (a) {\n  x();\n}\n}\n";
    const hashes = lineHashes(file);

    const result = applyEdits(file, parseEditsIn(file, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)], content_lines: ["  z();", "}"] },
    ]));

    expect(result.warnings?.some((w) => w.startsWith("[W_DUP]") && w.includes("}"))).toBe(true);
    expect(result.content).toContain("  z();\n}\n}\n}");
  });

  it("references the edit index in the warning for a multi-edit call", () => {
    const file = "before\nline1\nline2\nafter\n";
    const hashes = lineHashes(file);

    const result = applyEdits(file, parseEditsIn(file, [
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)], content_lines: ["new1"] },
      { hash_range_inclusive: [anchorAt(hashes, 3), anchorAt(hashes, 3)], content_lines: ["new2", "after"] },
    ]));

    expect(result.warnings?.some((w) => w.startsWith("[W_DUP] Edit 1:"))).toBe(true);
  });
});
