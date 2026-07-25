import { describe, expect, it } from "vitest";

import {
  loadHashStore,
  shutdownHashStore,
  getSnapshot,
  upsertSnapshot,
  deleteSnapshot,
} from "../../src/hash-store";

describe("hash-store — snapshot get / upsert / delete", () => {
  it("round-trips a snapshot by path and content", () => {
    const store = loadHashStore();
    const content = "hello\nworld\n";
    const hashes = ["aB3", "xY7"];
    upsertSnapshot(store, "/path/to/file.ts", content, hashes);

    expect(getSnapshot(store, "/path/to/file.ts", content)).toEqual(hashes);
  });

  it("returns undefined when content changed", () => {
    const store = loadHashStore();
    upsertSnapshot(store, "/p.ts", "aaa\nbbb\n", ["A", "B"]);

    expect(getSnapshot(store, "/p.ts", "aaa\nbbb\n")).toEqual(["A", "B"]);
    expect(getSnapshot(store, "/p.ts", "aaa\nBBB\n")).toBeUndefined();
  });

  it("overwrites an existing path with new content+hashes", () => {
    const store = loadHashStore();
    upsertSnapshot(store, "/p2.ts", "old\n", ["O"]);
    upsertSnapshot(store, "/p2.ts", "new\n", ["N"]);

    expect(getSnapshot(store, "/p2.ts", "old\n")).toBeUndefined();
    expect(getSnapshot(store, "/p2.ts", "new\n")).toEqual(["N"]);
  });

  it("keeps unrelated snapshots intact when upserting another path", () => {
    const store = loadHashStore();
    const aContent = "a\nb\nc\nd\ne\n".repeat(50);
    const aHashes = aContent.split("\n").map((_, i) => `A${i}`);
    upsertSnapshot(store, "/big.ts", aContent, aHashes);
    upsertSnapshot(store, "/small.ts", "x\n", ["X"]);

    expect(getSnapshot(store, "/big.ts", aContent)).toEqual(aHashes);
    expect(getSnapshot(store, "/small.ts", "x\n")).toEqual(["X"]);
  });

  it("deletes a snapshot", () => {
    const store = loadHashStore();
    upsertSnapshot(store, "/p3.ts", "x\n", ["X"]);
    deleteSnapshot(store, "/p3.ts");
    expect(getSnapshot(store, "/p3.ts", "x\n")).toBeUndefined();
  });

  it("shutdown clears the cache", () => {
    const store = loadHashStore();
    upsertSnapshot(store, "/p4.ts", "x\n", ["X"]);
    shutdownHashStore();
    expect(getSnapshot(loadHashStore(), "/p4.ts", "x\n")).toBeUndefined();
  });
});
