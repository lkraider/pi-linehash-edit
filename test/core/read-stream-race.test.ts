import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm, writeFile, rename } from "fs/promises";
import { join } from "path";

// streamReadWindow now opens the file exactly once (a single shared fd used
// by both the line-counting stream and the trailing-byte pread) precisely to
// close this race: on POSIX, once open() has returned, the fd keeps
// referencing the original inode no matter what happens to the path
// afterward (rename-over — the same technique this repo's own writeAtomic
// uses — or an external editor's autosave). This mocks fs/promises so the
// replacement happens deterministically right after open() resolves,
// simulating "someone replaced the file the instant after we opened it,"
// rather than relying on winning a real race.
let onOpened: (() => Promise<void>) | undefined;

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const path = args[0];
      if (typeof path === "string" && path.endsWith("file.txt") && onOpened) {
        const hook = onOpened;
        onOpened = undefined;
        await hook();
      }
      return handle;
    },
  };
});

describe("streamReadWindow: file replaced immediately after its single open()", () => {
  it("does not corrupt the anchor hash width for the file actually being streamed", async () => {
    const { streamReadWindow } = await import("../../src/read-stream");
    const { hashDigitsFor, lineHash } = await import("../../src/hashline/hash");

    const dir = await mkdtemp("/tmp/pi-hashline-race-");
    try {
      const path = join(dir, "file.txt");
      const stagePath = join(dir, "file.txt.tmp");

      // 99 lines, no trailing newline: a genuine 4-digit-hash file.
      const lines = Array.from({ length: 99 }, (_, i) => `a${i + 1}`);
      const content = lines.join("\n");
      await writeFile(path, content, "utf-8");

      onOpened = async () => {
        await new Promise((r) => setTimeout(r, 50));
        // Replace with a file whose last byte is a newline, atomically,
        // exactly as writeAtomic does for every replace/write.
        await writeFile(stagePath, "x\n", "utf-8");
        await rename(stagePath, path);
      };

      const result = await streamReadWindow(path, 1, undefined);

      const correctDigits = hashDigitsFor(content.split("\n").length);
      const correctFirstHash = lineHash(lines[0]!, correctDigits);

      expect(result.selectedHashes[0]).toBe(correctFirstHash);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
