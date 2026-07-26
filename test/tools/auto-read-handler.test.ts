import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { writeFile } from "fs/promises";
import { join } from "path";
import register from "../../index";
import { withTempDir } from "../support/fixtures";

function makeFakePi() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const tools = new Map<string, unknown>();
  return {
    pi: {
      registerTool(tool: any) {
        tools.set(tool.name, tool);
      },
      registerCommand() {},
      on(event: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(event, handler);
      },
      getActiveTools() {
        return [];
      },
      setActiveTools() {},
    } as any,
    handlers,
    getTool(name: string) {
      return tools.get(name);
    },
  };
}

describe("auto-read handler", () => {
  const originalAutoRead = process.env.PI_HASHLINE_AUTO_READ;

  beforeEach(() => {
    process.env.PI_HASHLINE_AUTO_READ = "1";
  });

  afterEach(() => {
    if (originalAutoRead === undefined) {
      delete process.env.PI_HASHLINE_AUTO_READ;
    } else {
      process.env.PI_HASHLINE_AUTO_READ = originalAutoRead;
    }
  });

  it("appends auto-read content after a successful write", async () => {
    await withTempDir("auto-read-", async (dir) => {
      const filePath = join(dir, "test.txt");
      await writeFile(filePath, "hello\nworld\n", "utf-8");

      const { pi, handlers } = makeFakePi();
      register(pi);

      const handler = handlers.get("tool_result");
      expect(handler).toBeDefined();

      const result = await handler!(
        {
          toolName: "write",
          isError: false,
          input: { path: "test.txt" },
          content: [{ type: "text", text: "File written." }],
        },
        { cwd: dir },
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty("content");
      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: "text", text: "File written." });
      expect(content[1].type).toBe("text");
      expect(content[1].text).toContain("--- Auto-read (hashline anchors) ---");
      expect(content[1].text).toContain("│hello");
      expect(content[1].text).toContain("│world");
    });
  });

  it("bounds the auto-read window to the changed region on a replace result", async () => {
    await withTempDir("auto-read-", async (dir) => {
      const filePath = join(dir, "big.txt");
      const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
      await writeFile(filePath, lines.join("\n") + "\n", "utf-8");

      const { pi, handlers } = makeFakePi();
      register(pi);

      const result = await handlers.get("tool_result")!(
        {
          toolName: "replace",
          isError: false,
          input: { path: "big.txt" },
          content: [{ type: "text", text: "replaced" }],
          details: { firstChangedLine: 50, metrics: { changed_lines: { first: 50, last: 50 } } },
        },
        { cwd: dir },
      );

      const text = (result as { content: Array<{ text: string }> }).content[1].text;
      expect(text).toContain("│line 50");
      expect(text).not.toContain("│line 1\n");
      expect(text).not.toContain("│line 200");
    });
  });

  it("returns nothing when auto-read is disabled", async () => {
    delete process.env.PI_HASHLINE_AUTO_READ;

    const { pi, handlers } = makeFakePi();
    register(pi);

    const handler = handlers.get("tool_result");
    expect(handler).toBeDefined();

    const result = await handler!(
      {
        toolName: "write",
        isError: false,
        input: { path: "test.txt" },
        content: [],
      },
      { cwd: "/tmp" },
    );

    expect(result).toBeUndefined();
  });

  it("returns nothing for non-write tool results", async () => {
    const { pi, handlers } = makeFakePi();
    register(pi);

    const handler = handlers.get("tool_result");
    expect(handler).toBeDefined();

    const result = await handler!(
      {
        toolName: "read",
        isError: false,
        input: { path: "test.txt" },
        content: [],
      },
      { cwd: "/tmp" },
    );

    expect(result).toBeUndefined();
  });

  it("returns nothing when the write tool reported an error", async () => {
    const { pi, handlers } = makeFakePi();
    register(pi);

    const handler = handlers.get("tool_result");
    expect(handler).toBeDefined();

    const result = await handler!(
      {
        toolName: "write",
        isError: true,
        input: { path: "test.txt" },
        content: [],
      },
      { cwd: "/tmp" },
    );

    expect(result).toBeUndefined();
  });

  it("returns nothing when the input has no path", async () => {
    const { pi, handlers } = makeFakePi();
    register(pi);

    const handler = handlers.get("tool_result");
    expect(handler).toBeDefined();

    const result = await handler!(
      {
        toolName: "write",
        isError: false,
        input: {},
        content: [],
      },
      { cwd: "/tmp" },
    );

    expect(result).toBeUndefined();
  });

  it("returns nothing when the written file is empty", async () => {
    await withTempDir("auto-read-", async (dir) => {
      const filePath = join(dir, "empty.txt");
      await writeFile(filePath, "", "utf-8");

      const { pi, handlers } = makeFakePi();
      register(pi);

      const handler = handlers.get("tool_result");
      expect(handler).toBeDefined();

      const result = await handler!(
        {
          toolName: "write",
          isError: false,
          input: { path: "empty.txt" },
          content: [],
        },
        { cwd: dir },
      );

      expect(result).toBeUndefined();
    });
  });

  it("handles file read errors gracefully (no throw)", async () => {
    const { pi, handlers } = makeFakePi();
    register(pi);

    const handler = handlers.get("tool_result");
    expect(handler).toBeDefined();

    const result = await handler!(
      {
        toolName: "write",
        isError: false,
        input: { path: "nonexistent.txt" },
        content: [],
      },
      { cwd: "/tmp" },
    );

    expect(result).toBeUndefined();
  });
});
