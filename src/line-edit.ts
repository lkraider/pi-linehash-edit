import { CONTENT_LINES_NOT_STRING_MSG } from "./constants";
import { abortIf, firstNonEmpty, isRec, lastNonEmpty, rejectUnknownFields, visLines } from "./utils";

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
  const lineCount = Math.max(1, visLines(content).length);
  const warnings: string[] = [];
  const noopEdits: NonNullable<ApplyResult["noopEdits"]> = [];
  const ranges = edits.map((edit, index) => ({ ...edit, index })).sort((a, b) => a.range[0] - b.range[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i]!.range[0] <= ranges[i - 1]!.range[1]) {
    throw new Error(`[E_EDIT_CONFLICT] Edit ${ranges[i - 1]!.index} and edit ${ranges[i]!.index} overlap.`);
  }
  const spans = edits.map((edit, index) => {
    const [start, end] = edit.range;
    if (end > lineCount) throw new Error(`[E_BAD_RANGE] Edit ${index} range ends at ${end}, but file has ${lineCount} line(s).`);
    const current = lines.slice(start - 1, end);
    if (current.length === edit.content_lines.length && current.every((line, i) => line === edit.content_lines[i])) {
      noopEdits.push(index);
      return null;
    }
    const before = lines[start - 2];
    const after = lines[end];
    const first = firstNonEmpty(edit.content_lines);
    const last = lastNonEmpty(edit.content_lines);
    if (first && first === before) warnings.push(`[W_DUP] Edit ${index}: content_lines starts with the preceding surviving line.`);
    if (last && last === after) warnings.push(`[W_DUP] Edit ${index}: content_lines ends with the next surviving line.`);
    return { ...edit, index };
  }).filter((edit): edit is NonNullable<typeof edit> => edit !== null);
  assertNoCopiedRows(edits, lines);
  const ordered = [...spans].sort((a, b) => a.range[0] - b.range[0]);
  const changedRegions: ChangedRegion[] = [];
  let shift = 0;
  for (const edit of ordered) {
    const start = edit.range[0] + shift;
    const last = edit.content_lines.length ? start + edit.content_lines.length - 1 : Math.max(1, start);
    changedRegions.push({ first: start, last });
    shift += edit.content_lines.length - (edit.range[1] - edit.range[0] + 1);
  }
  const result = [...lines];
  for (const edit of [...spans].sort((a, b) => b.range[0] - a.range[0])) {
    abortIf(signal);
    result.splice(edit.range[0] - 1, edit.range[1] - edit.range[0] + 1, ...edit.content_lines);
  }
  const output = result.join("\n");
  const range = changedRange(content, output);
  const outputLines = Math.max(1, visLines(output).length);
  const visibleRegions = changedRegions.map(region => ({ first: Math.min(region.first, outputLines), last: Math.min(region.last, outputLines) }));
  return { content: output, firstChangedLine: range?.firstChangedLine, lastChangedLine: range?.lastChangedLine, changedRegions: visibleRegions,
    ...(warnings.length ? { warnings } : {}), ...(noopEdits.length ? { noopEdits } : {}) };
}

export function formatRegion(lines: string[], startLine = 1): string {
  return lines.map((line, index) => `${startLine + index}│${line}`).join("\n");
}

function changedRange(original: string, result: string): { firstChangedLine: number; lastChangedLine: number } | null {
  if (original === result) return null;
  const a = original.split("\n"), b = result.split("\n");
  let prefix = 0;
  while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < Math.min(a.length, b.length) - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const firstChangedLine = prefix + 1;
  return { firstChangedLine, lastChangedLine: Math.max(firstChangedLine, b.length - suffix, Math.min(firstChangedLine, visLines(result).length)) };
}
