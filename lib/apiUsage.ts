/**
 * Heavy API users, read straight from the rate-limiter counters
 * (public.nt_rate_limit_hits, buckets named `<limit name>:user:<id>`), so it
 * costs no extra writes. Counters are pruned after a day, hence a 24h view.
 */
import { sql } from '@/lib/db';
import { LEVEL_RANGE_RATE, LEVEL_POINT_RATE } from '@/lib/levelAccess';

export interface HeavyUserRow {
  userId: string;
  email: string;
  requests: number;
  peakPerMinute: number;
  throttledMinutes: number;
  flagged: boolean;
}

/** Calls/day at or above which a user is flagged even if never throttled. */
export const HEAVY_DAILY_CALLS = 3000;

export async function getHeavyApiUsers(limit: number = 20): Promise<HeavyUserRow[]> {
  try {
    const rows = await sql`
      WITH h AS (
        SELECT split_part(bucket, ':', 1) AS name,
               substr(bucket, length(split_part(bucket, ':', 1)) + length(':user:') + 1) AS user_id,
               hits,
               hits > CASE split_part(bucket, ':', 1)
                        WHEN ${LEVEL_RANGE_RATE.name} THEN ${LEVEL_RANGE_RATE.limit}
                        ELSE ${LEVEL_POINT_RATE.limit} END AS throttled
        FROM public.nt_rate_limit_hits
        WHERE window_start >= now() - interval '24 hours'
          AND bucket LIKE '%:user:%'
      )
      SELECT h.user_id, u.email, sum(h.hits) AS requests, max(h.hits) AS peak,
             count(*) FILTER (WHERE h.throttled) AS throttled
      FROM h
      LEFT JOIN neon_auth."user" u ON u.id::text = h.user_id
      GROUP BY h.user_id, u.email
      ORDER BY requests DESC
      LIMIT ${limit}
    `;
    return (rows as any[]).map(r => {
      const requests = Number(r.requests);
      const throttledMinutes = Number(r.throttled);
      return {
        userId: r.user_id,
        email: r.email ?? r.user_id,
        requests,
        peakPerMinute: Number(r.peak),
        throttledMinutes,
        flagged: throttledMinutes > 0 || requests >= HEAVY_DAILY_CALLS,
      };
    });
  } catch (err) {
    console.error('apiUsage: heavy users failed', err);
    return [];
  }
}

/** One user's gated-API usage over the last 24h (same counters as the heavy-users tile). */
export async function getUserApiUsage(userId: string): Promise<HeavyUserRow | null> {
  const rows = (await getHeavyApiUsers(1000)).filter(r => r.userId === userId);
  return rows[0] ?? null;
}
