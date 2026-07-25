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
	type ResolvedAnchor,
	type ParsedEdit,
	type ResolvedEdit,
	type RawEdit,
	type NoopEdit,
	type BoundaryDupWarning,
	describeEdit,
	parseEdits,
	resolveEdits,
	assertNoBarePrefix,
	formatMismatch,
} from "./resolve";
export {
	buildLineIndex,
	applyEdits,
	formatRegion,
	changedRange,
} from "./apply";
