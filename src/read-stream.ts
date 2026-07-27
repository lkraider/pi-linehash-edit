import { readChecksum } from "./checksum";
import { classifyBytes, type SniffedKind } from "./file-kind";
import { analyzeEndings, stripBOM } from "./replace-diff";
import { visLines } from "./utils";

export interface StreamedWindow { totalLines: number; selectedLines: string[]; checksum: string; hadUtf8DecodeErrors: boolean; kind: SniffedKind }

export async function streamReadWindow(path: string, startLine: number, limit?: number, signal?: AbortSignal): Promise<StreamedWindow> {
  const observed = await readChecksum(path, undefined, signal);
  const kind = await classifyBytes(observed.raw);
  let hadUtf8DecodeErrors = false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(observed.raw); } catch { hadUtf8DecodeErrors = true; }
  const decoded = new TextDecoder("utf-8", { ignoreBOM: true }).decode(observed.raw);
  const lines = visLines(analyzeEndings(stripBOM(decoded).text).normalized);
  const end = limit === undefined ? lines.length : startLine - 1 + limit;
  return { totalLines: lines.length, selectedLines: lines.slice(startLine - 1, end), checksum: observed.checksum, hadUtf8DecodeErrors, kind };
}
