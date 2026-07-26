import { createReadStream } from "fs";
import { open as fsOpen } from "fs/promises";
import { createInterface } from "readline";
import { DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { hashDigitsFor, lineHash } from "./hashline/hash";
import { abortIf } from "./utils";

export interface StreamedWindow {
  totalLines: number;
  selectedLines: string[];
  selectedHashes: string[];
}

async function endsWithLineBreak(absolutePath: string): Promise<boolean> {
  const handle = await fsOpen(absolutePath, "r");
  try {
    const { size } = await handle.stat();
    if (size === 0) return false;
    const buffer = Buffer.alloc(1);
    await handle.read(buffer, 0, 1, size - 1);
    return buffer[0] === 0x0a || buffer[0] === 0x0d;
  } finally {
    await handle.close();
  }
}

async function collectWindow(
  absolutePath: string,
  startLine: number,
  windowEnd: number,
  signal: AbortSignal | undefined,
): Promise<{ visibleLineCount: number; selectedLines: string[] }> {
  const stream = createReadStream(absolutePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const selectedLines: string[] = [];
  let lineNo = 0;
  try {
    for await (const rawLine of rl) {
      abortIf(signal);
      lineNo++;
      const line =
        lineNo === 1 && rawLine.startsWith("﻿") ? rawLine.slice(1) : rawLine;
      if (lineNo >= startLine && lineNo <= windowEnd) {
        selectedLines.push(line);
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return { visibleLineCount: lineNo, selectedLines };
}

export async function streamReadWindow(
  absolutePath: string,
  startLine: number,
  limit: number | undefined,
  signal?: AbortSignal,
): Promise<StreamedWindow> {
  const windowCap = limit ?? DEFAULT_MAX_LINES;
  const windowEnd = startLine - 1 + windowCap;

  const [{ visibleLineCount, selectedLines }, hasTrailingLineBreak] = await Promise.all([
    collectWindow(absolutePath, startLine, windowEnd, signal),
    endsWithLineBreak(absolutePath),
  ]);

  const splitLineCount = visibleLineCount + (hasTrailingLineBreak ? 1 : 0);
  const digits = hashDigitsFor(splitLineCount);
  const selectedHashes = selectedLines.map((line) => lineHash(line, digits));

  return { totalLines: visibleLineCount, selectedLines, selectedHashes };
}
