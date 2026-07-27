export function isRec(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}


export function visLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  return text.endsWith("\n") ? lines.slice(0, -1) : lines;
}

export function visLineCount(text: string): number {
  if (text.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  return text.endsWith("\n") ? count - 1 : count;
}


export function rejectUnknownFields(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
  hint?: string,
): void {
  const unknown = Object.keys(obj).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    const suffix = hint ? ` ${hint}` : "";
    throw new Error(
      `[E_BAD_SHAPE] ${label} contains unknown or unsupported fields: ${unknown.join(", ")}.${suffix}`,
    );
  }
}


export function abortIf(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Operation aborted");
}

export function errCode(error: unknown): string | undefined {
	if (error instanceof Error) {
		return (error as NodeJS.ErrnoException).code;
	}
	return undefined;
}

export function lastNonEmpty(lines: string[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i]!.length) return lines[i];
}

export function firstNonEmpty(lines: string[]): string | undefined {
  return lines.find(line => line.length > 0);
}
