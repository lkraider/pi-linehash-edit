import { fnv1a32 } from "./hasher";

export const HASH_SEP = "│";

const SMALL_FILE_MAX_LINES = 99;

export function hashDigitsFor(lineCount: number): number {
	return lineCount <= SMALL_FILE_MAX_LINES ? 4 : 5;
}

export function hashWidthOf(content: string): number {
	return hashDigitsFor(content.split("\n").length);
}

export const HL_BARE_PREFIX_RE = new RegExp(`^\\s*\\+?\\s*(\\d+)│`);

export function canon(line: string): string {
	return line.replace(/\r/g, "").trimEnd();
}

export function lineHash(line: string, digits: number): string {
	return String(fnv1a32(canon(line)) % 10 ** digits).padStart(digits, "0");
}

export function blankHash(digits: number): string {
	return lineHash("", digits);
}

export function lineHashes(content: string): string[] {
	const lines = content.split("\n");
	const digits = hashDigitsFor(lines.length);
	return lines.map((line) => lineHash(line, digits));
}

export function formatAnchor(line: number, hash: string): string {
	if (hash === blankHash(hash.length) && String(line).length <= hash.length) {
		return String(line);
	}
	return `${line}${hash}`;
}

export function splitAnchor(
	digits: string,
	hashDigits: number,
): { line: number; hash: string } {
	if (digits.length <= hashDigits) {
		return { line: Number(digits), hash: "" };
	}
	return {
		line: Number(digits.slice(0, -hashDigits)),
		hash: digits.slice(-hashDigits),
	};
}
