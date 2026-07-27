import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createReadTool, formatSize, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, type TruncationResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { sniffKind } from "./file-kind";
import { streamReadWindow } from "./read-stream";
import { formatRegion } from "./hashline";
import { toCwd } from "./paths";
import { abortIf } from "./utils";
import { loadP, loadGuide } from "./prompts";
import { validateAccess } from "./validation";

const R_DESC = loadP("../prompts/read.md", { DEFAULT_MAX_LINES: String(DEFAULT_MAX_LINES), DEFAULT_MAX_BYTES: formatSize(DEFAULT_MAX_BYTES) });
const R_SNIPPET = loadP("../prompts/read-snippet.md");
const R_GUIDE = loadGuide("../prompts/read-guidelines.md");

function positive(value: number | undefined, name: string): number | undefined {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) throw new Error(`Read request field "${name}" must be a positive integer.`);
  return value;
}

function formatPaginationHint(start: number, end: number, total: number, next: number, byteLimit?: number): string {
  return `[Showing lines ${start}-${end} of ${total}${byteLimit ? ` (${formatSize(byteLimit)} limit)` : ""}. Use offset=${next} to continue.]`;
}

function finish(lines: string[], start: number, total: number, snapshot: string, forceTruncated = false): { text: string; truncation?: TruncationResult; nextOffset?: number } {
  if (start > total && (total > 0 || start > 1)) return { text: `snapshot:${snapshot}\nOffset ${start} is beyond end of file (${total} lines total).` };
  const rows = total === 0 ? "1│" : formatRegion(lines, start);
  let truncation = truncateHead(`snapshot:${snapshot}\n${rows}`);
  if (forceTruncated && !truncation.truncated) truncation = { ...truncation, truncated: true, truncatedBy: "lines", totalLines: total + 1 };
  const shown = Math.max(0, truncation.outputLines - 1);
  if (total > 0 && shown === 0) return { text: `snapshot:${snapshot}\n[Line ${start} exceeds ${formatSize(truncation.maxBytes)}.]`, truncation };
  const end = total === 0 ? 0 : start + shown - 1;
  const hasMore = truncation.truncated || end < total;
  const nextOffset = hasMore ? Math.max(start, end + 1) : undefined;
  const hint = nextOffset ? `\n\n${formatPaginationHint(start, end, total, nextOffset, truncation.truncatedBy === "bytes" ? truncation.maxBytes : undefined)}` : "";
  return { text: `${truncation.content}${hint}`, ...(truncation.truncated ? { truncation } : {}), ...(nextOffset ? { nextOffset } : {}) };
}


export async function fmtReadPreviewStreamed(path: string, options: { offset?: number; limit?: number }, signal?: AbortSignal) {
  const start = positive(options.offset, "offset") ?? 1, limit = positive(options.limit, "limit");
  const observed = await streamReadWindow(path, start, limit, signal);
  if (observed.kind.kind !== "text") throw new Error(`Path changed to a non-text file while being read: ${path}.`);
  const result = finish(observed.selectedLines, start, observed.totalLines, observed.snapshot, limit === undefined && observed.totalLines > DEFAULT_MAX_LINES);
  return { ...result, snapshot: observed.snapshot, hadUtf8DecodeErrors: observed.hadUtf8DecodeErrors };
}

export function regRead(pi: ExtensionAPI): void {
  pi.registerTool({ name: "read", label: "Read", description: R_DESC, promptSnippet: R_SNIPPET, promptGuidelines: R_GUIDE,
    parameters: Type.Object({ path: Type.String({ description: "Path to the file" }), offset: Type.Optional(Type.Integer({ minimum: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1 })) }),
    async execute(id, params, signal, onUpdate, ctx) {
      const path = params.path, absolute = toCwd(path, ctx.cwd);
      abortIf(signal); await validateAccess(absolute, path); const kind = await sniffKind(absolute);
      if (kind.kind === "image") return (createReadTool(ctx.cwd).execute as any)(id, params, signal, onUpdate, ctx);
      if (kind.kind === "directory") throw new Error(`Path is a directory: ${path}.`);
      if (kind.kind === "binary") throw new Error(`Path is a binary file: ${path} (${kind.description}).`);
      const preview = await fmtReadPreviewStreamed(absolute, { offset: params.offset, limit: params.limit }, signal);
      const text = preview.hadUtf8DecodeErrors ? `${preview.text}\n\n[Non-UTF-8 bytes shown as U+FFFD; editing rewrites as UTF-8.]` : preview.text;
      return { content: [{ type: "text" as const, text }], details: preview.truncation ? { truncation: preview.truncation } : undefined };
    }
  });
}
