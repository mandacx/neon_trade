/**
 * Period drill-downs behind every admin dashboard tile / section title.
 * A period is an inclusive range of Central Time calendar days; "day" buckets are Central days.
 */
import { sql } from '@/lib/db';
import { ensureTable as ensureActivityTable } from '@/lib/activity';
import { getHeavyApiUsers } from '@/lib/apiUsage';
import { addDaysYmd, ctDayStartISO } from '@/lib/time';

export const DRILL_METRICS = [
  'users', 'signups', 'telegram', 'logins', 'sessions', 'pages', 'errors', 'heavy',
  'funnel', 'stocks', 'sections', 'referrers', 'devices',
] as const;
export type DrillMetric = (typeof DRILL_METRICS)[number];

/**
 * A table cell: plain value, or text that opens a user's history (`user`) or a
 * tracker session's history (`session`), or an instant shown in Central Time.
 */
export type DrillCell = string | number | null | { text?: string; user?: string; session?: string; iso?: string };

export interface DrillResult {
  metric: DrillMetric;
  title: string;
  from: string;
  to: string;
  note?: string;
  columns: string[];
  rows: DrillCell[][];
  seriesLabel: string;
  series: Array<{ day: string; value: number }>;
  /** True when the row list hit the cap (the series still covers the full period). */
  truncated: boolean;
}

const LIMIT = 500;
const userLink = (id: string | null, email: string | null): DrillCell =>
  id && email ? { text: email, user: id } : email ?? 'Anonymous';

/** Fill every Central day in [from, to] so charts have no gaps. */
function fillSeries(from: string, to: string, rows: Array<{ day: string; n: string | number }>) {
  const by = new Map(rows.map(r => [r.day, Number(r.n)]));
  const out: Array<{ day: string; value: number }> = [];
  for (let d = from, i = 0; d <= to && i < 400; d = addDaysYmd(d, 1), i++) out.push({ day: d, value: by.get(d) ?? 0 });
  return out;
}

export async function getDrill(metric: DrillMetric, from: string, to: string): Promise<DrillResult> {
  const start = ctDayStartISO(from);
  const end = ctDayStartISO(addDaysYmd(to, 1)); // exclusive
  const base = { metric, from, to };

  if (metric === 'heavy') {
    const rows = await getHeavyApiUsers(LIMIT);
    return {
      ...base, title: 'Heavy API users', seriesLabel: '', series: [], truncated: false,
      note: 'Rate-limit counters are kept for about a day, so this always shows the last 24 hours regardless of the selected period.',
      columns: ['User', 'Requests', 'Peak / min', 'Throttled min'],
      rows: rows.map(r => [userLink(r.userId, r.email), r.requests, r.peakPerMinute, r.throttledMinutes]),
    };
  }

  if (metric === 'users' || metric === 'signups') {
    const [rows, series] = await Promise.all([
      sql`
        SELECT id::text AS id, email, name, "createdAt"::text AS at FROM neon_auth."user"
        WHERE "createdAt" >= ${start}::timestamptz AND "createdAt" < ${end}::timestamptz
        ORDER BY "createdAt" DESC LIMIT ${LIMIT}`,
      sql`
        SELECT ("createdAt" AT TIME ZONE 'America/Chicago')::date::text AS day, count(*) AS n FROM neon_auth."user"
        WHERE "createdAt" >= ${start}::timestamptz AND "createdAt" < ${end}::timestamptz GROUP BY 1`,
    ]);
    return {
      ...base, title: metric === 'users' ? 'Users joined' : 'Signups', seriesLabel: 'Signups per day',
      series: fillSeries(from, to, series as any), truncated: rows.length >= LIMIT,
      columns: ['User', 'Name', 'Joined'],
      rows: (rows as any[]).map(r => [userLink(r.id, r.email), r.name ?? '—', { iso: r.at }]),
    };
  }

  if (metric === 'telegram') {
    const [rows, series] = await Promise.all([
      sql`
        SELECT up.user_id AS id, u.email, up.telegram_linked_at::text AS at
        FROM public.nt_app_user_profiles up JOIN neon_auth."user" u ON u.id::text = up.user_id
        WHERE up.telegram_chat_id IS NOT NULL AND up.telegram_linked_at >= ${start}::timestamptz AND up.telegram_linked_at < ${end}::timestamptz
        ORDER BY up.telegram_linked_at DESC LIMIT ${LIMIT}`,
      sql`
        SELECT (telegram_linked_at AT TIME ZONE 'America/Chicago')::date::text AS day, count(*) AS n
        FROM public.nt_app_user_profiles
        WHERE telegram_chat_id IS NOT NULL AND telegram_linked_at >= ${start}::timestamptz AND telegram_linked_at < ${end}::timestamptz GROUP BY 1`,
    ]);
    return {
      ...base, title: 'Telegram linked', seriesLabel: 'Links per day', series: fillSeries(from, to, series as any),
      truncated: rows.length >= LIMIT, columns: ['User', 'Linked'],
      rows: (rows as any[]).map(r => [userLink(r.id, r.email), { iso: r.at }]),
    };
  }

  if (metric === 'logins') {
    const [rows, series] = await Promise.all([
      sql`
        SELECT s."userId"::text AS id, u.email, s."ipAddress" AS ip, s."createdAt"::text AS at
        FROM neon_auth."session" s JOIN neon_auth."user" u ON u.id = s."userId"
        WHERE s."createdAt" >= ${start}::timestamptz AND s."createdAt" < ${end}::timestamptz
        ORDER BY s."createdAt" DESC LIMIT ${LIMIT}`,
      sql`
        SELECT (s."createdAt" AT TIME ZONE 'America/Chicago')::date::text AS day, count(*) AS n FROM neon_auth."session" s
        WHERE s."createdAt" >= ${start}::timestamptz AND s."createdAt" < ${end}::timestamptz GROUP BY 1`,
    ]);
    return {
      ...base, title: 'Logins', seriesLabel: 'Logins per day', series: fillSeries(from, to, series as any),
      truncated: rows.length >= LIMIT,
      note: 'A login is a new auth session row; sessions that were revoked or expired and cleaned up are not counted.',
      columns: ['User', 'IP', 'Time'],
      rows: (rows as any[]).map(r => [userLink(r.id, r.email), r.ip ?? '—', { iso: r.at }]),
    };
  }

  // Everything below reads the activity table.
  await ensureActivityTable();

  if (metric === 'sessions') {
    const [rows, series] = await Promise.all([
      sql`
        SELECT e.session_id, max(e.user_id) AS uid, max(u.email) AS email,
               count(*) FILTER (WHERE e.event_type = 'pageview' AND e.duration_ms IS NULL) AS views,
               min(e.created_at)::text AS first_seen, max(e.created_at)::text AS last_seen
        FROM public.nt_activity_events e LEFT JOIN neon_auth."user" u ON u.id::text = e.user_id
        WHERE e.created_at >= ${start}::timestamptz AND e.created_at < ${end}::timestamptz
        GROUP BY e.session_id ORDER BY max(e.created_at) DESC LIMIT ${LIMIT}`,
      sql`
        SELECT (created_at AT TIME ZONE 'America/Chicago')::date::text AS day, count(DISTINCT session_id) AS n
        FROM public.nt_activity_events
        WHERE created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz GROUP BY 1`,
    ]);
    return {
      ...base, title: 'Sessions', seriesLabel: 'Sessions per day', series: fillSeries(from, to, series as any),
      truncated: rows.length >= LIMIT,
      note: 'Click a user to see their history, or a session id to see what happened in that session (works for anonymous sessions too).',
      columns: ['Who', 'Session', 'Pageviews', 'First seen', 'Last seen'],
      rows: (rows as any[]).map(r => [
        userLink(r.uid, r.email),
        { text: String(r.session_id).slice(0, 8), session: String(r.session_id) },
        Number(r.views), { iso: r.first_seen }, { iso: r.last_seen },
      ]),
    };
  }

  if (metric === 'pages') {
    const [rows, series] = await Promise.all([
      sql`
        SELECT path, count(*) FILTER (WHERE duration_ms IS NULL) AS views, count(DISTINCT session_id) AS sessions,
               avg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS avg_ms
        FROM public.nt_activity_events
        WHERE event_type = 'pageview' AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz
        GROUP BY path ORDER BY views DESC LIMIT ${LIMIT}`,
      sql`
        SELECT (created_at AT TIME ZONE 'America/Chicago')::date::text AS day, count(*) AS n
        FROM public.nt_activity_events
        WHERE event_type = 'pageview' AND duration_ms IS NULL AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz GROUP BY 1`,
    ]);
    return {
      ...base, title: 'Top pages', seriesLabel: 'Page views per day', series: fillSeries(from, to, series as any),
      truncated: rows.length >= LIMIT, columns: ['Path', 'Views', 'Sessions', 'Avg time (s)'],
      rows: (rows as any[]).map(r => [r.path ?? '—', Number(r.views), Number(r.sessions), r.avg_ms == null ? '—' : Math.round(Number(r.avg_ms) / 1000)]),
    };
  }

  if (metric === 'errors') {
    const [rows, series] = await Promise.all([
      sql`
        SELECT e.user_id AS uid, u.email, e.path, e.message, e.event_type, e.created_at::text AS at
        FROM public.nt_activity_events e LEFT JOIN neon_auth."user" u ON u.id::text = e.user_id
        WHERE e.event_type <> 'pageview' AND e.created_at >= ${start}::timestamptz AND e.created_at < ${end}::timestamptz
        ORDER BY e.created_at DESC LIMIT ${LIMIT}`,
      sql`
        SELECT (created_at AT TIME ZONE 'America/Chicago')::date::text AS day, count(*) AS n
        FROM public.nt_activity_events
        WHERE event_type <> 'pageview' AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz GROUP BY 1`,
    ]);
    return {
      ...base, title: 'Errors', seriesLabel: 'Errors per day', series: fillSeries(from, to, series as any),
      truncated: rows.length >= LIMIT, columns: ['User', 'Path', 'Message', 'Time'],
      rows: (rows as any[]).map(r => [userLink(r.uid, r.email), r.path ?? '—', r.message ?? r.event_type, { iso: r.at }]),
    };
  }

  if (metric === 'stocks' || metric === 'sections' || metric === 'referrers' || metric === 'devices') {
    let rows: any[];
    if (metric === 'stocks') {
      rows = await sql`
        SELECT upper(split_part(path, '/', 3)) AS label, count(*) AS n, count(DISTINCT session_id) AS sessions
        FROM public.nt_activity_events
        WHERE event_type = 'pageview' AND duration_ms IS NULL AND path LIKE '/stock/%' AND split_part(path, '/', 3) <> ''
          AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz
        GROUP BY 1 ORDER BY n DESC LIMIT ${LIMIT}` as any[];
    } else if (metric === 'sections') {
      rows = await sql`
        SELECT '/' || split_part(path, '/', 2) AS label, count(*) AS n, count(DISTINCT session_id) AS sessions
        FROM public.nt_activity_events
        WHERE event_type = 'pageview' AND duration_ms IS NULL
          AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz
        GROUP BY 1 ORDER BY n DESC LIMIT ${LIMIT}` as any[];
    } else if (metric === 'referrers') {
      rows = await sql`
        SELECT substring(referrer from '://([^/]+)') AS label, count(*) AS n, count(DISTINCT session_id) AS sessions
        FROM public.nt_activity_events
        WHERE event_type = 'pageview' AND duration_ms IS NULL AND referrer IS NOT NULL AND referrer <> ''
          AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz
        GROUP BY 1 HAVING substring(referrer from '://([^/]+)') IS NOT NULL ORDER BY n DESC LIMIT ${LIMIT}` as any[];
    } else {
      rows = await sql`
        SELECT CASE WHEN user_agent ILIKE '%ipad%' OR user_agent ILIKE '%tablet%' THEN 'Tablet'
                    WHEN user_agent ILIKE '%mobi%' OR user_agent ILIKE '%android%' OR user_agent ILIKE '%iphone%' THEN 'Mobile'
                    ELSE 'Desktop' END AS label,
               count(DISTINCT session_id) AS n, count(DISTINCT session_id) AS sessions
        FROM public.nt_activity_events
        WHERE created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz
        GROUP BY 1 ORDER BY n DESC` as any[];
    }
    const series = await sql`
      SELECT (created_at AT TIME ZONE 'America/Chicago')::date::text AS day, count(*) AS n
      FROM public.nt_activity_events
      WHERE event_type = 'pageview' AND duration_ms IS NULL AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz
      GROUP BY 1`;
    const titles = { stocks: 'Most viewed stocks', sections: 'Sections used', referrers: 'Traffic sources', devices: 'Devices' } as const;
    return {
      ...base, title: titles[metric], seriesLabel: 'Page views per day (all pages, for context)', series: fillSeries(from, to, series as any),
      truncated: rows.length >= LIMIT,
      columns: [metric === 'stocks' ? 'Symbol' : metric === 'sections' ? 'Section' : metric === 'referrers' ? 'Source' : 'Device', metric === 'devices' ? 'Sessions' : 'Views', 'Sessions'],
      rows: rows.map(r => [r.label ?? '—', Number(r.n), Number(r.sessions)]),
    };
  }

  // funnel: one row per Central day, newest first.
  const rows = await sql`
    WITH days AS (
      SELECT d::date AS day FROM generate_series(${from}::date, ${to}::date, interval '1 day') d
    ), act AS (
      SELECT (created_at AT TIME ZONE 'America/Chicago')::date AS day, count(DISTINCT session_id) AS sessions, count(DISTINCT user_id) AS users
      FROM public.nt_activity_events WHERE created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz GROUP BY 1
    ), su AS (
      SELECT ("createdAt" AT TIME ZONE 'America/Chicago')::date AS day, count(*) AS n FROM neon_auth."user"
      WHERE "createdAt" >= ${start}::timestamptz AND "createdAt" < ${end}::timestamptz GROUP BY 1
    ), lg AS (
      SELECT ("createdAt" AT TIME ZONE 'America/Chicago')::date AS day, count(*) AS n FROM neon_auth."session"
      WHERE "createdAt" >= ${start}::timestamptz AND "createdAt" < ${end}::timestamptz GROUP BY 1
    )
    SELECT days.day::text AS day, COALESCE(act.sessions, 0) AS sessions, COALESCE(act.users, 0) AS users,
           COALESCE(su.n, 0) AS signups, COALESCE(lg.n, 0) AS logins
    FROM days LEFT JOIN act USING (day) LEFT JOIN su USING (day) LEFT JOIN lg USING (day)
    ORDER BY days.day DESC`;
  const list = rows as any[];
  return {
    ...base, title: 'Funnel & retention', seriesLabel: 'Visitor sessions per day',
    series: fillSeries(from, to, list.map(r => ({ day: r.day, n: r.sessions }))), truncated: false,
    note: 'Per Central Time day. Signed-in users = distinct users with tracked activity that day.',
    columns: ['Day (CT)', 'Visitor sessions', 'Signed-in users', 'Signups', 'Logins'],
    rows: list.map(r => [r.day, Number(r.sessions), Number(r.users), Number(r.signups), Number(r.logins)]),
  };
}
