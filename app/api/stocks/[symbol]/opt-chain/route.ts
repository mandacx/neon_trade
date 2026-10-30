import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { catalogLastSeen, catalogTradeDatesUpTo } from '@/lib/marketCatalog';
import { sessionsForLoads } from '@/lib/marketSession';
import { getCurrentUserContext } from '@/lib/appUsers';
import { expiryAllowed, filterByExpiry, WEEKLY_EXPIRY_ERROR } from '@/lib/expiryAccess';
import { parseOcc } from '@/lib/occ';

// The OI published on load date D results from session D-1, so each row also
// carries `tradeDate` (the trading day before its load date; docs/oi-tracker.md).
// Best-effort: an empty map (calendar unavailable) makes callers fall back to the load date.
async function tradeDateByLoad(loads: string[]): Promise<Map<string, string>> {
  const distinct = [...new Set(loads)].sort();
  try {
    const sessions = await sessionsForLoads(distinct);
    return new Map(distinct.map((d, i) => [d, sessions[i]]));
  } catch (error) {
    console.error('Error mapping load dates to trading sessions:', error instanceof Error ? error.message : error);
    return new Map();
  }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
// `expiry=all` (every expiry of the symbol) is capped, keeping the largest |OI change| rows: a busy
// name reports ~200–1,500 changed contracts a day (measured 2026-10-28: SPY ~900, SPX ~1,100).
const ALL_EXPIRIES_MAX_ROWS = 5000;
const MAX_LOADS = 260;

// Per-strike option-chain OI snapshot(s) from public.us_opt_chg_rpt — a
// different, finer granularity than eod_usmkts_price's aggregate call/put OI
// (see app/api/stocks/[symbol]/oi/route.ts): one row per (strike, put/call)
// rather than one aggregate pair per day. This table is loaded once per
// trading day (one load_dt per day). An optional `from`/`to` range returns
// every day's snapshot in that window (one row per strike/type/day); without
// it, this returns just the single most recent load_dt available.
// `loads=N` (instead of `from`) means the last N loads (trading days) up to `to` (default today),
// read from the market catalog. `expiry=all` returns every expiry (weekly ones only for plans that
// have them), each row carrying its `expiry`, capped at ALL_EXPIRIES_MAX_ROWS (`truncated`).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    if (!symbol) {
      return NextResponse.json({ success: false, error: 'Symbol parameter is required' }, { status: 400 });
    }

    const expiry = request.nextUrl.searchParams.get('expiry');
    if (!expiry) {
      return NextResponse.json({ success: false, error: 'expiry query parameter is required' }, { status: 400 });
    }

    const allExpiries = expiry === 'all';
    if (!allExpiries && !YMD.test(expiry)) {
      return NextResponse.json({ success: false, error: 'expiry must be YYYY-MM-DD or all' }, { status: 400 });
    }

    // Plans limited to monthly/quarterly expiries get no weekly chains (lib/expiryAccess.ts).
    const ctx = await getCurrentUserContext();
    if (!allExpiries && !expiryAllowed(ctx.features, expiry)) {
      return NextResponse.json(WEEKLY_EXPIRY_ERROR, { status: 403 });
    }

    const upperSymbol = symbol.toUpperCase();
    let from = request.nextUrl.searchParams.get('from');
    let to = request.nextUrl.searchParams.get('to');
    const loadsParam = request.nextUrl.searchParams.get('loads');
    if (loadsParam) {
      const n = Math.min(Math.max(Math.floor(Number(loadsParam)) || 1, 1), MAX_LOADS);
      const upTo = to && YMD.test(to) ? to : new Date().toISOString().slice(0, 10);
      const dates = await catalogTradeDatesUpTo('opt_chg', upTo, n, async () => {
        const rows = await sql`
          SELECT DISTINCT load_dt::text AS d FROM public.us_opt_chg_rpt
          WHERE symbol_und = ${upperSymbol} AND load_dt <= ${upTo}::date
          ORDER BY d DESC LIMIT ${n}
        `;
        return rows.map((r: any) => r.d as string);
      });
      if (!dates.length) {
        return NextResponse.json({ success: true, data: { symbol: upperSymbol, expiryDate: expiry, from: null, to: null, rows: [] } });
      }
      from = dates[dates.length - 1];
      to = dates[0];
    }
    if ((from && !YMD.test(from)) || (to && !YMD.test(to))) {
      return NextResponse.json({ success: false, error: 'from/to must be YYYY-MM-DD' }, { status: 400 });
    }

    if (allExpiries) {
      if (!from || !to) {
        return NextResponse.json({ success: false, error: 'expiry=all needs from/to or loads' }, { status: 400 });
      }
      const rows = await sql`
        SELECT
          TRIM(opt_type) as opt_type,
          expiry_dt::text as expiry_dt,
          strike_pr,
          ltp,
          oi,
          oi_chg,
          close,
          symbol as occ,
          load_dt::text as load_dt
        FROM public.us_opt_chg_rpt
        WHERE symbol_und = ${upperSymbol}
          AND load_dt >= ${from}::date AND load_dt <= ${to}::date
        ORDER BY ABS(oi_chg) DESC
        LIMIT ${ALL_EXPIRIES_MAX_ROWS}
      `;
      const allowed = filterByExpiry(ctx.features, rows as any[], r => r.expiry_dt);
      const tradeDates = await tradeDateByLoad(allowed.map(r => r.load_dt));
      const chain = allowed.map(r => ({
        optType: r.opt_type === 'put' ? 'put' : 'call',
        expiry: r.expiry_dt,
        strike: Number(r.strike_pr),
        ltp: Number(r.ltp),
        oi: Number(r.oi),
        oiChg: Number(r.oi_chg),
        close: Number(r.close),
        loadDate: r.load_dt,
        tradeDate: tradeDates.get(r.load_dt) ?? r.load_dt,
        root: parseOcc(String(r.occ ?? ''))?.root,
      }));
      return NextResponse.json({
        success: true,
        data: { symbol: upperSymbol, expiryDate: 'all', from, to, rows: chain, truncated: rows.length >= ALL_EXPIRIES_MAX_ROWS },
      });
    }
    // Optional single-contract scope — used by the option-contract popup to
    // pull just one strike/type's full history instead of the whole chain.
    const strikeParam = request.nextUrl.searchParams.get('strike');
    const strike = strikeParam ? Number(strikeParam) : null;
    const optType = request.nextUrl.searchParams.get('optType');

    if (from && to) {
      const rows = await sql`
        SELECT
          TRIM(opt_type) as opt_type,
          strike_pr,
          ltp,
          oi,
          oi_chg,
          close,
          symbol as occ,
          load_dt::text as load_dt
        FROM public.us_opt_chg_rpt
        WHERE symbol_und = ${upperSymbol} AND expiry_dt = ${expiry}::date
          AND load_dt >= ${from}::date AND load_dt <= ${to}::date
          AND (${strike}::numeric IS NULL OR strike_pr = ${strike}::numeric)
          AND (${optType}::text IS NULL OR TRIM(opt_type) = ${optType}::text)
        ORDER BY load_dt DESC, strike_pr ASC, opt_type ASC
      `;
      const tradeDates = await tradeDateByLoad((rows as any[]).map(r => r.load_dt));
      const chain = (rows as any[]).map(r => ({
        optType: r.opt_type === 'put' ? 'put' : 'call',
        strike: Number(r.strike_pr),
        ltp: Number(r.ltp),
        oi: Number(r.oi),
        oiChg: Number(r.oi_chg),
        close: Number(r.close),
        expiry,
        loadDate: r.load_dt,
        tradeDate: tradeDates.get(r.load_dt) ?? r.load_dt,
        root: parseOcc(String(r.occ ?? ''))?.root,
      }));
      return NextResponse.json({ success: true, data: { symbol: upperSymbol, expiryDate: expiry, from, to, rows: chain } });
    }

    // No range given — single most recent snapshot (back-compat default).
    // Latest load day for this contract month comes from the daily catalog
    // (lib/marketCatalog.ts); the live MAX is the fallback before it's built.
    const loadDate = await catalogLastSeen('opt_chg', upperSymbol, expiry, async () => {
      const latestRows = await sql`
        SELECT MAX(load_dt)::text as d
        FROM public.us_opt_chg_rpt
        WHERE symbol_und = ${upperSymbol} AND expiry_dt = ${expiry}::date
      `;
      return (latestRows[0] as { d: string | null } | undefined)?.d ?? null;
    });

    if (!loadDate) {
      return NextResponse.json({ success: true, data: { symbol: upperSymbol, expiryDate: expiry, from: null, to: null, rows: [] } });
    }

    const rows = await sql`
      SELECT
        TRIM(opt_type) as opt_type,
        strike_pr,
        ltp,
        oi,
        oi_chg,
        close
      FROM public.us_opt_chg_rpt
      WHERE symbol_und = ${upperSymbol} AND expiry_dt = ${expiry}::date AND load_dt = ${loadDate}::date
      ORDER BY strike_pr ASC, opt_type ASC
    `;

    const tradeDate = (await tradeDateByLoad([loadDate])).get(loadDate) ?? loadDate;
    const chain = (rows as any[]).map(r => ({
      optType: r.opt_type === 'put' ? 'put' : 'call',
      strike: Number(r.strike_pr),
      ltp: Number(r.ltp),
      oi: Number(r.oi),
      oiChg: Number(r.oi_chg),
      close: Number(r.close),
      loadDate,
      tradeDate,
    }));

    return NextResponse.json({
      success: true,
      data: { symbol: upperSymbol, expiryDate: expiry, from: loadDate, to: loadDate, rows: chain },
    });
  } catch (error) {
    console.error('Error fetching option chain OI data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch option chain OI data', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
