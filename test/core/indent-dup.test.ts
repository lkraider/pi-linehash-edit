import { describe, expect, it } from "vitest";
import { lineHashes, resEdits, applyEdits } from "../../src/hashline";
import { anchorAt } from "../support/fixtures";


describe("indentation difference in boundary [W_DUP] warning", () => {
  it("warns on leading duplication when indentation matches exactly, keeps it literally", () => {
    const file = "  foo\nbar\n  baz";
    const hashes = lineHashes(file);
    const result = applyEdits(file, resEdits([
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)], content_lines: ["  foo", "  bar"] },
    ]));
    expect(result.content).toBe("  foo\n  foo\n  bar\n  baz");
    expect(result.warnings?.some((w) => w.startsWith("[W_DUP]") && w.includes("starts with"))).toBe(true);
  });

  it("warns on leading duplication when both indentation and content match exactly, keeps it literally", () => {
    const file = "  foo\n  bar\n  baz";
    const hashes = lineHashes(file);
    const result = applyEdits(file, resEdits([
      { hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)], content_lines: ["  foo", "  new"] },
    ]));
    expect(result.content).toBe("  foo\n  foo\n  new\n  baz");
    expect(result.warnings?.some((w) => w.startsWith("[W_DUP]") && w.includes("starts with"))).toBe(true);
  });
});
