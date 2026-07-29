import { CONTENT_LINES_NOT_STRING_MSG } from "./constants";
import { abortIf, firstNonEmpty, isRec, lastNonEmpty, rejectUnknownFields } from "./utils";

export type RawEdit = { range: [number, number]; content_lines: string[] };
type ParsedEdit = RawEdit;
type ChangedRegion = { first: number; last: number };
type ApplyResult = {
  content: string;
  firstChangedLine?: number;
  lastChangedLine?: number;
  changedRegions: ChangedRegion[];
  warnings?: string[];
  noopEdits?: number[];
};

const KEYS = new Set(["range", "content_lines"]);

export function parseEdits(edits: RawEdit[]): ParsedEdit[] {
  return edits.map((raw, index) => {
    if (!isRec(raw)) throw new Error(`[E_BAD_SHAPE] Edit ${index} must be an object.`);
    const edit = raw;
    rejectUnknownFields(edit, KEYS, `Edit ${index}`, "Each edit takes only { range, content_lines }.");
    if (!Array.isArray(edit.content_lines) || !edit.content_lines.every(line => typeof line === "string")) {
      if (typeof edit.content_lines === "string") throw new Error(CONTENT_LINES_NOT_STRING_MSG);
      throw new Error(`[E_BAD_SHAPE] Edit ${index} field "content_lines" must be a string array.`);
    }
    const brokenLine = edit.content_lines.findIndex(line => /[\r\n]/.test(line));
    if (brokenLine !== -1) throw new Error(`[E_BAD_SHAPE] Edit ${index} content_lines[${brokenLine}] contains a line break; provide one array item per line.`);
    if (!Array.isArray(edit.range) || edit.range.length !== 2 || !edit.range.every(Number.isInteger)) {
      throw new Error(`[E_BAD_RANGE] Edit ${index} field "range" must be two integers [start, end].`);
    }
    const [start, end] = edit.range as [number, number];
    if (start < 1 || end < start) throw new Error(`[E_BAD_RANGE] Edit ${index} range must satisfy 1 <= start <= end.`);
    return { range: [start, end], content_lines: [...edit.content_lines] as string[] };
  });
}

function assertNoCopiedRows(edits: ParsedEdit[], lines: string[]): void {
  for (const [editIndex, edit] of edits.entries()) for (const [lineIndex, content] of edit.content_lines.entries()) {
    const m = /^(\d+)│(.*)$/.exec(content);
    if (!m) continue;
    // src === m[2] alone misses edited copies; the range clause covers them. startsWith guard so a
    // file whose own lines begin "N│" stays editable rather than mistaken for a kept read prefix.
    const src = lines[Number(m[1]) - 1];
    if (src !== undefined && !src.startsWith(`${m[1]}│`) && (src === m[2] || Number(m[1]) === edit.range[0] + lineIndex)) {
      throw new Error(`[E_COPIED_ROW] Edit ${editIndex} content_lines[${lineIndex}] keeps the "${m[1]}│" read prefix. Send only the line content.`);
    }
  }
}

export function applyEdits(content: string, edits: ParsedEdit[], signal?: AbortSignal): ApplyResult {
  abortIf(signal);
  const lines = content.split("\n");
  const lineCount = Math.max(1, content === "" ? 0 : lines.length - (content.endsWith("\n") ? 1 : 0));
  const warnings: string[] = [];
  const noopEdits: NonNullable<ApplyResult["noopEdits"]> = [];
  // One ascending sort drives overlap detection, region math, and the reverse-order splice.
  const sorted = edits.map((edit, index) => ({ edit, index })).sort((a, b) => a.edit.range[0] - b.edit.range[0]);
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.edit.range[0] <= sorted[i - 1]!.edit.range[1]) {
    throw new Error(`[E_EDIT_CONFLICT] Edit ${sorted[i - 1]!.index} and edit ${sorted[i]!.index} overlap.`);
  }
  const active: { edit: ParsedEdit; index: number }[] = [];
  for (const { edit, index } of sorted) {
    const [start, end] = edit.range;
    if (end > lineCount) throw new Error(`[E_BAD_RANGE] Edit ${index} range ends at ${end}, but file has ${lineCount} line(s).`);
    const current = lines.slice(start - 1, end);
    if (current.length === edit.content_lines.length && current.every((line, i) => line === edit.content_lines[i])) { noopEdits.push(index); continue; }
    const before = lines[start - 2], after = lines[end];
    const first = firstNonEmpty(edit.content_lines), last = lastNonEmpty(edit.content_lines);
    if (first && first === before) warnings.push(`[W_DUP] Edit ${index}: content_lines starts with the preceding surviving line.`);
    if (last && last === after) warnings.push(`[W_DUP] Edit ${index}: content_lines ends with the next surviving line.`);
    active.push({ edit, index });
  }
  assertNoCopiedRows(edits, lines);
  const changedRegions: ChangedRegion[] = [];
  let shift = 0;
  for (const { edit } of active) {
    const start = edit.range[0] + shift;
    const last = edit.content_lines.length ? start + edit.content_lines.length - 1 : Math.max(1, start);
    changedRegions.push({ first: start, last });
    shift += edit.content_lines.length - (edit.range[1] - edit.range[0] + 1);
  }
  const result = [...lines];
  for (let i = active.length - 1; i >= 0; i--) {
    abortIf(signal);
    const { range, content_lines } = active[i]!.edit;
    result.splice(range[0] - 1, range[1] - range[0] + 1, ...content_lines);
  }
  // A fully-deleted file leaves result = []; treat it as one empty line to match string line semantics.
  const outLines = result.length ? result : [""];
  const outCount = Math.max(1, outLines.length - (outLines[outLines.length - 1] === "" ? 1 : 0));
  const range = changedRangeLines(lines, outLines);
  const visibleRegions = changedRegions.map(region => ({ first: Math.min(region.first, outCount), last: Math.min(region.last, outCount) }));
  return { content: outLines.join("\n"), firstChangedLine: range?.firstChangedLine, lastChangedLine: range?.lastChangedLine, changedRegions: visibleRegions,
    ...(warnings.length ? { warnings } : {}), ...(noopEdits.length ? { noopEdits } : {}) };
}

export function formatRegion(lines: string[], startLine = 1): string {
  return lines.map((line, index) => `${startLine + index}│${line}`).join("\n");
}

function changedRangeLines(a: string[], b: string[]): { firstChangedLine: number; lastChangedLine: number } | null {
  let prefix = 0;
  while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  if (a.length === b.length && prefix === a.length) return null;
  let suffix = 0;
  while (suffix < Math.min(a.length, b.length) - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const firstChangedLine = prefix + 1;
  return { firstChangedLine, lastChangedLine: Math.max(firstChangedLine, b.length - suffix) };
}
export function changedRange(original: string, result: string): { firstChangedLine: number; lastChangedLine: number } | null {
  return changedRangeLines(original.split("\n"), result.split("\n"));
}
