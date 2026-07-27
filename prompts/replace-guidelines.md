- Read first; pass the returned `s2:` snapshot to `replace`.
- Batch all same-file changes. Use numeric inclusive `range` values.
- On `E_STALE_SNAPSHOT`, re-read. Never retry with the stale snapshot.
- `content_lines` contains literal content only.
{{AUTO_READ_GUIDANCE}}