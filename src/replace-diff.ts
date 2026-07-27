import * as Diff from "diff";
import { MAX_DIFF_LINES } from "./constants";

export function shouldSkipDiff(oldLines: number, newLines: number): boolean { return oldLines > MAX_DIFF_LINES || newLines > MAX_DIFF_LINES; }
export function restoreEndings(text: string, ending: "\r\n" | "\n"): string { return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text; }
export function stripBOM(content: string): { bom: string; text: string } { return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content }; }
export interface EndingAnalysis { normalized: string; originalEnding: "\r\n" | "\n"; hadMixedEndings: boolean }
export function analyzeEndings(raw: string): EndingAnalysis {
  let first: "\r\n" | "\n" | undefined, crlf = false, lf = false, cr = false;
  const normalized = raw.replace(/\r\n|\r|\n/g, m => { if (m === "\r\n") { crlf = true; first ??= "\r\n"; } else if (m === "\n") { lf = true; first ??= "\n"; } else cr = true; return "\n"; });
  return { normalized, originalEnding: first ?? "\n", hadMixedEndings: cr || (crlf && lf) };
}
export function genDiff(oldContent: string, newContent: string, contextLines = 2): { diff: string; firstChangedLine: number | undefined } {
  const parts = Diff.diffLines(oldContent, newContent), out: string[] = [];
  let line = 1, firstChangedLine: number | undefined;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!, rows = part.value.split("\n");
    if (rows.at(-1) === "") rows.pop();
    if (part.added || part.removed) {
      firstChangedLine ??= line;
      for (const row of rows) { out.push(`${part.added ? `+${line}│` : "-"}${row}`); if (part.added) line++; }
      continue;
    }
    const shown = new Set<number>();
    if (i > 0 && (parts[i - 1]!.added || parts[i - 1]!.removed)) for (let n = 0; n < Math.min(contextLines, rows.length); n++) shown.add(n);
    if (i + 1 < parts.length && (parts[i + 1]!.added || parts[i + 1]!.removed)) for (let n = Math.max(0, rows.length - contextLines); n < rows.length; n++) shown.add(n);
    for (const n of [...shown].sort((a, b) => a - b)) out.push(` ${line + n}│${rows[n]}`);
    line += rows.length;
  }
  return { diff: out.join("\n"), firstChangedLine };
}
