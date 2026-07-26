import { describe, expect, it } from "vitest";
import { lineHashes } from "../../src/hashline";
import { shouldSkipDiff } from "../../src/replace-diff";
import { MAX_DIFF_LINES } from "../../src/constants";
import { withTempFile, setupIntegrationTest, anchorAt } from "../support/fixtures";
import { isApplied, buildAppliedText } from "../../src/replace-render";

const noopTheme = { fg: (_color: string, text: string) => text } as any;

function manyLines(n: number): string {
  return Array.from({ length: n }, (_, i) => `line${i + 1}`).join("\n") + "\n";
}

describe("shouldSkipDiff", () => {
  it("does not skip when both sides are exactly at MAX_DIFF_LINES", () => {
    expect(shouldSkipDiff(MAX_DIFF_LINES, MAX_DIFF_LINES)).toBe(false);
  });

  it("skips when either side is one line over MAX_DIFF_LINES", () => {
    expect(shouldSkipDiff(MAX_DIFF_LINES + 1, MAX_DIFF_LINES)).toBe(true);
    expect(shouldSkipDiff(MAX_DIFF_LINES, MAX_DIFF_LINES + 1)).toBe(true);
  });

  it("does not skip for small files", () => {
    expect(shouldSkipDiff(1, 1)).toBe(false);
    expect(shouldSkipDiff(0, 0)).toBe(false);
  });
});

describe("replace diff size-gate", () => {
  it("skips details.diff above MAX_DIFF_LINES while model-visible text is unchanged", async () => {
    const content = manyLines(MAX_DIFF_LINES + 1);
    await withTempFile("big.ts", content, async ({ cwd }) => {
      const { ctx, editTool } = setupIntegrationTest(cwd);
      const hashes = await lineHashes(content);

      const result = await editTool.execute(
        "e1",
        {
          path: "big.ts",
          changes: [{ hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)], content_lines: ["CHANGED"] }],
        },
        undefined,
        undefined,
        ctx,
      );

      expect(result.content[0].text).toContain("Successfully replaced");
      expect(result.content[0].text).toContain("Added 1 line(s), removed 1 line(s).");
      expect(result.details?.diff).toBe("");
      expect(result.details?.firstChangedLine).toBe(2);
      expect(result.details?.metrics?.changed_lines).toEqual({ first: 2, last: 2 });
    });
  });

  it("does not render a blank result for a large successful edit with no warnings", async () => {
    const content = manyLines(MAX_DIFF_LINES + 1);
    await withTempFile("big2.ts", content, async ({ cwd }) => {
      const { ctx, editTool } = setupIntegrationTest(cwd);
      const hashes = await lineHashes(content);

      const result = await editTool.execute(
        "e1",
        {
          path: "big2.ts",
          changes: [{ hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)], content_lines: ["CHANGED"] }],
        },
        undefined,
        undefined,
        ctx,
      );

      expect(result.details?.diff).toBe("");
      expect(isApplied(result.details)).toBe(true);
      const rendered = buildAppliedText(result.content[0].text, result.details, noopTheme);
      expect(rendered).toBeDefined();
      expect(rendered).toContain("Successfully replaced");
    });
  });

  it("still populates details.diff below MAX_DIFF_LINES", async () => {
    const content = manyLines(10);
    await withTempFile("small.ts", content, async ({ cwd }) => {
      const { ctx, editTool } = setupIntegrationTest(cwd);
      const hashes = await lineHashes(content);

      const result = await editTool.execute(
        "e1",
        {
          path: "small.ts",
          changes: [{ hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)], content_lines: ["CHANGED"] }],
        },
        undefined,
        undefined,
        ctx,
      );

      expect(result.content[0].text).toContain("Successfully replaced");
      expect(result.details?.diff).not.toBe("");
      expect(result.details?.diff).toContain("CHANGED");
    });
  });
});
