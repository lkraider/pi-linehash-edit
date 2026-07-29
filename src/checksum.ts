import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { resolveTarget } from "./fs-write";
import { MAX_BYTES } from "./constants";
import { abortIf, errCode } from "./utils";

const DOMAIN = Buffer.from("pi-linehash-edit\0checksum-v1\0");
const CHECKSUM_RE = /^[A-Za-z0-9_-]{22}$/;

function length(value: Uint8Array): Buffer {
  const result = Buffer.allocUnsafe(8);
  result.writeBigUInt64BE(BigInt(value.byteLength));
  return result;
}

export function fileChecksum(canonicalPath: string, raw: Uint8Array): string {
  const path = Buffer.from(canonicalPath);
  return createHash("sha256")
    .update(DOMAIN)
    .update(length(path))
    .update(path)
    .update(length(raw))
    .update(raw)
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

export function assertChecksum(value: unknown): asserts value is string {
  if (typeof value !== "string" || !CHECKSUM_RE.test(value)) {
    throw new Error('[E_BAD_CHECKSUM] "checksum" must be exactly 22 base64url characters.');
  }
}

export async function readChecksum(path: string, canonicalPath?: string, signal?: AbortSignal): Promise<{ canonicalPath: string; raw: Buffer; checksum: string }> {
  const target = canonicalPath ?? await resolveTarget(path);
  for (let attempt = 0; attempt < 3; attempt++) {
    abortIf(signal);
    const handle = await open(target, "r");
    try {
      const before = await handle.stat({ bigint: true });
      if (before.size > BigInt(MAX_BYTES)) throw new Error(`[E_FILE_TOO_LARGE] ${path} exceeds the ${MAX_BYTES}-byte limit.`);
      const raw = await handle.readFile();
      if (raw.length > MAX_BYTES) throw new Error(`[E_FILE_TOO_LARGE] ${path} exceeds the ${MAX_BYTES}-byte limit.`);
      const after = await handle.stat({ bigint: true });
      let live;
      try { live = await stat(target, { bigint: true }); }
      catch (error) { if (errCode(error) === "ENOENT") continue; throw error; }
      abortIf(signal);
      if (before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs && after.dev === live.dev && after.ino === live.ino && after.size === live.size && after.mtimeNs === live.mtimeNs && after.ctimeNs === live.ctimeNs) {
        return { canonicalPath: target, raw, checksum: fileChecksum(target, raw) };
      }
    } finally { await handle.close(); }
  }
  throw new Error(`[E_READ_RACE] ${path} changed repeatedly while being read; retry.`);
}
