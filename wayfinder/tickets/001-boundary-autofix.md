## Question

The boundary-duplication auto-fix in `src/hashline/resolve.ts` (`checkBoundaryDup`) silently strips the last line of `content_lines` when it matches the next surviving line outside the replaced range (and the first line when it matches the preceding line). This was designed to catch an LLM pattern of accidentally duplicating closing delimiters.

But for structural delimiters alone on a line — `}`, `</div>`, `)`, `]`, `});` — this auto-fix fires deterministically when two blocks close at the same indent level. The model correctly includes `}` to close a block; the next line after the range is also `}`; the tool silently removes it. Result: missing closer, broken structure.

The three imperatives pull in different directions:
- Rule 2 (no breakage): the auto-fix *causes* breakage for structural lines. Remove it.
- Rule 1 (fewest tokens): removing it means the LLM's genuine duplicates now land in the file, requiring rework (more tokens). Keep it or warn.
- Rule 3 (less code): removing it deletes code. Narrowing it adds code (language-aware structural detection). Warning it keeps roughly the same code volume.

What should happen to the boundary-duplication auto-fix?

## Resolution

**Replace silent auto-fix with terse `[W_DUP]` warning.**

### Upstream research

The feature lineage in the upstream repo (YuGiMob/pi-hashline-edit-pro):

1. **`d96f073`** — Original fix: *warn* on boundary duplication. Previously the regex required alphanumeric characters, so `}`, `});`, `} else {` never triggered. Removed regex restriction, made it warn. Duplicate stays; LLM sees warning and self-corrects.
2. **`0d84b24`** — Switched from warning to *silent auto-fix*. Rationale: "models either ignoring boundary duplication warnings or overreacting by undoing the entire edit." The duplicate line is stripped from content_lines before applying; model sees a normal success.
3. **`b14ac17`** — Bug fix (issue #6): auto-fix used last element of content_lines instead of last non-empty line, missing duplicates when trailing empty lines existed. Fixed to use `lastNonEmpty`.

### Decision

The silent auto-fix cannot distinguish coincidental structural matches (two different `}` blocks at same indent) from genuine duplicates (model accidentally including a `}` that survives outside the range). The string comparison is identical for both cases.

- **Remove:** auto-fix logic in `applyEdits` (deep-copy, splice, re-validate), `AutoFix` type, `fmtBoundaryWarning`
- **Keep:** `checkBoundaryDup` detection (~15 lines)
- **Add:** conversion to terse `[W_DUP]` warning appended to response's warnings array
- **Sharpen:** prompt guidelines to make boundary-checking a prominent rule

### Rationale against the three imperatives

- **Rule 2 (no breakage):** warning never silently alters structure; duplicate stays visible, model alerted
- **Rule 1 (token economy):** ~1 line warning output; prompt guidance prevents most occurrences
- **Rule 3 (less code):** net code reduction (auto-fix+splice+revalidate removed, detection kept, warning added)

The boundary-duplication auto-fix in `src/hashline/resolve.ts` (`checkBoundaryDup`) silently strips the last line of `content_lines` when it matches the next surviving line outside the replaced range (and the first line when it matches the preceding line). This was designed to catch an LLM pattern of accidentally duplicating closing delimiters.

But for structural delimiters alone on a line — `}`, `</div>`, `)`, `]`, `});` — this auto-fix fires deterministically when two blocks close at the same indent level. The model correctly includes `}` to close a block; the next line after the range is also `}`; the tool silently removes it. Result: missing closer, broken structure.

The three imperatives pull in different directions:
- Rule 2 (no breakage): the auto-fix *causes* breakage for structural lines. Remove it.
- Rule 1 (fewest tokens): removing it means the LLM's genuine duplicates now land in the file, requiring rework (more tokens). Keep it or warn.
- Rule 3 (less code): removing it deletes code. Narrowing it adds code (language-aware structural detection). Warning it keeps roughly the same code volume.

What should happen to the boundary-duplication auto-fix?
