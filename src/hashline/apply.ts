import { abortIf, visLines } from "../utils";
import { lineHashes, HASH_SEP } from "./hash";
import {
	resolveEdits,
	assertNoBarePrefix,
	warnUnicodeEscape,
	formatMismatch,
	describeEdit,
	type ResolvedEdit,
	type NoopEdit,
	type ParsedEdit,
} from "./resolve";

type LineSpan = {
	index: number;
	label: string;
	startLine: number;
	endLine: number;
	replacement: string[];
};

function assertNotEmpty(originalContent: string, result: string): void {
	if (originalContent.trim().length > 0 && result.length === 0) {
		throw new Error(
			"[E_WOULD_EMPTY] Cannot empty a non-empty file via edit. Use `write` if you need to clear the file."
		);
	}
}

function throwConflict(
	left: { index: number; label: string },
	right: { index: number; label: string },
	reason: string,
): never {
	throw new Error(
		`[E_EDIT_CONFLICT] Edit ${left.index} (${left.label}) and edit ${right.index} (${right.label}) ${reason}.`
	);
}

function editToSpan(
  edit: ResolvedEdit,
  index: number,
  fileLines: string[],
  noopEdits: NoopEdit[],
): LineSpan | null {
  const startLine = edit.hash_range_inclusive[0].line;
  const endLine = edit.hash_range_inclusive[1].line;
  const originalLines = fileLines.slice(startLine - 1, endLine);
  if (
    originalLines.length === edit.content_lines.length &&
    originalLines.every(
      (line, lineIndex) => line === edit.content_lines[lineIndex],
    )
  ) {
    noopEdits.push({
      editIndex: index,
      loc: `${startLine}:${edit.hash_range_inclusive[0].hash}`,
      currentContent: originalLines.join("\n"),
    });
    return null;
  }

  return {
    index,
    label: describeEdit(edit),
    startLine,
    endLine,
    replacement: edit.content_lines,
  };
}

function assertNoConflict(spans: LineSpan[]): void {
	for (let leftIndex = 0; leftIndex < spans.length; leftIndex++) {
		const left = spans[leftIndex]!;
		for (
			let rightIndex = leftIndex + 1;
			rightIndex < spans.length;
			rightIndex++
		) {
			const right = spans[rightIndex]!;

			if (left.startLine <= right.endLine && right.startLine <= left.endLine) {
				throwConflict(
					left,
					right,
					"overlap on the same original line range",
				);
			}
		}
	}
}

function editsToSpans(
	edits: ResolvedEdit[],
	fileLines: string[],
	noopEdits: NoopEdit[],
	signal: AbortSignal | undefined,
): LineSpan[] {
	const seenSpanKeys = new Set<string>();
	const resolvedSpans: LineSpan[] = [];
	for (const [index, edit] of edits.entries()) {
		abortIf(signal);
		const span = editToSpan(edit, index, fileLines, noopEdits);
		if (!span) {
			continue;
		}

		const spanKey =
				`${span.startLine}:${span.endLine}:${span.replacement.join("\n")}`;
		if (seenSpanKeys.has(spanKey)) {
			continue;
		}
		seenSpanKeys.add(spanKey);
		resolvedSpans.push(span);
	}

	assertNoConflict(resolvedSpans);
	return [...resolvedSpans].sort(
		(left, right) => right.startLine - left.startLine,
	);
}

function assemble(
	fileLines: string[],
	spans: LineSpan[],
	signal: AbortSignal | undefined,
): string {
	const result = [...fileLines];
	for (const span of spans) {
		abortIf(signal);
		result.splice(
			span.startLine - 1,
			span.endLine - span.startLine + 1,
			...span.replacement,
		);
	}
	return result.join("\n");
}

export function applyEdits(
	content: string,
	edits: ParsedEdit[],
	signal?: AbortSignal,
	precomputedHashes?: string[],
	filePath?: string,
	): {
	content: string;
	firstChangedLine: number | undefined;
	lastChangedLine: number | undefined;
	warnings?: string[];
	noopEdits?: NoopEdit[];
} {
	abortIf(signal);
	if (!edits.length)
		return {
			content,
			firstChangedLine: undefined,
			lastChangedLine: undefined,
		};

	const fileLines = content.split("\n");
	const fileHashes = precomputedHashes ?? lineHashes(content);
	const noopEdits: NoopEdit[] = [];
	const warnings: string[] = [];

	const { resolved, mismatches, boundaryWarnings } = resolveEdits(
		edits,
		fileLines,
		fileHashes,
		warnings,
		signal,
	);
	if (mismatches.length) {
		throw new Error(
			formatMismatch(mismatches, fileLines, fileHashes, filePath),
		);
	}

	assertNoBarePrefix(edits, fileLines, fileHashes, warnings);
	warnUnicodeEscape(edits, warnings);

	for (const bw of boundaryWarnings) {
		const edge = bw.kind === "trailing" ? "ends with" : "starts with";
		const surviving = bw.kind === "trailing" ? "the next surviving line" : "the preceding line";
		warnings.push(
			`[W_DUP] Edit ${bw.editIndex}: content_lines ${edge} ${JSON.stringify(bw.replacementLineContent)}, matching ${surviving}. If this duplicates content that already exists outside your range, remove it; if intentional, ignore this warning.`,
		);
	}

	const orderedSpans = editsToSpans(resolved, fileLines, noopEdits, signal);

	const result = assemble(fileLines, orderedSpans, signal);
	assertNotEmpty(content, result);
	const range = changedRange(content, result);

	return {
		content: result,
		firstChangedLine: range?.firstChangedLine,
		lastChangedLine: range?.lastChangedLine,
		...(warnings.length ? { warnings } : {}),
		...(noopEdits.length ? { noopEdits } : {}),
	};
}

export function formatRegion(
	hashes: string[],
	lines: string[],
	startLine = 1,
): string {
	if (hashes.length !== lines.length) {
		throw new Error(
			`formatRegion: hashes.length (${hashes.length}) must match lines.length (${lines.length}).`,
		);
	}
	return lines
		.map((line, index) => `${startLine + index}:${hashes[index]}${HASH_SEP}${line}`)
		.join("\n");
}

export function changedRange(
	original: string,
	result: string,
): { firstChangedLine: number; lastChangedLine: number } | null {
	if (original === result) return null;

	const origLines = original.split("\n");
	const resLines = result.split("\n");

	let prefix = 0;
	const maxShared = Math.min(origLines.length, resLines.length);
	while (prefix < maxShared && origLines[prefix] === resLines[prefix]) {
		prefix++;
	}
	let suffix = 0;
	while (
		suffix < maxShared - prefix &&
		origLines[origLines.length - 1 - suffix] === resLines[resLines.length - 1 - suffix]
	) {
		suffix++;
	}

	const firstChangedLine = prefix + 1;
	const lastChangedLine = resLines.length - suffix;
	if (lastChangedLine < firstChangedLine) {
		const point = Math.max(1, Math.min(firstChangedLine, visLines(result).length));
		return { firstChangedLine: point, lastChangedLine: point };
	}
	return { firstChangedLine, lastChangedLine };
}
