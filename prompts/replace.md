Replace lines in a text file using LINE:HASH anchors from `read`.{{MODE_DESCRIPTION}}

Workflow:
1. `read` the file to get `LINE:HASH│content` lines.
2. Pick the anchors bounding the range to replace.
3. Call `replace` with `hash_range_inclusive` (the two anchors) and `content_lines` (the new lines).
4. On `[E_STALE_ANCHOR]`, re-`read` and retry with fresh anchors.

Request structure:
{{MODE_REQUEST_STRUCTURE}}

Examples:
{{MODE_EXAMPLES}}

Rules:
- Anchors must be exact `line:hash` pairs from the most recent read; any mismatch (wrong line, wrong hash, or both) fails with [E_STALE_ANCHOR].
- hash_range_inclusive is inclusive: every line from the start anchor through the end anchor is deleted and replaced by content_lines — nothing is inserted or appended beyond that range.
- content_lines is literal file content only — never include the LINE:HASH│ prefix.
- To delete lines, use content_lines: [].
- If content_lines matches current content, the edit is a noop.
{{MODE_RULES}}
On success, the response shows the change summary. {{AUTO_READ_GUIDANCE}}

Recovery: if a replace produces incorrect results, call undo_last_replace with the file path to revert.
