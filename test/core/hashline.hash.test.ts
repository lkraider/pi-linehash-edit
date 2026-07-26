import { describe, expect, it } from "vitest";
import {
	applyEdits,
	lineHashes,
	parseText,
} from "../../src/hashline";

describe("strict hashline contract", () => {
	it("preserves internal spaces when hashing", () => {
		const hashes = lineHashes("a b");
		const hashes2 = lineHashes("ab");
		expect(hashes[0]).not.toBe(hashes2[0]);
	});

	it("trims trailing spaces when hashing", () => {
		const hashes = lineHashes("value  ");
		const hashes2 = lineHashes("value");
		expect(hashes[0]).toBe(hashes2[0]);
	});

	it("preserves explicit blank trailing line in array input", () => {
		expect(parseText(["alpha", ""])).toEqual(["alpha", ""]);
	});

	it("rejects a stale anchor (line out of range) instead of relocating by hash", () => {
		const content = ["a", "INSERTED", "b", "target", "c"].join("\n");
		const stale = {
      hash_range_inclusive: [{ line: 99, hash: "ZZ" }, { line: 99, hash: "ZZ" }], content_lines: ["updated"],
    } as any;
		expect(() => applyEdits(content, [stale])).toThrow(/stale anchor/i);
	});

	it("rejects a stale anchor (wrong hash at a real line) instead of relocating", () => {
		const content = ["a", "INSERTED", "b", "target", "c"].join("\n");
		const stale = {
      hash_range_inclusive: [{ line: 4, hash: "ZZ" }, { line: 4, hash: "ZZ" }], content_lines: ["updated"],
    } as any;
		expect(() => applyEdits(content, [stale])).toThrow(/stale anchor/i);
	});
});

describe("line:hash addressing", () => {
	it("returns one hash per line, 5-digit", () => {
		const hashes = lineHashes("alpha\nbeta\ngamma");
		expect(hashes).toHaveLength(3);
		expect(hashes[0]).toMatch(/^\d{5}$/);
		expect(hashes[1]).toMatch(/^\d{5}$/);
		expect(hashes[2]).toMatch(/^\d{5}$/);
	});

	it("gives identical content the same hash regardless of position", () => {
		const file = [
			"import { foo } from 'bar';",
			"import { baz } from 'qux';",
			"import { foo } from 'bar';",
		].join("\n");
		const hashes = lineHashes(file);
		expect(hashes[0]).toBe(hashes[2]);
		expect(hashes[0]).not.toBe(hashes[1]);
	});

	it("lets the edit tool target a specific occurrence of duplicated content by line number", () => {
		const file = [
			"const x = 1;",
			"const y = 2;",
			"const x = 1;",
		].join("\n");
		const hashes = lineHashes(file);
		const result = applyEdits(file, [
      { hash_range_inclusive: [{ line: 3, hash: hashes[2]! }, { line: 3, hash: hashes[2]! }], content_lines: ["const x = 999;"] },
    ]);
    expect(result.content).toBe("const x = 1;\nconst y = 2;\nconst x = 999;");
	});

	it("a shared hash at the wrong line is still a stale anchor, never a silent relocation", () => {
		const file = ["const x = 1;", "const y = 2;", "const x = 1;"].join("\n");
		const hashes = lineHashes(file);
		expect(hashes[0]).toBe(hashes[2]);

		let caught: Error | undefined;
		try {
			applyEdits(file, [
        { hash_range_inclusive: [{ line: 2, hash: hashes[0]! }, { line: 2, hash: hashes[0]! }], content_lines: ["X"] },
      ]);
    } catch (e) {
			caught = e as Error;
		}
		expect(caught).toBeDefined();
		expect(caught!.message).toMatch(/E_STALE_ANCHOR/);
		expect(caught!.message).toContain("Call read()");
	});

	it("stale-anchor error shows the file's current state for context", () => {
		const file = ["const x = 1;", "const y = 2;", "const x = 1;"].join("\n");
		let caught: Error | undefined;
		try {
			applyEdits(file, [
        { hash_range_inclusive: [{ line: 1, hash: "ZZ" }, { line: 1, hash: "ZZ" }], content_lines: ["X"] },
      ]);
    } catch (e) {
			caught = e as Error;
		}
		expect(caught).toBeDefined();
		expect(caught!.message).toMatch(/E_STALE_ANCHOR/);
		expect(caught!.message).toContain("Call read()");
	});

	it("hash array length matches line count for edge cases", () => {
		const cases = ["", "\n", "a", "a\n", "a\nb\nc\n"];
		for (const file of cases) {
			const hashes = lineHashes(file);
			expect(hashes).toHaveLength(file.split("\n").length);
		}
	});
});
