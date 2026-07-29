import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { regReplace } from "./src/replace";
import { regRead, sparsePreview, type Region } from "./src/read";
import { readConfig, toggleAutoRead } from "./src/config";
import { readNormFile } from "./src/file-reader";
import { visLines, isRec } from "./src/utils";
import { AUTO_READ_MAX } from "./src/constants";

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
