import { describe, expect, it } from "vitest";
import { parseText, parseHashRef } from "../../src/hashline";

describe("parseHashRef", () => {
	it("parses a colon-free anchor (line + 5-digit hash)", () => {
		expect(parseHashRef("1274293")).toEqual({ line: 12, hash: "74293" });
	});

	it("tolerates an optional colon between line and hash", () => {
		expect(parseHashRef("12:74293")).toEqual({ line: 12, hash: "74293" });
	});

	it("splits the last 5 digits as the hash regardless of line width", () => {
		expect(parseHashRef("100007")).toEqual({ line: 1, hash: "00007" });
		expect(parseHashRef("158000042857")).toEqual({ line: 1580000, hash: "42857" });
	});

	it("rejects trailing content after the anchor", () => {
		expect(() => parseHashRef("1274293:const x = 1;")).toThrow(
			/copied verbatim/,
		);
	});

	it("rejects a full anchor│content row copied into hash_range_inclusive", () => {
		expect(() => parseHashRef("1274293│const x = 1;")).toThrow(
			/must contain the anchor only/,
		);
	});

	it("rejects leading >>> markers (strict mode: no marker stripping)", () => {
		expect(() => parseHashRef(">>> 1274293")).toThrow(/E_BAD_REF/);
	});

	it("rejects + and - diff markers (strict mode: anchor only)", () => {
		expect(() => parseHashRef("+1274293")).toThrow(/E_BAD_REF/);
		expect(() => parseHashRef("-1274293")).toThrow(/E_BAD_REF/);
	});

	it("rejects a base64 hash from the old dialect", () => {
		expect(() => parseHashRef("12:aB")).toThrow(/E_BAD_REF/);
	});

	it("rejects fewer than 5 hash digits", () => {
		expect(() => parseHashRef("124293")).not.toThrow();
		expect(() => parseHashRef("12429")).toThrow(/E_BAD_REF/);
	});

	it("rejects malformed anchors with E_BAD_REF", () => {
		expect(() => parseHashRef("invalid")).toThrow(/^\[E_BAD_REF\]/);
	});

	it("rejects a bare hash with no line number", () => {
		expect(() => parseHashRef("74293")).toThrow(/^\[E_BAD_REF\]/);
	});

	it("rejects a non-numeric hash", () => {
		expect(() => parseHashRef("12:abcde")).toThrow(/^\[E_BAD_REF\]/);
	});

	it("rejects a missing or non-numeric line number", () => {
		expect(() => parseHashRef(":74293")).toThrow(/^\[E_BAD_REF\]/);
		expect(() => parseHashRef("x74293")).toThrow(/^\[E_BAD_REF\]/);
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
