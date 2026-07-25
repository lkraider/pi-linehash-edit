Read a text file. Each line is returned as `LINE:HASH│content`.

The anchor is the whole `LINE:HASH` pair — copy it verbatim into replace calls. There is no fuzzy matching: if a line's position or content differs at all from what you read, `replace` fails with [E_STALE_ANCHOR]. Re-read to get current anchors.

Anchor format:
- `LINE` — 1-based line number.
- `HASH` — 2 characters from the URL-safe base64 alphabet `A-Za-z0-9-_` (e.g. `aB`, `4y`, `-q`). A checksum on the line's content, not a unique ID — identical lines share a HASH; LINE disambiguates them.
- Content after `│` is the line verbatim.

Pagination:
- Large files return a truncated preview with a pagination hint (e.g. `[Showing lines 1-100 of 500. Use offset=101 to continue.]`). Call `read` again with `offset=N` to continue.
- Default cap: {{DEFAULT_MAX_LINES}} lines or {{DEFAULT_MAX_BYTES}}; output exceeding either is truncated. Pass `limit` to read fewer lines.

File kinds:
- Text files are returned as `LINE:HASH│content` lines.
- Images (JPEG, PNG, GIF, WebP) are returned as visual attachments.
- Binary files and directories are rejected with a descriptive error.
- Empty files are returned as a single empty-line anchor (`1:HASH│`). Use replace on that anchor to insert content.

Non-UTF-8 bytes:
- UTF-8 byte-order marks (BOM) are stripped. Editing a file with a BOM rewrites it without the BOM.
