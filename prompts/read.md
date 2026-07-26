Read a text file. Each line is returned as `<anchor>│content`.

The anchor is the run of digits before `│` — copy it verbatim into replace calls. There is no fuzzy matching: if a line's position or content differs at all from what you read, `replace` fails with [E_STALE_ANCHOR]. Re-read to get current anchors.

Anchor format:
- The anchor is the 1-based line number immediately followed by a content checksum, no separator (e.g. `4274293` is line 42, checksum `74293`). The checksum is 4 digits in files of ≤99 lines, 5 digits otherwise.
- Blank lines show the line number alone (e.g. `42│`).
- The checksum verifies the line's content, not a unique ID — identical lines share a checksum; the line number disambiguates them.
- Content after `│` is the line verbatim.

Pagination:
- Large files return a truncated preview with a pagination hint (e.g. `[Showing lines 1-100 of 500. Use offset=101 to continue.]`). Call `read` again with `offset=N` to continue.
- Default cap: {{DEFAULT_MAX_LINES}} lines or {{DEFAULT_MAX_BYTES}}; output exceeding either is truncated. Pass `limit` to read fewer lines.

File kinds:
- Text files are returned as `<anchor>│content` lines.
- Images (JPEG, PNG, GIF, WebP) are returned as visual attachments.
- Binary files and directories are rejected with a descriptive error.
- Empty files are returned as a single empty-line anchor (`1│`). Use replace on that anchor to insert content.

Non-UTF-8 bytes:
- UTF-8 byte-order marks (BOM) are stripped. Editing a file with a BOM rewrites it without the BOM.
