import { open as fsOpen, stat as fsStat } from "fs/promises";
import { SNIFF_BYTES } from "./constants";

export type SniffedKind = { kind: "directory" } | { kind: "image"; mimeType: string } | { kind: "text" };

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (bytes: Uint8Array, offset: number, text: string): boolean => {
  for (let i = 0; i < text.length; i++) if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  return true;
};

// Images are the only content we must recognize: they route to the host image reader and are rejected
// for edits. Everything else is text — the decoder tolerates arbitrary bytes, matching the host read
// tool, which also treats non-images (NUL bytes and all) as lossy UTF-8 text.
function imageMime(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (PNG.every((byte, i) => bytes[i] === byte)) return "image/png";
  if (ascii(bytes, 0, "GIF")) return "image/gif";
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return "image/webp";
  if (ascii(bytes, 0, "BM")) return "image/bmp";
  return undefined;
}

export function classifyBytes(bytes: Uint8Array): SniffedKind {
  const mimeType = imageMime(bytes.subarray(0, SNIFF_BYTES));
  return mimeType ? { kind: "image", mimeType } : { kind: "text" };
}

export async function sniffKind(filePath: string): Promise<SniffedKind> {
  const stat = await fsStat(filePath);
  if (stat.isDirectory()) return { kind: "directory" };
  if (!stat.isFile()) throw new Error(`Not a regular file: ${filePath}.`); // avoid blocking on fifos/devices
  const handle = await fsOpen(filePath, "r");
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    return classifyBytes(buffer.subarray(0, bytesRead));
  } finally { await handle.close(); }
}
