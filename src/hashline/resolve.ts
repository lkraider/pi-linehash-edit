import { abortIf, rejectUnknownFields, lastNonEmpty, firstNonEmpty } from "../utils";
import { HL_BARE_PREFIX_RE, ANCHOR_RE } from "./hash";
import { parseHashRef, parseText, type Anchor } from "./parse";
import { CONTENT_LINES_NOT_STRING_MSG } from "../constants";

export type ResolvedAnchor = { line: number; hash: string };

export type ParsedEdit = { content_lines: string[]; hash_range_inclusive: [Anchor, Anchor] };
export type ResolvedEdit = {
  content_lines: string[];
  hash_range_inclusive: [ResolvedAnchor, ResolvedAnchor];
};

interface HMismatch {
	ref: Anchor;
}

export interface BoundaryDupWarning {
	kind: "trailing" | "leading";
	survivingLineContent: string;
	survivingLineIndex: number;
	replacementLineContent: string;
	editIndex: number;
}


export interface NoopEdit {
	editIndex: number;
	loc: string;
	currentContent: string;
}

export type RawEdit = {
  content_lines: string[];
  hash_range_inclusive: [string, string];
};

function resolveAnchor(ref: Anchor, fileHashes: string[]): ResolvedAnchor | HMismatch {
	if (ref.line < 1 || ref.line > fileHashes.length) return { ref };
	if (fileHashes[ref.line - 1] !== ref.hash) return { ref };
	return { line: ref.line, hash: ref.hash };
}

function assertAligned(
	fileLines: string[],
	fileHashes: string[],
	ctx: string,
): void {
	if (fileHashes.length !== fileLines.length) {
		throw new Error(
			`${ctx}: fileHashes.length (${fileHashes.length}) must match fileLines.length (${fileLines.length}).`,
		);
	}
}


export function formatMismatch(
  mismatches: HMismatch[],
  fileLines: string[],
  fileHashes: string[],
  filePath?: string,
): string {
  assertAligned(fileLines, fileHashes, "formatMismatch");

  const refList = mismatches.map((m) => `"${m.ref.line}:${m.ref.hash}"`).join(", ");
  const detail = mismatches
    .map((m) => {
      if (m.ref.line < 1 || m.ref.line > fileLines.length) {
        return `  ${m.ref.line}:${m.ref.hash} — line ${m.ref.line} does not exist (file has ${fileLines.length} line(s)).`;
      }
      return `  ${m.ref.line}:${m.ref.hash} — line ${m.ref.line} is now ${fileHashes[m.ref.line - 1]}:${JSON.stringify(fileLines[m.ref.line - 1])}.`;
    })
    .join("\n");

  return `[E_STALE_ANCHOR] ${mismatches.length} stale anchor${mismatches.length > 1 ? "s" : ""}${filePath ? ` in ${filePath}` : ""}: ${refList}. The file content or line position has changed since those anchors were read. Call read() to get fresh anchors, then copy the "line:hash" anchor of the start and end of the range you are replacing into hash_range_inclusive of your next replace call.\n${detail}`;
}

const ITEM_KS = new Set(["content_lines", "hash_range_inclusive"]);

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function isStringPair(value: unknown): value is [string, string] {
	return (
		Array.isArray(value) &&
		value.length === 2 &&
		value.every((item) => typeof item === "string")
	);
}

function coerceContentLinesString(val: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(val);
  } catch {
    throw new Error(CONTENT_LINES_NOT_STRING_MSG);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(CONTENT_LINES_NOT_STRING_MSG);
  }
  return parsed;
}

function assertItem(edit: Record<string, unknown>, index: number): void {
  rejectUnknownFields(edit, ITEM_KS, `Edit ${index}`, "Each edit takes only { content_lines, hash_range_inclusive }.");

  if ("hash_range_inclusive" in edit && !isStringPair(edit.hash_range_inclusive)) {
    throw new Error(
      `[E_BAD_SHAPE] Edit ${index} field "hash_range_inclusive" must be a pair of anchor strings [start, end].`,
    );
  }
  if (!("content_lines" in edit)) {
    throw new Error(`[E_BAD_SHAPE] Edit ${index} requires a "content_lines" field. Provide the replacement lines (use [] to delete).`);
  }
  if (!isStringArray(edit.content_lines)) {
    const val = edit.content_lines;
    if (typeof val !== "string") {
      throw new Error(`[E_BAD_SHAPE] Edit ${index} field "content_lines" must be a string array.`);
    }
    edit.content_lines = coerceContentLinesString(val);
  }
  if (!isStringPair(edit.hash_range_inclusive)) {
    throw new Error(
      `[E_BAD_SHAPE] Edit ${index} requires an "hash_range_inclusive" pair of anchor strings [start, end].`,
    );
  }
}

export function parseEdits(edits: RawEdit[]): ParsedEdit[] {
  const result: ParsedEdit[] = [];
  for (const [index, edit] of edits.entries()) {
    assertItem(edit as Record<string, unknown>, index);

    const replaceLines = parseText(edit.content_lines);
    result.push({
      content_lines: replaceLines,
      hash_range_inclusive: [parseHashRef(edit.hash_range_inclusive[0]), parseHashRef(edit.hash_range_inclusive[1])],
    });
  }
  return result;
}

function warnUnicodeEscape(
  edits: ParsedEdit[],
  warnings: string[],
): void {
  for (const edit of edits) {
    if (edit.content_lines.some((line) => /\\uDDDD/i.test(line))) {
      warnings.push(
        "Detected literal \\uDDDD in edit content; no autocorrection applied. Verify whether this should be a real Unicode escape or plain text.",
      );
    }
  }
}

export function assertNoBarePrefix(
  edits: ParsedEdit[],
  fileHashes: string[],
  warnings: string[],
): void {
  const suspects: { line: string; editIndex: number; lineIndex: number }[] = [];
  for (let editIndex = 0; editIndex < edits.length; editIndex++) {
    const edit = edits[editIndex]!;
    const [start, end] = edit.hash_range_inclusive;
    for (let lineIndex = 0; lineIndex < edit.content_lines.length; lineIndex++) {
      const line = edit.content_lines[lineIndex]!;
      const match = HL_BARE_PREFIX_RE.exec(line);
      if (!match) continue;
      const anchor = ANCHOR_RE.exec(match[1]!);
      if (!anchor) continue;
      const anchorLine = Number(anchor[1]);
      if (fileHashes[anchorLine - 1] !== anchor[2]) continue;
      if (anchorLine >= start.line && anchorLine <= end.line) {
        suspects.push({ line, editIndex, lineIndex });
      } else {
        warnings.push(
          `[W_BARE_HASH_PREFIX] Edit ${editIndex} content_lines[${lineIndex}] starts with ${JSON.stringify(match[1])}│, which matches a real anchor elsewhere in this file. If this was copied from read output, remove the "line:hash│" prefix; if it is literal content, ignore this warning.`,
        );
      }
    }
  }
  if (suspects.length === 0) return;
  const locations = suspects
    .map((s) => `edit ${s.editIndex}, content_lines[${s.lineIndex}]`)
    .join("; ");
  const exampleLine = suspects[0]!.line;

  throw new Error(
    `[E_BARE_HASH_PREFIX] ${suspects.length} edit line(s) start with a real file-line anchor inside the replaced range (${locations}). Example: ${JSON.stringify(exampleLine)}. This is strong evidence the "line:hash│" prefix was copied from read or diff output. Remove the "line:hash│" prefix from each affected content_lines entry; keep only the literal line content that appears after "│". Remember: content_lines uses file content only, hash_range_inclusive uses anchors.`
  );
}

export function describeEdit(edit: ResolvedEdit): string {
	const [start, end] = edit.hash_range_inclusive;
	return `replace ${start.line}:${start.hash}-${end.line}:${end.hash}`;
}


function checkBoundaryDup(
	adjacentLine: string | undefined,
	replacementEdge: string | undefined,
	kind: "trailing" | "leading",
	survivingLineIndex: number,
	editIndex: number,
): BoundaryDupWarning | null {
	if (
		adjacentLine === undefined ||
		replacementEdge === undefined ||
		replacementEdge.length === 0 ||
		replacementEdge !== adjacentLine
	) return null;
  return {
    kind,
    survivingLineContent: adjacentLine,
    survivingLineIndex,
    replacementLineContent: replacementEdge,
    editIndex,
  };
}


export function resolveEdits(
	edits: ParsedEdit[],
	fileLines: string[],
	fileHashes: string[],
	warnings: string[],
	signal: AbortSignal | undefined,
): { resolved: ResolvedEdit[]; mismatches: HMismatch[]; boundaryWarnings: BoundaryDupWarning[] } {
	assertAligned(fileLines, fileHashes, "resolveEdits");
	const resolved: ResolvedEdit[] = [];
	const mismatches: HMismatch[] = [];
	const boundaryWarnings: BoundaryDupWarning[] = [];

	const tryResolve = (ref: Anchor): ResolvedAnchor | undefined => {
		const result = resolveAnchor(ref, fileHashes);
		if ("ref" in result) {
			mismatches.push(result);
			return undefined;
		}
		return result;
	};

	for (const edit of edits) {
		abortIf(signal);
		const startResolved = tryResolve(edit.hash_range_inclusive[0]);
		const endResolved = tryResolve(edit.hash_range_inclusive[1]);
		if (!startResolved || !endResolved) {
			continue;
		}
		if (startResolved.line > endResolved.line) {
			throw new Error(
				`[E_BAD_OP] Range start line ${startResolved.line} must be <= end line ${endResolved.line} (anchors ${startResolved.line}:${startResolved.hash} and ${endResolved.line}:${endResolved.hash}).`,
			);
		}
		const endLine = endResolved.line;
		const nextLine = fileLines[endLine];
		const replacementLastLine = lastNonEmpty(edit.content_lines);
		const trailing = checkBoundaryDup(nextLine, replacementLastLine, "trailing", endLine, resolved.length);
		if (trailing) boundaryWarnings.push(trailing);
		const prevLine = fileLines[startResolved.line - 2];
		const replacementFirstLine = firstNonEmpty(edit.content_lines);
		const leading = checkBoundaryDup(prevLine, replacementFirstLine, "leading", startResolved.line - 2, resolved.length);
		if (leading) boundaryWarnings.push(leading);
		resolved.push({
			content_lines: edit.content_lines,
			hash_range_inclusive: [startResolved, endResolved],
		});
	}

	return { resolved, mismatches, boundaryWarnings };
}

export { warnUnicodeEscape };
