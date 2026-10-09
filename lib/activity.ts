/**
 * First-party activity tracking (page views, client/server errors) feeding the
 * admin dashboard tiles. Rows are written by POST /api/track.
 */
import { sql } from '@/lib/db';

export type ActivityEventType = 'pageview' | 'error_client' | 'error_server';

export interface ActivityEventInput {
  sessionId: string;
  userId: string | null;
  eventType: ActivityEventType;
  path: string | null;
  referrer?: string | null;
  durationMs?: number | null;
  message?: string | null;
  statusCode?: number | null;
  userAgent?: string | null;
}

const MAX_DURATION_MS = 30 * 60 * 1000;
const RETENTION_DAYS = 90;

let tableReady = false;

/** Idempotent lazy DDL. */
export async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS public.nt_activity_events (
      id          BIGSERIAL PRIMARY KEY,
      session_id  TEXT NOT NULL,
      user_id     TEXT,
      event_type  TEXT NOT NULL,
      path        TEXT,
      referrer    TEXT,
      duration_ms INT,
      message     TEXT,
      status_code INT,
      user_agent  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS nt_activity_events_created_idx ON public.nt_activity_events (created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS nt_activity_events_user_idx ON public.nt_activity_events (user_id, created_at)`;
  tableReady = true;
}

/** Headless browsers (test runs, crawlers) would inflate the stats. Hygiene, not security. */
export function isIgnoredUserAgent(ua: string | null): boolean {
  return !!ua && /HeadlessChrome|Playwright|Puppeteer|PhantomJS|Lighthouse|bot\b|crawler|spider/i.test(ua);
}

const clip = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : null);

export async function recordActivity(e: ActivityEventInput): Promise<void> {
  await ensureTable();
  const duration = e.durationMs == null ? null : Math.max(0, Math.min(MAX_DURATION_MS, Math.round(e.durationMs)));
  await sql`
    INSERT INTO public.nt_activity_events
      (session_id, user_id, event_type, path, referrer, duration_ms, message, status_code, user_agent)
    VALUES (${e.sessionId}, ${e.userId}, ${e.eventType}, ${clip(e.path, 300)}, ${clip(e.referrer, 300)},
            ${duration}, ${clip(e.message, 500)}, ${e.statusCode ?? null}, ${clip(e.userAgent, 300)})
  `;
  // Opportunistic retention prune (~1 in 200 writes) instead of a dedicated cron.
  if (Math.random() < 0.005) {
    await sql`DELETE FROM public.nt_activity_events WHERE created_at < now() - (${RETENTION_DAYS} || ' days')::interval`;
  }
}

/** After login, attach that browser session's earlier anonymous events to the user. */
export async function claimAnonymousEvents(sessionId: string, userId: string): Promise<void> {
  await ensureTable();
  await sql`UPDATE public.nt_activity_events SET user_id = ${userId} WHERE session_id = ${sessionId} AND user_id IS NULL`;
}

export interface ActiveSessionRow { sessionId: string; who: string; pageviews: number; lastSeen: string }
export interface TopPageRow { path: string; views: number; avgSeconds: number | null }
export interface ErrorRow { path: string | null; message: string | null; kind: string; createdAt: string }
export interface ActivitySummary {
  activeSessionsToday: number;
  pageViewsToday: number;
  errorsToday: number;
  activeSessions: ActiveSessionRow[];
  topPages: TopPageRow[];
  errors: ErrorRow[];
}

/** "Today" = the DB server's current date, matching the logins tile. */
export async function getActivitySummary(limit: number = 100): Promise<ActivitySummary> {
  try {
    await ensureTable();
    const [counts, sessions, pages, errs] = await Promise.all([
      sql`
        SELECT
          count(DISTINCT session_id) AS sessions,
          count(*) FILTER (WHERE event_type = 'pageview' AND duration_ms IS NULL) AS views,
          count(*) FILTER (WHERE event_type <> 'pageview') AS errors
        FROM public.nt_activity_events WHERE created_at >= CURRENT_DATE
      `,
      sql`
        SELECT e.session_id, max(u.email) AS email,
               count(*) FILTER (WHERE e.event_type = 'pageview' AND e.duration_ms IS NULL) AS views,
               max(e.created_at)::text AS last_seen
        FROM public.nt_activity_events e
        LEFT JOIN neon_auth."user" u ON u.id::text = e.user_id
        WHERE e.created_at >= CURRENT_DATE
        GROUP BY e.session_id
        ORDER BY max(e.created_at) DESC
        LIMIT ${limit}
      `,
      sql`
        SELECT path,
               count(*) FILTER (WHERE duration_ms IS NULL) AS views,
               avg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS avg_ms
        FROM public.nt_activity_events
        WHERE created_at >= CURRENT_DATE AND event_type = 'pageview'
        GROUP BY path
        ORDER BY views DESC
        LIMIT ${limit}
      `,
      sql`
        SELECT path, message, event_type, created_at::text AS created_at
        FROM public.nt_activity_events
        WHERE created_at >= CURRENT_DATE AND event_type <> 'pageview'
        ORDER BY created_at DESC
        LIMIT ${limit}
      `,
    ]);
    const c = counts[0] as { sessions: string; views: string; errors: string };
    return {
      activeSessionsToday: Number(c.sessions),
      pageViewsToday: Number(c.views),
      errorsToday: Number(c.errors),
      activeSessions: (sessions as any[]).map(r => ({
        sessionId: String(r.session_id).slice(0, 8),
        who: r.email ?? 'Anonymous',
        pageviews: Number(r.views),
        lastSeen: r.last_seen,
      })),
      topPages: (pages as any[]).map(r => ({
        path: r.path ?? '—',
        views: Number(r.views),
        avgSeconds: r.avg_ms == null ? null : Math.round(Number(r.avg_ms) / 1000),
      })),
      errors: (errs as any[]).map(r => ({ path: r.path, message: r.message, kind: r.event_type, createdAt: r.created_at })),
    };
  } catch (err) {
    console.error('activity: summary failed', err);
    return { activeSessionsToday: 0, pageViewsToday: 0, errorsToday: 0, activeSessions: [], topPages: [], errors: [] };
  }
}

// ---------------------------------------------------------------------------
// Behavior analytics (trends, retention, what people look at, where they come from)
// ---------------------------------------------------------------------------

export interface DailyPoint { day: string; views: number; sessions: number; users: number }
export interface CountRow { label: string; count: number; extra?: number }
export interface BehaviorStats {
  days: number;
  daily: DailyPoint[];
  /** Distinct signed-in users / sessions active in the last 1, 7 and 30 days. */
  dau: number; wau: number; mau: number;
  sessions7d: number;
  avgSessionSeconds: number | null;
  bounceRate: number | null;
  topStocks: CountRow[];
  sections: CountRow[];
  referrers: CountRow[];
  devices: CountRow[];
  /** Signed-in users active on 2+ distinct days in the last 7 days. */
  returningUsers7d: number;
}

const EMPTY_BEHAVIOR: BehaviorStats = {
  days: 14, daily: [], dau: 0, wau: 0, mau: 0, sessions7d: 0, avgSessionSeconds: null, bounceRate: null,
  topStocks: [], sections: [], referrers: [], devices: [], returningUsers7d: 0,
};

export async function getBehaviorStats(days: number = 14): Promise<BehaviorStats> {
  try {
    await ensureTable();
    const [daily, active, engagement, stocks, sections, referrers, devices, returning] = await Promise.all([
      sql`
        SELECT created_at::date::text AS day,
               count(*) FILTER (WHERE duration_ms IS NULL) AS views,
               count(DISTINCT session_id) AS sessions,
               count(DISTINCT user_id) AS users
        FROM public.nt_activity_events
        WHERE event_type = 'pageview' AND created_at >= CURRENT_DATE - (${days - 1} || ' days')::interval
        GROUP BY 1 ORDER BY 1
      `,
      sql`
        SELECT count(DISTINCT user_id) FILTER (WHERE created_at >= CURRENT_DATE) AS dau,
               count(DISTINCT user_id) FILTER (WHERE created_at >= now() - interval '7 days') AS wau,
               count(DISTINCT user_id) AS mau
        FROM public.nt_activity_events
        WHERE created_at >= now() - interval '30 days' AND user_id IS NOT NULL
      `,
      sql`
        WITH s AS (
          SELECT session_id,
                 count(*) FILTER (WHERE event_type = 'pageview' AND duration_ms IS NULL) AS views,
                 extract(epoch FROM max(created_at) - min(created_at)) AS secs
          FROM public.nt_activity_events
          WHERE created_at >= now() - interval '7 days'
          GROUP BY session_id
        )
        SELECT count(*) AS sessions, avg(secs) FILTER (WHERE views > 1) AS avg_secs,
               count(*) FILTER (WHERE views <= 1) AS bounced
        FROM s
      `,
      sql`
        SELECT upper(split_part(path, '/', 3)) AS symbol, count(*) AS views, count(DISTINCT session_id) AS sessions
        FROM public.nt_activity_events
        WHERE event_type = 'pageview' AND duration_ms IS NULL AND path LIKE '/stock/%'
          AND created_at >= now() - interval '7 days' AND split_part(path, '/', 3) <> ''
        GROUP BY 1 ORDER BY views DESC LIMIT 15
      `,
      sql`
        SELECT '/' || split_part(path, '/', 2) AS section, count(*) AS views, count(DISTINCT session_id) AS sessions
        FROM public.nt_activity_events
        WHERE event_type = 'pageview' AND duration_ms IS NULL AND created_at >= now() - interval '7 days'
        GROUP BY 1 ORDER BY views DESC LIMIT 12
      `,
      sql`
        SELECT substring(referrer from '://([^/]+)') AS host, count(*) AS visits
        FROM public.nt_activity_events
        WHERE event_type = 'pageview' AND duration_ms IS NULL AND referrer IS NOT NULL AND referrer <> ''
          AND created_at >= now() - interval '7 days'
        GROUP BY 1 HAVING substring(referrer from '://([^/]+)') IS NOT NULL
        ORDER BY visits DESC LIMIT 10
      `,
      sql`
        SELECT CASE WHEN user_agent ILIKE '%ipad%' OR user_agent ILIKE '%tablet%' THEN 'Tablet'
                    WHEN user_agent ILIKE '%mobi%' OR user_agent ILIKE '%android%' OR user_agent ILIKE '%iphone%' THEN 'Mobile'
                    ELSE 'Desktop' END AS device,
               count(DISTINCT session_id) AS sessions
        FROM public.nt_activity_events
        WHERE created_at >= now() - interval '7 days'
        GROUP BY 1 ORDER BY sessions DESC
      `,
      // Signed-in users seen on at least 2 distinct days in the last 7 days.
      sql`
        SELECT count(*) AS n FROM (
          SELECT user_id FROM public.nt_activity_events
          WHERE user_id IS NOT NULL AND created_at >= now() - interval '7 days'
          GROUP BY user_id HAVING count(DISTINCT created_at::date) >= 2
        ) t
      `,
    ]);

    // Fill days with no traffic so the chart has no gaps.
    const byDay = new Map((daily as any[]).map(r => [r.day as string, r]));
    const series: DailyPoint[] = [];
    const nowMs = Date.now();
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(nowMs - i * 86400000).toISOString().slice(0, 10);
      const r = byDay.get(day);
      series.push({ day, views: Number(r?.views ?? 0), sessions: Number(r?.sessions ?? 0), users: Number(r?.users ?? 0) });
    }

    const a = active[0] as { dau: string; wau: string; mau: string };
    const e = engagement[0] as { sessions: string; avg_secs: string | null; bounced: string };
    const sessions7d = Number(e.sessions);
    return {
      days, daily: series,
      dau: Number(a.dau), wau: Number(a.wau), mau: Number(a.mau),
      sessions7d,
      avgSessionSeconds: e.avg_secs == null ? null : Math.round(Number(e.avg_secs)),
      bounceRate: sessions7d > 0 ? Number(e.bounced) / sessions7d : null,
      topStocks: (stocks as any[]).map(r => ({ label: r.symbol, count: Number(r.views), extra: Number(r.sessions) })),
      sections: (sections as any[]).map(r => ({ label: r.section, count: Number(r.views), extra: Number(r.sessions) })),
      referrers: (referrers as any[]).map(r => ({ label: r.host, count: Number(r.visits) })),
      devices: (devices as any[]).map(r => ({ label: r.device, count: Number(r.sessions) })),
      returningUsers7d: Number((returning[0] as { n: string }).n),
    };
  } catch (err) {
    console.error('activity: behavior stats failed', err);
    return EMPTY_BEHAVIOR;
  }
}

// ---------------------------------------------------------------------------
// Per-user behavior (admin user detail page)
// ---------------------------------------------------------------------------

export interface UserTimelineRow { createdAt: string; kind: ActivityEventType; path: string | null; durationSeconds: number | null; message: string | null }
export interface UserBehavior {
  firstSeen: string | null;
  lastSeen: string | null;
  totalViews: number;
  sessions: number;
  /** Distinct days with activity in the last 30 days. */
  activeDays30d: number;
  avgPageSeconds: number | null;
  errors: number;
  topPages: CountRow[];
  topStocks: CountRow[];
  devices: CountRow[];
  timeline: UserTimelineRow[];
}

/** Everything tracked for one signed-in user (all-time totals; lists cover the last 30 days). */
export async function getUserBehavior(userId: string, timelineLimit: number = 100): Promise<UserBehavior> {
  try {
    await ensureTable();
    const [summary, pages, stocks, devices, timeline] = await Promise.all([
      sql`
        SELECT min(created_at)::text AS first_seen, max(created_at)::text AS last_seen,
               count(*) FILTER (WHERE event_type = 'pageview' AND duration_ms IS NULL) AS views,
               count(DISTINCT session_id) AS sessions,
               count(DISTINCT created_at::date) FILTER (WHERE created_at >= now() - interval '30 days') AS active_days,
               avg(duration_ms) FILTER (WHERE event_type = 'pageview' AND duration_ms IS NOT NULL) AS avg_ms,
               count(*) FILTER (WHERE event_type <> 'pageview') AS errors
        FROM public.nt_activity_events WHERE user_id = ${userId}
      `,
      sql`
        SELECT path, count(*) AS views FROM public.nt_activity_events
        WHERE user_id = ${userId} AND event_type = 'pageview' AND duration_ms IS NULL
          AND created_at >= now() - interval '30 days'
        GROUP BY path ORDER BY views DESC LIMIT 10
      `,
      sql`
        SELECT upper(split_part(path, '/', 3)) AS symbol, count(*) AS views FROM public.nt_activity_events
        WHERE user_id = ${userId} AND event_type = 'pageview' AND duration_ms IS NULL
          AND path LIKE '/stock/%' AND split_part(path, '/', 3) <> '' AND created_at >= now() - interval '30 days'
        GROUP BY 1 ORDER BY views DESC LIMIT 10
      `,
      sql`
        SELECT CASE WHEN user_agent ILIKE '%ipad%' OR user_agent ILIKE '%tablet%' THEN 'Tablet'
                    WHEN user_agent ILIKE '%mobi%' OR user_agent ILIKE '%android%' OR user_agent ILIKE '%iphone%' THEN 'Mobile'
                    ELSE 'Desktop' END AS device, count(DISTINCT session_id) AS sessions
        FROM public.nt_activity_events WHERE user_id = ${userId} AND created_at >= now() - interval '30 days'
        GROUP BY 1 ORDER BY sessions DESC
      `,
      sql`
        SELECT created_at::text AS created_at, event_type, path, duration_ms, message
        FROM public.nt_activity_events WHERE user_id = ${userId}
        ORDER BY created_at DESC LIMIT ${timelineLimit}
      `,
    ]);
    const s = summary[0] as { first_seen: string | null; last_seen: string | null; views: string; sessions: string; active_days: string; avg_ms: string | null; errors: string };
    return {
      firstSeen: s.first_seen, lastSeen: s.last_seen,
      totalViews: Number(s.views), sessions: Number(s.sessions), activeDays30d: Number(s.active_days),
      avgPageSeconds: s.avg_ms == null ? null : Math.round(Number(s.avg_ms) / 1000),
      errors: Number(s.errors),
      topPages: (pages as any[]).map(r => ({ label: r.path ?? '—', count: Number(r.views) })),
      topStocks: (stocks as any[]).map(r => ({ label: r.symbol, count: Number(r.views) })),
      devices: (devices as any[]).map(r => ({ label: r.device, count: Number(r.sessions) })),
      timeline: (timeline as any[]).map(r => ({
        createdAt: r.created_at, kind: r.event_type, path: r.path,
        durationSeconds: r.duration_ms == null ? null : Math.round(Number(r.duration_ms) / 1000), message: r.message,
      })),
    };
  } catch (err) {
    console.error('activity: user behavior failed', err);
    return { firstSeen: null, lastSeen: null, totalViews: 0, sessions: 0, activeDays30d: 0, avgPageSeconds: null, errors: 0, topPages: [], topStocks: [], devices: [], timeline: [] };
  }
}
