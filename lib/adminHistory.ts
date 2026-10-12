/**
 * Activity history for one signed-in user or one tracker session, shown in the
 * admin dashboard's history modal. Instants are returned as Postgres `::text`
 * and formatted client-side in Central Time (`formatCT`).
 */
import { sql } from '@/lib/db';
import { ensureTable as ensureActivityTable, type ActivityEventType } from '@/lib/activity';

export type HistoryKind = 'user' | 'session';

export interface HistoryEvent {
  createdAt: string;
  kind: ActivityEventType;
  path: string | null;
  durationSeconds: number | null;
  message: string | null;
  /** Full tracker session id, so a user's events can be grouped / opened per session. */
  sessionId: string;
}

export interface HistoryLogin { createdAt: string; ipAddress: string | null }

export interface HistoryResult {
  kind: HistoryKind;
  /** Email for a signed-in subject, else "Anonymous". */
  who: string;
  userId: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  views: number;
  errors: number;
  sessions: number;
  device: string | null;
  referrer: string | null;
  events: HistoryEvent[];
  /** Auth logins (new auth session rows) — user history only. */
  logins: HistoryLogin[];
  /** True when the event list hit the cap (newest events are kept). */
  truncated: boolean;
}

const EVENT_LIMIT = 300;
const LOGIN_LIMIT = 20;

function mapEvents(rows: any[]): HistoryEvent[] {
  return rows.map(r => ({
    createdAt: r.created_at,
    kind: r.event_type,
    path: r.path,
    durationSeconds: r.duration_ms == null ? null : Math.round(Number(r.duration_ms) / 1000),
    message: r.message,
    sessionId: r.session_id,
  }));
}

export async function getUserHistory(userId: string): Promise<HistoryResult | null> {
  await ensureActivityTable();
  const [who, summary, events, logins] = await Promise.all([
    sql`SELECT email FROM neon_auth."user" WHERE id::text = ${userId}`,
    sql`
      SELECT min(created_at)::text AS first_seen, max(created_at)::text AS last_seen,
             count(*) FILTER (WHERE event_type = 'pageview' AND duration_ms IS NULL) AS views,
             count(*) FILTER (WHERE event_type <> 'pageview') AS errors,
             count(DISTINCT session_id) AS sessions
      FROM public.nt_activity_events WHERE user_id = ${userId}
    `,
    sql`
      SELECT created_at::text AS created_at, event_type, path, duration_ms, message, session_id
      FROM public.nt_activity_events WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT ${EVENT_LIMIT + 1}
    `,
    sql`
      SELECT "createdAt"::text AS created_at, "ipAddress" AS ip
      FROM neon_auth."session" WHERE "userId"::text = ${userId}
      ORDER BY "createdAt" DESC LIMIT ${LOGIN_LIMIT}
    `,
  ]);
  if (who.length === 0) return null;
  const s = summary[0] as any;
  return {
    kind: 'user',
    who: (who[0] as any).email,
    userId,
    firstSeen: s.first_seen, lastSeen: s.last_seen,
    views: Number(s.views), errors: Number(s.errors), sessions: Number(s.sessions),
    device: null, referrer: null,
    events: mapEvents((events as any[]).slice(0, EVENT_LIMIT)),
    logins: (logins as any[]).map(r => ({ createdAt: r.created_at, ipAddress: r.ip ?? null })),
    truncated: events.length > EVENT_LIMIT,
  };
}

export async function getSessionHistory(sessionId: string): Promise<HistoryResult | null> {
  await ensureActivityTable();
  const [summary, events, first] = await Promise.all([
    sql`
      SELECT min(e.created_at)::text AS first_seen, max(e.created_at)::text AS last_seen,
             count(*) FILTER (WHERE e.event_type = 'pageview' AND e.duration_ms IS NULL) AS views,
             count(*) FILTER (WHERE e.event_type <> 'pageview') AS errors,
             count(*) AS n, max(e.user_id) AS uid, max(u.email) AS email
      FROM public.nt_activity_events e LEFT JOIN neon_auth."user" u ON u.id::text = e.user_id
      WHERE e.session_id = ${sessionId}
    `,
    sql`
      SELECT created_at::text AS created_at, event_type, path, duration_ms, message, session_id
      FROM public.nt_activity_events WHERE session_id = ${sessionId}
      ORDER BY created_at DESC LIMIT ${EVENT_LIMIT + 1}
    `,
    sql`
      SELECT referrer, user_agent FROM public.nt_activity_events
      WHERE session_id = ${sessionId} ORDER BY created_at ASC LIMIT 1
    `,
  ]);
  const s = summary[0] as any;
  if (Number(s.n) === 0) return null;
  const ua: string | null = (first[0] as any)?.user_agent ?? null;
  const device = !ua ? null : /ipad|tablet/i.test(ua) ? 'Tablet' : /mobi|android|iphone/i.test(ua) ? 'Mobile' : 'Desktop';
  return {
    kind: 'session',
    who: s.email ?? 'Anonymous',
    userId: s.uid ?? null,
    firstSeen: s.first_seen, lastSeen: s.last_seen,
    views: Number(s.views), errors: Number(s.errors), sessions: 1,
    device,
    referrer: (first[0] as any)?.referrer || null,
    events: mapEvents((events as any[]).slice(0, EVENT_LIMIT)),
    logins: [],
    truncated: events.length > EVENT_LIMIT,
  };
}
