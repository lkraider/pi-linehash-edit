import { fnv1a32 } from "./hasher";

export const HASH_LEN = 2;
export const HASH_SEP = "│";

const ALPH =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const ALPH_BITS = 6;
const ALPH_MASK = (1 << ALPH_BITS) - 1;
const ALPH_SAFE = ALPH.replace(/-/g, "\\-");
export const HASH_CLASS = `[${ALPH_SAFE}]{${HASH_LEN}}`;
export const ANCHOR_CLASS = `\\d+:${HASH_CLASS}`;
export const ANCHOR_RE = new RegExp(`^(\\d+):(${HASH_CLASS})$`);

export const HL_PREFIX_PLUS_RE = new RegExp(`^\\+\\s*${ANCHOR_CLASS}│`);
export const DIFF_MINUS_RE = /^-\s*\d+\s{4}/;
export const HL_BARE_PREFIX_RE = new RegExp(`^\\s*(${ANCHOR_CLASS})│`);

function h2s(h: number): string {
	const totalBits = HASH_LEN * ALPH_BITS;
	const shift = 32 - totalBits;
	const n = h >>> shift;
	let out = "";
	for (let j = 0; j < HASH_LEN; j++) {
		out +=
			ALPH[
				(n >>> ((HASH_LEN - 1 - j) * ALPH_BITS)) &
					ALPH_MASK
			]!;
	}
	return out;
}

export function canon(line: string): string {
	return line.replace(/\r/g, "").trimEnd();
}

export function lineHash(line: string): string {
	return h2s(fnv1a32(canon(line)));
}

export function lineHashes(content: string): string[] {
	return content.split("\n").map(lineHash);
}
