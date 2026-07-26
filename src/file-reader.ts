import { constants } from "fs";
import { stat } from "fs/promises";
import { lineHashes } from "./hashline";
import { loadFileKindAndText, type LFile } from "./file-kind";
import { resolveTarget } from "./fs-write";
import { toCwd } from "./paths";
import { analyzeEndings, stripBOM } from "./replace-diff";
import { abortIf, visLineCount } from "./utils";
import { validateKind, validateAccess } from "./validation";
export interface NormFile {
  absolutePath: string;
  normalized: string;
  bom: string;
  originalEnding: "\r\n" | "\n";
  fileHashes: string[];
  hadUtf8DecodeErrors: boolean;
  hadMixedEndings: boolean;
}

export type SnapInfo = {
  snapshotId: string;
  mtimeMs: number;
  size: number;
};

function fmtSnapId(canonicalPath: string, info: { mtimeMs: number; size: number }): string {
  return `v1|${canonicalPath}|${info.mtimeMs}|${info.size}`;
}

export async function fileSnap(absolutePath: string, resolvedPath?: string): Promise<SnapInfo> {
  const canonicalPath = resolvedPath ?? (await resolveTarget(absolutePath));
  const stats = await stat(canonicalPath);
  return {
    snapshotId: fmtSnapId(canonicalPath, stats),
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

export async function readNormFile(
  path: string,
  cwd: string,
  signal: AbortSignal | undefined,
  accessMode: number = constants.R_OK,
  preloadedFile?: LFile,
  maxLines?: number,
  resolvedAbsolutePath?: string,
): Promise<NormFile> {
  const absolutePath = toCwd(path, cwd);
  const resolvedPath = resolvedAbsolutePath ?? (await resolveTarget(absolutePath));

  abortIf(signal);
  await validateAccess(resolvedPath, path, accessMode);

  abortIf(signal);
  const file = preloadedFile ?? (await loadFileKindAndText(resolvedPath));
  validateKind(file, path);

  abortIf(signal);
  const { bom, text: rawContent } = stripBOM(file.text);
  const { normalized, originalEnding, hadMixedEndings } = analyzeEndings(rawContent);

  if (maxLines !== undefined) {
    const lineCount = visLineCount(normalized);
    if (lineCount > maxLines) {
      throw new Error(
        `[E_FILE_TOO_LARGE] ${path} has ${lineCount} lines, exceeding the ${maxLines}-line edit limit. Hashline editing targets source-sized files; for very large files use write or a non-line-based approach.`,
      );
    }
  }

  const fileHashes = lineHashes(normalized);
  return {
    absolutePath: resolvedPath,
    normalized,
    bom,
    originalEnding,
    fileHashes,
    hadUtf8DecodeErrors: file.hadUtf8DecodeErrors === true,
    hadMixedEndings,
  };
}
