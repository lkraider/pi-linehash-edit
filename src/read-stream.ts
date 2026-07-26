import { createReadStream } from "fs";
import { open as fsOpen, type FileHandle } from "fs/promises";
import { createInterface } from "readline";
import { DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { hashDigitsFor, lineHash } from "./hashline/hash";
import { abortIf } from "./utils";

export interface StreamedWindow {
  totalLines: number;
  selectedLines: string[];
  selectedHashes: string[];
}

// Explicit-position read (pread) — does not touch the fd's shared sequential
// offset, so this is safe to run concurrently with collectWindow's stream on
// the same fd.
async function trailingByte(
  handle: FileHandle,
  size: number,
): Promise<number | undefined> {
  if (size === 0) return undefined;
  const buffer = Buffer.alloc(1);
  await handle.read(buffer, 0, 1, size - 1);
  return buffer[0];
}

async function collectWindow(
  absolutePath: string,
  handle: FileHandle,
  startLine: number,
  windowEnd: number,
  signal: AbortSignal | undefined,
): Promise<{
  visibleLineCount: number;
  selectedLines: string[];
  firstLineWasBomOnly: boolean;
}> {
  // fd option + no `start`: reads sequentially from the fd's live offset,
  // ignoring `absolutePath` (required by the type, but overridden by `fd`),
  // without opening a second, independently-racing file handle.
  const stream = createReadStream(absolutePath, {
    fd: handle.fd,
    autoClose: false,
    encoding: "utf8",
  });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const selectedLines: string[] = [];
  let lineNo = 0;
  let firstLineHadBom = false;
  let firstLineStrippedEmpty = false;
  try {
    for await (const rawLine of rl) {
      abortIf(signal);
      lineNo++;
      let line = rawLine;
      if (lineNo === 1 && rawLine.startsWith("﻿")) {
        line = rawLine.slice(1);
        firstLineHadBom = true;
        firstLineStrippedEmpty = line === "";
      }
      if (lineNo >= startLine && lineNo <= windowEnd) {
        selectedLines.push(line);
      }
    }
  } finally {
    rl.close();
  }

  return {
    visibleLineCount: lineNo,
    selectedLines,
    firstLineWasBomOnly: lineNo === 1 && firstLineHadBom && firstLineStrippedEmpty,
  };
}

export async function streamReadWindow(
  absolutePath: string,
  startLine: number,
  limit: number | undefined,
  signal?: AbortSignal,
): Promise<StreamedWindow> {
  const windowCap = limit ?? DEFAULT_MAX_LINES;
  const windowEnd = startLine - 1 + windowCap;

  const handle = await fsOpen(absolutePath, "r");
  try {
    const { size } = await handle.stat();
    const [{ visibleLineCount, selectedLines, firstLineWasBomOnly }, trailing] =
      await Promise.all([
        collectWindow(absolutePath, handle, startLine, windowEnd, signal),
        trailingByte(handle, size),
      ]);

    const hasTrailingLineBreak = trailing === 0x0a || trailing === 0x0d;
    // A file containing only a BOM (no trailing line break) has no content,
    // same as the whole-file path's stripBOM + visLines("") special case.
    const isEmptyAfterBom = firstLineWasBomOnly && !hasTrailingLineBreak;

    const totalLines = isEmptyAfterBom ? 0 : visibleLineCount;
    const finalSelectedLines = isEmptyAfterBom ? [] : selectedLines;

    const splitLineCount = totalLines + (hasTrailingLineBreak ? 1 : 0);
    const digits = hashDigitsFor(splitLineCount);
    const selectedHashes = finalSelectedLines.map((line) => lineHash(line, digits));

    return { totalLines, selectedLines: finalSelectedLines, selectedHashes };
  } finally {
    await handle.close();
  }
}
