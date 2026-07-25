export {
	HASH_LEN,
	HASH_SEP,
	HASH_CLASS,
	ANCHOR_CLASS,
	ANCHOR_RE,
	HL_PREFIX_PLUS_RE,
	DIFF_MINUS_RE,
	HL_BARE_PREFIX_RE,
	lineHash,
	lineHashes,
} from "./hash";

export {
	parseHashRef,
	parseText,
	type Anchor,
} from "./parse";

export {
	type RAnchor,
	type HEdit,
	type RHEdit,
	type HTEdit,
	type NEdit,
	type BDupWarn,
	type AutoFix,
	descEdit,
	resEdits,
	valEdits,
	assertNoBarePrefix,
	fmtMismatch,
} from "./resolve";
export {
	buildIdx,
	applyEdits,
	fmtRegion,
	changedRange,
	fmtBoundaryWarning,
} from "./apply";
