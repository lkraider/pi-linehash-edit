# pi-linehash-edit

`pi-linehash-edit` gives [pi](https://github.com/earendil-works/pi-mono) two strict, token-efficient tools for changing files: `read` and `replace`.

The central idea is simple. A line number says **where** to edit. One whole-file snapshot says **which exact version of the file** those line numbers came from.

Think of the snapshot as a tamper seal on a printed document. You may ask to replace lines 8 through 10, but the tool first checks the seal. If anyone changed the document after you read it, even somewhere else, the seal no longer matches and the edit is refused.

That is the key promise in another form: the tool would rather stop and ask for a fresh read than apply an edit to a file version the model did not see.

## Why the editing tool matters

A coding model can understand a bug and still fail to edit the file. Understanding and delivery are separate problems.

Many editing tools ask the model to reproduce an old block of text exactly before replacing it. One wrong space, tab, or repeated line can make that request fail or become ambiguous. Patch formats add another grammar that the model must produce correctly.

Can Bölük's 2026 [harness benchmark](https://stencil.so/blog/the-harness-problem) tested this distinction. The tasks and models stayed fixed while the edit interface changed. The benchmark covered 16 models, with three runs of 180 tasks for each format.

Hash-addressed editing beat patch editing for 14 of the 16 models. Grok Code Fast 1 rose from 6.7% to 68.3%. In the best reported token comparison, Grok 4 Fast produced 61% fewer output tokens.

Those numbers do not measure this package. The benchmark was produced by the author of a hashline implementation, so it is evidence for a narrower claim: **the interface between a model and the filesystem can materially change coding results**. It does not prove that this particular protocol will produce the same gains.

## What the local evidence showed

This implementation also follows a frozen local replay and a small live pilot.

The replay corpus contained:

- 2 sessions;
- 444 assistant turns;
- 364 normal or automatic read responses;
- 48,533 displayed file rows; and
- 107 `replace` calls.

Each candidate replayed the same events. Token counts were checked with three tokenizer vocabularies: `o200k_base`, `cl100k_base`, and `p50k_base`. A tokenizer is the component that divides text into the units a language model consumes.

The replay produced three practical findings:

1. A numbered `line│` prefix measured 2.277 `o200k` tokens per displayed line. A per-line guarded prefix measured 3.795 tokens. With the current design, the larger snapshot tag is paid once at the top of a response instead of once on every line.

2. Automatic reads that showed separate windows of 32 lines before and after each edit used 45.2% fewer tokens than broad first-change-to-last-change output. All 80 rows that were referenced later in the observed corpus were still present.

3. A paired live pilot used 12 edit cases on one working model. Both versions completed 12 out of 12 tasks. The sparse automatic-read version used 11.37% fewer total tokens and returned 57.54% fewer rows.

These results have limits. The corpus was narrow. The live pilot covered one model family, and its confidence interval, the estimated range around the measured result, did not establish a guaranteed saving of at least 10%. Cross-model testing and release telemetry are still needed.

## A complete edit, step by step

Suppose a file contains two declarations, and the second one is wrong.

### 1. Read the file

The `read` tool returns one snapshot followed by numbered lines:

```text
snapshot:s2:4vQj8YqLw7R3tP0uN2mKxA
1│const a = 1;
2│const b = 2;
3│
```

The separator `│` is only a visual boundary. It is not part of the file. On line 2, the actual content is `const b = 2;`.

The first line is different. It carries the snapshot for the whole file:

```text
snapshot:s2:4vQj8YqLw7R3tP0uN2mKxA
```

A partial read still receives a snapshot of the entire file, not merely the displayed page. Paginated reads behave the same way. An empty file displays `1│`, so its editable position is `[1,1]`.

### 2. Describe the replacement

The model keeps the snapshot, chooses the inclusive line range `[2,2]`, and supplies the new literal content.

A range is inclusive because both endpoints belong to the replacement. For example, `[8,10]` means lines 8, 9, and 10.

### 3. Send one same-file batch

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

The first change replaces line 2 with one line. The second change deletes lines 8 through 10 because its `content_lines` array is empty.

Every change in the batch refers to the same pre-edit file. The tool applies disjoint changes from the bottom upward. This prevents an insertion near the top from shifting the line numbers of a later change.

### 4. Let the tool verify before writing

If the path and snapshot still describe the file that was read, the tool applies the batch and returns a new snapshot.

If any raw byte changed, the tool returns `E_STALE_SNAPSHOT`. The correct response is to read the file again. Retrying the old snapshot cannot make it current.

If two ranges overlap, the tool returns `E_EDIT_CONFLICT`. If replacement content is identical to the current range, the operation is a no-op and nothing is written.

## The request fields

| Field | Meaning |
| --- | --- |
| `path` | A relative or absolute path to a text file |
| `snapshot` | The exact `s2:` tag returned by `read` |
| `changes` | A non-empty batch of changes for that one file |
| `range` | Positive, inclusive `[start, end]` line numbers from the snapshot |
| `content_lines` | Literal replacement lines; an empty array deletes the range |

Each string in `content_lines` represents exactly one file line. It must not contain a line break. It must also omit the displayed `line│` prefix.

## What the snapshot contains

The snapshot has this shape:

```text
s2:base64url(first_128_bits(SHA-256(domain || lengths || canonical_path || raw_bytes)))
```

Read aloud, the formula means:

1. Start with a versioned domain label so this digest cannot be confused with an unrelated hash.
2. Add explicit lengths and the canonical path, which is the resolved path of the actual mutation target.
3. Add the file's exact raw bytes.
4. Hash that input with SHA-256, the 256-bit Secure Hash Algorithm.
5. Keep the first 128 bits.
6. Encode those bits with URL-safe Base64, without padding, and prefix the result with `s2:`.

The result is 22 Base64URL characters after `s2:`.

Because the exact bytes are included, all of these changes produce a different snapshot:

- adding or removing a UTF-8 byte order mark (BOM);
- changing line-ending style;
- adding trailing whitespace;
- editing an unrelated line; or
- changing the target reached through a symbolic link.

The path is included too. Two different files with identical contents receive different snapshots.

The protocol is stateless. It does not need a cache, database, session record, or persisted line index. A process restart does not erase the meaning of a snapshot, although the snapshot is useful only while the target path and bytes still match.

## How writing is protected

The tool uses optimistic concurrency control. In plain language, it reads without locking the world, checks that its observation is still current, and writes only if validation succeeds.

The sequence is deliberately strict:

1. The request object and every edit are validated before file input/output begins.
2. While reading a snapshot, the tool compares file-descriptor metadata before and after reading.
3. It also checks that the live path still points to the same inode. An inode is the filesystem's identity record for a file.
4. `replace` enters pi's per-file mutation queue. Calls targeting the same resolved file wait their turn.
5. The snapshot is checked after entering that queue.
6. It is checked once more immediately before writing.
7. Only then is the file changed.

The queue uses the resolved target path. Therefore, two symbolic-link aliases that lead to the same file share one queue instead of racing each other.

Normal files are written to a temporary file and then renamed into place. Existing permissions are preserved. Hard-linked files are written in place because replacing the inode would break the shared hard link.

The tool also catches two common copying mistakes:

- If a submitted line such as `2│const b = 2;` matches a displayed live row, the tool rejects it. The model should submit only `const b = 2;`.
- If replacement content repeats the surviving line immediately before or after the range, the tool keeps the submitted content exactly as written but emits `W_DUP`.

Here is the safety idea again, from the filesystem's point of view: line numbers are accepted only together with evidence of the exact path and bytes that gave those numbers meaning.

## What the snapshot does not guarantee

A snapshot is a concurrency guard. It is not a lock, permission credential, or authorization token.

The 128-bit digest makes accidental collision negligible for this use, but no finite digest is mathematically collision-free. An external process can also write after the final validation and race with this tool. The per-file queue coordinates pi tools that use the queue; it cannot control every process on the machine.

Files are limited to 100 megabytes (MB). A replacement result is limited to 1,000,000 lines.

## Automatic reads after an edit

After a successful write, the result includes the next snapshot. Automatic read is enabled by default.

Instead of returning one large block from the first changed line to the last changed line, automatic read returns separate windows around changed regions. Each window can include up to 32 lines of context before and after the change. Overlapping windows are merged.

Output has a hard cap of 2,000 lines or 50 kilobytes (KB), whichever is reached first. If that cap hides a changed region, the output says which region was omitted. The model can then request that area explicitly.

Use `/toggle-auto-read` to turn this behavior on or off.

## Text and file behavior

### UTF-8 and byte order marks

UTF-8 is the Unicode text encoding used by the tool. A UTF-8 byte order mark is preserved.

If a file contains invalid UTF-8, `read` displays the invalid bytes as U+FFFD, the Unicode replacement character `�`. If an actual edit is made, the file is rewritten as valid UTF-8 and the result includes a warning.

### Line endings

The tool handles both common line-ending styles:

- line feed (LF), commonly used on Unix-like systems; and
- carriage return plus line feed (CRLF), commonly used on Windows.

The content is normalized internally while edits are calculated. If a file mixes line-ending styles, an actual edit normalizes the file to the first detected style and emits `W_MIXED_EOL`.

### Images and binary files

JPEG, PNG, GIF, and WebP images retain pi's image-reading behavior. Other binary files and directories are rejected instead of being interpreted as editable text.

## Installation

Install the package from npm, the Node Package Manager registry:

```bash
pi install npm:pi-linehash-edit
```

When a session starts, the extension replaces pi's `read` tool, registers `replace`, and disables pi's built-in `edit` tool.

## Configuration

The `/toggle-auto-read` command persists one setting:

```json
{
  "autoRead": true
}
```

The configuration file is stored at:

```text
~/.config/pi-linehash-edit/config.json
```

## Development

Development requires Node.js 22.

```bash
npm ci
npm run prepublishOnly
```

`npm ci` installs the exact dependency versions recorded by the project. `npm run prepublishOnly` runs the release gate: TypeScript type checking, ESLint static analysis, and the protocol test suite.

## Evidence and references

- Can Bölük, [“We improved 15 LLMs at coding in one afternoon. Only the harness changed.”](https://stencil.so/blog/the-harness-problem) supplies the external harness benchmark and its methodology.
- [Aider's edit-format benchmarks](https://aider.chat/docs/more/edit-formats.html) show that format performance depends on the model.
- JetBrains' [Diff-XYZ](https://arxiv.org/abs/2510.12487) reports that no single edit representation dominates every model and use case.
- [CodeEditorBench](https://arxiv.org/abs/2404.03543) provides broader code-editing evaluation context.
- Kung and Robinson's work on [optimistic concurrency control](https://mwhittaker.github.io/papers/html/kung1981optimistic.html) describes the read, validate, and write model behind snapshot rejection.

## License

This project is licensed under the [MIT License](LICENSE).
