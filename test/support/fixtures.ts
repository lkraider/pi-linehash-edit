import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { beforeAll, afterAll, vi } from "vitest";
import { Compile } from "typebox/compile";
import register from "../../index";
import { regReplaceFlat } from "../../src/replace";
import { HASH_DIGITS, HASH_SEP } from "../../src/hashline";

const HASH_RE = `\\d{${HASH_DIGITS}}`;
async function getWritableTempRoot(): Promise<string> {
  const fallback = join(process.cwd(), ".tmp");
  await mkdir(fallback, { recursive: true });
  return fallback;
}

async function setupTestHome(): Promise<{
  home: string;
  testPath: string;
  cleanup: () => Promise<void>;
}> {
  const tmpHome = await mkdtemp(join(await getWritableTempRoot(), "testhome-"));
  vi.stubEnv('HOME', tmpHome);
  const testPath = join(tmpHome, "test.txt");
  return {
    home: tmpHome,
    testPath,
    cleanup: async () => {
      vi.unstubAllEnvs();
      await rm(tmpHome, { recursive: true, force: true });
    },
  };
}
export function useTestHome(): { testPath: string } {
  const state: { testPath: string } = { testPath: "" };
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const s = await setupTestHome();
    state.testPath = s.testPath;
    cleanup = s.cleanup;
  });

  afterAll(async () => {
    await cleanup?.();
  });

  return state;
}

async function freshCwd(): Promise<string> {
  const cwd = await mkdtemp(join(await getWritableTempRoot(), "pi-hashline-test-"));
  process.env.HOME = cwd;
  return cwd;
}

export async function withTempFile(
  name: string,
  content: string,
  run: (args: { cwd: string; path: string }) => Promise<void>,
): Promise<void> {
  const cwd = await freshCwd();
  const path = join(cwd, name);
  try {
    await writeFile(path, content, "utf-8");
    await run({ cwd, path });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

export async function withTempBytes(
  name: string,
  bytes: Uint8Array,
  run: (args: { cwd: string; path: string }) => Promise<void>,
): Promise<void> {
  const cwd = await freshCwd();
  const path = join(cwd, name);
  try {
    await writeFile(path, bytes);
    await run({ cwd, path });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

export async function withTempSubdir(
  name: string,
  run: (args: { cwd: string; path: string }) => Promise<void>,
): Promise<void> {
  const cwd = await freshCwd();
  const path = join(cwd, name);
  try {
    await mkdir(path, { recursive: true });
    await run({ cwd, path });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

export async function withTempDir(
  prefix: string,
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(await getWritableTempRoot(), prefix));
  process.env.HOME = dir;
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(await getWritableTempRoot(), prefix));
  process.env.HOME = dir;
  return dir;
}

export function makeFakePiRegistry() {
  const tools = new Map<string, any>();
  return {
    pi: {
      registerTool(tool: any) {
        const originalExecute = tool.execute;
        const validator = Compile(tool.parameters);
        tool.execute = async function(
          toolCallId: string,
          params: unknown,
          signal: AbortSignal | undefined,
          onUpdate: unknown,
          ctx: unknown,
        ) {
          const prepared = tool.prepareArguments
            ? tool.prepareArguments(params)
            : params;
          if (!validator.Check(prepared)) {
            const errors = [...validator.Errors(prepared)]
              .map((e: any) => `  - ${e.message}`)
              .join("\n");
            const msg = "[E_BAD_SHAPE] Schema validation failed for tool \"" + tool.name + "\" after prepareArguments. The prepareArguments return value does not match the registered schema.\n" + errors;
            throw new Error(msg);
          }
          return originalExecute.call(this, toolCallId, prepared, signal, onUpdate, ctx);
        };
        tools.set(tool.name, tool);
      },
      registerCommand() {},
      on() {},
    } as any,
    getTool(name: string) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool not registered: ${name}`);
      return tool;
    },
  };
}

export function setupIntegrationTest(cwd: string) {
  const { pi, getTool } = makeFakePiRegistry();
  register(pi);
  const ctx = { cwd, ui: { notify() {} } } as any;
  return { pi, getTool, ctx, readTool: getTool("read"), editTool: getTool("replace") };
}

export function setupFlatIntegrationTest(cwd: string) {
  const { pi, getTool } = makeFakePiRegistry();
  register(pi);
  regReplaceFlat(pi);
  const ctx = { cwd, ui: { notify() {} } } as any;
  return { pi, getTool, ctx, readTool: getTool("read"), editTool: getTool("replace") };
}

export function getText(result: { content: Array<{ text?: string }> }): string {
  return result.content[0]?.text ?? "";
}

export function extractHash(line: string): string {
  return line.split("│")[0]!
}

export function anchorHash(row: string): string {
  return extractHash(row).slice(-HASH_DIGITS);
}

export function anchorAt(hashes: string[], line: number): string {
  return `${line}${hashes[line - 1]}`;
}

export const anchorShapeRe = new RegExp(`^\\d+${HASH_RE}$`);

export function anchorRowRe(
  content: string,
  opts: { prefix?: "" | " " | "+" | "-"; line?: number } = {},
): RegExp {
  const esc = content.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pfx = opts.prefix === "+" ? "\\+" : (opts.prefix ?? "");
  const lineRe = opts.line !== undefined ? String(opts.line) : "\\d+";
  return new RegExp(`^${pfx}${lineRe}${HASH_RE}${HASH_SEP}${esc}$`, "m");
}

export function fakeAnchor(line: number): string {
  return `${line}${"9".repeat(HASH_DIGITS)}`;
}

export async function makeTag(content: string, line: number, _path?: string): Promise<{ line: number; hash: string }> {
  const { lineHashes } = await import("../../src/hashline");
  const hashes = lineHashes(content);
  return { line, hash: hashes[line - 1]! };
}
