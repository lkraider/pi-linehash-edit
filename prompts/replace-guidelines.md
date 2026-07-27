- Use `read` before `replace`; pass the returned `s2:` snapshot to `replace`.
- Batch all same-file `replace` changes using numeric inclusive `range` values.
- On `E_STALE_SNAPSHOT`, use `read` again. Never retry `replace` with the stale snapshot.
- Put literal content only in `replace` field `content_lines`.
{{AUTO_READ_GUIDANCE}}