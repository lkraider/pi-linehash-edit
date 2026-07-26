import { splitAnchor } from "./hash";
import { CONTENT_LINES_NOT_STRING_MSG } from "../constants";

export type Anchor = { line: number; hash: string };

const REF_RE = /^(\d+)(:?)(\d*)$/;

function diagRef(ref: string): string {
	const trimmed = ref.trim();

	if (!trimmed.length) {
		return `[E_BAD_REF] Invalid anchor. Expected an anchor copied verbatim from the most recent read (e.g. "4274293").`;
	}

	if (trimmed.includes("│")) {
		return `[E_BAD_REF] Invalid anchor "${trimmed}". hash_range_inclusive must contain the anchor only — remove everything from "│" onward.`;
	}

	return `[E_BAD_REF] Invalid anchor "${trimmed}". Expected an anchor copied verbatim from the most recent read (e.g. "4274293").`;
}

function parseRef(ref: string, hashDigits: number): Anchor {
	const trimmed = ref.trim();
	const match = REF_RE.exec(trimmed);
	if (!match) throw new Error(diagRef(ref));

	if (match[2] === ":") {
		const hash = match[3]!;
		if (hash.length !== hashDigits && hash.length !== 0) {
			throw new Error(diagRef(ref));
		}
		return { line: Number(match[1]), hash };
	}

	return splitAnchor(trimmed, hashDigits);
}

export const parseHashRef = parseRef;

export function parseText(edit: string[] | string | null): string[] {
  if (edit === null) return [];
  if (typeof edit === "string") {
    throw new Error(CONTENT_LINES_NOT_STRING_MSG);
  }
  return edit;
}
