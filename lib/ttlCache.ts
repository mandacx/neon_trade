/**
 * In-process TTL cache (per warm server instance) with in-flight de-duplication: concurrent misses for
 * the same key share one call instead of each running `fn`. `cacheIf` (default: always) decides whether
 * a value is kept; a rejected value is still returned. A failed call is not cached.
 */
const store = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export async function getOrSet<T>(key: string, ttlMs: number, fn: () => Promise<T>, cacheIf: (v: T) => boolean = () => true): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fn()
    .then(value => {
      if (cacheIf(value)) store.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** The cached value even if expired (for serving stale data while a refresh fails). */
export function peek<T>(key: string): T | undefined {
  return store.get(key)?.value as T | undefined;
}
