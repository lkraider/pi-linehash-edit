import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createReadTool,
	formatSize,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	truncateHead,
	type TruncationResult,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { sniffKind, detectUtf8DecodeErrors } from "./file-kind";
import { streamReadWindow } from "./read-stream";
import { lineHashes, formatRegion, HASH_SEP, blankHash } from "./hashline";
import { toCwd } from "./paths";
import { abortIf } from "./utils";
import { fileSnap } from "./file-reader";
import { visLines } from "./utils";
import { loadP, loadGuide } from "./prompts";
import { validateAccess } from "./validation";

const R_DESC = loadP("../prompts/read.md", {
	DEFAULT_MAX_LINES: String(DEFAULT_MAX_LINES),
	DEFAULT_MAX_BYTES: formatSize(DEFAULT_MAX_BYTES),
});

const R_SNIPPET = loadP("../prompts/read-snippet.md");
const R_GUIDE = loadGuide("../prompts/read-guidelines.md");

function normPosInt(
	value: number | undefined,
	name: "offset" | "limit",
): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`Read request field "${name}" must be a positive integer.`);
	}

	return value;
}

export function formatPaginationHint(
	startLine: number,
	endLine: number,
	totalLines: number,
	nextOffset: number,
	byteLimit?: number,
): string {
	const sizeSuffix = byteLimit !== undefined ? ` (${formatSize(byteLimit)} limit)` : "";
	return `[Showing lines ${startLine}-${endLine} of ${totalLines}${sizeSuffix}. Use offset=${nextOffset} to continue.]`;
}

function emptyOrOutOfRangeResult(
	startLine: number,
	totalLines: number,
): { text: string } | null {
	if (totalLines === 0) {
		if (startLine === 1) {
			return {
				text: `1${blankHash(4)}${HASH_SEP}\n[File is empty. Use replace to insert content.]`,
			};
		}
		return {
			text: `Offset ${startLine} is beyond end of file (0 lines total). The file is empty. Use replace to insert content.`,
		};
	}
	if (startLine > totalLines) {
		return {
			text: `Offset ${startLine} is beyond end of file (${totalLines} lines total). Use offset=1 to read from the start, or offset=${totalLines} to read the last line.`,
		};
	}
	return null;
}

function appendPaginationHint(
	preview: string,
	startLine: number,
	endIdx: number,
	totalLines: number,
	truncation: TruncationResult,
): { preview: string; nextOffset: number | undefined } {
	if (truncation.truncated) {
		const endLineDisplay = startLine + truncation.outputLines - 1;
		const nextOffset = endLineDisplay + 1;
		const byteLimit = truncation.truncatedBy === "lines" ? undefined : truncation.maxBytes;
		return {
			preview: `${preview}\n\n${formatPaginationHint(startLine, endLineDisplay, totalLines, nextOffset, byteLimit)}`,
			nextOffset,
		};
	}
	if (endIdx < totalLines) {
		const nextOffset = endIdx + 1;
		return {
			preview: `${preview}\n\n${formatPaginationHint(startLine, endIdx, totalLines, nextOffset)}`,
			nextOffset,
		};
	}
	return { preview, nextOffset: undefined };
}

function finishPreview(
	selectedHashes: string[],
	selectedLines: string[],
	startLine: number,
	totalLines: number,
): { text: string; truncation?: TruncationResult; nextOffset?: number } {
	const earlyResult = emptyOrOutOfRangeResult(startLine, totalLines);
	if (earlyResult) return earlyResult;

	const endIdx = startLine - 1 + selectedLines.length;
	const formatted = formatRegion(selectedHashes, selectedLines, startLine);

	const truncation = truncateHead(formatted);
	if (truncation.firstLineExceedsLimit) {
		return {
			text: `[Line ${startLine} exceeds ${formatSize(truncation.maxBytes)}. Hashline output requires full lines; cannot compute hashes for a truncated preview.]`,
			truncation,
		};
	}

	const { preview, nextOffset } = appendPaginationHint(
		truncation.content,
		startLine,
		endIdx,
		totalLines,
		truncation,
	);

	return {
		text: preview,
		truncation: truncation.truncated ? truncation : undefined,
		...(nextOffset !== undefined ? { nextOffset } : {}),
	};
}

export async function fmtReadPreview(
	text: string,
	options: { offset?: number; limit?: number },
	precomputedHashes?: string[],
	_path?: string,
): Promise<{ text: string; truncation?: TruncationResult; nextOffset?: number }> {
	const allLines = visLines(text);
	const totalLines = allLines.length;
	const startLine = normPosInt(options.offset, "offset") ?? 1;

	const limit = normPosInt(options.limit, "limit");
	const endIdx = limit
		? Math.min(startLine - 1 + limit, totalLines)
		: totalLines;
	const selected = allLines.slice(startLine - 1, endIdx);
	const allHashes = precomputedHashes ?? lineHashes(text);
	const selectedHashes = allHashes.slice(startLine - 1, endIdx);

	return finishPreview(selectedHashes, selected, startLine, totalLines);
}

export async function fmtReadPreviewStreamed(
	absolutePath: string,
	options: { offset?: number; limit?: number },
	signal?: AbortSignal,
): Promise<{ text: string; truncation?: TruncationResult; nextOffset?: number }> {
	const startLine = normPosInt(options.offset, "offset") ?? 1;
	const limit = normPosInt(options.limit, "limit");

	const { totalLines, selectedLines, selectedHashes } = await streamReadWindow(
		absolutePath,
		startLine,
		limit,
		signal,
	);

	return finishPreview(selectedHashes, selectedLines, startLine, totalLines);
}

export function regRead(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "read",
		label: "Read",
		description: R_DESC,
		promptSnippet: R_SNIPPET,
		promptGuidelines: R_GUIDE,
		parameters: Type.Object({
			path: Type.String({
				description: "Path to the file to read (relative or absolute)",
			}),
			offset: Type.Optional(
				Type.Integer({
					minimum: 1,
					description: "Line number to start reading from (1-indexed)",
				}),
			),
			limit: Type.Optional(
				Type.Integer({
					minimum: 1,
					description: "Maximum number of lines to read",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const rawPath = params.path;
			const absolutePath = toCwd(rawPath, ctx.cwd);

			abortIf(signal);
			await validateAccess(absolutePath, rawPath);

			abortIf(signal);
			const kind = await sniffKind(absolutePath);
			if (kind.kind === "image") {
				const builtinRead = createReadTool(ctx.cwd);
				const executeBuiltinRead = builtinRead.execute as unknown as (
					toolCallId: string,
					input: typeof params,
					abortSignal: typeof signal,
					onUpdate: typeof _onUpdate,
					context: typeof ctx,
				) => ReturnType<typeof builtinRead.execute>;
				return executeBuiltinRead(_toolCallId, params, signal, _onUpdate, ctx);
			}
			if (kind.kind === "directory") {
				throw new Error(`Path is a directory: ${rawPath}. Use ls to inspect directories.`);
			}
			if (kind.kind === "binary") {
				throw new Error(`Path is a binary file: ${rawPath} (${kind.description}). Hashline edit only supports text files.`);
			}

			const [preview, hadUtf8DecodeErrors] = await Promise.all([
				fmtReadPreviewStreamed(
					absolutePath,
					{
						offset: params.offset,
						limit: params.limit,
					},
					signal,
				),
				detectUtf8DecodeErrors(absolutePath, signal),
			]);
			const snapshot = await fileSnap(absolutePath);

			const previewText = hadUtf8DecodeErrors
				? `${preview.text}\n\n[Non-UTF-8 bytes shown as U+FFFD; editing rewrites the file as UTF-8.]`
				: preview.text;

			return {
				content: [{ type: "text", text: previewText }],
				details: {
					truncation: preview.truncation,
					snapshotId: snapshot.snapshotId,
					...(preview.nextOffset !== undefined
						? { nextOffset: preview.nextOffset }
						: {}),
					metrics: {
						truncated: !!preview.truncation,
						...(preview.nextOffset !== undefined
							? { next_offset: preview.nextOffset }
							: {}),
					},
				},
			};
		},
	});
}
