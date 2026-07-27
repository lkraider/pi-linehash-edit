import type { ReplaceDetails } from "./replace";

export type RMetrics = { edits_attempted: number; edits_noop: number; warnings: number; classification: "applied" | "noop"; changed_lines?: { first: number; last: number }; added_lines?: number; removed_lines?: number };
export type RMeta = { editsAttempted: number; noopEditsCount: number; firstChangedLine?: number; lastChangedLine?: number; addedLines: number; removedLines: number; changedRegions?: { first: number; last: number }[] };
type Result = { content: Array<{ type: "text"; text: string }>; details: ReplaceDetails };

function metrics(kind: "applied" | "noop", meta: RMeta, warnings = 0): RMetrics {
  const result: RMetrics = { classification: kind, edits_attempted: meta.editsAttempted, edits_noop: meta.noopEditsCount, warnings };
  if (kind === "applied" && meta.firstChangedLine !== undefined && meta.lastChangedLine !== undefined) result.changed_lines = { first: meta.firstChangedLine, last: meta.lastChangedLine };
  if (kind === "applied") { result.added_lines = meta.addedLines; result.removed_lines = meta.removedLines; }
  return result;
}

export function buildNoop(input: { path: string; snapshot: string; editMeta: RMeta; warnings?: string[]; noopEdits?: unknown }): Result {
  return { content: [{ type: "text", text: `No changes made to ${input.path}.\nsnapshot:${input.snapshot}` }], details: { diff: "", snapshot: input.snapshot, snapshotId: input.snapshot, classification: "noop", metrics: metrics("noop", input.editMeta, input.warnings?.length) } };
}

export function buildChanged(input: { path: string; result: string; warnings?: string[]; snapshot: string; editMeta: RMeta; diff: string }): Result {
  const warning = input.warnings?.length ? `\n\nWarnings:\n${input.warnings.join("\n")}` : "";
  return { content: [{ type: "text", text: `Successfully replaced in ${input.path}.\nsnapshot:${input.snapshot}${warning}` }], details: { diff: input.diff, firstChangedLine: input.editMeta.firstChangedLine, changedRegions: input.editMeta.changedRegions, snapshot: input.snapshot, snapshotId: input.snapshot, metrics: metrics("applied", input.editMeta, input.warnings?.length) } };
}
