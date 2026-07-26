import { describe, expect, it } from "vitest";
import { lineHashes } from "../../src/hashline";
import { MAX_DIFF_LINES } from "../../src/constants";
import { withTempFile, setupIntegrationTest, anchorAt } from "../support/fixtures";

function manyLines(n: number): string {
  return Array.from({ length: n }, (_, i) => `line${i + 1}`).join("\n") + "\n";
}

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
