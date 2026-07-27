# pi-linehash-edit

Strict, token-efficient `read` and `replace` tools for [pi](https://github.com/earendil-works/pi-mono). Lines are numeric addresses; one stateless whole-file snapshot proves which file observation those addresses belong to.

## Why the harness matters

Coding ability and editing reliability are different problems. A model can know the right change and still fail while expressing an exact-text replacement or patch.

Can Bölük's 2026 [harness benchmark](https://stencil.so/blog/the-harness-problem) held tasks and models constant while changing the edit interface. Across 16 models, three runs of 180 tasks per format, hash-addressed editing beat patch for 14 models. Grok Code Fast 1 rose from 6.7% to 68.3%; Grok 4 Fast used 61% fewer output tokens in the best reported comparison. The benchmark was produced by a hashline implementation author, so it supports the premise that edit interfaces matter—not the performance of this package or protocol.

Local replay and pilot evidence shaped this implementation. The frozen replay corpus covered 2 sessions, 444 assistant turns, 364 read/auto-read responses, 48,533 displayed rows, and 107 replace calls. Candidates replayed identical events under `o200k_base`, `cl100k_base`, and `p50k_base`:

- Number-only `line│` prefixes measured 2.277 `o200k` tokens per displayed line versus 3.795 for per-line guarded prefixes. The snapshot header is paid once per response.
- Disjoint ±32-line post-edit windows cut replayed auto-read tokens 45.2% while retaining all 80 later-referenced rows in the observed corpus.
- A 12-case paired pilot on one valid model passed 12/12 tasks in both arms; sparse auto-read reduced total tokens 11.37% and returned rows 57.54%.

Those are bounded results, not universal claims: the corpus was narrow, the live pilot covered one model family, and its confidence interval did not establish a guaranteed 10% saving. Release telemetry and cross-model testing remain necessary.

## Read format

`read` starts with one snapshot, then emits numbered content:

```text
snapshot:s2:4vQj8YqLw7R3tP0uN2mKxA
1│const a = 1;
2│const b = 2;
3│
```

`│` is display-only. Content begins after it. Partial and paginated reads carry a snapshot of the entire file, not only the displayed window. Empty files display `1│` and are editable at `[1,1]`.

The snapshot is:

```text
s2:base64url(first_128_bits(SHA-256(domain || lengths || canonical_path || raw_bytes)))
```

It binds exact bytes and the resolved mutation target. BOMs, line endings, trailing whitespace, unrelated lines, and symlink-target changes all affect it. No cache, database, session state, or persisted index is involved.

## Replace format

Send one same-file batch using the snapshot returned by `read`:

```json
{
  "path": "src/main.ts",
  "snapshot": "s2:4vQj8YqLw7R3tP0uN2mKxA",
  "changes": [
    { "range": [2, 2], "content_lines": ["const b = 3;"] },
    { "range": [8, 10], "content_lines": [] }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `path` | Relative or absolute text-file path |
| `snapshot` | Exact `s2:` tag returned by `read` |
| `changes` | Non-empty same-file batch |
| `range` | Positive, inclusive `[start, end]` line numbers from that snapshot |
| `content_lines` | Literal replacement lines; `[]` deletes the range |

Every range resolves against the same pre-edit observation. Disjoint changes apply bottom-up, so earlier insertions cannot shift later addresses. Overlap fails with `E_EDIT_CONFLICT`. Identical replacement content is a no-op. A stale snapshot fails with `E_STALE_SNAPSHOT`; re-read instead of retrying it.

After a successful write, the result returns the next snapshot. Auto-read, enabled by default, appends sparse ±32-line windows around changed regions. It preserves a hard 2,000-line/50 KB output cap and marks any changed regions omitted by that cap.

## Safety model

- Request shape and every edit are validated before file I/O.
- Snapshot reads compare descriptor metadata before and after reading and verify the live path still names the same inode.
- `replace` validates the snapshot after entering pi's per-file mutation queue and checks it again immediately before writing.
- The mutation queue is keyed by the resolved target, so symlink aliases serialize together.
- Existing permissions are preserved. Normal files use temp-file-and-rename replacement; hard-linked files are written in place to preserve the shared inode.
- A copied `line│content` row is rejected when it matches the live file. Boundary duplication is written exactly as submitted but emits `W_DUP`.

The snapshot is an optimistic-concurrency guard, not a lock or authorization token. Its 128-bit digest makes accidental collision negligible, but an external writer can still race after the final check. Files are limited to 100 MB; replacements are limited to 1,000,000 lines.

## Text behavior

- UTF-8 BOMs are preserved.
- Invalid UTF-8 is displayed with U+FFFD; an actual edit rewrites the file as UTF-8 and warns.
- CRLF and LF are normalized internally. Editing mixed endings normalizes the file to its first detected ending and emits `W_MIXED_EOL`.
- JPEG, PNG, GIF, and WebP reads retain pi's image handling. Other binary files and directories are rejected.

## Installation

```bash
pi install npm:pi-linehash-edit
```

The extension replaces pi's `read` tool, registers `replace`, and disables the built-in `edit` tool for the session.

## Configuration

`/toggle-auto-read` persists this file:

```json
{
  "autoRead": true
}
```

Location: `~/.config/pi-linehash-edit/config.json`.

## Development

Requires Node.js 22.

```bash
npm ci
npm run prepublishOnly
```

The release gate runs TypeScript, ESLint, and the protocol test suite.

## Evidence and references

- Can Bölük, [“We improved 15 LLMs at coding in one afternoon. Only the harness changed.”](https://stencil.so/blog/the-harness-problem) — external harness benchmark and methodology.
- [Aider edit-format benchmarks](https://aider.chat/docs/more/edit-formats.html) — model-dependent format performance.
- JetBrains, [Diff-XYZ](https://arxiv.org/abs/2510.12487) — no single edit representation dominates every model and use case.
- [CodeEditorBench](https://arxiv.org/abs/2404.03543) — broader code-editing evaluation context.
- Kung and Robinson, [optimistic concurrency control](https://mwhittaker.github.io/papers/html/kung1981optimistic.html) — read, validate, write model underlying snapshot rejection.

## License

[MIT](LICENSE)
