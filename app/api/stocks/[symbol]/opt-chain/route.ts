import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

// Per-strike option-chain OI snapshot(s) from public.us_opt_chg_rpt — a
// different, finer granularity than eod_usmkts_price's aggregate call/put OI
// (see app/api/stocks/[symbol]/oi/route.ts): one row per (strike, put/call)
// rather than one aggregate pair per day. This table is loaded once per
// trading day (one load_dt per day). An optional `from`/`to` range returns
// every day's snapshot in that window (one row per strike/type/day); without
// it, this returns just the single most recent load_dt available.
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

    const upperSymbol = symbol.toUpperCase();
    const from = request.nextUrl.searchParams.get('from');
    const to = request.nextUrl.searchParams.get('to');

    if (from && to) {
      const rows = await sql`
        SELECT
          TRIM(opt_type) as opt_type,
          strike_pr,
          ltp,
          oi,
          oi_chg,
          close,
          load_dt::text as load_dt
        FROM public.us_opt_chg_rpt
        WHERE symbol_und = ${upperSymbol} AND expiry_dt = ${expiry}::date
          AND load_dt >= ${from}::date AND load_dt <= ${to}::date
        ORDER BY load_dt DESC, strike_pr ASC, opt_type ASC
      `;
      const chain = (rows as any[]).map(r => ({
        optType: r.opt_type === 'put' ? 'put' : 'call',
        strike: Number(r.strike_pr),
        ltp: Number(r.ltp),
        oi: Number(r.oi),
        oiChg: Number(r.oi_chg),
        close: Number(r.close),
        loadDate: r.load_dt,
      }));
      return NextResponse.json({ success: true, data: { symbol: upperSymbol, expiryDate: expiry, from, to, rows: chain } });
    }

    // No range given — single most recent snapshot (back-compat default).
    const latestRows = await sql`
      SELECT MAX(load_dt)::text as d
      FROM public.us_opt_chg_rpt
      WHERE symbol_und = ${upperSymbol} AND expiry_dt = ${expiry}::date
    `;
    const loadDate = (latestRows[0] as { d: string | null } | undefined)?.d ?? null;

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

    const chain = (rows as any[]).map(r => ({
      optType: r.opt_type === 'put' ? 'put' : 'call',
      strike: Number(r.strike_pr),
      ltp: Number(r.ltp),
      oi: Number(r.oi),
      oiChg: Number(r.oi_chg),
      close: Number(r.close),
      loadDate,
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
