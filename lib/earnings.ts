/**
 * Earnings dates & results. Tables come from scripts/bootstrap-earnings.mjs:
 *
 *   nt_earnings_calendar  upcoming schedule — Alpha Vantage EARNINGS_CALENDAR
 *                         (one CSV for every symbol, 1 call/day)
 *   nt_earnings           reported quarters — Alpaca News (Benzinga results
 *                         headlines, same day, EPS + sales vs consensus) and
 *                         Alpha Vantage EARNINGS (per-symbol history; backfill
 *                         and fallback when no headline parses)
 *   nt_earnings_sync      per-symbol AV history state (backfill queue)
 *   nt_api_usage          AV daily budget (free tier: 25 calls/day, UTC day)
 *   nt_job_lease          single-row lease so cron runs never overlap
 *
 * Driven by app/api/cron/earnings (Railway, every 15 min; the route decides
 * which step runs when). Readers at the bottom serve the stock and watchlist
 * pages; all of it is Pro-only (FEATURE_EARNINGS), enforced by the routes.
 *
 * Dates are US/Eastern calendar dates, stored as DATE and returned as text
 * ('YYYY-MM-DD'); day arithmetic is done on those strings, never through
 * new Date('YYYY-MM-DD') in local time.
 */
import { sql } from '@/lib/db';
import { parseEarningsHeadline, symbolsForResult, easternDateAndSession } from '@/lib/earningsParse';
import type { EarningsEvent, EarningsOutcome, EarningsResult, EarningsSummary, EarningsTime } from '@/types/earnings';

const AV_URL = 'https://www.alphavantage.co/query';
const AV_PROVIDER = 'alphavantage';
const ALPACA_NEWS_URL = `${process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets'}/v1beta1/news`;

const avKey = () => process.env.ALPHA_VANTAGE_API_KEY || '';
const avDailyBudget = () => Number(process.env.ALPHA_VANTAGE_DAILY_BUDGET || 25);
const avMinIntervalMs = () => Number(process.env.ALPHA_VANTAGE_MIN_INTERVAL_MS || 13000);

// ---------------------------------------------------------------------------
// Date helpers (string-based, US/Eastern)
// ---------------------------------------------------------------------------

export function todayET(): string {
  return easternDateAndSession(new Date().toISOString()).date;
}

/** Whole days from `from` to `to` (both 'YYYY-MM-DD'). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

function outcomeFromSurprise(pct: number | null): EarningsOutcome | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  if (Math.abs(pct) < 0.5) return 'inline';
  return pct > 0 ? 'beat' : 'miss';
}

function surprisePct(actual: number | null, estimate: number | null): number | null {
  if (actual === null || estimate === null || estimate === 0) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
}

// ---------------------------------------------------------------------------
// Universe, lease, budget
// ---------------------------------------------------------------------------

/** Symbols with option levels traded in the last 30 days (~600; excludes delisted tickers). */
export async function getTrackedSymbols(): Promise<string[]> {
  const rows = await sql`
    SELECT DISTINCT symbol FROM public.nt_market_expiries
    WHERE source = 'eod' AND last_trade_date >= CURRENT_DATE - 30
  `;
  return rows.map((r: any) => r.symbol as string);
}

async function acquireLease(seconds: number): Promise<boolean> {
  await sql`INSERT INTO public.nt_job_lease (name) VALUES ('earnings') ON CONFLICT (name) DO NOTHING`;
  const rows = await sql`
    UPDATE public.nt_job_lease SET locked_until = now() + make_interval(secs => ${seconds})
    WHERE name = 'earnings' AND locked_until < now()
    RETURNING 1
  `;
  return rows.length > 0;
}

async function releaseLease(): Promise<void> {
  await sql`UPDATE public.nt_job_lease SET locked_until = 'epoch' WHERE name = 'earnings'`;
}

export class AvRateLimited extends Error {}

/**
 * Atomically take one call from today's (UTC) Alpha Vantage budget. Counts
 * the call before it's made — AV counts failed and throttled calls too.
 */
async function reserveAvCall(): Promise<boolean> {
  const rows = await sql`
    INSERT INTO public.nt_api_usage AS u (provider, day, calls)
    VALUES (${AV_PROVIDER}, (now() AT TIME ZONE 'UTC')::date, 1)
    ON CONFLICT (provider, day) DO UPDATE SET calls = u.calls + 1
      WHERE u.calls < ${avDailyBudget()} AND u.exhausted_at IS NULL
    RETURNING calls
  `;
  return rows.length > 0;
}

async function markAvExhausted(): Promise<void> {
  await sql`
    INSERT INTO public.nt_api_usage (provider, day, calls, exhausted_at)
    VALUES (${AV_PROVIDER}, (now() AT TIME ZONE 'UTC')::date, 0, now())
    ON CONFLICT (provider, day) DO UPDATE SET exhausted_at = now()
  `;
}

// ---------------------------------------------------------------------------
// Alpha Vantage client
// ---------------------------------------------------------------------------

/** GET an AV endpoint. Never logs the URL (it carries the key). */
async function avGet(params: Record<string, string>): Promise<string> {
  const url = `${AV_URL}?${new URLSearchParams({ ...params, apikey: avKey() })}`;
  const res = await fetch(url, { cache: 'no-store' });
  const text = await res.text();
  if (!res.ok) throw new Error(`Alpha Vantage ${params.function} HTTP ${res.status}`);
  if (text.trimStart().startsWith('{')) {
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* not JSON after all */ }
    if (body && (body.Information || body.Note)) throw new AvRateLimited(String(body.Information || body.Note).slice(0, 200));
    if (body && body['Error Message']) throw new Error(`Alpha Vantage ${params.function}: ${String(body['Error Message']).slice(0, 200)}`);
  }
  return text;
}

/** RFC-4180-ish CSV: quoted fields, embedded commas, doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const avNum = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const t = v.trim();
  if (t === '' || t.toLowerCase() === 'none' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const avTime = (v: string | undefined): EarningsTime => (v === 'pre-market' || v === 'post-market' ? v : null);

// ---------------------------------------------------------------------------
// Result upsert (shared by news and AV)
// ---------------------------------------------------------------------------

interface ResultRow {
  symbol: string;
  reportedDate: string;
  reportTime: EarningsTime;
  period: string | null;
  fiscalDateEnding: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  epsSurprisePct: number | null;
  epsOutcome: EarningsOutcome | null;
  epsAdjusted: boolean | null;
  salesActual: number | null;
  salesEstimate: number | null;
  salesOutcome: EarningsOutcome | null;
  source: 'alpaca_news' | 'alphavantage';
  headline: string | null;
  newsId: number | null;
}

/**
 * Insert or merge reported quarters. A row lands on an existing report for
 * the same symbol within ±3 days (news publish date vs AV reportedDate can
 * differ by a day). Existing news values win over AV (better consensus
 * numbers); AV fills gaps and owns report_time and fiscal_date_ending.
 */
async function upsertResults(input: ResultRow[]): Promise<number> {
  // Collapse repeats of one report inside the batch (e.g. the original
  // headline plus a next-day "Reported Earlier," copy) — keep the earliest.
  const sorted = [...input].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.reportedDate.localeCompare(b.reportedDate));
  const rows: ResultRow[] = [];
  for (const r of sorted) {
    const prev = rows[rows.length - 1];
    if (prev && prev.symbol === r.symbol && daysBetween(prev.reportedDate, r.reportedDate) <= 3) continue;
    rows.push(r);
  }
  if (rows.length === 0) return 0;
  const col = <K extends keyof ResultRow>(k: K) => rows.map(r => r[k]);
  const result = await sql`
    WITH incoming AS (
      SELECT * FROM unnest(
        ${col('symbol')}::text[], ${col('reportedDate')}::date[], ${col('reportTime')}::text[], ${col('period')}::text[],
        ${col('fiscalDateEnding')}::date[], ${col('epsActual')}::numeric[], ${col('epsEstimate')}::numeric[],
        ${col('epsSurprisePct')}::numeric[], ${col('epsOutcome')}::text[], ${col('epsAdjusted')}::boolean[],
        ${col('salesActual')}::numeric[], ${col('salesEstimate')}::numeric[], ${col('salesOutcome')}::text[],
        ${col('source')}::text[], ${col('headline')}::text[], ${col('newsId')}::bigint[]
      ) AS t(symbol, reported_date, report_time, period, fiscal_date_ending, eps_actual, eps_estimate,
             eps_surprise_pct, eps_outcome, eps_adjusted, sales_actual, sales_estimate, sales_outcome,
             source, headline, news_id)
    ),
    placed AS (
      -- One row per (symbol, target date): snap onto an existing nearby report.
      SELECT DISTINCT ON (i.symbol, COALESCE(e.reported_date, i.reported_date))
        i.*, COALESCE(e.reported_date, i.reported_date) AS target_date
      FROM incoming i
      LEFT JOIN LATERAL (
        SELECT reported_date FROM public.nt_earnings x
        WHERE x.symbol = i.symbol AND x.reported_date BETWEEN i.reported_date - 3 AND i.reported_date + 3
        ORDER BY abs(x.reported_date - i.reported_date) LIMIT 1
      ) e ON true
      ORDER BY i.symbol, COALESCE(e.reported_date, i.reported_date), i.reported_date
    )
    INSERT INTO public.nt_earnings AS n (
      symbol, reported_date, report_time, period, fiscal_date_ending, eps_actual, eps_estimate, eps_surprise_pct,
      eps_outcome, eps_adjusted, sales_actual, sales_estimate, sales_outcome, source, headline, news_id, fetched_at
    )
    SELECT symbol, target_date, report_time, period, fiscal_date_ending, eps_actual, eps_estimate, eps_surprise_pct,
           eps_outcome, eps_adjusted, sales_actual, sales_estimate, sales_outcome, source, headline, news_id, now()
    FROM placed
    ON CONFLICT (symbol, reported_date) DO UPDATE SET
      report_time        = CASE WHEN EXCLUDED.source = 'alphavantage' THEN COALESCE(EXCLUDED.report_time, n.report_time) ELSE COALESCE(n.report_time, EXCLUDED.report_time) END,
      fiscal_date_ending = COALESCE(EXCLUDED.fiscal_date_ending, n.fiscal_date_ending),
      period             = COALESCE(n.period, EXCLUDED.period),
      eps_actual         = CASE WHEN n.source = 'alpaca_news' THEN COALESCE(n.eps_actual, EXCLUDED.eps_actual) ELSE COALESCE(EXCLUDED.eps_actual, n.eps_actual) END,
      eps_estimate       = CASE WHEN n.source = 'alpaca_news' THEN COALESCE(n.eps_estimate, EXCLUDED.eps_estimate) ELSE COALESCE(EXCLUDED.eps_estimate, n.eps_estimate) END,
      eps_surprise_pct   = CASE WHEN n.source = 'alpaca_news' THEN COALESCE(n.eps_surprise_pct, EXCLUDED.eps_surprise_pct) ELSE COALESCE(EXCLUDED.eps_surprise_pct, n.eps_surprise_pct) END,
      eps_outcome        = CASE WHEN n.source = 'alpaca_news' THEN COALESCE(n.eps_outcome, EXCLUDED.eps_outcome) ELSE COALESCE(EXCLUDED.eps_outcome, n.eps_outcome) END,
      eps_adjusted       = CASE WHEN n.source = 'alpaca_news' THEN COALESCE(n.eps_adjusted, EXCLUDED.eps_adjusted) ELSE COALESCE(EXCLUDED.eps_adjusted, n.eps_adjusted) END,
      sales_actual       = CASE WHEN n.source = 'alpaca_news' THEN COALESCE(n.sales_actual, EXCLUDED.sales_actual) ELSE COALESCE(EXCLUDED.sales_actual, n.sales_actual) END,
      sales_estimate     = CASE WHEN n.source = 'alpaca_news' THEN COALESCE(n.sales_estimate, EXCLUDED.sales_estimate) ELSE COALESCE(EXCLUDED.sales_estimate, n.sales_estimate) END,
      sales_outcome      = CASE WHEN n.source = 'alpaca_news' THEN COALESCE(n.sales_outcome, EXCLUDED.sales_outcome) ELSE COALESCE(EXCLUDED.sales_outcome, n.sales_outcome) END,
      source             = CASE WHEN n.source = 'alpaca_news' OR EXCLUDED.source = 'alpaca_news' THEN 'alpaca_news' ELSE 'alphavantage' END,
      headline           = COALESCE(n.headline, EXCLUDED.headline),
      news_id            = COALESCE(n.news_id, EXCLUDED.news_id),
      fetched_at         = now()
    RETURNING 1
  `;
  return result.length;
}

/** "CORRECTION:" headlines replace the figures of the report they correct. */
async function applyCorrections(rows: ResultRow[]): Promise<void> {
  for (const r of rows) {
    await sql`
      UPDATE public.nt_earnings SET
        eps_actual = ${r.epsActual}, eps_estimate = ${r.epsEstimate}, eps_surprise_pct = ${r.epsSurprisePct},
        eps_outcome = ${r.epsOutcome}, eps_adjusted = ${r.epsAdjusted}, sales_actual = ${r.salesActual},
        sales_estimate = ${r.salesEstimate}, sales_outcome = ${r.salesOutcome}, period = COALESCE(${r.period}, period),
        source = 'alpaca_news', headline = ${r.headline}, news_id = ${r.newsId}, fetched_at = now()
      WHERE symbol = ${r.symbol} AND reported_date BETWEEN ${r.reportedDate}::date - 3 AND ${r.reportedDate}::date + 3
    `;
  }
}

/** Calendar rows whose report now has a stored result. */
async function resolveCalendar(): Promise<void> {
  await sql`
    UPDATE public.nt_earnings_calendar c SET status = 'resolved'
    WHERE c.status IN ('scheduled', 'pending_results')
      AND EXISTS (
        SELECT 1 FROM public.nt_earnings e
        WHERE e.symbol = c.symbol AND e.reported_date BETWEEN c.report_date - 3 AND c.report_date + 10
      )
  `;
}

// ---------------------------------------------------------------------------
// Step 1 — Alpha Vantage calendar (1 call/day)
// ---------------------------------------------------------------------------

export async function syncCalendar(): Promise<{ status: string; rows?: number; dropped?: number }> {
  if (!avKey()) return { status: 'skipped: ALPHA_VANTAGE_API_KEY not set' };
  const [{ synced }] = (await sql`
    SELECT EXISTS (
      SELECT 1 FROM public.nt_earnings_calendar
      WHERE last_seen_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    ) AS synced
  `) as Array<{ synced: boolean }>;
  if (synced) return { status: 'already synced today' };
  if (!(await reserveAvCall())) return { status: 'skipped: AV budget used' };

  let text: string;
  try {
    text = await avGet({ function: 'EARNINGS_CALENDAR', horizon: '3month' });
  } catch (err) {
    if (err instanceof AvRateLimited) await markAvExhausted();
    throw err;
  }
  const table = parseCsv(text);
  const header = table[0] ?? [];
  if (header[0] !== 'symbol' || table.length < 1000) {
    // Never apply a partial or error body: the previous snapshot stays.
    throw new Error(`Unexpected EARNINGS_CALENDAR body (${table.length} rows, header "${header.join(',').slice(0, 80)}")`);
  }
  const idx = (name: string) => header.indexOf(name);
  const [iSym, iDate, iFiscal, iEst, iTime] = ['symbol', 'reportDate', 'fiscalDateEnding', 'estimate', 'timeOfTheDay'].map(idx);

  const tracked = new Set(await getTrackedSymbols());
  const rows = table.slice(1)
    .filter(r => tracked.has((r[iSym] ?? '').toUpperCase()) && /^\d{4}-\d{2}-\d{2}$/.test(r[iDate] ?? ''))
    .map(r => ({
      symbol: r[iSym].toUpperCase(),
      date: r[iDate],
      fiscal: /^\d{4}-\d{2}-\d{2}$/.test(r[iFiscal] ?? '') ? r[iFiscal] : null,
      estimate: avNum(r[iEst]),
      time: avTime(iTime >= 0 ? r[iTime] : undefined),
    }));

  const syncStart = new Date().toISOString();
  if (rows.length > 0) {
    await sql`
      INSERT INTO public.nt_earnings_calendar AS c (symbol, report_date, fiscal_date_ending, eps_estimate, time_of_day, status)
      SELECT symbol, report_date, fiscal_date_ending, eps_estimate, time_of_day, 'scheduled'
      FROM unnest(${rows.map(r => r.symbol)}::text[], ${rows.map(r => r.date)}::date[], ${rows.map(r => r.fiscal)}::date[],
                  ${rows.map(r => r.estimate)}::numeric[], ${rows.map(r => r.time)}::text[])
        AS t(symbol, report_date, fiscal_date_ending, eps_estimate, time_of_day)
      ON CONFLICT (symbol, report_date) DO UPDATE SET
        fiscal_date_ending = EXCLUDED.fiscal_date_ending,
        eps_estimate = EXCLUDED.eps_estimate,
        time_of_day = COALESCE(EXCLUDED.time_of_day, c.time_of_day),
        status = CASE WHEN c.status = 'dropped' THEN 'scheduled' ELSE c.status END,
        last_seen_at = now()
    `;
  }
  const today = todayET();
  // A future date that vanished from the snapshot was rescheduled or cancelled.
  const dropped = await sql`
    UPDATE public.nt_earnings_calendar SET status = 'dropped'
    WHERE status = 'scheduled' AND report_date >= ${today}::date AND last_seen_at < ${syncStart}::timestamptz
    RETURNING 1
  `;
  // Past dates leave the calendar once they happen — they become due work, never deleted.
  await sql`
    UPDATE public.nt_earnings_calendar SET status = 'pending_results'
    WHERE status = 'scheduled' AND report_date < ${today}::date
  `;
  await sql`DELETE FROM public.nt_earnings_calendar WHERE status = 'dropped' AND last_seen_at < now() - interval '30 days'`;
  await resolveCalendar();
  return { status: 'synced', rows: rows.length, dropped: dropped.length };
}

// ---------------------------------------------------------------------------
// Step 2 — Alpaca News results (no AV budget; runs often)
// ---------------------------------------------------------------------------

interface NewsArticle { id: number; headline: string; symbols: string[]; created_at: string }

/** Page through Alpaca news. `symbols` narrows server-side; stops at `deadline`. */
export async function* alpacaNews(opts: { start: string; end?: string; symbols?: string[]; deadline?: number; maxPages?: number }) {
  let token: string | null = null;
  let pages = 0;
  do {
    const params = new URLSearchParams({ start: opts.start, limit: '50', sort: 'asc', include_content: 'false' });
    if (opts.end) params.set('end', opts.end);
    if (opts.symbols?.length) params.set('symbols', opts.symbols.join(','));
    if (token) params.set('page_token', token);
    const res = await fetch(`${ALPACA_NEWS_URL}?${params}`, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
        'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
      },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Alpaca news HTTP ${res.status}`);
    const body = (await res.json()) as { news?: NewsArticle[]; next_page_token?: string | null };
    yield body.news ?? [];
    token = body.next_page_token ?? null;
    pages++;
  } while (token && (!opts.maxPages || pages < opts.maxPages) && (!opts.deadline || Date.now() < opts.deadline));
}

/** Turn news articles into result rows for tracked symbols. Exported for the backfill script. */
export function resultRowsFromNews(articles: NewsArticle[], tracked: Set<string>): { rows: ResultRow[]; corrections: ResultRow[] } {
  const rows: ResultRow[] = [];
  const corrections: ResultRow[] = [];
  for (const a of articles) {
    const parsed = parseEarningsHeadline(a.headline);
    if (!parsed) continue;
    const symbols = symbolsForResult(a.symbols, tracked);
    if (symbols.length === 0) continue;
    const { date, session } = easternDateAndSession(a.created_at);
    for (const symbol of symbols) {
      const row: ResultRow = {
        symbol,
        reportedDate: date,
        reportTime: session,
        period: parsed.period,
        fiscalDateEnding: null,
        epsActual: parsed.epsActual,
        epsEstimate: parsed.epsEstimate,
        epsSurprisePct: surprisePct(parsed.epsActual, parsed.epsEstimate),
        epsOutcome: parsed.epsOutcome,
        epsAdjusted: parsed.epsAdjusted,
        salesActual: parsed.salesActual,
        salesEstimate: parsed.salesEstimate,
        salesOutcome: parsed.salesOutcome,
        source: 'alpaca_news',
        headline: a.headline.slice(0, 500),
        newsId: a.id,
      };
      (parsed.correction ? corrections : rows).push(row);
    }
  }
  return { rows, corrections };
}

/** Store parsed news results (merge + corrections + calendar resolution). */
export async function storeNewsResults(articles: NewsArticle[], tracked: Set<string>): Promise<number> {
  const { rows, corrections } = resultRowsFromNews(articles, tracked);
  const stored = await upsertResults(rows);
  await applyCorrections(corrections);
  if (stored > 0 || corrections.length > 0) await resolveCalendar();
  return stored + corrections.length;
}

export async function syncResultsFromNews(opts: { lookbackHours?: number; deadline?: number } = {}): Promise<{ articles: number; results: number }> {
  const tracked = await getTrackedSymbols();
  const trackedSet = new Set(tracked);
  const start = new Date(Date.now() - (opts.lookbackHours ?? 30) * 3_600_000).toISOString();
  let articles = 0;
  let results = 0;
  for await (const page of alpacaNews({ start, symbols: tracked, deadline: opts.deadline })) {
    articles += page.length;
    results += await storeNewsResults(page, trackedSet);
  }
  return { articles, results };
}

// ---------------------------------------------------------------------------
// Step 3 — Alpha Vantage per-symbol history (backfill + fallback)
// ---------------------------------------------------------------------------

/** Backoff after AV didn't have the quarter yet (or errored): 6h, 1d, 2d, then 7d. */
function backoffHours(attempts: number): number {
  return [6, 24, 48][attempts] ?? 168;
}

async function pickAvCandidates(limit: number): Promise<Array<{ symbol: string; fallback: boolean; attempts: number }>> {
  const today = todayET();
  const rows = await sql`
    WITH tracked AS (
      SELECT DISTINCT symbol FROM public.nt_market_expiries
      WHERE source = 'eod' AND last_trade_date >= CURRENT_DATE - 30
    ),
    fallback AS (
      -- Reports two+ days old with no result: no parseable headline, ask AV.
      SELECT DISTINCT symbol FROM public.nt_earnings_calendar
      WHERE status = 'pending_results' AND report_date <= ${today}::date - 2
    ),
    watch AS (SELECT DISTINCT symbol FROM public.nt_watchlist_items),
    soon AS (
      SELECT DISTINCT symbol FROM public.nt_earnings_calendar
      WHERE status = 'scheduled' AND report_date BETWEEN ${today}::date AND ${today}::date + 14
    )
    SELECT t.symbol, (f.symbol IS NOT NULL) AS fallback, COALESCE(s.attempts, 0) AS attempts
    FROM tracked t
    LEFT JOIN public.nt_earnings_sync s ON s.symbol = t.symbol
    LEFT JOIN fallback f ON f.symbol = t.symbol
    LEFT JOIN watch w ON w.symbol = t.symbol
    LEFT JOIN soon n ON n.symbol = t.symbol
    LEFT JOIN public.securities sec ON sec.symbol = t.symbol
    WHERE (s.next_attempt_at IS NULL OR s.next_attempt_at <= now())
      AND (
        f.symbol IS NOT NULL
        OR (s.history_fetched_at IS NULL AND COALESCE(s.status, 'pending') NOT IN ('no_earnings', 'unmapped'))
        OR (s.status IN ('no_earnings', 'unmapped') AND s.history_fetched_at < now() - interval '180 days')
      )
    ORDER BY
      (f.symbol IS NOT NULL) DESC,
      (w.symbol IS NOT NULL) DESC,
      (n.symbol IS NOT NULL) DESC,
      -- A null date in the old yfinance snapshot almost always means an ETF.
      (sec.symbol IS NOT NULL AND sec.next_earnings_date IS NULL) ASC,
      COALESCE(sec.market_cap, 0) DESC,
      t.symbol
    LIMIT ${limit}
  `;
  return rows.map((r: any) => ({ symbol: r.symbol, fallback: r.fallback, attempts: Number(r.attempts) }));
}

async function recordSync(symbol: string, status: string, ok: boolean, attempts: number, error?: string): Promise<void> {
  const nextAttempt = ok ? null : new Date(Date.now() + backoffHours(attempts) * 3_600_000).toISOString();
  await sql`
    INSERT INTO public.nt_earnings_sync AS s (symbol, status, history_fetched_at, next_attempt_at, attempts, last_error)
    VALUES (${symbol}, ${status}, ${ok ? new Date().toISOString() : null}::timestamptz, ${nextAttempt}::timestamptz, ${ok ? 0 : attempts + 1}, ${error ?? null})
    ON CONFLICT (symbol) DO UPDATE SET
      status = EXCLUDED.status,
      history_fetched_at = COALESCE(EXCLUDED.history_fetched_at, s.history_fetched_at),
      next_attempt_at = EXCLUDED.next_attempt_at,
      attempts = EXCLUDED.attempts,
      last_error = EXCLUDED.last_error
  `;
}

export async function backfillFromAv(opts: { maxCalls?: number; deadline: number }): Promise<{ status: string; fetched: string[] }> {
  if (!avKey()) return { status: 'skipped: ALPHA_VANTAGE_API_KEY not set', fetched: [] };
  const candidates = await pickAvCandidates(opts.maxCalls ?? 3);
  const fetched: string[] = [];
  for (const c of candidates) {
    if (fetched.length > 0) await sleep(avMinIntervalMs());
    if (Date.now() + 8_000 > opts.deadline) return { status: 'deadline', fetched };
    if (!(await reserveAvCall())) return { status: 'budget used', fetched };

    let body: any;
    try {
      body = JSON.parse(await avGet({ function: 'EARNINGS', symbol: c.symbol }));
    } catch (err) {
      if (err instanceof AvRateLimited) {
        await markAvExhausted();
        return { status: 'AV rate limited', fetched };
      }
      await recordSync(c.symbol, 'error', false, c.attempts, err instanceof Error ? err.message.slice(0, 300) : 'error');
      continue;
    }

    const quarters: any[] = Array.isArray(body?.quarterlyEarnings) ? body.quarterlyEarnings : [];
    const today = todayET();
    const rows: ResultRow[] = quarters
      .filter(q => /^\d{4}-\d{2}-\d{2}$/.test(q.reportedDate ?? '') && q.reportedDate <= today && avNum(q.reportedEPS) !== null)
      .slice(0, 16)
      .map(q => {
        const actual = avNum(q.reportedEPS);
        const estimate = avNum(q.estimatedEPS);
        const pct = avNum(q.surprisePercentage) ?? surprisePct(actual, estimate);
        return {
          symbol: c.symbol,
          reportedDate: q.reportedDate,
          reportTime: avTime(q.reportTime),
          period: null,
          fiscalDateEnding: /^\d{4}-\d{2}-\d{2}$/.test(q.fiscalDateEnding ?? '') ? q.fiscalDateEnding : null,
          epsActual: actual,
          epsEstimate: estimate,
          epsSurprisePct: pct,
          epsOutcome: outcomeFromSurprise(pct),
          epsAdjusted: null,
          salesActual: null,
          salesEstimate: null,
          salesOutcome: null,
          source: 'alphavantage' as const,
          headline: null,
          newsId: null,
        };
      });

    if (rows.length === 0) {
      // No history: an ETF/fund, or a ticker AV maps differently. Recheck in 180 days.
      const [{ inCalendar }] = (await sql`
        SELECT EXISTS (SELECT 1 FROM public.nt_earnings_calendar WHERE symbol = ${c.symbol}) AS "inCalendar"
      `) as Array<{ inCalendar: boolean }>;
      await recordSync(c.symbol, inCalendar ? 'unmapped' : 'no_earnings', true, c.attempts);
    } else {
      await upsertResults(rows);
      await resolveCalendar();
      const [{ stillPending }] = (await sql`
        SELECT EXISTS (
          SELECT 1 FROM public.nt_earnings_calendar
          WHERE symbol = ${c.symbol} AND status = 'pending_results' AND report_date <= ${today}::date - 2
        ) AS "stillPending"
      `) as Array<{ stillPending: boolean }>;
      // History stored; if AV doesn't have the newest quarter yet, come back later for it.
      if (c.fallback && stillPending) await recordSync(c.symbol, 'ok', false, c.attempts, 'latest quarter not yet in AV');
      else await recordSync(c.symbol, 'ok', true, c.attempts);
    }
    fetched.push(c.symbol);
  }
  return { status: candidates.length === 0 ? 'nothing to fetch' : 'ok', fetched };
}

// ---------------------------------------------------------------------------
// Orchestration (one cron invocation)
// ---------------------------------------------------------------------------

export interface EarningsRunPlan { calendar: boolean; news: boolean; backfill: boolean }

export async function processEarnings(plan: EarningsRunPlan, deadline: number): Promise<Record<string, unknown>> {
  if (!(await acquireLease(Math.ceil((deadline - Date.now()) / 1000) + 5))) return { skipped: 'another run holds the lease' };
  const out: Record<string, unknown> = {};
  try {
    if (plan.calendar) {
      try { out.calendar = await syncCalendar(); } catch (e) { out.calendar = { error: e instanceof Error ? e.message : String(e) }; }
    }
    if (plan.news) {
      try { out.news = await syncResultsFromNews({ deadline: deadline - 20_000 }); } catch (e) { out.news = { error: e instanceof Error ? e.message : String(e) }; }
    }
    if (plan.backfill) {
      try { out.backfill = await backfillFromAv({ deadline }); } catch (e) { out.backfill = { error: e instanceof Error ? e.message : String(e) }; }
    }
  } finally {
    await releaseLease();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

function toResult(r: any): EarningsResult {
  const epsSurprisePct = num(r.eps_surprise_pct);
  return {
    date: r.reported_date,
    time: (r.report_time ?? null) as EarningsTime,
    period: r.period ?? null,
    fiscalDateEnding: r.fiscal_date_ending ?? null,
    epsActual: num(r.eps_actual),
    epsEstimate: num(r.eps_estimate),
    epsSurprisePct,
    epsOutcome: (r.eps_outcome as EarningsOutcome | null) ?? outcomeFromSurprise(epsSurprisePct),
    epsAdjusted: r.eps_adjusted ?? null,
    salesActual: num(r.sales_actual),
    salesEstimate: num(r.sales_estimate),
    salesOutcome: (r.sales_outcome as EarningsOutcome | null) ?? null,
    source: r.source,
  };
}

const RESULT_COLUMNS = `reported_date::text AS reported_date, report_time, period, fiscal_date_ending::text AS fiscal_date_ending,
  eps_actual, eps_estimate, eps_surprise_pct, eps_outcome, eps_adjusted, sales_actual, sales_estimate, sales_outcome, source`;

/** Next / last / pending earnings per symbol. Missing symbols get an all-null summary. */
export async function getEarningsSummary(symbols: string[]): Promise<Map<string, EarningsSummary>> {
  const upper = Array.from(new Set(symbols.map(s => s.toUpperCase())));
  const out = new Map<string, EarningsSummary>();
  if (upper.length === 0) return out;
  const today = todayET();
  try {
    const [nextRows, lastRows, pendingRows] = await Promise.all([
      sql`
        SELECT DISTINCT ON (symbol) symbol, report_date::text AS report_date, time_of_day, eps_estimate
        FROM public.nt_earnings_calendar
        WHERE symbol = ANY(${upper}) AND status = 'scheduled' AND report_date >= ${today}::date
        ORDER BY symbol, report_date
      `,
      sql(
        `SELECT DISTINCT ON (symbol) symbol, ${RESULT_COLUMNS}
         FROM public.nt_earnings WHERE symbol = ANY($1) ORDER BY symbol, reported_date DESC`,
        [upper]
      ),
      sql`
        SELECT DISTINCT ON (symbol) symbol, report_date::text AS report_date, time_of_day
        FROM public.nt_earnings_calendar
        WHERE symbol = ANY(${upper}) AND status = 'pending_results'
        ORDER BY symbol, report_date DESC
      `,
    ]);
    for (const s of upper) out.set(s, { symbol: s, next: null, last: null, pending: null });
    for (const r of nextRows as any[]) {
      out.get(r.symbol)!.next = {
        date: r.report_date,
        time: (r.time_of_day ?? null) as EarningsTime,
        epsEstimate: num(r.eps_estimate),
        daysUntil: daysBetween(today, r.report_date),
      };
    }
    for (const r of lastRows as any[]) out.get(r.symbol)!.last = toResult(r);
    for (const r of pendingRows as any[]) {
      const summary = out.get(r.symbol)!;
      if (!summary.last || summary.last.date < addDays(r.report_date, -3)) {
        summary.pending = { date: r.report_date, time: (r.time_of_day ?? null) as EarningsTime };
      }
    }
  } catch (err) {
    // Tables not bootstrapped yet, or a transient error: pages render without earnings.
    console.error('[earnings] summary read failed:', err instanceof Error ? err.message : err);
  }
  return out;
}

export async function getEarningsHistory(symbol: string, limit = 12): Promise<EarningsResult[]> {
  try {
    const rows = await sql(
      `SELECT ${RESULT_COLUMNS} FROM public.nt_earnings WHERE symbol = $1 ORDER BY reported_date DESC LIMIT $2`,
      [symbol.toUpperCase(), limit]
    );
    return (rows as any[]).map(toResult);
  } catch (err) {
    console.error('[earnings] history read failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

/** Upcoming (today → +aheadDays) and reported (−backDays → today) events for a symbol set, soonest first. */
export async function getEarningsEvents(symbols: string[], opts: { aheadDays?: number; backDays?: number } = {}): Promise<EarningsEvent[]> {
  const upper = Array.from(new Set(symbols.map(s => s.toUpperCase())));
  if (upper.length === 0) return [];
  const today = todayET();
  const to = addDays(today, opts.aheadDays ?? 14);
  const from = addDays(today, -(opts.backDays ?? 7));
  try {
    const [upcoming, reported] = await Promise.all([
      sql`
        SELECT symbol, report_date::text AS report_date, time_of_day, eps_estimate
        FROM public.nt_earnings_calendar
        WHERE symbol = ANY(${upper}) AND status = 'scheduled' AND report_date BETWEEN ${today}::date AND ${to}::date
      `,
      sql(
        `SELECT symbol, ${RESULT_COLUMNS} FROM public.nt_earnings
         WHERE symbol = ANY($1) AND reported_date BETWEEN $2::date AND $3::date`,
        [upper, from, today]
      ),
    ]);
    const events: EarningsEvent[] = [
      ...(upcoming as any[]).map(r => ({
        symbol: r.symbol, kind: 'upcoming' as const, date: r.report_date, time: (r.time_of_day ?? null) as EarningsTime,
        daysUntil: daysBetween(today, r.report_date), epsEstimate: num(r.eps_estimate),
        epsActual: null, epsSurprisePct: null, epsOutcome: null,
      })),
      ...(reported as any[]).map(r => {
        const res = toResult(r);
        return {
          symbol: r.symbol, kind: 'reported' as const, date: res.date, time: res.time,
          daysUntil: daysBetween(today, res.date), epsEstimate: res.epsEstimate,
          epsActual: res.epsActual, epsSurprisePct: res.epsSurprisePct, epsOutcome: res.epsOutcome,
        };
      }),
    ];
    // Just-reported first (newest first), then upcoming (soonest first).
    return events.sort((a, b) =>
      a.kind !== b.kind ? (a.kind === 'reported' ? -1 : 1) : a.kind === 'reported' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)
    );
  } catch (err) {
    console.error('[earnings] events read failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
