import { describe, expect, it } from "vitest";
import {
	applyEdits,
	lineHashes,
	parseEdits,
	type RawEdit,
} from "../../src/hashline";
import { anchorAt } from "../support/fixtures";

describe("strict edit input (no autocorrection)", () => {
	it("rejects a real line:hash| prefix in content with E_BARE_HASH_PREFIX", () => {
		const file = "foo\nbar";
		const hashes = lineHashes(file);
		const toolEdits: RawEdit[] = [
      { hash_range_inclusive: [anchorAt(hashes, 1), anchorAt(hashes, 1)], content_lines: [`${anchorAt(hashes, 1)}│foo`] },
    ];
    let caught: Error | undefined;
		try {
			applyEdits(file, parseEdits(toolEdits));
		} catch (e) {
			caught = e as Error;
		}
		expect(caught).toBeDefined();
		expect(caught!.message).toMatch(/^\[E_BARE_HASH_PREFIX\]/);
		expect(caught!.message).toMatch(/real file-line anchor/);
	});

	it("rejects string content_lines before patch-prefix validation", () => {
		const toolEdits: RawEdit[] = [
			{
        hash_range_inclusive: ["1:ZZ", "1:ZZ"], content_lines: `+1:ZZ:foo`,
      } as unknown as RawEdit,
    ];
    expect(() => parseEdits(toolEdits)).toThrow(
      /must be a native JSON array of strings, not a JSON string/i,
    );
	});

	it("accepts column-aligned negative numbers literally (no shape-only rejection)", () => {
		const toolEdits: RawEdit[] = [
      { hash_range_inclusive: ["1:ZZ", "1:ZZ"], content_lines: ["-1    foo"] },
    ];
    expect(parseEdits(toolEdits)[0]!.content_lines).toEqual(["-1    foo"]);
	});

	it("accepts plain literal content unchanged", () => {
		const toolEdits: RawEdit[] = [
      { hash_range_inclusive: ["1:ZZ", "1:ZZ"], content_lines: ["bar"] },
    ];
    const resolved = parseEdits(toolEdits);
		expect(resolved).toHaveLength(1);
    expect(resolved[0]!.content_lines).toEqual(["bar"]);
	});

	it("preserves '#' comment lines that do not match the strict prefix", () => {
		const toolEdits: RawEdit[] = [
      { hash_range_inclusive: ["1:ZZ", "1:ZZ"], content_lines: ["# keep me"] },
    ];
    const resolved = parseEdits(toolEdits);
    expect(resolved[0]!.content_lines).toEqual(["# keep me"]);
	});
});

describe("bare-prefix false positives are impossible: only real anchors trigger it", () => {
	const file = "alpha\nbeta\ngamma\ndelta";

	function applyTool(toolEdits: RawEdit[], precomputedHashes?: string[]) {
		return applyEdits(file, parseEdits(toolEdits), undefined, precomputedHashes);
	}

	it("rejects when a content line quotes a real anchor inside the replaced range", () => {
		const hashes = lineHashes(file);
		const anchor = anchorAt(hashes, 2);
		const betaAnchor = anchorAt(hashes, 2);
		let caught: Error | undefined;
		try {
      applyTool([
        { hash_range_inclusive: [anchor, anchor], content_lines: [`${betaAnchor}│### heading`, "real content"] },
      ], hashes);
    } catch (e) {
      caught = e as Error;
    }
		expect(caught).toBeDefined();
		expect(caught!.message).toMatch(/^\[E_BARE_HASH_PREFIX\]/);
		expect(caught!.message).toContain(`${betaAnchor}│### heading`);
	});

	it("warns but applies when a content line quotes a real anchor outside the replaced range", () => {
		const hashes = lineHashes(file);
		const anchor = anchorAt(hashes, 1);
		const betaAnchor = anchorAt(hashes, 2);
		const result = applyTool([
      { hash_range_inclusive: [anchor, anchor], content_lines: [`${betaAnchor}│quoted`] },
    ], hashes);
		expect(result.content).toContain(`${betaAnchor}│quoted`);
		expect(result.warnings?.some((w) => w.startsWith("[W_BARE_HASH_PREFIX]"))).toBe(true);
	});

	it("does NOT reject a line:hash-shaped prefix that doesn't match any real current anchor", () => {
		const hashes = lineHashes(file);
		const anchor = anchorAt(hashes, 1);
		const result = applyTool([
      { hash_range_inclusive: [anchor, anchor], content_lines: ["99:ZZ│one", "88:YY│two"] },
    ], hashes);
		expect(result.content).toContain("99:ZZ│one");
		expect(result.content).toContain("88:YY│two");
	});

	it("does NOT reject a line:hash-shaped prefix with the right hash but the wrong line number", () => {
		const hashes = lineHashes(file);
		const anchor = anchorAt(hashes, 1);
		const betaHash = hashes[1]!;
		const result = applyTool([
      { hash_range_inclusive: [anchor, anchor], content_lines: [`99:${betaHash}│not actually beta`] },
    ], hashes);
		expect(result.content).toContain(`99:${betaHash}│not actually beta`);
	});

	it("reports the edit index and content_lines index for each offending line", () => {
		const hashes = lineHashes(file);
		const gammaAnchor = anchorAt(hashes, 3);
		const deltaAnchor = anchorAt(hashes, 4);
		let caught: Error | undefined;
		try {
      applyTool([
        { hash_range_inclusive: [gammaAnchor, gammaAnchor], content_lines: [`${gammaAnchor}│one`] },
        { hash_range_inclusive: [deltaAnchor, deltaAnchor], content_lines: ["real", `${deltaAnchor}│two`] },
      ], hashes);
    } catch (e) {
      caught = e as Error;
    }
		expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/edit 0, content_lines\[0\]/);
    expect(caught!.message).toMatch(/edit 1, content_lines\[1\]/);
	});

	it("accepts a single legit 'TS: TypeScript' line without warning", () => {
		const hashes = lineHashes(file);
		const anchor = anchorAt(hashes, 1);
		const result = applyTool([
      { hash_range_inclusive: [anchor, anchor], content_lines: ["TS: TypeScript"] },
    ], hashes);
    expect(result.warnings ?? []).toEqual([]);
		expect(result.content).toContain("TS: TypeScript");
	});

	it("does not false-positive on shorter valid-content prefixes like '#' or '+'", () => {
		const hashes = lineHashes(file);
		const anchor = anchorAt(hashes, 1);
		const result = applyTool([
      { hash_range_inclusive: [anchor, anchor], content_lines: ["# heading"] },
    ], hashes);
    expect(result.warnings ?? []).toEqual([]);
	});
});
