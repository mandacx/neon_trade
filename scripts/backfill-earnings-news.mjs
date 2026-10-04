// One-time (re-runnable) backfill of reported earnings from Alpaca News
// (Benzinga results headlines) into nt_earnings, so every symbol has recent
// results on day 1 instead of waiting weeks for the Alpha Vantage backfill
// (25 calls/day). Run locally — it pages through months of news:
//
//   node --env-file=.env.local scripts/backfill-earnings-news.mjs [days=200]
//
// Uses the same parser as the app (lib/earningsParse.ts, loaded via Node's
// built-in TypeScript stripping). Inserts never overwrite existing rows;
// "CORRECTION:" headlines replace the figures of the report they correct.
// The live sync (lib/earnings.ts) applies the same merge rules.

import { neon } from '@neondatabase/serverless';
import { parseEarningsHeadline, symbolsForResult, easternDateAndSession } from '../lib/earningsParse.ts';

for (const k of ['DATABASE_URL', 'ALPACA_API_KEY', 'ALPACA_SECRET_KEY']) {
  if (!process.env[k]) { console.error(`${k} is not set — run with --env-file=.env.local`); process.exit(1); }
}
const sql = neon(process.env.DATABASE_URL);
const DAYS = Number(process.argv[2] || 200);
const NEWS_URL = `${process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets'}/v1beta1/news`;

const tracked = (await sql`
  SELECT DISTINCT symbol FROM public.nt_market_expiries
  WHERE source = 'eod' AND last_trade_date >= CURRENT_DATE - 30
`).map(r => r.symbol);
const trackedSet = new Set(tracked);
console.log(`tracking ${tracked.length} symbols; scanning ${DAYS} days of news`);

const surprisePct = (a, e) => (a === null || e === null || e === 0 ? null : ((a - e) / Math.abs(e)) * 100);

function rowsFrom(articles) {
  const rows = [], corrections = [];
  for (const a of articles) {
    const p = parseEarningsHeadline(a.headline);
    if (!p) continue;
    const { date, session } = easternDateAndSession(a.created_at);
    for (const symbol of symbolsForResult(a.symbols, trackedSet)) {
      const row = {
        symbol, date, session, period: p.period, epsActual: p.epsActual, epsEstimate: p.epsEstimate,
        epsSurprisePct: surprisePct(p.epsActual, p.epsEstimate), epsOutcome: p.epsOutcome, epsAdjusted: p.epsAdjusted,
        salesActual: p.salesActual, salesEstimate: p.salesEstimate, salesOutcome: p.salesOutcome,
        headline: a.headline.slice(0, 500), newsId: a.id,
      };
      (p.correction ? corrections : rows).push(row);
    }
  }
  // Collapse repeats of one report within the batch (keep the earliest).
  rows.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.date.localeCompare(b.date));
  const deduped = [];
  for (const r of rows) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.symbol === r.symbol && (Date.parse(r.date) - Date.parse(prev.date)) / 86_400_000 <= 3) continue;
    deduped.push(r);
  }
  return { rows: deduped, corrections };
}

async function insertRows(rows) {
  if (rows.length === 0) return 0;
  const col = k => rows.map(r => r[k]);
  const res = await sql`
    WITH incoming AS (
      SELECT * FROM unnest(
        ${col('symbol')}::text[], ${col('date')}::date[], ${col('session')}::text[], ${col('period')}::text[],
        ${col('epsActual')}::numeric[], ${col('epsEstimate')}::numeric[], ${col('epsSurprisePct')}::numeric[],
        ${col('epsOutcome')}::text[], ${col('epsAdjusted')}::boolean[], ${col('salesActual')}::numeric[],
        ${col('salesEstimate')}::numeric[], ${col('salesOutcome')}::text[], ${col('headline')}::text[], ${col('newsId')}::bigint[]
      ) AS t(symbol, reported_date, report_time, period, eps_actual, eps_estimate, eps_surprise_pct, eps_outcome,
             eps_adjusted, sales_actual, sales_estimate, sales_outcome, headline, news_id)
    )
    INSERT INTO public.nt_earnings (symbol, reported_date, report_time, period, eps_actual, eps_estimate, eps_surprise_pct,
      eps_outcome, eps_adjusted, sales_actual, sales_estimate, sales_outcome, source, headline, news_id)
    SELECT i.symbol, i.reported_date, i.report_time, i.period, i.eps_actual, i.eps_estimate, i.eps_surprise_pct,
      i.eps_outcome, i.eps_adjusted, i.sales_actual, i.sales_estimate, i.sales_outcome, 'alpaca_news', i.headline, i.news_id
    FROM incoming i
    -- A report already stored within ±3 days (e.g. a later "Reported Earlier," copy) is the same report.
    WHERE NOT EXISTS (
      SELECT 1 FROM public.nt_earnings x
      WHERE x.symbol = i.symbol AND x.reported_date BETWEEN i.reported_date - 3 AND i.reported_date + 3
    )
    ON CONFLICT (symbol, reported_date) DO NOTHING
    RETURNING 1
  `;
  return res.length;
}

async function applyCorrections(rows) {
  for (const r of rows) {
    await sql`
      UPDATE public.nt_earnings SET
        eps_actual = ${r.epsActual}, eps_estimate = ${r.epsEstimate}, eps_surprise_pct = ${r.epsSurprisePct},
        eps_outcome = ${r.epsOutcome}, eps_adjusted = ${r.epsAdjusted}, sales_actual = ${r.salesActual},
        sales_estimate = ${r.salesEstimate}, sales_outcome = ${r.salesOutcome}, period = COALESCE(${r.period}, period),
        source = 'alpaca_news', headline = ${r.headline}, news_id = ${r.newsId}, fetched_at = now()
      WHERE symbol = ${r.symbol} AND reported_date BETWEEN ${r.date}::date - 3 AND ${r.date}::date + 3
    `;
  }
}

const start = new Date(Date.now() - DAYS * 86_400_000).toISOString();
let token = null, pages = 0, articles = 0, inserted = 0, corrected = 0;
const t0 = Date.now();
do {
  const params = new URLSearchParams({ start, limit: '50', sort: 'asc', include_content: 'false', symbols: tracked.join(',') });
  if (token) params.set('page_token', token);
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${NEWS_URL}?${params}`, {
      headers: { 'APCA-API-KEY-ID': process.env.ALPACA_API_KEY, 'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY },
    });
    if (res.status !== 429 || attempt >= 5) break;
    await new Promise(r => setTimeout(r, 15_000)); // Alpaca rate limit — back off and retry
  }
  if (!res.ok) { console.error(`news HTTP ${res.status} on page ${pages}; stopping (re-run to resume — inserts are idempotent)`); break; }
  const body = await res.json();
  const news = body.news ?? [];
  articles += news.length;
  const { rows, corrections } = rowsFrom(news);
  inserted += await insertRows(rows);
  await applyCorrections(corrections);
  corrected += corrections.length;
  token = body.next_page_token ?? null;
  pages++;
  if (pages % 100 === 0) {
    const last = news[news.length - 1]?.created_at?.slice(0, 10) ?? '?';
    console.log(`  ${pages} pages · ${articles} articles · up to ${last} · ${inserted} results stored · ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  }
  await new Promise(r => setTimeout(r, 320)); // stay under ~200 requests/min
} while (token);

// Calendar rows whose report now has a result.
await sql`
  UPDATE public.nt_earnings_calendar c SET status = 'resolved'
  WHERE c.status IN ('scheduled', 'pending_results')
    AND EXISTS (SELECT 1 FROM public.nt_earnings e WHERE e.symbol = c.symbol AND e.reported_date BETWEEN c.report_date - 3 AND c.report_date + 10)
`;

const [summary] = await sql`
  SELECT COUNT(*)::int AS rows, COUNT(DISTINCT symbol)::int AS symbols, MIN(reported_date)::text AS first, MAX(reported_date)::text AS last
  FROM public.nt_earnings
`;
console.log(`done: ${pages} pages, ${articles} articles, ${inserted} new results, ${corrected} corrections applied`);
console.log(`nt_earnings now: ${summary.rows} reports across ${summary.symbols} symbols (${summary.first} → ${summary.last})`);
