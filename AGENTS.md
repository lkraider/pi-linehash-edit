# AGENTS.md

## Maxims

1. **Token economy.** Use as few tokens as possible for any edit. Every round-trip, every verbose response, every unnecessary tool call burns context. Fewest tokens wins.

2. **No breakage, no rework.** Edits must be consistent and not break files or the repo. A broken edit causes rework, which violates rule 1. The tool should prevent mistakes at the protocol level — don't allow the LLM to make them in the first place.

3. **Less code, more performance.** Less code means lower overhead, fewer bugs, higher performance. New code must earn its weight by adding value on rules 1 or 2. Always as optimized as possible, never overengineered. Legacy code that doesn't carry its weight is waste.
