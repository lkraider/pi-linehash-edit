import { describe, expect, it } from "vitest";
import { fmtReadPreview, fmtReadPreviewStreamed } from "../../src/read";
import { toLF, stripBOM } from "../../src/replace-diff";
import { withTempFile } from "../support/fixtures";

function normalize(content: string): string {
  return toLF(stripBOM(content).text);
}

function manyLines(n: number, prefix = "line"): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join("\n") + "\n";
}

const FIXTURES: Record<string, string> = {
  empty: "",
  "single blank line": "\n",
  "no trailing newline": "a\nb\nc",
  "trailing newline": "a\nb\nc\n",
  "lone CR endings": "a\rb\rc\r",
  "lone CR, no trailing": "a\rb\rc",
  "CRLF endings": "a\r\nb\r\nc\r\n",
  "mixed endings": "a\r\nb\rc\nd",
  "double CR": "a\r\rb",
  ">99 lines": manyLines(150),
  "exactly 99 lines": manyLines(99),
  "exactly 100 lines": manyLines(100),
  "multibyte content": "héllo\n世界\n🎉🎊\nplain\n",
  "blank and whitespace-only lines": "a\n\n   \nb\n\t\nc\n",
  "BOM prefix": "﻿a\nb\nc\n",
};

const WINDOWS: Array<{ offset?: number; limit?: number }> = [
  {},
  { limit: 2 },
  { offset: 2 },
  { offset: 2, limit: 2 },
  { offset: 1, limit: 1 },
  { offset: 1000 },
  { offset: 1, limit: 1000 },
];

describe("streamed read matches whole-file read exactly", () => {
  for (const [label, content] of Object.entries(FIXTURES)) {
    for (const window of WINDOWS) {
      it(`${label} @ ${JSON.stringify(window)}`, async () => {
        await withTempFile("fixture.txt", content, async ({ path }) => {
          const oracle = await fmtReadPreview(normalize(content), window, undefined, path);
          const streamed = await fmtReadPreviewStreamed(path, window, undefined);

          expect(streamed.text).toBe(oracle.text);
          expect(streamed.nextOffset).toBe(oracle.nextOffset);
          expect(streamed.truncation).toEqual(oracle.truncation);
        });
      });
    }
  }

  it("matches for a window ending exactly at EOF", async () => {
    const content = manyLines(10);
    await withTempFile("fixture.txt", content, async ({ path }) => {
      const window = { offset: 6, limit: 5 };
      const oracle = await fmtReadPreview(normalize(content), window, undefined, path);
      const streamed = await fmtReadPreviewStreamed(path, window, undefined);
      expect(streamed.text).toBe(oracle.text);
      expect(streamed.nextOffset).toBe(oracle.nextOffset);
    });
  });

  it("matches for offset exactly at the last line", async () => {
    const content = manyLines(10);
    await withTempFile("fixture.txt", content, async ({ path }) => {
      const window = { offset: 10 };
      const oracle = await fmtReadPreview(normalize(content), window, undefined, path);
      const streamed = await fmtReadPreviewStreamed(path, window, undefined);
      expect(streamed.text).toBe(oracle.text);
    });
  });

  it("reports the same truncation metadata as the whole-file path for a default (no-limit) read past DEFAULT_MAX_LINES", async () => {
    const content = manyLines(3000);
    await withTempFile("huge.txt", content, async ({ path }) => {
      const oracle = await fmtReadPreview(normalize(content), {}, undefined, path);
      const streamed = await fmtReadPreviewStreamed(path, {}, undefined);

      expect(streamed.text).toBe(oracle.text);
      expect(streamed.nextOffset).toBe(oracle.nextOffset);
      // totalBytes is excluded: the oracle's value counts the byte size of
      // formatting+hashing the entire untruncated file, which the streamed
      // path deliberately never buffers or hashes past the window (that's
      // the whole point of streaming). Every other field — most importantly
      // truncated/truncatedBy/totalLines, which is what callers act on — must
      // still match exactly.
      const { totalBytes: _oracleTotalBytes, ...oracleRest } = oracle.truncation!;
      const { totalBytes: _streamedTotalBytes, ...streamedRest } = streamed.truncation!;
      expect(streamedRest).toEqual(oracleRest);
    });
  });

  it("treats a file containing only a BOM as empty, same as the whole-file path", async () => {
    const content = "﻿";
    await withTempFile("bomonly.txt", content, async ({ path }) => {
      const oracle = await fmtReadPreview(normalize(content), {}, undefined, path);
      const streamed = await fmtReadPreviewStreamed(path, {}, undefined);

      expect(streamed.text).toBe(oracle.text);
    });
  });
});
