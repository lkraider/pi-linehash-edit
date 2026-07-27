# AGENTS.md

Use grunt caveman lang, few word do trick. Sacrifice gramatic for brevity. Be direct.

## Maxims

1. **Token economy.** Use as few tokens as possible for any edit. Every round-trip, every verbose response, every unnecessary tool call burns context. Fewest tokens wins.

2. **No breakage, no rework.** Edits must be consistent and not break files or the repo. A broken edit causes rework, which violates rule 1. The tool should prevent mistakes at the protocol level — don't allow the LLM to make them in the first place.

3. **Less code, more performance.** Less code means lower overhead, fewer bugs, higher performance. New code must earn its weight by adding value on rules 1 or 2. Always as optimized as possible, never overengineered. Legacy code that doesn't carry its weight is waste.

4. **Protocol breakage has no consequence.** Never preserve model-facing wire compatibility. Change fields, prefixes, errors, and formats whenever the current protocol improves. No legacy adapters or major-version ceremony.

## Direction

The raw hash algorithm carries the weight. Everything else — persistence, caching, stability mapping — is a thin, disposable layer on top. When a layer's job can be done by a plain data structure (a `Map`, a string compare), it should be.

- **Low level over abstraction.** Prefer a raw function over a wrapped one, sync over async where nothing is actually asynchronous, in-memory over on-disk where nothing needs to survive the process.
- **No decision docs.** Why code exists (or doesn't) lives in the commit message that changed it, or a one-line comment where the non-obvious constraint would otherwise be invisible. No ticket files, no ADRs, no wayfinder. `git log` is the record of the road not taken.
- **Tests are brutal, not nice.** A test exists because something can break; if nothing can break there, no test. Fast: no sleeps, no incidental I/O, no scaffolding beyond what the assertion needs.
