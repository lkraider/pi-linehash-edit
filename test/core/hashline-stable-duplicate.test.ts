import { describe, expect, it } from "vitest";
import { lineHashes, applyEdits, type ParsedEdit } from "../../src/hashline";
import { withTempFile, setupIntegrationTest, getText, extractHash, anchorHash, anchorRowRe } from "../support/fixtures";

describe("duplicate-content lines share a hash, disambiguated by line number", () => {
  it("two identical lines get the same hash", () => {
    const content = "function a() {\n  return 1;\n}\n\nfunction b() {\n  return 2;\n}\n";
    const hashes = lineHashes(content);

    const firstBraceHash = hashes[2]!;
    const secondBraceHash = hashes[6]!;
    expect(firstBraceHash).toBe(secondBraceHash);
  });

  it("removing the first of two identical lines leaves the second at its own shifted line, same hash", () => {
    const content = "function a() {\n  return 1;\n}\n\nfunction b() {\n  return 2;\n}\n";
    const hashes = lineHashes(content);
    const braceHash = hashes[2]!;

    const edits: ParsedEdit[] = [
      {
        hash_range_inclusive: [{ line: 1, hash: hashes[0]! }, { line: 3, hash: braceHash }],
        content_lines: [],
      },
    ];

    const result = applyEdits(content, edits);
    expect(result.content).toBe("\nfunction b() {\n  return 2;\n}\n");

    const resultHashes = lineHashes(result.content);
    expect(resultHashes[3]).toBe(braceHash);
  });

  it("removing a unique line between two identical lines leaves both brace hashes unchanged", () => {
    const content = "a\n}\nb\n}\nc\n}\nd\n";
    const hashes = lineHashes(content);
    const braceHash = hashes[1]!;
    expect(hashes[3]).toBe(braceHash);
    expect(hashes[5]).toBe(braceHash);

    const edits: ParsedEdit[] = [
      {
        hash_range_inclusive: [{ line: 3, hash: hashes[2]! }, { line: 3, hash: hashes[2]! }],
        content_lines: [],
      },
    ];

    const result = applyEdits(content, edits);
    expect(result.content).toBe("a\n}\n}\nc\n}\nd\n");

    const resultHashes = lineHashes(result.content);
    expect(resultHashes[1]).toBe(braceHash);
    expect(resultHashes[2]).toBe(braceHash);
    expect(resultHashes[4]).toBe(braceHash);
  });
});

describe("end-to-end via tool: duplicate lines after an edit", () => {
  it("removing one of two identical lines leaves the surviving one addressable at its shifted line", async () => {
    const file = "function a() {\n  return 1;\n}\n\nfunction b() {\n  return 2;\n}\n";
    await withTempFile("sample.ts", file, async ({ cwd }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);

      const read1 = await readTool.execute("r1", { path: "sample.ts" }, undefined, undefined, ctx);
      const lines1 = getText(read1).split("\n");

      const braceLines = lines1.filter((l) => l.endsWith("│}"));
      expect(braceLines).toHaveLength(2);
      const firstBraceHash = anchorHash(braceLines[0]!);
      const secondBraceHash = anchorHash(braceLines[1]!);
      expect(firstBraceHash).toBe(secondBraceHash);

      const line1Hash = extractHash(lines1.find((l) => l.includes("│function a()"))!);
      const firstBraceAnchor = extractHash(braceLines[0]!);
      await editTool.execute(
        "e1",
        {
          path: "sample.ts",
          changes: [{ hash_range_inclusive: [line1Hash, firstBraceAnchor], content_lines: [] }],
        },
        undefined,
        undefined,
        ctx,
      );

      const read2 = await readTool.execute("r2", { path: "sample.ts" }, undefined, undefined, ctx);
      const lines2 = getText(read2).split("\n");
      const survivingBrace = lines2.find((l) => l.endsWith("│}"))!;
      expect(survivingBrace).toBeTruthy();
      expect(anchorHash(survivingBrace)).toBe(secondBraceHash);
    });
  });

  it("interior duplicate line (not a boundary) keeps its hash after an unrelated edit", async () => {
    const file = "a\nb\nc\nb\nd\n";
    await withTempFile("sample.ts", file, async ({ cwd }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);

      const read1 = await readTool.execute("r1", { path: "sample.ts" }, undefined, undefined, ctx);
      const lines1 = getText(read1).split("\n");

      const bLines = lines1.filter((l) => l.endsWith("│b"));
      expect(bLines).toHaveLength(2);
      const bHash = anchorHash(bLines[0]!);
      expect(anchorHash(bLines[1]!)).toBe(bHash);

      const aHash = extractHash(lines1.find((l) => l.endsWith("│a"))!);
      const cHash = extractHash(lines1.find((l) => l.endsWith("│c"))!);

      await editTool.execute(
        "e1",
        {
          path: "sample.ts",
          changes: [{ hash_range_inclusive: [aHash, cHash], content_lines: [] }],
        },
        undefined,
        undefined,
        ctx,
      );

      const read2 = await readTool.execute("r2", { path: "sample.ts" }, undefined, undefined, ctx);
      const lines2 = getText(read2).split("\n");
      const survivingB = lines2.find((l) => l.endsWith("│b"))!;
      expect(survivingB).toBeTruthy();
      expect(anchorHash(survivingB)).toBe(bHash);
      expect(survivingB).toMatch(anchorRowRe("b", { line: 1 }));
    });
  });

  it("multi-edit bulk with interior duplicates preserves all surviving hashes", async () => {
    const file = "a\nb\nc\nb\nd\ne\nb\nf\n";
    await withTempFile("sample.ts", file, async ({ cwd }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);

      const read1 = await readTool.execute("r1", { path: "sample.ts" }, undefined, undefined, ctx);
      const lines1 = getText(read1).split("\n");

      const bLines = lines1.filter((l) => l.endsWith("│b"));
      expect(bLines).toHaveLength(3);
      const bHash = anchorHash(bLines[0]!);
      for (const line of bLines) {
        expect(anchorHash(line)).toBe(bHash);
      }

      const aHash = extractHash(lines1.find((l) => l.endsWith("│a"))!);
      const cHash = extractHash(lines1.find((l) => l.endsWith("│c"))!);
      const dHash = extractHash(lines1.find((l) => l.endsWith("│d"))!);
      const eHash = extractHash(lines1.find((l) => l.endsWith("│e"))!);

      await editTool.execute(
        "e1",
        {
          path: "sample.ts",
          changes: [
            { hash_range_inclusive: [aHash, cHash], content_lines: [] },
            { hash_range_inclusive: [dHash, eHash], content_lines: [] },
          ],
        },
        undefined,
        undefined,
        ctx,
      );

      const read2 = await readTool.execute("r2", { path: "sample.ts" }, undefined, undefined, ctx);
      const lines2 = getText(read2).split("\n");
      const survivingBLines = lines2.filter((l) => l.endsWith("│b"));
      expect(survivingBLines).toHaveLength(2);
      for (const line of survivingBLines) {
        expect(anchorHash(line)).toBe(bHash);
      }
    });
  });
});
