import { createHash, timingSafeEqual } from "node:crypto";
import { open } from "node:fs/promises";
import { resolveTarget } from "./fs-write";

const DOMAIN = Buffer.from("pi-linehash-edit\0snapshot-v2\0");
const SNAP_RE = /^s2:[A-Za-z0-9_-]{22}$/;

function field(value: Buffer): Buffer {
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(value.length));
  return Buffer.concat([length, value]);
}

export function snapshotTag(canonicalPath: string, raw: Uint8Array): string {
  const digest = createHash("sha256")
    .update(DOMAIN)
    .update(field(Buffer.from(canonicalPath)))
    .update(field(Buffer.from(raw)))
    .digest()
    .subarray(0, 16)
    .toString("base64url");
  return `s2:${digest}`;
}

export function assertSnapshot(value: unknown): asserts value is string {
  if (typeof value !== "string" || !SNAP_RE.test(value)) {
    throw new Error('[E_BAD_SNAPSHOT] "snapshot" must be s2: followed by exactly 22 base64url characters.');
  }
}

export function sameSnapshot(left: string, right: string): boolean {
  return SNAP_RE.test(left) && SNAP_RE.test(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export async function readSnapshot(path: string, canonicalPath?: string): Promise<{ canonicalPath: string; raw: Buffer; snapshot: string }> {
  const target = canonicalPath ?? await resolveTarget(path);
  for (let attempt = 0; attempt < 3; attempt++) {
    const handle = await open(target, "r");
    try {
      const before = await handle.stat({ bigint: true });
      const raw = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      if (before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs) {
        return { canonicalPath: target, raw, snapshot: snapshotTag(target, raw) };
      }
    } finally { await handle.close(); }
  }
  throw new Error(`[E_READ_RACE] ${path} changed repeatedly while being read; retry.`);
}
