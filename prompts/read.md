Read a text file. Each line is returned as `LINE:HASH│content`.

Key rule: the anchor is the whole `LINE:HASH` pair, copied verbatim. Use it to reference lines in replace calls. HASH changes when the line content changes; LINE changes when lines are added or removed above it — always use the pair from your most recent read.

Anchor format:
- `LINE` is the 1-based line number.
- `HASH` is 2 characters from the URL-safe base64 alphabet `A-Za-z0-9-_` (e.g. `aB`, `4y`, `-q`) — a checksum on that line's content, not a unique ID by itself.
- The content after the `│` separator is the line verbatim.

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
