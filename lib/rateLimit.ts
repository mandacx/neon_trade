/**
 * Postgres-backed fixed-window rate limiter.
 *
 * Counters live in the DB rather than in memory because this app runs on Vercel
 * serverless: each instance has its own heap, so an in-process Map would give an
 * unpredictable effective limit and a scraper rotating across warm instances
 * would sail past it. One small upsert per gated request is the cost.
 *
 * Fixed window (not sliding): a caller can burst up to 2x the limit across a
 * window boundary. That's an accepted trade for a single round-trip and no
 * per-request row growth — this exists to stop bulk scraping of the level
 * archive, not to shape traffic precisely.
 */
import { sql } from '@/lib/db';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window resets — for the Retry-After header. */
  resetSeconds: number;
}

let tableReady = false;

/** Idempotent; the table is also created by scripts/bootstrap-app-tables.mjs — this is a fallback for environments that skipped that step. */
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS public.nt_rate_limit_hits (
      bucket      TEXT NOT NULL,
      window_start TIMESTAMPTZ NOT NULL,
      hits        INT NOT NULL DEFAULT 0,
      PRIMARY KEY (bucket, window_start)
    )
  `;
  tableReady = true;
}

/**
 * Identity for limiting: the session user when signed in (so a user isn't
 * punished for sharing an office NAT), else the client IP. `x-forwarded-for` is
 * set by Vercel's proxy; its first entry is the real client. Falls back to a
 * shared 'unknown' bucket, which is deliberately strict — an unidentifiable
 * caller shouldn't get a free pass.
 */
export function rateLimitKey(headers: Headers, userId: string | null): string {
  if (userId) return `user:${userId}`;
  const fwd = headers.get('x-forwarded-for');
  const ip = fwd?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim();
  return `ip:${ip || 'unknown'}`;
}

/**
 * Count one request against `name` for `key`. Returns allowed=false once the
 * window's budget is spent. Fails OPEN: if the counter write errors we serve the
 * request rather than 500 — the level gating itself is what protects the data,
 * this is only volume control.
 */
export async function checkRateLimit(
  name: string,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    await ensureTable();
    const rows = await sql`
      INSERT INTO public.nt_rate_limit_hits (bucket, window_start, hits)
      VALUES (
        ${`${name}:${key}`},
        to_timestamp(floor(extract(epoch FROM now()) / ${windowSeconds}) * ${windowSeconds}),
        1
      )
      ON CONFLICT (bucket, window_start) DO UPDATE SET hits = nt_rate_limit_hits.hits + 1
      RETURNING hits, extract(epoch FROM window_start)::bigint AS window_epoch
    `;
    const row = rows[0] as { hits: number; window_epoch: string } | undefined;
    const hits = Number(row?.hits ?? 1);
    const windowEnd = (Number(row?.window_epoch ?? 0) + windowSeconds) * 1000;
    return {
      allowed: hits <= limit,
      limit,
      remaining: Math.max(0, limit - hits),
      resetSeconds: Math.max(1, Math.ceil((windowEnd - Date.now()) / 1000)),
    };
  } catch (err) {
    console.error('rateLimit: counter unavailable, failing open', err);
    return { allowed: true, limit, remaining: limit, resetSeconds: windowSeconds };
  }
}

/** Standard headers so well-behaved clients can self-throttle. */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(r.limit),
    'X-RateLimit-Remaining': String(r.remaining),
    'X-RateLimit-Reset': String(r.resetSeconds),
    ...(r.allowed ? {} : { 'Retry-After': String(r.resetSeconds) }),
  };
}

/**
 * Housekeeping: drop windows older than a day. Cheap enough to call
 * opportunistically; the table is tiny (one row per key per window).
 */
export async function pruneRateLimitHits(): Promise<void> {
  try {
    await sql`DELETE FROM public.nt_rate_limit_hits WHERE window_start < now() - interval '1 day'`;
  } catch (err) {
    console.error('rateLimit: prune failed', err);
  }
}
