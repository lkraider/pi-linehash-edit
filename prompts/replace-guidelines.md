- Use `read` before `replace`; pass the returned checksum to `replace`.
- Batch all same-file edits into one `replace` with multiple `changes`; never drip edits one call at a time.
- On `E_STALE_CHECKSUM`, the error returns the current state and checksum: re-derive every pending edit against it and resend in one `replace`. Never retry with the stale checksum.
- Put literal content only in `replace` field `content_lines`.
{{AUTO_READ_GUIDANCE}}