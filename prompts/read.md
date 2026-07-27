Read a text file. Text output starts with `checksum:<22-char-value>`, followed by `line│content` rows.

The checksum binds the canonical target path and exact raw bytes. Copy it into `replace`. Any raw-byte change makes it stale.

Pagination:
- Partial reads still return the same whole-file checksum as full reads.
- Default cap: {{DEFAULT_MAX_LINES}} lines or {{DEFAULT_MAX_BYTES}}. Use offset/limit to continue.

Images retain visual handling. Binary files and directories are rejected. Empty files return `1│` and remain editable.