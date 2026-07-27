import { DEFAULT_MAX_BYTES, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { regReplace } from "./src/replace";
import { regRead } from "./src/read";
import { readConfig, toggleAutoRead } from "./src/config";
import { readNormFile } from "./src/file-reader";
import { formatRegion } from "./src/hashline";
import { visLines, isRec } from "./src/utils";
import { AUTO_READ_MAX, AUTO_READ_CONTEXT } from "./src/constants";

export type Region = { first: number; last: number };

export function sparseRows(lineCount: number, regions: Region[], cap = AUTO_READ_MAX, context = AUTO_READ_CONTEXT, cost: (row: number) => number = () => 0, byteCap = Infinity): { rows: number[]; omitted: Region[] } {
  const normalized = regions.map(r => ({ first: Math.max(1, Math.min(lineCount, r.first)), last: Math.max(1, Math.min(lineCount, r.last)) })).filter(r => r.first <= r.last);
  const mandatory: number[] = [];
  for (const r of normalized) for (let n = r.first; n <= r.last; n++) mandatory.push(n);
  const selected = new Set<number>();
  let bytes = 0;
  const add = (row: number) => {
    if (selected.has(row)) return true;
    const size = cost(row);
    if (selected.size >= cap || bytes + size > byteCap) return false;
    selected.add(row); bytes += size; return true;
  };
  for (const row of [...new Set(mandatory)].sort((a, b) => a - b)) add(row);
  const omitted = normalized.filter(r => { for (let n = r.first; n <= r.last; n++) if (!selected.has(n)) return true; return false; });
  for (let distance = 1; distance <= context && selected.size < cap; distance++) for (const region of normalized) {
    for (const row of [region.first - distance, region.last + distance]) if (row >= 1 && row <= lineCount) add(row);
  }
  return { rows: [...selected].sort((a, b) => a - b), omitted };
}

function sparsePreview(content: string, snapshot: string, regions: Region[]): string {
  const lines = visLines(content);
  if (!lines.length) return `snapshot:${snapshot}\n1│`;
  const headerBytes = Buffer.byteLength(`snapshot:${snapshot}\n`);
  const { rows, omitted } = sparseRows(lines.length, regions, AUTO_READ_MAX, 32, row => Buffer.byteLength(`${row}│${lines[row - 1]}\n`), Math.max(0, DEFAULT_MAX_BYTES - headerBytes - 4096));
  const blocks: string[] = [`snapshot:${snapshot}`];
  let run: number[] = [];
  const flush = () => { if (run.length) blocks.push(formatRegion(run.map(n => lines[n - 1]!), run[0])); run = []; };
  for (const row of rows) { if (run.length && row !== run.at(-1)! + 1) flush(); run.push(row); }
  flush();
  if (omitted.length) blocks.push(`[Changed regions omitted by cap: ${omitted.map(r => `${r.first}-${r.last}`).join(", ")}]`);
  return blocks.join("\n\n");
}

export default function (pi: ExtensionAPI): void {
  regRead(pi); regReplace(pi);
  let autoRead = true;
  pi.on("session_start", async () => { const config = await readConfig(); autoRead = config.autoRead; regReplace(pi, autoRead); const active = pi.getActiveTools(); pi.setActiveTools(active.filter(t => t !== "edit")); });
  pi.registerCommand("toggle-auto-read", { description: "Toggle automatic sparse read after write/replace", handler: async (_args, ctx) => { autoRead = await toggleAutoRead(); regReplace(pi, autoRead); ctx.ui.notify(`Auto-read: ${autoRead ? "enabled" : "disabled"}`, "info"); } });
  pi.on("tool_result", async (event, ctx) => {
    if (!autoRead || event.isError || event.toolName !== "replace" && event.toolName !== "write") return;
    const path = isRec(event.input) && typeof event.input.path === "string" ? event.input.path : undefined;
    if (!path) return;
    try {
      const file = await readNormFile(path, ctx.cwd);
      const details = isRec((event as { details?: unknown }).details) ? (event as { details: Record<string, unknown> }).details : undefined;
      const rawRegions = details?.changedRegions;
      const regions: Region[] = Array.isArray(rawRegions) ? rawRegions.filter(isRec).map(r => ({ first: Number(r.first), last: Number(r.last) })).filter(r => Number.isInteger(r.first) && Number.isInteger(r.last)) : [{ first: 1, last: Math.min(AUTO_READ_MAX, Math.max(1, visLines(file.normalized).length)) }];
      return { content: [...(event.content ?? []), { type: "text" as const, text: `\n\n--- Auto-read ---\n${sparsePreview(file.normalized, file.snapshot, regions)}` }] };
    } catch (error) { console.error("Auto-read failed:", error); }
  });
}
