# pi-linehash-edit

A [pi-coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension that replaces the built-in `read` and `edit` tools with an anchored line-replacing workflow. Strict semantics, no silent relocation, no autocorrection, no fuzzy fallback. Every line is addressed by its own line number, verified by a content checksum, so edits stay precise and stale anchors are caught before they reach the file.

Fork of [pi-hashline-edit](https://github.com/RimuruW/pi-hashline-edit) by RimuruW. The strict-semantics policy is unchanged.

Every line returned by `read` carries an anchor (line number plus a content checksum). Edits reference those anchors instead of raw text, so the tool can detect stale context and reject outdated changes before they reach the file.

## Why line + checksum?

A bare content hash (what upstream hashline implementations, including earlier versions of this fork, use as the sole anchor) asks a lossy, compressive function to serve as a permanent, collision-free identity for a line. That's a mismatch: two duplicate-content lines are indistinguishable by content alone, no matter how good the hash is, and a fixed-size hash space collides by the birthday bound long before any file gets large.

Line number is already a perfect, free identifier: no two lines in one snapshot share a line number, ever, with zero collision handling. So the anchor is the line number immediately followed by a checksum — position is the address, the checksum only catches drift (has this specific line's content changed since it was last read). A mismatch at the stated line is always a stale anchor, never an identity crisis.

## Installation

From npm:

```bash
pi install npm:pi-linehash-edit
```

From a local checkout:

```bash
pi install /path/to/pi-linehash-edit
```

## How It Works

### `read` -- tagged line output

Text files are returned with an `<anchor>│content` prefix on every line. Example output for the source below:

```js
function hello() {
  console.log("world");
}
```

would be returned as:

```text
176785│function hello() {
241458│  console.log("world");
388536│}
```

- The anchor is the 1-based line number immediately followed by a 5-digit content checksum, with no separator (`176785` is line 1, checksum `76785`). See [Hashing](#hashing) for details.

Optional parameters:

- `offset` -- start reading from this line number (1-indexed).
- `limit` -- maximum number of lines to return.

Images (JPEG, PNG, GIF, WebP) are passed through as attachments and do not participate in the hashline protocol. Binary and directory paths are rejected with a descriptive error. Empty files are returned as a single empty-line anchor (e.g. `136261│`). Use replace on that anchor to insert content.

### `replace` -- anchor-based modifications

Replaces using the `<anchor>│content` anchors from `read` output to target lines precisely. Two modes are available, toggled via `/toggle-replace-mode` (persists across sessions):

**Bulk mode (default):** `hash_range_inclusive` and `content_lines` go inside a `changes` array, supporting multiple edits in one call.

```json
{
  "changes": [
    { "content_lines": ["  console.log('hashline');"], "hash_range_inclusive": ["274293", "274293"] }
  ],
  "path": "src/main.ts"
}
```

**Flat mode:** `hash_range_inclusive` and `content_lines` sit at the top level. Only one edit per call.

```json
{
  "content_lines": ["  console.log('hashline');"],
  "hash_range_inclusive": ["274293", "274293"],
  "path": "src/main.ts"
}
```

| Field | Description |
| --- | --- |
| `hash_range_inclusive` | Inclusive line range `[start_hash, end_hash]` (required). |
| `content_lines` | Literal replacement content, one string per line (use `[]` to delete the range). |

- **Request structure validation.** The request envelope (`path`, `changes` in bulk mode; `path`, `hash_range_inclusive`, `content_lines` in flat mode) and individual edit items are validated before any file I/O. Unknown fields, missing required fields, invalid types, and malformed anchors are rejected with `[E_BAD_SHAPE]` or `[E_BAD_REF]`.
- **Legacy dialect rejected.** The native top-level `oldText`/`newText` (and `old_text`/`new_text`) dialect is rejected with `[E_LEGACY_SHAPE]`. The error message tells the model to call `read` first and send `{content_lines: [...], hash_range_inclusive: ["<START>", "<END>"]}`.
- **Batched atomicity (bulk mode).** All edits in a single call validate against the same pre-edit snapshot and apply bottom-up, so the hashes from a single `read` call remain valid across all edits in the batch.

### Stable anchors across edits

Anchors are computed fresh from disk on every `read` and `replace` call — there is no store, no cache, no cross-edit bookkeeping. Editing one part of a file never changes the anchor of an unrelated, untouched line: its line number is unchanged and its hash is a pure function of its own content, so it reproduces identically every time. Anchors from a `read` stay valid for every line you didn't touch, across any number of later edits, for free.

An anchor only goes stale when its specific line actually changed — content, position, or both. There is no proximity search and no fallback relocation: a mismatch at the stated line is always `[E_STALE_ANCHOR]`, telling the model to re-`read`.

### Chained edits

After a successful replace, the response confirms with `Successfully replaced in {path}. Added X line(s), removed Y line(s).` (warnings are still shown if present). When auto-read is enabled, fresh anchors are appended automatically. Otherwise call `read` to get fresh anchors for follow-up edits.
### Auto-read after write and replace

Auto-read is **enabled by default**. After a successful `write` or `replace` the extension automatically reads the file and appends a `--- Auto-read (hashline anchors) ---` block to the result, giving the model immediate `<anchor>│content` anchors without a separate `read` call. The workflow becomes:

1. `write` a file, result includes hashline anchors
2. `replace` using those anchors directly

After a `replace`, the appended block is **bounded to the changed region** (the edited lines plus surrounding context), not the whole file — chained edits near the last change get fresh anchors for free, while an edit elsewhere still uses `read`. A `write` has no single change point, so it returns a capped head read of the new file.

Toggle at runtime with the `/toggle-auto-read` command. The setting persists across sessions in the config file (`~/.config/pi-linehash-edit/config.json`). Set `PI_HASHLINE_AUTO_READ=1` to force it on regardless of saved config.

### Diff for the host

The post-edit diff (with `+`/`-` markers) is exposed to the host UI via `details.diff`. It is intentionally not in the LLM-visible text. The model already knows what it changed and can call `read` for fresh anchors when needed.

### Commands

| Command | Description |
| --- | --- |
| `/toggle-replace-mode` | Switch between bulk mode (`changes` array) and flat mode (top-level fields). Persists across sessions. |
| `/toggle-auto-read` | Toggle automatic hashline anchors after write and replace operations. Persists across sessions. |

### Config file

Settings are stored in `~/.config/pi-linehash-edit/config.json`:

```json
{
  "replaceMode": "bulk",
  "autoRead": true
}
```

The file is created automatically when any setting is toggled. Both fields are independent — toggling one never clobbers the other.

## Design Decisions

- **Stale anchors fail (per-line).** An anchor mismatch means that specific line's content or position changed since the last `read`; the error tells the model to call `read()` to get fresh anchors, then copy the full anchor of the start and end of the range being replaced into `hash_range_inclusive` of the next replace call. Because staleness is per-line, editing or appending lines does **not** invalidate anchors for lines whose content and position are unchanged — anchors for untouched regions stay valid across edits to other regions.
- **No fallback relocation.** Mismatched anchors are never silently relocated to a "close enough" line, and there is no proximity search. This trades convenience for correctness.
- **Strict patch content.** Copied-row detection is evidence-based, never shape-based. A `content_lines` entry starting with an `<anchor>│` prefix (read row, diff context row, or diff `+` row) is rejected with `[E_BARE_HASH_PREFIX]` when that anchor matches the file's real current anchor table **and** either points inside the range being replaced (pasted rows of the edited region) or reproduces the referenced line verbatim after the `│` (rows copied from elsewhere — the move/duplicate signature). A live-anchor prefix outside the range whose content *differs* from the referenced line is likely a legitimate quote, so it applies with a `[W_BARE_HASH_PREFIX]` warning instead. Anchor-shaped prefixes that match nothing real, unified-diff lines (`+x`, `-x`, ` x`, `@@ … @@`), and column-aligned negative numbers are all written literally — literal content is never silently altered or blocked on shape alone.
- **Atomic writes.** Files are written via temp-file-then-rename to avoid corruption from interrupted writes. Symlink chains are resolved so the target file is updated without replacing the symlink. Hard-linked files are updated in place to preserve the shared inode. File permissions are preserved across atomic renames.
- **Per-file mutation queue.** Edits queue by the canonical write target, so concurrent edits through different symlink paths still serialize onto the same underlying file.
- **Boundary duplication warns, never auto-fixes.** When the last line of a replacement matches the next surviving line (or the first line matches the preceding one), the edit still applies exactly as submitted — content_lines is never altered — and a `[W_DUP]` warning is added to the response. This catches a common LLM pattern where closing delimiters like `}`, `});`, or `} else {` are accidentally duplicated, without risking the alternative failure mode: a duplicate that's coincidental rather than accidental (two unrelated `}` blocks at the same indent) silently mangled by a guess. Best-effort detection (exact, untrimmed line comparison), not enforcement — it can miss a duplicate that differs only in whitespace, and it never blocks the write.
- **Flat mode normalization.** When flat mode is active, the tool's `execute` function wraps the top-level `hash_range_inclusive` and `content_lines` into a single-element `changes` array internally, then runs the same pipeline as bulk mode. The `normReq` function in `replace-normalize.ts` also handles flat format directly, so any code path that normalizes input (e.g. `compPreview`) works with both formats.
- **No hash store, no cache.** `lineHashes` is a pure, synchronous function of file content — no async init, no persistence, no per-edit bookkeeping to keep hashes "stable." Stability is a free consequence of addressing by line number and hashing content directly, not something that needs to be engineered.
- **File size is enforced, not best-effort.** `replace` hard-rejects files over 1,000,000 lines with `[E_FILE_TOO_LARGE]` rather than degrading; this tool targets source-sized files, not data dumps. `read` has no such cap. Concurrent edits from *outside* this tool (a second process writing the file while a replace is in flight) are unsupported — the per-file mutation queue only serializes edits made through this extension.

## Hashing

The raw hash is a synchronous 32-bit FNV-1a (`src/hashline/hasher.ts`, ~6 lines, zero dependencies) reduced modulo 100000 to a fixed 5-digit decimal checksum (16.6 bits, 100000 buckets). It renders with no separator before the line number so both fold into a single token on OpenAI's o200k tokenizer (which chunks digit runs by 3), and 5 decimal digits are both cheaper per line and more drift-resistant than the previous 2-char base64 checksum. It is not asked to be globally unique — the line number is the address, the hash only verifies that the content at that address hasn't drifted since it was last read. That reframing is what lets the hash be small, non-cryptographic, and collision-tolerant: two different lines sharing a checksum is harmless, since they're never compared to each other, only to whatever the model claims is at one specific line.

The alphabet is sized for an LLM consumer. The model tokenizes, it doesn't squint at pixel glyphs, so the human-readability heuristics used by smaller hand-curated alphabets (no G/L/I/O because they look like digits, no vowels so the hash doesn't accidentally spell a word, no hex digits so it can't be confused with `0xFF`) don't apply.

Before hashing, each line is normalized: carriage returns are stripped and trailing whitespace is trimmed. This `canon()` normalization prevents insignificant whitespace changes from cascade-triggering hash churn across the file. Two lines that differ only in trailing spaces or `\r` characters produce the same hash, so anchor stability is preserved across editor-save cycles that add or remove trailing whitespace.

Two duplicate-content lines get the same hash — that's fine, because their line numbers differ, and it's the line number that's checked first. There is no collision retry, no "used hash" bookkeeping, and no hash-space exhaustion: `HASH_LEN` in `src/hashline/hash.ts` sets the checksum length and can be raised for a wider drift-detection margin, but nothing in the system depends on it for correctness.

Anchors are best-effort drift detection, not a freshness proof. Two external changes evade them by construction: a line that changed only in trailing whitespace (invisible by `canon()` design), and a same-line replacement whose content collides in the 12-bit hash space. Both apply the edit against the changed file. If drift protection against concurrent external writers matters, that is a snapshot/locking concern outside the anchor scheme.

### Bare-prefix detector

The bare-prefix detector matches lines starting with an `<anchor>│` shape (digits, with an optional leading `+`, covering diff rows), then demands evidence before hard-rejecting. The anchor must match the file's actual current anchor table, and then one of two copy signatures must hold: the anchor points inside the range being replaced (read/diff rows of the edited region pasted back), or the content after `│` reproduces the referenced line verbatim (rows copied from elsewhere in the file — the move/duplicate mistake). A live-anchor prefix that matches neither signature — same anchor, different content — reads as a deliberate quote of another line, so it applies with a `[W_BARE_HASH_PREFIX]` warning instead of blocking. Content that merely looks anchor-shaped but matches nothing real is always written literally.

## Development

Requires [Node.js](https://nodejs.org) and npm.

```bash
npm install
npm test
```

Set `PI_HASHLINE_DEBUG=1` to show an "active" notification at session start.

Auto-read after write and replace is on by default. Set `PI_HASHLINE_AUTO_READ=1` to force it on regardless of saved config; toggle at runtime with `/toggle-auto-read` (the setting persists across sessions once toggled).

## Credits

- [RimuruW](https://github.com/RimuruW) -- original `pi-hashline-edit` and the strict-semantics policy
- [can1357](https://github.com/can1357) -- original [oh-my-pi](https://github.com/can1357/oh-my-pi) implementation and the hashline concept

## License

[MIT](LICENSE)
