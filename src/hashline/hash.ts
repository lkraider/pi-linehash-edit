import { fnv1a32 } from "./hasher";

export const HASH_DIGITS = 5;
export const HASH_SEP = "│";

const HASH_MOD = 10 ** HASH_DIGITS;

export const HASH_CLASS = `\\d{${HASH_DIGITS}}`;
export const ANCHOR_CLASS = `\\d{${HASH_DIGITS + 1},}`;
export const ANCHOR_RE = new RegExp(`^(\\d+):?(${HASH_CLASS})$`);

export const HL_BARE_PREFIX_RE = new RegExp(`^\\s*\\+?\\s*(${ANCHOR_CLASS})│`);

function hashToString(h: number): string {
	return String(h % HASH_MOD).padStart(HASH_DIGITS, "0");
}

export function canon(line: string): string {
	return line.replace(/\r/g, "").trimEnd();
}

export function lineHash(line: string): string {
	return hashToString(fnv1a32(canon(line)));
}

export function lineHashes(content: string): string[] {
	return content.split("\n").map(lineHash);
}
