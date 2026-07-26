import { describe, expect, it } from "vitest";
import { fakeAnchor } from "../support/fixtures";
import {
	parseEdits,
	type Anchor,
	type RawEdit,
} from "../../src/hashline";

describe("parseEdits", () => {
	it("resolves replace with hash_range_inclusive", () => {
		const edits: RawEdit[] = [
      { hash_range_inclusive: [fakeAnchor(1), fakeAnchor(2)], content_lines: ["a", "b"] },
		];
		const resolved = parseEdits(edits, 5);
		expect(resolved).toHaveLength(1);
		expect(resolved[0]).toHaveProperty("hash_range_inclusive");
		expect(resolved[0]).toHaveProperty("content_lines");
	});

	it("resolves a 1-line replace (same anchor)", () => {
		const edits: RawEdit[] = [
      { hash_range_inclusive: [fakeAnchor(3), fakeAnchor(3)], content_lines: ["new"] },
		];
		const resolved = parseEdits(edits, 5);
		expect(resolved).toHaveLength(1);
		const r = resolved[0] as {
			hash_range_inclusive: [Anchor, Anchor];
      content_lines: string[];
		};
		expect(r.hash_range_inclusive[0]).toEqual({ line: 3, hash: "99999" });
		expect(r.hash_range_inclusive[1]).toEqual({ line: 3, hash: "99999" });
	});

	it("throws on replace with no hash_range_inclusive (E_BAD_SHAPE)", () => {
    const edits = [{ content_lines: ["new"] }] as any;
		expect(() => parseEdits(edits, 5)).toThrow(/^\[E_BAD_SHAPE\]/);
	});

	it("throws on malformed hash_range_inclusive", () => {
		const edits: RawEdit[] = [
      { hash_range_inclusive: ["not-valid", "not-valid"], content_lines: ["x"] },
		];
		expect(() => parseEdits(edits, 5)).toThrow(/Invalid anchor/);
	});

  it("rejects string content_lines input", () => {
    const edits: RawEdit[] = [
      {
        hash_range_inclusive: [fakeAnchor(1), fakeAnchor(1)],
        content_lines: "hello\nworld\n",
      } as unknown as RawEdit,
    ];
    expect(() => parseEdits(edits, 5)).toThrow(
      /must be a native JSON array of strings, not a JSON string/i,
    );
  });

  it("auto-recovers JSON-string content_lines", () => {
    const edits: RawEdit[] = [
      {
        hash_range_inclusive: [fakeAnchor(1), fakeAnchor(1)],
        content_lines: '["line1", "line2"]'
      } as unknown as RawEdit,
    ];
    const resolved = parseEdits(edits, 5);
    expect(resolved[0]!.content_lines).toEqual(["line1", "line2"]);
  });

  it("rejects JSON-string content_lines that parses to non-array", () => {
    const edits: RawEdit[] = [
      {
        hash_range_inclusive: [fakeAnchor(1), fakeAnchor(1)],
        content_lines: '"just a string"'
      } as unknown as RawEdit,
    ];
    expect(() => parseEdits(edits, 5)).toThrow(
      /must be a native JSON array of strings, not a JSON string/i,
    );
  });

	it("rejects null content_lines input", () => {
		const edits: RawEdit[] = [
			{
				hash_range_inclusive: [fakeAnchor(1), fakeAnchor(1)],
        content_lines: null,
			} as unknown as RawEdit,
		];
		expect(() => parseEdits(edits, 5)).toThrow(
      /content_lines" must be a string array/i,
		);
	});

	it("rejects unknown fields", () => {
    const edits = [{ hash_range_inclusive: [fakeAnchor(1), fakeAnchor(1)], content_lines: ["x"], extra: true }] as any;
		expect(() => parseEdits(edits, 5)).toThrow(
			/unknown or unsupported fields/i,
		);
	});

	it("rejects missing content_lines", () => {
		const edits = [{ hash_range_inclusive: [fakeAnchor(1), fakeAnchor(1)] }] as any;
		expect(() => parseEdits(edits, 5)).toThrow(
      /requires a "content_lines" field/i,
		);
	});
});
