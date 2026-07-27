Replace inclusive numeric line ranges from one whole-file snapshot.

Request:
```json
{"path":"src/main.ts","snapshot":"s2:<22-char-tag>","changes":[{"range":[2,2],"content_lines":["const b = 3;"]}]}
```

Rules:
- `snapshot` must come from `read` for this canonical file target.
- Any raw-byte change returns `[E_STALE_SNAPSHOT]`; re-read and retry.
- All ranges resolve against one snapshot and apply atomically bottom-up.
- Ranges use positive integers and are inclusive.
- `content_lines` contains literal file content only, never `line│` prefixes.
- Use `[]` to delete. Overlapping ranges fail with `[E_EDIT_CONFLICT]`.
{{AUTO_READ_GUIDANCE}}