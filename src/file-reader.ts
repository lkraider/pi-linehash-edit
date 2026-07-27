import { constants } from "node:fs";
import { readChecksum } from "./checksum";
import { classifyBytes } from "./file-kind";
import { toCwd } from "./paths";
import { analyzeEndings, stripBOM } from "./replace-diff";
import { abortIf, visLineCount } from "./utils";
import { validateAccess } from "./validation";

export interface NormFile {
  normalized: string;
  bom: string;
  originalEnding: "\r\n" | "\n";
  checksum: string;
  hadUtf8DecodeErrors: boolean;
  hadMixedEndings: boolean;
}

export async function readNormFile(path: string, cwd: string, signal?: AbortSignal, accessMode = constants.R_OK, maxLines?: number, resolvedAbsolutePath?: string): Promise<NormFile> {
  const absolute = toCwd(path, cwd);
  abortIf(signal);
  const observation = await readChecksum(absolute, resolvedAbsolutePath, signal);
  await validateAccess(observation.canonicalPath, path, accessMode);
  abortIf(signal);
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
  return { normalized, bom, originalEnding, checksum: observation.checksum, hadUtf8DecodeErrors, hadMixedEndings };
}
