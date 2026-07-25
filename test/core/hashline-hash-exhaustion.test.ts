import { describe, it, expect } from "vitest";
import { _lineHashesPure } from "../../src/hashline";
import { MAX_HASH_LINES } from "../../src/constants";

describe("adversarial: hash space exhausts far below the stated MAX_HASH_LINES cap", () => {
  it("throws an unstructured error on a file smaller than 1/3 of the declared line limit", () => {
    const n = 262_145;
    expect(n).toBeLessThan(MAX_HASH_LINES);
    const content = Array.from({ length: n }, (_, i) => `line${i}`).join("\n");

    let thrown: unknown;
    try {
      _lineHashesPure(content);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/Hash space exhausted/);
    expect((thrown as Error).message).not.toMatch(/^\[E_/);
  }, 20_000);
});
