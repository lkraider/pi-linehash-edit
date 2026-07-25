import { describe, expect, it } from "vitest";
import { parseText, parseHashRef } from "../../src/hashline";

describe("parseHashRef", () => {
	it("parses a line:hash anchor", () => {
		const ref = parseHashRef("12:aB");
		expect(ref).toEqual({ line: 12, hash: "aB" });
	});

	it("rejects trailing content after the anchor", () => {
		expect(() => parseHashRef("12:aB:const x = 1;")).toThrow(
			/Expected "line:hash"/,
		);
	});

	it("rejects a full LINE:HASH│content line copied into hash_range_inclusive", () => {
		expect(() => parseHashRef("12:aB│const x = 1;")).toThrow(
			/hash_range_inclusive must contain "line:hash" only/,
		);
	});
	it("rejects leading >>> markers (strict mode: no marker stripping)", () => {
		expect(() => parseHashRef(">>> 12:aB")).toThrow(/E_BAD_REF/);
	});

	it("rejects + and - diff markers (strict mode: anchor only)", () => {
		expect(() => parseHashRef("+12:aB")).toThrow(/E_BAD_REF/);
		expect(() => parseHashRef("-12:aB")).toThrow(/E_BAD_REF/);
	});

	it("accepts a hash that starts with - in the body (alphabet char, not a marker)", () => {
		expect(parseHashRef("12:-q")).toEqual({ line: 12, hash: "-q" });
		expect(parseHashRef("12:--")).toEqual({ line: 12, hash: "--" });
	});

	it("rejects + as a hash body character (not in alphabet)", () => {
		expect(() => parseHashRef("12:+q")).toThrow(/E_BAD_REF/);
	});

	it("rejects malformed anchors with E_BAD_REF", () => {
		expect(() => parseHashRef("invalid")).toThrow(/^\[E_BAD_REF\]/);
	});

	it("rejects a bare hash with no line number (the old dialect)", () => {
		expect(() => parseHashRef("aB")).toThrow(/^\[E_BAD_REF\]/);
	});

	it("rejects wrong-length hash bodies", () => {
		expect(() => parseHashRef("12:a")).toThrow(/E_BAD_REF/);
		expect(() => parseHashRef("12:aBc")).toThrow(/E_BAD_REF/);
	});

	it("rejects anchors with invalid alphabet", () => {
		expect(() => parseHashRef("12:!@")).toThrow(/^\[E_BAD_REF\]/);
	});

	it("rejects a missing or non-numeric line number", () => {
		expect(() => parseHashRef(":aB")).toThrow(/^\[E_BAD_REF\]/);
		expect(() => parseHashRef("x:aB")).toThrow(/^\[E_BAD_REF\]/);
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
	it("rejects array input that contains LINE:HASH| prefixes", () => {
		expect(() => parseText(["+1:aB│foo", "+2:xY│bar"])).toThrow(
			/^\[E_INVALID_PATCH\]/,
		);
	});

	it("rejects diff-preview hunks with + and context anchor prefixes", () => {
		expect(() =>
				parseText([" 1:aB│keep", "+2:xY│new", " 3:mN│after"]),
		).toThrow(/^\[E_INVALID_PATCH\]/);
	});

	it("rejects diff-preview deletion rows", () => {
		expect(() =>
				parseText([" 1:aB│keep", "-10    old", " 2:xY│after"]),
		).toThrow(/^\[E_INVALID_PATCH\]/);
	});

  it("rejects string-form rendered diff hunks (string input rejected before prefix check)", () => {
    const input = " 1:aB│keep\n-10    old\n+2:xY│new\n 3:mN│after";
    expect(() => parseText(input)).toThrow(
      /must be a native JSON array of strings, not a JSON string/,
    );
  });
});
