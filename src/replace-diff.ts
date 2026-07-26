import * as Diff from "diff";
import {
  lineHashes,
  HASH_SEP,
} from "./hashline";

export function detectEnding(content: string): "\r\n" | "\n" {
  const crlfIdx = content.indexOf("\r\n");
  const lfIdx = content.indexOf("\n");
  if (lfIdx === -1 || crlfIdx === -1) return "\n";
  return crlfIdx < lfIdx ? "\r\n" : "\n";
}

export function toLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreEndings(
  text: string,
  ending: "\r\n" | "\n",
): string {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

export function stripBOM(content: string): { bom: string; text: string } {
  return content.startsWith("\uFEFF")
    ? { bom: "\uFEFF", text: content.slice(1) }
    : { bom: "", text: content };
}

function anchorAt(hashes: string[], line: number): string | undefined {
  const hash = hashes[line - 1];
  return hash === undefined ? undefined : `${line}${hash}`;
}

function fmtDiffLine(
  prefix: " " | "+" | "-",
  line: string,
  anchor: string | undefined,
): string {
  if (anchor === undefined) {
    return `${prefix}${line}`;
  }
  return `${prefix}${anchor}${HASH_SEP}${line}`;
}

const ELLIPSIS = "__ELLIPSIS__";

type ContextWindow = { linesToShow: string[]; skipStart: number; skipMiddle: number };

function windowContext(
  displayLines: string[],
  afterChange: boolean,
  beforeChange: boolean,
  contextLines: number,
): ContextWindow {
  if (!afterChange) {
    const skipStart = Math.max(0, displayLines.length - contextLines);
    return { linesToShow: displayLines.slice(skipStart), skipStart, skipMiddle: 0 };
  }
  if (beforeChange && displayLines.length > contextLines * 2) {
    const tail = displayLines.slice(-contextLines);
    const linesToShow = [...displayLines.slice(0, contextLines), ELLIPSIS, ...tail];
    return { linesToShow, skipStart: 0, skipMiddle: displayLines.length - contextLines * 2 };
  }
  if (displayLines.length > contextLines) {
    return { linesToShow: displayLines.slice(0, contextLines), skipStart: 0, skipMiddle: 0 };
  }
  return { linesToShow: displayLines, skipStart: 0, skipMiddle: 0 };
}

function emitChangeLines(
  output: string[],
  displayLines: string[],
  added: boolean,
  hashes: string[],
  newLineNum: number,
): number {
  for (const line of displayLines) {
    if (added) {
      output.push(fmtDiffLine("+", line, anchorAt(hashes, newLineNum)));
      newLineNum++;
    } else {
      output.push(fmtDiffLine("-", line, undefined));
    }
  }
  return newLineNum;
}

function emitContextLines(
  output: string[],
  window: ContextWindow,
  hashes: string[],
  newLineNum: number,
): number {
  if (window.skipStart > 0) {
    output.push(" ...");
    newLineNum += window.skipStart;
  }
  for (const line of window.linesToShow) {
    if (line === ELLIPSIS) {
      output.push(" ...");
      newLineNum += window.skipMiddle;
      continue;
    }
    output.push(fmtDiffLine(" ", line, anchorAt(hashes, newLineNum)));
    newLineNum++;
  }
  return newLineNum;
}

export function genDiff(
  oldContent: string,
  newContent: string,
  contextLines = 2,
  newContentHashes?: string[],
  _oldHashes?: string[],
): { diff: string; firstChangedLine: number | undefined } {
  const effectiveNewHashes = newContentHashes ?? lineHashes(newContent);

  const parts = Diff.diffLines(oldContent, newContent);
  const output: string[] = [];
  let newLineNum = 1;
  let lastWasChange = false;
  let firstChangedLine: number | undefined;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const raw = part.value.split("\n");
    if (raw[raw.length - 1] === "") raw.pop();
    const displayLines = raw;

    if (part.added || part.removed) {
      if (firstChangedLine === undefined) firstChangedLine = newLineNum;
      newLineNum = emitChangeLines(output, displayLines, !!part.added, effectiveNewHashes, newLineNum);
      lastWasChange = true;
      continue;
    }

    const nextPartIsChange =
      i < parts.length - 1 && (parts[i + 1]!.added || parts[i + 1]!.removed);
    if (lastWasChange || nextPartIsChange) {
      const window = windowContext(displayLines, lastWasChange, nextPartIsChange, contextLines);
      newLineNum = emitContextLines(output, window, effectiveNewHashes, newLineNum);
    } else {
      newLineNum += displayLines.length;
    }
    lastWasChange = false;
  }

  return { diff: output.join("\n"), firstChangedLine };
}
