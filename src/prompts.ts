import { readFileSync } from "fs";

function applyReplacements(content: string, replacements?: Record<string, string>): string {
  if (replacements) for (const [key, value] of Object.entries(replacements)) content = content.split(`{{${key}}}`).join(value);
  return content;
}

export function loadP(relativePath: string, replacements?: Record<string, string>): string {
  return applyReplacements(readFileSync(new URL(relativePath, import.meta.url), "utf-8").trim(), replacements);
}

export function loadGuide(relativePath: string, replacements?: Record<string, string>): string[] {
  return applyReplacements(readFileSync(new URL(relativePath, import.meta.url), "utf-8"), replacements)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));
}
