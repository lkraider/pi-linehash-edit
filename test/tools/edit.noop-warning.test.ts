import { describe, expect, it } from "vitest";
import { lineHashes } from "../../src/hashline";
import { withTempFile, setupIntegrationTest, anchorAt, getText } from "../support/fixtures";


describe("edit tool noop + warnings", () => {
  it("returns classification noop instead of throwing on identical content", async () => {
    await withTempFile("sample.ts", "aaa\nbbb\nccc\n", async ({ cwd }) => {
      const { ctx, editTool } = setupIntegrationTest(cwd);
      const hashes = await lineHashes("aaa\nbbb\nccc\n");

      const result = await editTool.execute(
        "e1",
        {
          path: "sample.ts",
          changes: [{ hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)], content_lines: ["bbb"] }],
        },
        undefined,
        undefined,
        ctx,
      );
      expect(result.details.classification).toBe("noop");
    });
  });

  it("warns on trailing duplicate instead of auto-fixing silently", async () => {
    await withTempFile("sample.ts", "aaa\nbbb\nccc\n", async ({ cwd, path }) => {
      const { ctx, editTool } = setupIntegrationTest(cwd);
      const hashes = lineHashes("aaa\nbbb\nccc\n");

      const result = await editTool.execute(
        "e1",
        {
          path: "sample.ts",
          changes: [{ hash_range_inclusive: [anchorAt(hashes, 2), anchorAt(hashes, 2)], content_lines: ["BBB", "ccc"] }],
        },
        undefined,
        undefined,
        ctx,
      );

      expect(result.details.classification).not.toBe("noop");
      expect(getText(result)).toMatch(/\[W_DUP\]/);

      const { readFile } = await import("fs/promises");
      const content = await readFile(path, "utf-8");
      expect(content).toBe("aaa\nBBB\nccc\nccc\n");
    });
  });
});
