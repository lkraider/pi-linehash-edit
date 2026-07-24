## Question

A block move is logically one operation but requires two `replace` calls today: insert at target, then delete the source. Between calls, anchors shift (the stable hash mapping reassigns hashes for identical lines), so the second call often hits wrong lines or becomes a noop. The model also sometimes forgets the delete step entirely, leaving duplicates.

What is the minimal design for expressing "move this block there" as a single atomic operation?

Candidates to prototype:
- Extend `replace` with an optional `insert_after_hash` field — if present, the replaced range is moved (not deleted) to after that line
- A separate `replace_move` tool with `from_hash_range_inclusive`, `to_hash`, `path`
- Something even simpler?

The design must satisfy: single call, anchors evaluated against one pre-edit snapshot, no shifting ground.
