import { NextRequest, NextResponse } from 'next/server';
import { getOptionBars, getOptionTodaySnapshotBar, getFallbackBars, buildOccOptionSymbol, convertIntervalToTimeframe, isIntradayInterval, ChartInterval } from '@/lib/marketdata';
import type { Bar } from '@/lib/marketdata';
import { usTradingDayKey } from '@/lib/utils';
import { format, subDays } from 'date-fns';
import axios from 'axios';
import { getCurrentUserContext } from '@/lib/appUsers';
import { expiryAllowed, WEEKLY_EXPIRY_ERROR } from '@/lib/expiryAccess';

// Index options (SPX/SPXW/...) trade outside 09:30-16:00 and the history feed's
// bars include those prints, so today's bars must too. Equity options: intraday
// bars include extended prints as well, but the history feed's DAILY bar does
// not, so equity daily keeps the regular-session daily bar. Checked 2026-10-28.
const INDEX_OPTION_ROOTS = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'RUT', 'RUTW', 'XSP', 'VIX', 'VIXW', 'DJX']);
function todaySessions(root: string, interval: ChartInterval): 'open' | 'all' {
  return interval === 'daily' ? (INDEX_OPTION_ROOTS.has(root.toUpperCase()) ? 'all' : 'open') : 'all';
}

// OHLCV bars for a single option contract, via the market-data options API
// (OCC symbol built from expiry+strike+optType) — see lib/marketdata for
// the OCC symbol format and the "no current trading day" subscription limit.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const searchParams = request.nextUrl.searchParams;

    const expiry = searchParams.get('expiry');
    const strikeParam = searchParams.get('strike');
    const optType = searchParams.get('optType');

    if (!symbol) {
      return NextResponse.json({ success: false, error: 'Symbol parameter is required' }, { status: 400 });
    }
    if (!expiry || !strikeParam || (optType !== 'call' && optType !== 'put')) {
      return NextResponse.json({ success: false, error: 'expiry, strike, and optType (call|put) query parameters are required' }, { status: 400 });
    }
    const strike = Number(strikeParam);
    if (!Number.isFinite(strike)) {
      return NextResponse.json({ success: false, error: 'strike must be numeric' }, { status: 400 });
    }
    // Plans limited to monthly/quarterly expiries get no weekly contract bars (lib/expiryAccess.ts).
    const ctx = await getCurrentUserContext();
    if (!expiryAllowed(ctx.features, expiry)) {
      return NextResponse.json(WEEKLY_EXPIRY_ERROR, { status: 403 });
    }

    // "Today"/"yesterday" must be the US Eastern trading day, not the server's
    // (UTC on Vercel) local date — otherwise for a few hours every evening
    // (UTC midnight until the next Eastern midnight) the server's "yesterday"
    // is still today's Eastern trading session, the cap below fails to
    // exclude it, and the feed 403s with "subscription does not permit
    // querying recent OPRA data".
    const todayET = usTradingDayKey(Math.floor(Date.now() / 1000));
    const yesterdayET = format(subDays(new Date(`${todayET}T12:00:00Z`), 1), 'yyyy-MM-dd');

    const interval = (searchParams.get('interval') || 'daily') as ChartInterval;
    const to = searchParams.get('to') || todayET;
    const from = searchParams.get('from') || format(subDays(new Date(), 90), 'yyyy-MM-dd');

    // The current trading day always 403s regardless of range requested —
    // cap `to` at yesterday rather than surfacing that as an error.
    const effectiveTo = to < yesterdayET ? to : yesterdayET;

    // The OCC root can differ from the underlying (SPX -> SPXW weeklies, NDX -> NDXP,
    // adjusted contracts such as LEN1); the OI tracker passes the contract's own root.
    const rootParam = searchParams.get('root');
    if (rootParam !== null && !/^[A-Za-z0-9]{1,6}$/.test(rootParam)) {
      return NextResponse.json({ success: false, error: 'root must be 1-6 letters or digits' }, { status: 400 });
    }
    const root = rootParam ?? symbol;
    const occSymbol = buildOccOptionSymbol(root, expiry, optType, strike);
    const timeframe = convertIntervalToTimeframe(interval);

    // Today's bars come from the fallback feed (real intraday bars; the primary
    // feed's only current-day data is one daily snapshot bar). Started in
    // parallel with the history request; null when today isn't wanted/available.
    const wantsToday = (interval === 'daily' || isIntradayInterval(interval)) && to >= todayET;
    const todayBarsPromise: Promise<Bar[]> = wantsToday
      ? getFallbackBars(occSymbol, interval, todayET, todayET, todaySessions(root, interval)).catch(err => {
          console.error('Error fetching today\'s option bars:', err instanceof Error ? err.message : err);
          return [];
        })
      : Promise.resolve([]);

    const bars = await getOptionBars(occSymbol, timeframe, from, effectiveTo);

    const barsData = bars.map(bar => {
      const timestamp = Math.floor(new Date(bar.t).getTime() / 1000);
      return {
        date: usTradingDayKey(timestamp),
        timestamp,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
      };
    });

    // The historical endpoint above always 403s for the current trading day
    // (capped at `effectiveTo` = yesterday), so today never shows up in
    // `barsData`. Append today from the fallback feed (daily: one running bar;
    // intraday: every bar so far, same bucket boundaries as the history).
    // Weekly/monthly stay historical-only since a single day's bar isn't the
    // right shape for a partial week/month candle.
    if (wantsToday) {
      const todayBars = (await todayBarsPromise)
        .map(b => ({ b, timestamp: Math.floor(new Date(b.t).getTime() / 1000) }))
        .filter(({ timestamp }) => usTradingDayKey(timestamp) === todayET);
      for (const { b, timestamp } of todayBars) {
        barsData.push({
          date: todayET, timestamp,
          open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
        });
      }
    }

    // Nothing from the fallback feed: show the primary feed's single running
    // daily bar instead (it can't draw intraday candles, but beats an empty today).
    if (wantsToday && !barsData.some(b => b.date === todayET)) {
      const todayBar = await getOptionTodaySnapshotBar(symbol, expiry, strike, occSymbol);
      const timestamp = todayBar ? Math.floor(new Date(todayBar.t).getTime() / 1000) : 0;
      // Snapshot's dailyBar can be stale (e.g. Friday's bar showing on a
      // weekend view) — only append if it's genuinely today's bar, so we
      // never duplicate a day already covered by barsData above.
      if (todayBar && usTradingDayKey(timestamp) === todayET) {
        barsData.push({
          date: usTradingDayKey(timestamp),
          timestamp,
          open: todayBar.o,
          high: todayBar.h,
          low: todayBar.l,
          close: todayBar.c,
          volume: todayBar.v,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: { symbol: symbol.toUpperCase(), occSymbol, expiry, strike, optType, interval, from, to: effectiveTo, data: barsData },
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 403) {
      return NextResponse.json(
        { success: false, error: 'Options bar data is not available for this range on the current data plan.' },
        { status: 403 }
      );
    }
    console.error('Error fetching option bars:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch option bars', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
