import { DEFAULT_MAX_BYTES, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { regReplace } from "./src/replace";
import { regRead } from "./src/read";
import { readConfig, toggleAutoRead } from "./src/config";
import { readNormFile } from "./src/file-reader";
import { formatRegion } from "./src/line-edit";
import { visLines, isRec } from "./src/utils";
import { AUTO_READ_MAX, AUTO_READ_CONTEXT } from "./src/constants";

export type Region = { first: number; last: number };

export function sparseRows(lineCount: number, regions: Region[], cap = AUTO_READ_MAX, context = AUTO_READ_CONTEXT, cost: (row: number) => number = () => 0, byteCap = Infinity): { rows: number[]; omitted: Region[] } {
  const normalized = regions.map(r => ({ first: Math.max(1, Math.min(lineCount, r.first)), last: Math.max(1, Math.min(lineCount, r.last)) })).filter(r => r.first <= r.last).sort((a, b) => a.first - b.first);
  const selected = new Set<number>();
  let bytes = 0;
  const add = (row: number) => {
    if (selected.has(row)) return true;
    const size = cost(row);
    if (selected.size >= cap || bytes + size > byteCap) return false;
    selected.add(row); bytes += size; return true;
  };
  for (const region of normalized) for (let row = region.first; row <= region.last; row++) if (!add(row) && selected.size >= cap) break;
  const omitted = normalized.filter(r => { for (let n = r.first; n <= r.last; n++) if (!selected.has(n)) return true; return false; });
  for (let distance = 1; distance <= context && selected.size < cap; distance++) for (const after of [false, true]) {
    for (const region of normalized) {
      const row = after ? region.last + distance : region.first - distance;
      if (row >= 1 && row <= lineCount) add(row);
    }
  }
  return { rows: [...selected].sort((a, b) => a - b), omitted };
}

export function sparsePreview(content: string, checksum: string, regions: Region[]): string {
  const lines = visLines(content);
  if (!lines.length) return `checksum:${checksum}\n1│`;
  const cost = (row: number) => Buffer.byteLength(`${row}│${lines[row - 1]}\n`);
  const markerReserve = Buffer.byteLength(`[Changed regions omitted by cap: ${regions.map(r => `${r.first}-${r.last}`).join(", ")}]\n`);
  const { rows, omitted } = sparseRows(
    lines.length, regions, AUTO_READ_MAX - 2, AUTO_READ_CONTEXT, cost,
    Math.max(0, DEFAULT_MAX_BYTES - Buffer.byteLength(`checksum:${checksum}\n`) - markerReserve),
  );
  const blocks: string[] = [`checksum:${checksum}`];
  let run: number[] = [];
  const flush = () => { if (run.length) blocks.push(formatRegion(run.map(n => lines[n - 1]!), run[0])); run = []; };
  for (const row of rows) { if (run.length && row !== run.at(-1)! + 1) flush(); run.push(row); }
  flush();
  if (omitted.length) blocks.push(`[Changed regions omitted by cap: ${omitted.map(r => `${r.first}-${r.last}`).join(", ")}]`);
  const preview = blocks.join("\n");
  if (Buffer.byteLength(preview) <= DEFAULT_MAX_BYTES) return preview;
  return `checksum:${checksum}\n[All ${regions.length} changed regions omitted: metadata exceeds cap.]`;
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
    const details = isRec((event as { details?: unknown }).details) ? (event as { details: Record<string, unknown> }).details : undefined;
    if (details?.classification === "noop") return;
    try {
      const file = await readNormFile(path, ctx.cwd);
      const rawRegions = details?.changedRegions;
      const regions: Region[] = Array.isArray(rawRegions) ? rawRegions.filter(isRec).map(r => ({ first: Number(r.first), last: Number(r.last) })).filter(r => Number.isInteger(r.first) && Number.isInteger(r.last)) : [{ first: 1, last: Math.min(AUTO_READ_MAX, Math.max(1, visLines(file.normalized).length)) }];
      const marker = `checksum:${file.checksum}`;
      let preview = sparsePreview(file.normalized, file.checksum, regions);
      if (event.toolName === "replace" && (event.content ?? []).some(part => part.type === "text" && part.text.split("\n").includes(marker))) preview = preview.slice(marker.length + 1);
      return { content: [...(event.content ?? []), { type: "text" as const, text: `\n\n--- Auto-read ---\n${preview}` }] };
    } catch (error) { console.error("Auto-read failed:", error); }
  });
}
