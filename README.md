# pi-linehash-edit

Strict `read`/`replace` tools for pi. Numeric line addresses; one whole-file snapshot guard.

## Protocol v2

`read` returns:

```text
snapshot:s2:4vQj8YqLw7R3tP0uN2mKxA
1│const a = 1;
2│const b = 2;
3│
```

The 22-character tag is the first 128 bits of SHA-256 over a versioned domain, canonical mutation-target path, and exact raw file bytes, encoded base64url without padding. It is stateless. Any byte change—including BOM, line endings, trailing whitespace, or an unrelated line—invalidates it.

Replace with one atomic same-file batch:

```json
{
  "path": "src/main.ts",
  "snapshot": "s2:4vQj8YqLw7R3tP0uN2mKxA",
  "changes": [
    { "range": [2, 2], "content_lines": ["const b = 3;"] }
  ]
}
```

Ranges are positive, inclusive numeric line addresses from that snapshot. All changes resolve against the same file observation and apply bottom-up. Overlaps fail. Missing, malformed, or mismatched snapshots fail closed. The old per-line hash and `hash_range_inclusive` format is unsupported.

Partial reads return the same whole-file snapshot as full reads. `│` is display-only. Empty files display `1│` and can be replaced at `[1,1]`.

After successful replacement, the result includes the new snapshot. Optional auto-read shows sparse ±32-line windows around each changed region.

## Installation

```bash
pi install npm:pi-linehash-edit
```

## Development

```bash
npm run typecheck
npm run lint
npm test
```

MIT licensed.
