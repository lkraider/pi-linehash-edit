import { describe, expect, it } from "vitest";
import { saveUndo, getUndo, clearUndo } from "../../src/replace-undo";

describe("undo-store", () => {
  it("round-trips a single entry", () => {
    saveUndo("/a.ts", {
      content: "hello\nworld",
      bom: "",
      originalEnding: "\n",
    });
    const entry = getUndo("/a.ts");
    expect(entry).toBeDefined();
    expect(entry!.content).toBe("hello\nworld");
    expect(entry!.bom).toBe("");
    expect(entry!.originalEnding).toBe("\n");
  });

  it("returns undefined for a path with no undo history", () => {
    expect(getUndo("/nonexistent.ts")).toBeUndefined();
  });

  it("overwrites previous entry for the same path", () => {
    saveUndo("/overwrite.ts", {
      content: "first",
      bom: "",
      originalEnding: "\n",
    });
    saveUndo("/overwrite.ts", {
      content: "second",
      bom: "﻿",
      originalEnding: "\r\n",
    });
    const entry = getUndo("/overwrite.ts");
    expect(entry!.content).toBe("second");
    expect(entry!.bom).toBe("﻿");
    expect(entry!.originalEnding).toBe("\r\n");
  });

  it("clearUndo removes the entry", () => {
    saveUndo("/clear-me.ts", {
      content: "data",
      bom: "",
      originalEnding: "\n",
    });
    expect(getUndo("/clear-me.ts")).toBeDefined();
    clearUndo("/clear-me.ts");
    expect(getUndo("/clear-me.ts")).toBeUndefined();
  });

  it("handles multiple independent paths", () => {
    saveUndo("/a.ts", {
      content: "aaa",
      bom: "",
      originalEnding: "\n",
    });
    saveUndo("/b.ts", {
      content: "bbb",
      bom: "",
      originalEnding: "\n",
    });
    expect(getUndo("/a.ts")!.content).toBe("aaa");
    expect(getUndo("/b.ts")!.content).toBe("bbb");
    clearUndo("/a.ts");
    expect(getUndo("/a.ts")).toBeUndefined();
    expect(getUndo("/b.ts")!.content).toBe("bbb");
  });
});
