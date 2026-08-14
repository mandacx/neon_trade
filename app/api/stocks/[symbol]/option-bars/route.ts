import { NextRequest, NextResponse } from 'next/server';
import { getOptionBars, buildOccOptionSymbol, convertIntervalToTimeframe, ChartInterval } from '@/lib/alpaca';
import { usTradingDayKey } from '@/lib/utils';
import { format, subDays } from 'date-fns';
import axios from 'axios';

// OHLCV bars for a single option contract, via Alpaca's Options Market Data
// API (OCC symbol built from expiry+strike+optType) — see lib/alpaca.ts for
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

    const interval = (searchParams.get('interval') || 'daily') as ChartInterval;
    const to = searchParams.get('to') || format(new Date(), 'yyyy-MM-dd');
    const from = searchParams.get('from') || format(subDays(new Date(), 90), 'yyyy-MM-dd');

    // The current trading day always 403s regardless of range requested —
    // cap `to` at yesterday rather than surfacing that as an error.
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
    const effectiveTo = to < yesterday ? to : yesterday;

    const occSymbol = buildOccOptionSymbol(symbol, expiry, optType, strike);
    const timeframe = convertIntervalToTimeframe(interval);

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

    return NextResponse.json({
      success: true,
      data: { symbol: symbol.toUpperCase(), occSymbol, expiry, strike, optType, interval, from, to: effectiveTo, data: barsData },
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 403) {
      return NextResponse.json(
        { success: false, error: 'Options bar data is not available on the current Alpaca subscription for this range.', message: error.response?.data?.message },
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
