## Destination

The `replace` tool pipeline is changed in place so that every edit the LLM makes is structurally assertive — the tool prevents structural breakage at the protocol level, block moves are a single atomic operation, and dead code is removed. Token economy improves as a consequence of fewer round-trips and less rework.

## Notes

- Domain: TypeScript extension for pi-coding-agent's hashline read/replace tool
- Skills per session: domain-modeling, grill-me
- Standing preferences: code is truth; legacy code is waste unless it earns its weight; never overengineer
- Every change ships as a clear upstream issue + separate PR, with reasoning linked to the decision ticket
- Three imperatives govern every decision:
  1. Fewest tokens per edit
  2. Edits never break files / cause rework
  3. Less code = low overhead, low bugs, more performance. New code must add value on rules 1 or 2.

## Decisions so far

- [Boundary-duplication auto-fix: remove, narrow, or warn?](./tickets/001-boundary-autofix.md) — **Replace silent auto-fix with terse `[W_DUP]` warning.** Upstream rationale (issues #6, commits d96f073→0d84b24→b14ac17): LLMs duplicated closing delimiters at range boundaries; warnings were ignored; silent auto-fix was the compromise. But the auto-fix can't distinguish coincidental structural matches from genuine duplicates, and silent stripping causes invisible breakage (rule 2). Detection stays; auto-fix/splice/re-validate code removed; warning is one terse line; prompt guidelines sharpened. Net code reduction.
- [Atomic block move: minimal design](./tickets/002-atomic-move.md) — **Teach the bulk-mode pattern, no new code.** Bulk mode already supports moves atomically: delete source + insert at target in one `changes` array, validated against one snapshot. Add a "Moving blocks" section to the tool prompts/guidelines with the two-change pattern. Zero new code (rule 3), one call instead of two (rule 1), no shifting ground (rule 2).
- [Undo: cut or keep?](./tickets/003-undo-cut.md) — **Cut.** Upstream (RimuruW) has no undo; it was added opportunistically in this fork. Zero issues/PRs about it, zero observed LLM usage, zero bugs filed. It contributes to hash-store concurrency problems (issue #10). 120 lines source + 316 lines tests + 3 prompt files. Fails all three rules: burns tokens (rule 1), doesn't prevent breakage (rule 2 — after-the-fact), dead code (rule 3). Recovery via git or session replay.

## Not yet specified

- Structural balance checking (post-edit validation) — handoff report suggestion. The `[W_DUP]` warning and move-pattern teaching are prevention-first; post-hoc structural checking remains unnecessary. Revisit only if the warning approach proves insufficient in practice.

## Out of scope

- Multi-step undo — handoff report suggestion; moot: undo cut entirely
- Dry-run/preview mode — handoff report suggestion; separate concern, not on this route
- Auto-read changes — auto-read is a token multiplier, not an assertivity lever
