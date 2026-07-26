import { describe, expect, it } from "vitest";
import {
	applyEdits,
	blankHash,
	formatAnchor,
	formatRegion,
	lineHashes,
	parseEdits,
} from "../../src/hashline";
import { anchorAt, parseEditsIn } from "../support/fixtures";

describe("blank-line short anchors", () => {
	it("renders blank lines as the bare line number", () => {
		const content = "alpha\n\nbeta";
		const rendered = formatRegion(lineHashes(content), content.split("\n"));
		const rows = rendered.split("\n");
		expect(rows[0]).toMatch(/^1\d{4}│alpha$/);
		expect(rows[1]).toBe("2│");
		expect(rows[2]).toMatch(/^3\d{4}│beta$/);
	});

	it("treats whitespace-only lines as blank (canon parity)", () => {
		const content = "alpha\n   \nbeta";
		const rendered = formatRegion(lineHashes(content), content.split("\n"));
		expect(rendered.split("\n")[1]).toBe("2│   ");
	});

	it("replaces a blank line via its short anchor end-to-end", () => {
		const content = "alpha\n\nbeta";
		const result = applyEdits(content, parseEditsIn(content, [
			{ hash_range_inclusive: ["2", "2"], content_lines: ["inserted"] },
		]));
		expect(result.content).toBe("alpha\ninserted\nbeta");
	});

	it("rejects a blank anchor for a line that is no longer blank", () => {
		const content = "alpha\nfilled\nbeta";
		expect(() =>
			applyEdits(content, parseEditsIn(content, [
				{ hash_range_inclusive: ["2", "2"], content_lines: ["X"] },
			])),
		).toThrow(/E_STALE_ANCHOR/);
	});

	it("hard-rejects a copied blank read row inside the replaced range", () => {
		const content = "alpha\n\nbeta";
		expect(() =>
			applyEdits(content, parseEditsIn(content, [
				{ hash_range_inclusive: ["2", "2"], content_lines: ["2│"] },
			])),
		).toThrow(/E_BARE_HASH_PREFIX/);
	});

	it("writes literal digit│ content when the referenced line is not blank", () => {
		const content = "alpha\nfilled\nbeta";
		const hashes = lineHashes(content);
		const result = applyEdits(content, parseEditsIn(content, [
			{ hash_range_inclusive: [anchorAt(hashes, 1), anchorAt(hashes, 1)], content_lines: ["2│cell"] },
		]));
		expect(result.content).toContain("2│cell");
	});
});

describe("width band crossing between read and replace", () => {
	it("fails loudly when a 4-digit anchor is applied after the file grew past the band", () => {
		const small = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
		const smallHashes = lineHashes(small);
		const anchorFromSmallRead = formatAnchor(42, smallHashes[41]!);

		const big = Array.from({ length: 150 }, (_, i) => `line ${i + 1}`).join("\n");
		expect(() =>
			applyEdits(big, parseEdits([
				{ hash_range_inclusive: [anchorFromSmallRead, anchorFromSmallRead], content_lines: ["X"] },
			], 5)),
		).toThrow(/E_STALE_ANCHOR/);
	});

	it("a blank anchor for a huge line number renders in full form and round-trips", () => {
		const anchor = formatAnchor(123456, blankHash(5));
		expect(anchor).toBe(`123456${blankHash(5)}`);
	});
});
