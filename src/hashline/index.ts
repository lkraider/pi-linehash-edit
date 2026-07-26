export {
	HASH_DIGITS,
	HASH_SEP,
	HASH_CLASS,
	ANCHOR_CLASS,
	ANCHOR_RE,
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
	applyEdits,
	formatRegion,
	changedRange,
} from "./apply";
