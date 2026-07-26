import { describe, expect, it } from "vitest";
import { parseText, parseHashRef, splitAnchor, formatAnchor, blankHash } from "../../src/hashline";

describe("parseHashRef", () => {
	it("splits the last N digits as the hash at the given width", () => {
		expect(parseHashRef("1274293", 5)).toEqual({ line: 12, hash: "74293" });
		expect(parseHashRef("127429", 4)).toEqual({ line: 12, hash: "7429" });
	});

	it("splits differently per width (band semantics)", () => {
		expect(parseHashRef("427429", 4)).toEqual({ line: 42, hash: "7429" });
		expect(parseHashRef("427429", 5)).toEqual({ line: 4, hash: "27429" });
	});

	it("parses a short digit run as a blank-line anchor", () => {
		expect(parseHashRef("42", 5)).toEqual({ line: 42, hash: "" });
		expect(parseHashRef("42", 4)).toEqual({ line: 42, hash: "" });
		expect(parseHashRef("74293", 5)).toEqual({ line: 74293, hash: "" });
	});

	it("tolerates an explicit colon between line and hash", () => {
		expect(parseHashRef("12:74293", 5)).toEqual({ line: 12, hash: "74293" });
		expect(parseHashRef("12:7429", 4)).toEqual({ line: 12, hash: "7429" });
		expect(parseHashRef("12:", 5)).toEqual({ line: 12, hash: "" });
	});

	it("rejects a colon-form hash of the wrong width", () => {
		expect(() => parseHashRef("12:7429", 5)).toThrow(/E_BAD_REF/);
		expect(() => parseHashRef("12:74293", 4)).toThrow(/E_BAD_REF/);
	});

	it("rejects trailing content after the anchor", () => {
		expect(() => parseHashRef("1274293:const x = 1;", 5)).toThrow(
			/copied verbatim/,
		);
	});

	it("rejects a full anchor│content row copied into hash_range_inclusive", () => {
		expect(() => parseHashRef("1274293│const x = 1;", 5)).toThrow(
			/must contain the anchor only/,
		);
	});

	it("rejects leading >>> markers (strict mode: no marker stripping)", () => {
		expect(() => parseHashRef(">>> 1274293", 5)).toThrow(/E_BAD_REF/);
	});

	it("rejects + and - diff markers (strict mode: anchor only)", () => {
		expect(() => parseHashRef("+1274293", 5)).toThrow(/E_BAD_REF/);
		expect(() => parseHashRef("-1274293", 5)).toThrow(/E_BAD_REF/);
	});

	it("rejects the old base64 dialect", () => {
		expect(() => parseHashRef("12:aB", 5)).toThrow(/E_BAD_REF/);
	});

	it("rejects malformed anchors with E_BAD_REF", () => {
		expect(() => parseHashRef("invalid", 5)).toThrow(/^\[E_BAD_REF\]/);
		expect(() => parseHashRef("", 5)).toThrow(/^\[E_BAD_REF\]/);
		expect(() => parseHashRef(":74293", 5)).toThrow(/^\[E_BAD_REF\]/);
		expect(() => parseHashRef("x74293", 5)).toThrow(/^\[E_BAD_REF\]/);
	});
});

describe("splitAnchor / formatAnchor round-trip", () => {
	it("round-trips a normal anchor", () => {
		const anchor = formatAnchor(42, "74293");
		expect(anchor).toBe("4274293");
		expect(splitAnchor(anchor, 5)).toEqual({ line: 42, hash: "74293" });
	});

	it("renders a blank line as the bare line number", () => {
		expect(formatAnchor(42, blankHash(5))).toBe("42");
		expect(formatAnchor(7, blankHash(4))).toBe("7");
	});

	it("renders a blank line with a wide line number in full form", () => {
		const anchor = formatAnchor(123456, blankHash(5));
		expect(anchor).toBe(`123456${blankHash(5)}`);
		expect(splitAnchor(anchor, 5)).toEqual({ line: 123456, hash: blankHash(5) });
	});
});

describe("parseText", () => {
	it("returns [] for null", () => {
		expect(parseText(null)).toEqual([]);
	});

  it("rejects string input with clear error (must use array)", () => {
    expect(() => parseText("a\nb")).toThrow(
      /must be a native JSON array of strings, not a JSON string/,
    );
  });

  it("rejects string input with trailing newline", () => {
    expect(() => parseText("a\nb\n")).toThrow(
      /must be a native JSON array of strings, not a JSON string/,
    );
  });

  it("rejects string input with trailing whitespace", () => {
    expect(() => parseText("a\nb\n  ")).toThrow(
      /must be a native JSON array of strings, not a JSON string/,
    );
  });

  it("rejects empty string input", () => {
    expect(() => parseText("")).toThrow(
      /must be a native JSON array of strings, not a JSON string/,
    );
  });

	it("passes through array input verbatim", () => {
		const input = ["a", "b"];
		expect(parseText(input)).toEqual(input);
	});

	it("preserves '# keep me' comment lines (no autocorrection)", () => {
		expect(parseText(["# keep me"])).toEqual(["# keep me"]);
	});

	it("preserves literal '+' prefixed content (no autocorrection)", () => {
		expect(parseText(["+added"])).toEqual(["+added"]);
	});

  it("returns empty string as a single empty line for blank content (array input)", () => {
    expect(parseText([""])).toEqual([""]);
  });
	it("passes anchor-shaped prefixes through; copied-row detection is evidence-based downstream", () => {
		expect(parseText(["+1:aB│foo", "-10    old"])).toEqual(["+1:aB│foo", "-10    old"]);
	});

  it("rejects string-form rendered diff hunks (string input rejected before prefix check)", () => {
    const input = " 1:aB│keep\n-10    old\n+2:xY│new\n 3:mN│after";
    expect(() => parseText(input)).toThrow(
      /must be a native JSON array of strings, not a JSON string/,
    );
  });
});
