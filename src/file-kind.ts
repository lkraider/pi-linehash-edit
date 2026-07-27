import { open as fsOpen, stat as fsStat } from "fs/promises";
import { fileTypeFromBuffer } from "file-type";
import { SNIFF_BYTES, MAX_BYTES } from "./constants";

const IMG_TYPES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const TEXT_TYPES = new Set<string>([
  "application/rtf",
  "application/xml",
  "application/x-ms-regedit",
]);

function isTextType(mimeType: string): boolean {
  return mimeType.startsWith("text/") || TEXT_TYPES.has(mimeType);
}


export type SniffedKind =
  | { kind: "directory" }
  | { kind: "image"; mimeType: string }
  | { kind: "binary"; description: string }
  | { kind: "text" };

type PreStatVerdict = { kind: "directory" } | { kind: "binary"; description: string };

function statGate(pathStat: { isDirectory(): boolean; isFile(): boolean; size: number }): PreStatVerdict | undefined {
  if (pathStat.isDirectory()) {
    return { kind: "directory" };
  }
  if (!pathStat.isFile()) {
    return { kind: "binary", description: "unsupported file type" };
  }
  if (pathStat.size > MAX_BYTES) {
    return { kind: "binary", description: `file exceeds ${MAX_BYTES} byte limit` };
  }
  return undefined;
}

type SampleVerdict = { kind: "image"; mimeType: string } | { kind: "binary"; description: string };

async function classifySample(sample: Buffer): Promise<SampleVerdict | undefined> {
  const detectedMimeType = (await fileTypeFromBuffer(sample))?.mime;
  if (detectedMimeType === undefined || isTextType(detectedMimeType)) {
    return undefined;
  }
  if (IMG_TYPES.has(detectedMimeType)) {
    return { kind: "image", mimeType: detectedMimeType };
  }
  return { kind: "binary", description: detectedMimeType };
}

export async function classifyBytes(bytes: Buffer): Promise<SniffedKind> {
  return (await classifySample(bytes.subarray(0, SNIFF_BYTES))) ?? { kind: "text" };
}

export async function sniffKind(filePath: string): Promise<SniffedKind> {
  const gated = statGate(await fsStat(filePath));
  if (gated) return gated;

  const fileHandle = await fsOpen(filePath, "r");
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await fileHandle.read(buffer, 0, SNIFF_BYTES, 0);
    if (bytesRead === 0) {
      return { kind: "text" };
    }

    const sample = buffer.subarray(0, bytesRead);
    return (await classifySample(sample)) ?? { kind: "text" };
  } finally {
    await fileHandle.close();
  }
}

