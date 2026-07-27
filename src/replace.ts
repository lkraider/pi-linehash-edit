import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { constants } from "node:fs";
import { readNormFile } from "./file-reader";
import { restoreEndings, genDiff, shouldSkipDiff } from "./replace-diff";
import { resolveTarget, writeAtomic } from "./fs-write";
import { applyEdits, parseEdits, type RawEdit } from "./hashline";
import { toCwd } from "./paths";
import { readSnapshot, assertSnapshot, sameSnapshot, snapshotTag } from "./snapshot";
import { isRec, rejectUnknownFields, abortIf, visLineCount } from "./utils";
import { MAX_BYTES, MAX_EDIT_LINES } from "./constants";
import { buildChanged, buildNoop, type RMeta, type RMetrics } from "./replace-response";
import { loadP, loadGuide } from "./prompts";

const contentLines = Type.Array(Type.String(), { description: "literal replacement lines without line│ prefixes" });
const range = Type.Array(Type.Integer({ minimum: 1 }), { minItems: 2, maxItems: 2, description: "inclusive numeric [start, end]" });
const change = Type.Object({ range, content_lines: contentLines }, { additionalProperties: false });
export const editToolSchema = Type.Object({ path: Type.String(), snapshot: Type.String(), changes: Type.Array(change, { minItems: 1 }) }, { additionalProperties: false });
export type ReqParams = { path: string; snapshot: string; changes: RawEdit[] };
export type ReplaceDetails = { diff: string; firstChangedLine?: number; changedRegions?: { first: number; last: number }[]; snapshot?: string; snapshotId?: string; classification?: "noop"; metrics?: RMetrics };
type PipelineResult = { path: string; originalNormalized: string; result: string; rawOutput: string; warnings: string[]; noopEdits?: { editIndex: number; loc: string; currentContent: string }[]; firstChangedLine?: number; lastChangedLine?: number; changedRegions: { first: number; last: number }[]; totalAddedLines: number; totalRemovedLines: number; initialSnapshot: string };
const ROOT = new Set(["path", "snapshot", "changes"]);

export function assertReq(request: unknown): asserts request is ReqParams {
  if (!isRec(request)) throw new Error("[E_BAD_SHAPE] Replace request must be an object.");
  if ("hash_range_inclusive" in request || Array.isArray(request.changes) && request.changes.some(c => isRec(c) && "hash_range_inclusive" in c)) throw new Error('[E_LEGACY_SHAPE] "hash_range_inclusive" is obsolete. Use snapshot plus numeric range.');
  rejectUnknownFields(request, ROOT, "Replace request");
  if (typeof request.path !== "string" || !request.path) throw new Error('[E_BAD_SHAPE] Replace requires non-empty "path".');
  assertSnapshot(request.snapshot);
  if (!Array.isArray(request.changes) || request.changes.length === 0) throw new Error('[E_BAD_SHAPE] Replace requires a non-empty "changes" array.');
}

export async function execPipeline(params: ReqParams, cwd: string, accessMode: number, signal?: AbortSignal, target?: string): Promise<PipelineResult> {
  assertReq(params);
  const edits = parseEdits(params.changes);
  const file = await readNormFile(params.path, cwd, signal, accessMode, MAX_EDIT_LINES, target);
  if (!sameSnapshot(params.snapshot, file.snapshot)) throw new Error(`[E_STALE_SNAPSHOT] Snapshot does not match ${params.path}. Re-read and retry with the new snapshot.`);
  const applied = applyEdits(file.normalized, edits, signal);
  const rawOutput = file.bom + restoreEndings(applied.content, file.originalEnding);
  if (visLineCount(applied.content) > MAX_EDIT_LINES) throw new Error(`[E_FILE_TOO_LARGE] Result exceeds the ${MAX_EDIT_LINES}-line edit limit.`);
  if (Buffer.byteLength(rawOutput) > MAX_BYTES) throw new Error(`[E_FILE_TOO_LARGE] Result exceeds the ${MAX_BYTES}-byte edit limit.`);
  const warnings = [...(applied.warnings ?? [])];
  if (applied.content !== file.normalized && file.hadMixedEndings) warnings.push(`[W_MIXED_EOL] File has mixed line endings; edit normalizes them to ${file.originalEnding === "\r\n" ? "CRLF" : "LF"}.`);
  let totalAddedLines = 0, totalRemovedLines = 0;
  const noops = new Set(applied.noopEdits?.map(n => n.editIndex));
  edits.forEach((edit, i) => { if (!noops.has(i)) { totalAddedLines += edit.content_lines.length; totalRemovedLines += edit.range[1] - edit.range[0] + 1; } });
  return { path: params.path, originalNormalized: file.normalized, result: applied.content, rawOutput, warnings, noopEdits: applied.noopEdits, firstChangedLine: applied.firstChangedLine, lastChangedLine: applied.lastChangedLine, changedRegions: applied.changedRegions, totalAddedLines, totalRemovedLines, initialSnapshot: file.snapshot };
}

export async function compPreview(request: unknown, cwd: string): Promise<{ diff: string } | { error: string }> {
  try { assertReq(request); const p = await execPipeline(request, cwd, constants.R_OK); return { diff: shouldSkipDiff(p.originalNormalized.split("\n").length, p.result.split("\n").length) ? "" : genDiff(p.originalNormalized, p.result, 4).diff }; }
  catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

export function buildToolDef(opts: { autoRead?: boolean } = {}): ToolDefinition<any, ReplaceDetails> {
  const guidance = opts.autoRead ? "A fresh snapshot is returned automatically." : "Read again for follow-up edits.";
  return { name: "replace", label: "Replace", description: loadP("../prompts/replace.md", { AUTO_READ_GUIDANCE: guidance }), promptSnippet: loadP("../prompts/replace-snippet.md"), promptGuidelines: loadGuide("../prompts/replace-guidelines.md", { AUTO_READ_GUIDANCE: guidance }), parameters: editToolSchema,
    async execute(_id, params, signal, _update, ctx) {
      assertReq(params); const absolute = toCwd(params.path, ctx.cwd), target = await resolveTarget(absolute);
      return withFileMutationQueue(target, async () => {
        const p = await execPipeline(params, ctx.cwd, constants.R_OK | constants.W_OK, signal, target);
        const meta: RMeta = { editsAttempted: params.changes.length, noopEditsCount: p.noopEdits?.length ?? 0, firstChangedLine: p.firstChangedLine, lastChangedLine: p.lastChangedLine, changedRegions: p.changedRegions, addedLines: p.totalAddedLines, removedLines: p.totalRemovedLines };
        if (p.originalNormalized === p.result) return buildNoop({ path: p.path, snapshot: p.initialSnapshot, editMeta: meta, warnings: p.warnings, noopEdits: p.noopEdits });
        abortIf(signal);
        const current = await readSnapshot(target, target, signal);
        if (!sameSnapshot(params.snapshot, current.snapshot)) throw new Error(`[E_STALE_SNAPSHOT] ${p.path} changed during replace; nothing was written.`);
        await writeAtomic(absolute, p.rawOutput, target);
        const next = snapshotTag(target, Buffer.from(p.rawOutput));
        const diff = shouldSkipDiff(p.originalNormalized.split("\n").length, p.result.split("\n").length) ? "" : genDiff(p.originalNormalized, p.result, 2).diff;
        return buildChanged({ path: p.path, result: p.result, warnings: p.warnings, snapshot: next, editMeta: meta, diff });
      });
    }
  } as ToolDefinition<any, ReplaceDetails>;
}
export function regReplace(pi: ExtensionAPI, autoRead?: boolean): void { pi.registerTool(buildToolDef({ autoRead })); }
