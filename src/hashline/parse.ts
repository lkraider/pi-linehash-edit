import { ANCHOR_RE } from "./hash";
import { CONTENT_LINES_NOT_STRING_MSG } from "../constants";

export type Anchor = { line: number; hash: string };

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

function parseRef(ref: string): Anchor {
	const trimmed = ref.trim();
	const match = ANCHOR_RE.exec(trimmed);
	if (!match) throw new Error(diagRef(ref));
	return { line: Number(match[1]), hash: match[2]! };
}

export const parseHashRef = parseRef;

export function parseText(edit: string[] | string | null): string[] {
  if (edit === null) return [];
  if (typeof edit === "string") {
    throw new Error(CONTENT_LINES_NOT_STRING_MSG);
  }
  return edit;
}
