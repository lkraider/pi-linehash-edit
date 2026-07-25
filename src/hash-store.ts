export interface HashSnapshot {
  content: string;
  hashes: string[];
}

export interface HashStore {
  readonly cache: Map<string, HashSnapshot>;
}

const cache = new Map<string, HashSnapshot>();

export function loadHashStore(): HashStore {
  return { cache };
}

export function shutdownHashStore(): void {
  cache.clear();
}

export function getSnapshot(
  store: HashStore,
  path: string,
  content: string,
): string[] | undefined {
  const entry = store.cache.get(path);
  return entry && entry.content === content ? entry.hashes : undefined;
}

export function upsertSnapshot(
  store: HashStore,
  path: string,
  content: string,
  hashes: string[],
): void {
  store.cache.set(path, { content, hashes });
}

export function deleteSnapshot(store: HashStore, path: string): void {
  store.cache.delete(path);
}
