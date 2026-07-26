import { describe, expect, it } from "vitest";
import { detectEnding, toLF, restoreEndings, stripBOM, analyzeEndings } from "../../src/replace-diff";

describe("detectEnding", () => {
  it("detects CRLF when \\r\\n appears first", () => {
    expect(detectEnding("hello\r\nworld")).toBe("\r\n");
  });

  it("defaults to LF when only \\n is present", () => {
    expect(detectEnding("hello\nworld")).toBe("\n");
  });

  it("detects CRLF when both exist but CRLF comes first", () => {
    expect(detectEnding("line1\r\nline2\nline3")).toBe("\r\n");
  });

  it("defaults to LF when no line endings exist", () => {
    expect(detectEnding("hello world")).toBe("\n");
  });

  it("defaults to LF for empty string", () => {
    expect(detectEnding("")).toBe("\n");
  });
});

describe("toLF", () => {
  it("converts \\r\\n to \\n", () => {
    expect(toLF("hello\r\nworld")).toBe("hello\nworld");
  });

  it("converts bare \\r to \\n", () => {
    expect(toLF("hello\rworld")).toBe("hello\nworld");
  });

  it("leaves already-LF text unchanged", () => {
    expect(toLF("hello\nworld")).toBe("hello\nworld");
  });

  it("handles mixed line endings", () => {
    expect(toLF("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  it("returns empty string for empty input", () => {
    expect(toLF("")).toBe("");
  });
});

describe("stripBOM", () => {
  it("strips \\uFEFF prefix", () => {
    const result = stripBOM("\uFEFFhello");
    expect(result).toEqual({ bom: "\uFEFF", text: "hello" });
  });

  it("returns empty bom when no BOM present", () => {
    const result = stripBOM("hello");
    expect(result).toEqual({ bom: "", text: "hello" });
  });

  it("handles empty string with BOM only", () => {
    const result = stripBOM("\uFEFF");
    expect(result).toEqual({ bom: "\uFEFF", text: "" });
  });

  it("handles plain empty string", () => {
    const result = stripBOM("");
    expect(result).toEqual({ bom: "", text: "" });
  });
});

function* endingStrings(len: number): Generator<string> {
  if (len === 0) {
    yield "";
    return;
  }
  for (const rest of endingStrings(len - 1)) {
    for (const ch of ["a", "\r", "\n"]) yield ch + rest;
  }
}

function oracleHadMixedEndings(content: string): boolean {
  const hasCRLF = content.includes("\r\n");
  const hasLoneLF = /(?<!\r)\n/.test(content);
  const hasLoneCR = /\r(?!\n)/.test(content);
  return (hasCRLF && hasLoneLF) || hasLoneCR;
}

describe("analyzeEndings", () => {
  it("matches detectEnding/toLF/the original 3-scan hadMixedEndings formula on every string up to length 7 over {a, CR, LF}", () => {
    for (let len = 0; len <= 7; len++) {
      for (const content of endingStrings(len)) {
        const { normalized, originalEnding, hadMixedEndings } = analyzeEndings(content);
        expect(normalized).toBe(toLF(content));
        expect(originalEnding).toBe(detectEnding(content));
        expect(hadMixedEndings).toBe(oracleHadMixedEndings(content));
      }
    }
  });

  it("flags mixed endings for CRLF plus a lone LF", () => {
    expect(analyzeEndings("a\r\nb\nc").hadMixedEndings).toBe(true);
  });

  it("flags mixed endings for any lone CR", () => {
    expect(analyzeEndings("a\rb\nc").hadMixedEndings).toBe(true);
    expect(analyzeEndings("a\r\rb").hadMixedEndings).toBe(true);
  });

  it("does not flag uniform CRLF as mixed", () => {
    expect(analyzeEndings("a\r\nb\r\nc\r\n").hadMixedEndings).toBe(false);
  });

  it("does not flag uniform LF as mixed", () => {
    expect(analyzeEndings("a\nb\nc\n").hadMixedEndings).toBe(false);
  });

  it("does not flag single-line content with no endings as mixed", () => {
    expect(analyzeEndings("hello world").hadMixedEndings).toBe(false);
  });
});

describe("restoreEndings", () => {
  it("converts LF back to CRLF when original used CRLF", () => {
    expect(restoreEndings("hello\nworld", "\r\n")).toBe("hello\r\nworld");
  });

  it("leaves LF unchanged when original used LF", () => {
    expect(restoreEndings("hello\nworld", "\n")).toBe("hello\nworld");
  });

  it("handles empty string with CRLF target", () => {
    expect(restoreEndings("", "\r\n")).toBe("");
  });

  it("handles empty string with LF target", () => {
    expect(restoreEndings("", "\n")).toBe("");
  });

  it("handles multiple lines with CRLF target", () => {
    expect(restoreEndings("a\nb\nc", "\r\n")).toBe("a\r\nb\r\nc");
  });

  it("preserves content without newlines", () => {
    expect(restoreEndings("hello", "\r\n")).toBe("hello");
    expect(restoreEndings("hello", "\n")).toBe("hello");
  });
});
