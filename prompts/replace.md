Replace inclusive numeric line ranges from one whole-file checksum.

Request:
```json
{"path":"src/main.ts","checksum":"<22-char-value>","changes":[{"range":[2,2],"content_lines":["const b = 3;"]}]}
```

Rules:
- `checksum` must come from `read` for this canonical file target.
- Any raw-byte change returns `[E_STALE_CHECKSUM]`; re-read and retry.
- All ranges resolve against one checksum and apply atomically bottom-up.
- Ranges use positive integers and are inclusive.
- `content_lines` contains literal file content only, never `line│` prefixes.
- Use `[]` to delete. Overlapping ranges fail with `[E_EDIT_CONFLICT]`.
{{AUTO_READ_GUIDANCE}}