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

export const HL_BARE_PREFIX_RE = new RegExp(`^\\s*\\+?\\s*(${ANCHOR_CLASS})│`);

function hashToString(h: number): string {
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
	return hashToString(fnv1a32(canon(line)));
}

export function lineHashes(content: string): string[] {
	return content.split("\n").map(lineHash);
}
