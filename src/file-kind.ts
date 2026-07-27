import { open as fsOpen, stat as fsStat } from "fs/promises";
import { createReadStream } from "fs";
import { fileTypeFromBuffer } from "file-type";
import { SNIFF_BYTES, MAX_BYTES } from "./constants";
import { abortIf } from "./utils";

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

export type LFile =
  | { kind: "directory" }
  | { kind: "image"; mimeType: string }
  | { kind: "text"; text: string; hadUtf8DecodeErrors?: true }
  | { kind: "binary"; description: string };

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

export async function detectUtf8DecodeErrors(
  filePath: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const fatalDecoder = new TextDecoder("utf-8", { fatal: true });
  const stream = createReadStream(filePath);
  let hadUtf8DecodeErrors = false;
  try {
    for await (const chunk of stream) {
      abortIf(signal);
      try {
        fatalDecoder.decode(chunk as Buffer, { stream: true });
      } catch (error: unknown) {
        if (error instanceof TypeError) {
          hadUtf8DecodeErrors = true;
          break;
        }
        throw error;
      }
    }
    if (!hadUtf8DecodeErrors) {
      try {
        fatalDecoder.decode();
      } catch (error: unknown) {
        if (error instanceof TypeError) {
          hadUtf8DecodeErrors = true;
        } else {
          throw error;
        }
      }
    }
  } finally {
    stream.destroy();
  }
  return hadUtf8DecodeErrors;
}

export async function loadFileKindAndText(
  filePath: string,
): Promise<LFile> {
  const gated = statGate(await fsStat(filePath));
  if (gated) return gated;

  const fileHandle = await fsOpen(filePath, "r");
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await fileHandle.read(
      buffer,
      0,
      SNIFF_BYTES,
      0,
    );
    if (bytesRead === 0) {
      return { kind: "text", text: "" };
    }

    const sample = buffer.subarray(0, bytesRead);
    const sniffed = await classifySample(sample);
    if (sniffed) return sniffed;

    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    const fatalDecoder = new TextDecoder("utf-8", { fatal: true });
    let hadUtf8DecodeErrors = false;
    const noteUtf8Err = (chunk?: Uint8Array): void => {
      if (hadUtf8DecodeErrors) return;
      try {
        fatalDecoder.decode(chunk, { stream: chunk !== undefined });
      } catch (error: unknown) {
        if (error instanceof TypeError) {
          hadUtf8DecodeErrors = true;
          return;
        }
        throw error;
      }
    };

    noteUtf8Err(sample);
    const parts: string[] = [decoder.decode(sample, { stream: true })];

    let position = bytesRead;
    while (true) {
      const { bytesRead: chunkBytesRead } = await fileHandle.read(
        buffer,
        0,
        SNIFF_BYTES,
        position,
      );
      if (chunkBytesRead === 0) {
        break;
      }

      const chunk = buffer.subarray(0, chunkBytesRead);
      noteUtf8Err(chunk);
      parts.push(decoder.decode(chunk, { stream: true }));
      position += chunkBytesRead;
    }
    noteUtf8Err();
    parts.push(decoder.decode());

    return {
      kind: "text",
      text: parts.join(""),
      ...(hadUtf8DecodeErrors ? { hadUtf8DecodeErrors: true as const } : {}),
    };
  } finally {
    await fileHandle.close();
  }
}
