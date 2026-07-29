import { MAX_DIFF_LINES } from "./constants";

export function shouldSkipDiff(oldLines: number, newLines: number): boolean { return oldLines > MAX_DIFF_LINES || newLines > MAX_DIFF_LINES; }
export function restoreEndings(text: string, ending: "\r\n" | "\n"): string { return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text; }
function stripBOM(content: string): { bom: string; text: string } { return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content }; }
interface EndingAnalysis { normalized: string; originalEnding: "\r\n" | "\n"; hadMixedEndings: boolean }
function analyzeEndings(raw: string): EndingAnalysis {
  let first: "\r\n" | "\n" | undefined, crlf = false, lf = false, cr = false;
  const normalized = raw.replace(/\r\n|\r|\n/g, m => { if (m === "\r\n") { crlf = true; first ??= "\r\n"; } else if (m === "\n") { lf = true; first ??= "\n"; } else cr = true; return "\n"; });
  return { normalized, originalEnding: first ?? "\n", hadMixedEndings: cr || (crlf && lf) };
}
export function decodeNormalized(raw: Buffer | Uint8Array): EndingAnalysis & { bom: string; hadUtf8DecodeErrors: boolean } {
  // Fatal decode doubles as the UTF-8 validity probe, so valid files decode once; only invalid
  // bytes cost the second, replacement-char pass. ignoreBOM leaves the BOM for stripBOM to handle.
  let decoded: string, hadUtf8DecodeErrors = false;
  try { decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw); }
  catch { hadUtf8DecodeErrors = true; decoded = new TextDecoder("utf-8", { ignoreBOM: true }).decode(raw); }
  const { bom, text } = stripBOM(decoded);
  return { ...analyzeEndings(text), bom, hadUtf8DecodeErrors };
}
