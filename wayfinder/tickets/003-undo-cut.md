## Question

`undo_last_replace` provides single-level undo per file, in-memory (lost on session end). It includes tool registration, prompt templates, ~120 lines of logic, and integration in the replace pipeline (saveUndo call).

The LLM has never been observed invoking it. The human *might* use it via the TUI, but there's no evidence of that either.

The three imperatives:
- Rule 3 (less code): dead code is waste. Cut it.
- Rule 2 (no breakage): undo is a recovery mechanism — it could prevent rework if the LLM learned to use it. But it hasn't.
- Rule 1 (fewest tokens): the tool description and prompt guidelines consume context tokens every session.

Should `undo_last_replace` be removed from the extension?

## Resolution

**Cut.**

### Evidence

**Upstream (RimuruW/pi-hashline-edit):** No undo — it was added opportunistically in this fork.

**This repo (YuGiMob/pi-hashline-edit-pro):**
- 2 commits ever touched undo: initial add (`ccd570c`) and rename (`9cb5c3c`)
- Zero issues filed about undo — no bugs, no feature requests, no user demand
- Zero PRs — no community contribution
- Issue #10 (concurrent hash-store loss) identifies undo as a complicating factor: *"Undo has another independent load-modify-save path"*
- Zero observed LLM invocations across all usage

**Code weight:** 120 lines source (`src/replace-undo.ts`), 316 lines tests, 3 prompt files (587 bytes), 2 integration points (`replace.ts`, `index.ts`), 1 line in replace prompt.

### Decision

Remove entirely:
- Delete `src/replace-undo.ts`
- Delete `test/tools/replace-undo.test.ts`
- Delete 3 prompt files (`undo-last-replace*.md`)
- Remove `import { regReplaceUndo }` and `regReplaceUndo(pi)` from `index.ts`
- Remove `import { saveUndo }` and `saveUndo(...)` call from `replace.ts`
- Remove "Recovery: call undo_last_replace..." line from replace prompt

### Rationale against the three imperatives

- **Rule 3:** dead code removed. Net reduction of 436+ lines.
- **Rule 2:** recovery still exists via `git checkout` or session replay. Undo was single-level, in-memory, lost on session restart — not a robust safety net.
- **Rule 1:** replace prompt shortens by one line; 3 prompt files removed from context.

`undo_last_replace` provides single-level undo per file, in-memory (lost on session end). It includes tool registration, prompt templates, ~60 lines of logic, and integration in the replace pipeline (saveUndo call).

The LLM has never been observed invoking it. The human *might* use it via the TUI, but there's no evidence of that either.

The three imperatives:
- Rule 3 (less code): dead code is waste. Cut it.
- Rule 2 (no breakage): undo is a recovery mechanism — it could prevent rework if the LLM learned to use it. But it hasn't.
- Rule 1 (fewest tokens): the tool description and prompt guidelines consume context tokens every session.

Should `undo_last_replace` be removed from the extension?
