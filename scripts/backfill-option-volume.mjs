// Backfill nt_opt_daily_bars for past options loads (the daily cron only
// captures the latest load; see lib/optionVolume.ts, which this mirrors —
// scripts can't import the TypeScript lib).
//
//   node --env-file=.env.local scripts/backfill-option-volume.mjs --from 2026-09-01 [--to 2026-10-15]
//
// For every us_opt_chg_rpt load date D in the range, stores the daily bar of
// the trading session before D for each contract in that load. Resumable and
// idempotent: contracts that already have a row are skipped. Alpaca's option
// history starts in 2024; older dates simply come back as no_trade rows.

import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL || !process.env.ALPACA_API_KEY || !process.env.ALPACA_SECRET_KEY) {
  console.error('DATABASE_URL / ALPACA_API_KEY / ALPACA_SECRET_KEY not set — run with --env-file=.env.local');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
const arg = name => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const from = arg('--from');
const to = arg('--to') ?? new Date().toISOString().slice(0, 10);
if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
  console.error('usage: --from YYYY-MM-DD [--to YYYY-MM-DD]');
  process.exit(1);
}

const DATA_URL = process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets';
const TRADING_URL = process.env.ALPACA_TRADING_URL || 'https://paper-api.alpaca.markets';
const headers = { 'APCA-API-KEY-ID': process.env.ALPACA_API_KEY, 'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shift = (ymd, days) => new Date(Date.parse(`${ymd}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const calRes = await fetch(`${TRADING_URL}/v2/calendar?start=${shift(from, -14)}&end=${to}`, { headers });
if (!calRes.ok) throw new Error(`calendar HTTP ${calRes.status}`);
const tradingDays = (await calRes.json()).map(r => r.date).sort();
const previousSession = d => {
  const before = tradingDays.filter(x => x < d);
  return before.length ? before[before.length - 1] : null;
};

async function fetchBars(symbols, session) {
  const out = {};
  let pageToken;
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ symbols: symbols.join(','), timeframe: '1Day', limit: '10000', start: session, end: session });
    if (pageToken) qs.set('page_token', pageToken);
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${DATA_URL}/v1beta1/options/bars?${qs}`, { headers });
      if (res.status === 429 && attempt < 5) { await sleep(2000 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error(`bars HTTP ${res.status} ${await res.text()}`);
      const j = await res.json();
      for (const [sym, list] of Object.entries(j.bars ?? {})) (out[sym] ??= []).push(...list);
      pageToken = j.next_page_token;
      break;
    }
    if (!pageToken) break;
  }
  return out;
}

const loads = (await sql`
  SELECT trade_date::text AS d FROM public.nt_market_dates
  WHERE source = 'opt_chg' AND trade_date BETWEEN ${from}::date AND ${to}::date
  ORDER BY trade_date
`).map(r => r.d);
console.log(`${loads.length} load dates from ${from} to ${to}`);

for (const loadDate of loads) {
  const session = previousSession(loadDate);
  if (!session) { console.log(loadDate, 'no previous session, skipped'); continue; }
  const t0 = Date.now();
  // Contract key: the OCC symbol, derived for loads before 2026-10-06 where it is null (lib/oiTracker.ts occSql).
  const occ = `COALESCE(r.symbol, r.symbol_und || to_char(r.expiry_dt, 'YYMMDD') || CASE WHEN TRIM(r.opt_type) = 'call' THEN 'C' ELSE 'P' END || lpad((round(r.strike_pr * 1000))::bigint::text, 8, '0'))`;
  const contracts = (await sql(`
    SELECT DISTINCT ${occ} AS c FROM public.us_opt_chg_rpt r
    WHERE r.load_dt = $1::date
      AND NOT EXISTS (SELECT 1 FROM public.nt_opt_daily_bars b WHERE b.contract = ${occ} AND b.bar_date = $2::date)
  `, [loadDate, session])).map(r => r.c);
  let stored = 0, noTrade = 0;
  for (let i = 0; i < contracts.length; i += 1200) {
    const chunk = contracts.slice(i, i + 1200);
    // Six 200-symbol requests in parallel (~2.7s each; limit 200 requests/min).
    const parts = [];
    for (let j = 0; j < chunk.length; j += 200) parts.push(chunk.slice(j, j + 200));
    const bars = Object.assign({}, ...(await Promise.all(parts.map(p => fetchBars(p, session)))));
    const rows = chunk.map(c => {
      const b = (bars[c] ?? []).find(x => x.t.slice(0, 10) === session);
      return b ? { c, o: b.o, h: b.h, l: b.l, cl: b.c, v: b.v, vw: b.vw ?? null, n: b.n ?? null, nt: false }
               : { c, o: null, h: null, l: null, cl: null, v: 0, vw: null, n: null, nt: true };
    });
    await sql`
      INSERT INTO public.nt_opt_daily_bars (contract, bar_date, o, h, l, c, v, vw, n, no_trade)
      SELECT u.contract, ${session}::date, u.o, u.h, u.l, u.c, u.v, u.vw, u.n, u.no_trade
      FROM unnest(
        ${rows.map(r => r.c)}::text[], ${rows.map(r => r.o)}::numeric[], ${rows.map(r => r.h)}::numeric[],
        ${rows.map(r => r.l)}::numeric[], ${rows.map(r => r.cl)}::numeric[], ${rows.map(r => r.v)}::bigint[],
        ${rows.map(r => r.vw)}::numeric[], ${rows.map(r => r.n)}::int[], ${rows.map(r => r.nt)}::boolean[]
      ) AS u(contract, o, h, l, c, v, vw, n, no_trade)
      ON CONFLICT (contract, bar_date) DO NOTHING
    `;
    stored += rows.filter(r => !r.nt).length;
    noTrade += rows.filter(r => r.nt).length;
  }
  console.log(`${loadDate} (session ${session}): ${contracts.length} pending, ${stored} bars, ${noTrade} no-trade, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
