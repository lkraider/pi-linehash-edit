Replace lines in a text file using LINE:HASH anchors from `read`.{{MODE_DESCRIPTION}}

Workflow:
1. Call `read` to get `LINE:HASH│content` lines for the file.
2. Identify the range to replace using the anchors from the read output.
3. Call `replace` with `hash_range_inclusive` (the two anchors) and `content_lines` (the new lines).
4. On `[E_STALE_ANCHOR]`, call `read` again for fresh anchors, then retry.
5. On success, call `read` to get fresh anchors for follow-up edits.

Request structure:
{{MODE_REQUEST_STRUCTURE}}

Fields:
- content_lines — replacement lines as a JSON array of strings. File content only — no LINE:HASH│ prefix.
- hash_range_inclusive — [start, end] anchors from read output, each the full `line:hash` string (e.g. `"12:aB"`) — no │ or line content.
- path — file to edit.

Examples:
{{MODE_EXAMPLES}}

Rules:
- Anchors must be exact `line:hash` pairs from the most recent read. Stale anchors (wrong line, wrong hash, or both) fail with [E_STALE_ANCHOR].
- The range is inclusive: every line from the start anchor through the end anchor is deleted.
- Those lines are replaced with content_lines — nothing is inserted, nothing is appended.
- content_lines is literal file content. Never include the LINE:HASH│ prefix — that goes in hash_range_inclusive.
- content_lines must be a native JSON array of strings, not a serialized string.
- Preserve leading whitespace exactly as it appears after │ in read output.
- To delete lines, use content_lines: [].
- If content_lines matches current content, the edit is a noop (file unchanged).
- **Verify boundaries:** before submitting, check your `content_lines`. If its first non-empty line matches the line just before the start anchor, remove it — that line survives outside your range. If its last non-empty line matches the line just after the end anchor, remove it — it also survives. A `[W_DUP]` warning means you missed this check; the duplicate is kept in the file exactly as submitted, never silently corrected.
{{MODE_RULES}}
On success, the response shows the change summary. {{AUTO_READ_GUIDANCE}}

Recovery: If a replace produces incorrect results, call undo_last_replace with the file path to revert.
