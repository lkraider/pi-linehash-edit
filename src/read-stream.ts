import { readChecksum } from "./checksum";
import { classifyBytes, type SniffedKind } from "./file-kind";
import { decodeNormalized } from "./replace-diff";
import { visLines } from "./utils";

export interface StreamedWindow { totalLines: number; selectedLines: string[]; checksum: string; hadUtf8DecodeErrors: boolean; kind: SniffedKind }

export async function streamReadWindow(path: string, startLine: number, limit?: number, signal?: AbortSignal): Promise<StreamedWindow> {
  const observed = await readChecksum(path, undefined, signal);
  const kind = await classifyBytes(observed.raw);
  const { normalized, hadUtf8DecodeErrors } = decodeNormalized(observed.raw);
  const lines = visLines(normalized);
  const end = limit === undefined ? lines.length : startLine - 1 + limit;
  return { totalLines: lines.length, selectedLines: lines.slice(startLine - 1, end), checksum: observed.checksum, hadUtf8DecodeErrors, kind };
}
