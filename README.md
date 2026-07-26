# pi-linehash-edit

A [pi-coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension that replaces the built-in `read` and `edit` tools. `read` prefixes every line with an anchor — its line number plus a short content checksum. `replace` edits by anchor rather than by a copied snippet, so the tool can tell when the target line has moved or changed since it was read and reject the edit instead of applying it in the wrong place.

It started from the upstream [pi-hashline-edit-pro](https://github.com/YuGiMob/pi-hashline-edit-pro) (itself a fork of [pi-hashline-edit](https://github.com/RimuruW/pi-hashline-edit)); the anchor scheme, token encoding, and most internals have since been rewritten (see [Why line + checksum](#why-line--checksum)).

## Installation

```bash
pi install npm:pi-linehash-edit      # from npm
pi install /path/to/pi-linehash-edit # from a local checkout
```

## Anchor format

`read` returns each line as `<anchor>│<content>`:

```text
14831│function greet(name) {
25797│  const msg = `hi ${name}`;
3│
48747│  console.log(msg);
54600│}
```

The anchor is the 1-based line number followed immediately by the checksum, with no separator: `14831` is line 1, checksum `4831`. The checksum is 4 digits in files up to 99 lines and 5 digits above. Blank and whitespace-only lines drop the checksum and render as the line number alone — line 3 above is just `3│`.

To edit, copy the anchors bounding the target range into a `replace` call. The `│` (U+2502) is only a display separator in `read` output; it never appears in a valid anchor argument.

## Token cost

In an agent session, `read` output is read far more often than edits are written, so anchor overhead is paid on nearly every turn. The encoding keeps that overhead low on OpenAI's o200k tokenizer, which groups digit runs in threes: because the checksum is decimal and abuts the line number, the anchor tokenizes as one or two digit tokens plus the separator.

Prefix tokens per line, measured on o200k:

| case | this scheme | base64 `line:hash` |
| --- | --- | --- |
| file ≤ 99 lines | 3 | 4 |
| file > 99 lines | 4 | 4 |
| blank line | 2 | 4 |

On a repository with a median file size around 96 lines, that is roughly 0.75 fewer tokens per line — about 19% of the anchor overhead — versus a colon-separated base64 anchor.

## Why line + checksum?

A bare content hash — which upstream hashline tools, including earlier versions of this fork, use as the sole anchor — asks a lossy function to serve as a stable identity for a line. Two identical lines then share an identity and cannot be told apart, and a fixed hash space starts colliding by the birthday bound well before a file gets large.

A line number is already a unique identity within one snapshot, for free. Using it as the address and the hash only as a drift check removes both problems: duplicate lines are distinguished by position, and the hash can be small because it never has to be globally unique. It also lets the anchor be a plain digit run, which is what makes the token encoding cheap.

## Principles

- **Position is the address; the checksum only detects drift.** The line number locates the line; the hash confirms its content is unchanged since the read. The hash is never used to find a line.
- **No relocation.** A stale anchor is rejected with `E_STALE_ANCHOR`, never remapped to a nearby line. There is no fuzzy match and no proximity search.
- **No content autocorrection.** A suspicious edit (for example, a duplicated boundary line) produces a warning; the content is written exactly as submitted.
- **Validate before I/O.** Request shape and anchors are checked before the file is touched.
- **No state.** Anchors are recomputed from file content on every call — no index, cache, or cross-edit bookkeeping. A line's anchor is stable across unrelated edits because both its inputs, line number and content, are.

## Algorithm

Everything runs synchronously in memory. The only I/O per call is one read, and for `replace` one atomic write.

**Hash.** Each line is canonicalized (`\r` stripped, trailing whitespace trimmed), hashed with 32-bit FNV-1a, reduced `mod 10^N`, and zero-padded to `N` digits. `N` is 4 for files up to 99 lines, 5 above; it is derived from the line count so `read` and `replace` split anchors identically. Linear in the line's byte length, no allocation beyond the digit string.

**Read.** Split on `\n`, hash each line, emit `<line><hash>│<content>`. One pass.

**Resolve.** Each anchor parses to `(line, hash)` by taking the last `N` digits as the hash. Resolution is a direct index — compare `hashes[line - 1]` to the anchor's hash — so it is O(1) per anchor with no scan. A wrong line, wrong hash, or out-of-range line is a stale anchor.

**Apply.** Edits become inclusive line ranges. Overlap is checked pairwise (edit counts per call are small), ranges are sorted by start line descending, and each is spliced into the line array so earlier splices do not shift later indices. The result is joined on `\n`. Linear in file length.

The checksum is not required to be unique. Two identical lines share a checksum, which is harmless because the line number selects the line and the checksum only has to detect that *that* line changed. The residual failure is a changed line whose new content collides with its old checksum: 1 in 10^N, i.e. 1 in 10,000 or 1 in 100,000.

## `read`

Text files return as `<anchor>│content` lines. Parameters:

- `offset` — first line to return (1-indexed).
- `limit` — maximum number of lines.

Large files are truncated with a pagination hint (`[Showing lines 1-100 of 500. Use offset=101 to continue.]`). Images (JPEG, PNG, GIF, WebP) return as attachments. Binary files and directories are rejected with a descriptive error. An empty file returns a single anchor `1│`; `replace` on it inserts content. A UTF-8 BOM is preserved across edits.

## `replace`

Two request shapes, switched by `/toggle-replace-mode` (persisted):

**Bulk (default)** — one or more edits in a `changes` array, applied atomically against a single snapshot:

```json
{
  "changes": [
    { "content_lines": ["  console.log('hashline');"], "hash_range_inclusive": ["274293", "274293"] }
  ],
  "path": "src/main.ts"
}
```

**Flat** — one edit, fields at the top level:

```json
{
  "content_lines": ["  console.log('hashline');"],
  "hash_range_inclusive": ["274293", "274293"],
  "path": "src/main.ts"
}
```

| field | meaning |
| --- | --- |
| `hash_range_inclusive` | inclusive `[start_anchor, end_anchor]` range to replace |
| `content_lines` | replacement lines, one string each; `[]` deletes the range |

Every line from the start anchor through the end anchor is replaced by `content_lines`; nothing outside the range is touched. If `content_lines` equals the current range content, the edit is a no-op. In bulk mode all anchors resolve against the same pre-edit snapshot and apply bottom-up, so anchors from one `read` stay valid across every edit in the batch.

Errors: `E_BAD_SHAPE` (unknown or missing fields, wrong types), `E_BAD_REF` (malformed anchor), `E_LEGACY_SHAPE` (an `oldText`/`newText` request — the message points to the anchor format), `E_STALE_ANCHOR` (anchor no longer matches), `E_EDIT_CONFLICT` (overlapping ranges), `E_FILE_TOO_LARGE` (over 1,000,000 lines).

## Auto-read

On by default. After a successful `write` or `replace`, fresh anchors are appended to the result so a follow-up edit needs no separate `read`. For `replace` the appended block is bounded to the changed region plus surrounding context; for `write` it is a capped head read of the new file. Toggle with `/toggle-auto-read` (persisted), or force on with `PI_HASHLINE_AUTO_READ=1`.

The post-edit diff (`+`/`-` markers) is exposed to the host UI via `details.diff` and is not included in the model-visible text.

## Failure modes and limits

- **Copied read/diff rows.** If a `content_lines` entry starts with a `<anchor>│` prefix, it is rejected with `E_BARE_HASH_PREFIX` only when the anchor matches the live file *and* either targets the range being replaced or reproduces that line verbatim — the signatures of a pasted read or diff row. A live anchor for some other line, with different content, is treated as a deliberate quote and applied with a `W_BARE_HASH_PREFIX` warning. Anchor-shaped content that matches nothing real is written as-is.
- **Boundary duplication.** If a replacement's first or last line matches the adjacent surviving line, the edit still applies unchanged and a `W_DUP` warning is added. Detection is an exact line comparison; it can miss a whitespace-only difference and never blocks the write.
- **Mixed line endings.** A file with mixed endings is normalized to its dominant ending, with a `W_MIXED_EOL` warning.
- **Drift blind spots.** Anchors detect drift, they do not prove freshness. A change confined to trailing whitespace is invisible (it is trimmed before hashing), and a checksum collision (rate above) lets a changed line pass. Both then edit against the changed file.
- **External writers.** Edits through this extension serialize on a per-file queue keyed by the resolved write target, so symlink aliases still serialize; a write from another process during a `replace` is not covered.

## Writes

`replace` and `write` use temp-file-then-rename to avoid partial writes. Symlink chains are resolved so the link is followed rather than replaced; hard-linked files are written in place to keep the shared inode; permissions are preserved across the rename.

## Commands and config

| command | effect |
| --- | --- |
| `/toggle-replace-mode` | switch bulk / flat request shape |
| `/toggle-auto-read` | switch auto-read on / off |

Settings persist in `~/.config/pi-linehash-edit/config.json`:

```json
{
  "replaceMode": "bulk",
  "autoRead": true
}
```

## Development

Requires [Node.js](https://nodejs.org) and npm.

```bash
npm install
npm test
```

`PI_HASHLINE_DEBUG=1` shows a session-start notification. The suite is 587 tests, including an adversarial set covering stale anchors, copied rows, span math, line-ending fidelity, and hash-width boundaries.

## Credits

- [YuGiMob](https://github.com/YuGiMob) — [pi-hashline-edit-pro](https://github.com/YuGiMob/pi-hashline-edit-pro), the upstream this fork started from.
- [RimuruW](https://github.com/RimuruW) — original `pi-hashline-edit` and the strict-semantics policy.
- [can1357](https://github.com/can1357) — original [oh-my-pi](https://github.com/can1357/oh-my-pi) implementation and the hashline concept.

## License

[MIT](LICENSE)
