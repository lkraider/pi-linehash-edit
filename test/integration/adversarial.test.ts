import { describe, it, expect } from "vitest";
import { readFile } from "fs/promises";
import { withTempFile, setupIntegrationTest, getText, extractHash } from "../support/fixtures";

describe("adversarial: boundary auto-fix double-strips a sandwiched insert", () => {
  it("deletes the whole line instead of replacing it, when both neighbors coincidentally match", async () => {
    const file = "- item\nOLD\n- item\n";
    await withTempFile("sandwich.txt", file, async ({ cwd, path }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);
      const read1 = await readTool.execute("r1", { path: "sandwich.txt" }, undefined, undefined, ctx);
      const lines1 = getText(read1).split("\n");
      const oldHash = extractHash(lines1.find((l) => l.includes("│OLD"))!);

      await editTool.execute(
        "e1",
        { path: "sandwich.txt", changes: [{ hash_range_inclusive: [oldHash, oldHash], content_lines: ["- item", "- item"] }] },
        undefined, undefined, ctx,
      );

      const content = await readFile(path, "utf-8");
      expect(content).toBe("- item\n- item\n");
    });
  });
});

describe("adversarial: boundary auto-fix eats an intentional adjacent duplicate", () => {
  it("silently no-ops an insert-a-copy edit instead of applying it", async () => {
    const file = "- item\n- item\n";
    await withTempFile("adjacent.txt", file, async ({ cwd, path }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);
      const read1 = await readTool.execute("r1", { path: "adjacent.txt" }, undefined, undefined, ctx);
      const line2Hash = extractHash(getText(read1).split("\n")[1]!);

      await editTool.execute(
        "e1",
        { path: "adjacent.txt", changes: [{ hash_range_inclusive: [line2Hash, line2Hash], content_lines: ["- item", "- item"] }] },
        undefined, undefined, ctx,
      );

      const content = await readFile(path, "utf-8");
      expect(content).toBe("- item\n- item\n");
    });
  });
});

describe("adversarial: duplicate-content lines swap identity across an unrelated edit", () => {
  it("gives an untouched duplicate line a new hash after an unrelated nearby insert", async () => {
    const file = "A\nX\nB1\nB2\nX\nC\n";
    await withTempFile("swap.txt", file, async ({ cwd }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);
      const read1 = await readTool.execute("r1", { path: "swap.txt" }, undefined, undefined, ctx);
      const lines1 = getText(read1).split("\n");
      const x1Hash = extractHash(lines1[1]!);
      const b1Hash = extractHash(lines1[2]!);
      const untouchedXHash = extractHash(lines1[4]!);

      await editTool.execute(
        "e1",
        {
          path: "swap.txt",
          changes: [
            { hash_range_inclusive: [x1Hash, x1Hash], content_lines: [] },
            { hash_range_inclusive: [b1Hash, b1Hash], content_lines: ["B1", "X"] },
          ],
        },
        undefined, undefined, ctx,
      );

      const read2 = await readTool.execute("r2", { path: "swap.txt" }, undefined, undefined, ctx);
      const lines2 = getText(read2).split("\n");
      const untouchedLineNow = lines2.find((l) => l.endsWith("│X") && l !== lines2[2]);
      expect(extractHash(untouchedLineNow!)).not.toBe(untouchedXHash);
    });
  });

  it("lets a follow-up edit using the remembered hash silently land on the wrong line", async () => {
    const file = "A\nX\nB1\nB2\nX\nC\n";
    await withTempFile("swap2.txt", file, async ({ cwd, path }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);
      const read1 = await readTool.execute("r1", { path: "swap2.txt" }, undefined, undefined, ctx);
      const lines1 = getText(read1).split("\n");
      const x1Hash = extractHash(lines1[1]!);
      const b1Hash = extractHash(lines1[2]!);
      const untouchedXHash = extractHash(lines1[4]!);

      await editTool.execute(
        "e1",
        {
          path: "swap2.txt",
          changes: [
            { hash_range_inclusive: [x1Hash, x1Hash], content_lines: [] },
            { hash_range_inclusive: [b1Hash, b1Hash], content_lines: ["B1", "X"] },
          ],
        },
        undefined, undefined, ctx,
      );

      await editTool.execute(
        "e2",
        { path: "swap2.txt", changes: [{ hash_range_inclusive: [untouchedXHash, untouchedXHash], content_lines: ["EDITED"] }] },
        undefined, undefined, ctx,
      );

      const content = await readFile(path, "utf-8");
      expect(content).toBe("A\nB1\nEDITED\nB2\nX\nC\n");
    });
  });
});

describe("adversarial: bare-hash-prefix guard has no escape for legitimate content", () => {
  it("rejects a line that merely starts with 3 alnum chars + │, even if it matches no real anchor", async () => {
    const file = "a\nb\nc\n";
    await withTempFile("boxdraw.txt", file, async ({ cwd }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);
      const read1 = await readTool.execute("r1", { path: "boxdraw.txt" }, undefined, undefined, ctx);
      const bHash = extractHash(getText(read1).split("\n").find((l) => l.endsWith("│b"))!);

      await expect(
        editTool.execute(
          "e1",
          { path: "boxdraw.txt", changes: [{ hash_range_inclusive: [bHash, bHash], content_lines: ["abc│ legitimate table cell"] }] },
          undefined, undefined, ctx,
        ),
      ).rejects.toThrow(/E_BARE_HASH_PREFIX/);
    });
  });
});
