- Use `read` before `replace`; pass the returned checksum to `replace`.
- Batch all same-file `replace` changes using numeric inclusive `range` values.
- On `E_STALE_CHECKSUM`, use `read` again. Never retry `replace` with the stale checksum.
- Put literal content only in `replace` field `content_lines`.
{{AUTO_READ_GUIDANCE}}