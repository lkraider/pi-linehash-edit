import { describe, it, expect } from "vitest";
import { _lineHashesPure } from "../../src/hashline";
import { MAX_HASH_LINES } from "../../src/constants";

describe("invariant: a file within the advertised MAX_HASH_LINES cap must hash successfully", () => {
  it("hashes a file smaller than 1/3 of the declared line limit without exhausting the hash space", () => {
    const n = 262_145;
    expect(n).toBeLessThan(MAX_HASH_LINES);
    const content = Array.from({ length: n }, (_, i) => `line${i}`).join("\n");

    const hashes = _lineHashesPure(content);

    expect(hashes).toHaveLength(n);
    expect(new Set(hashes).size).toBe(n);
  }, 20_000);
});
