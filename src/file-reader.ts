import { constants } from "node:fs";
import { readSnapshot } from "./snapshot";
import { classifyBytes } from "./file-kind";
import { MAX_BYTES } from "./constants";
import { toCwd } from "./paths";
import { analyzeEndings, stripBOM } from "./replace-diff";
import { abortIf, visLineCount } from "./utils";
import { validateAccess } from "./validation";

export interface NormFile {
  normalized: string;
  bom: string;
  originalEnding: "\r\n" | "\n";
  snapshot: string;
  hadUtf8DecodeErrors: boolean;
  hadMixedEndings: boolean;
}

export async function readNormFile(path: string, cwd: string, signal?: AbortSignal, accessMode = constants.R_OK, maxLines?: number, resolvedAbsolutePath?: string): Promise<NormFile> {
  const absolute = toCwd(path, cwd);
  const target = resolvedAbsolutePath;
  abortIf(signal);
  const observation = await readSnapshot(absolute, target);
  await validateAccess(observation.canonicalPath, path, accessMode);
  abortIf(signal);
  if (observation.raw.length > MAX_BYTES) throw new Error(`[E_FILE_TOO_LARGE] ${path} exceeds the ${MAX_BYTES}-byte edit limit.`);
  const kind = await classifyBytes(observation.raw);
  if (kind.kind !== "text") throw new Error(`Path is not a text file: ${path}.`);
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  const fatal = new TextDecoder("utf-8", { fatal: true });
  let hadUtf8DecodeErrors = false;
  try { fatal.decode(observation.raw); } catch { hadUtf8DecodeErrors = true; }
  const decoded = decoder.decode(observation.raw);
  const { bom, text } = stripBOM(decoded);
  const { normalized, originalEnding, hadMixedEndings } = analyzeEndings(text);
  if (maxLines !== undefined && visLineCount(normalized) > maxLines) throw new Error(`[E_FILE_TOO_LARGE] ${path} exceeds the ${maxLines}-line edit limit.`);
  return { normalized, bom, originalEnding, snapshot: observation.snapshot, hadUtf8DecodeErrors, hadMixedEndings };
}
