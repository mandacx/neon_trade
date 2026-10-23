import { NextRequest, NextResponse } from 'next/server';
import { getHistoricalBars, getFallbackBars, convertIntervalToTimeframe, type Bar, type ChartInterval } from '@/lib/marketdata';
import { getDailyBars, toBars } from '@/lib/dailyBars';
import { usTradingDayKey } from '@/lib/utils';
import { format, subDays } from 'date-fns';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const searchParams = request.nextUrl.searchParams;

    // Get date range from query params or default to last 90 days
    const to = searchParams.get('to') || format(new Date(), 'yyyy-MM-dd');
    const from = searchParams.get('from') || format(subDays(new Date(), 90), 'yyyy-MM-dd');
    const interval = (searchParams.get('interval') || 'daily') as ChartInterval;

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: 'Symbol parameter is required' },
        { status: 400 }
      );
    }

    const timeframe = convertIntervalToTimeframe(interval);

    // The primary source has no indices (SPX returns an empty set), so when it has nothing for
    // the symbol the bars come from the fallback source instead (lib/marketdata).
    let bars: Bar[] = [];
    let primaryError: unknown = null;
    if (interval === 'daily') {
      // Daily bars: past days come from our own table (filled once), only today is fetched live.
      // lib/dailyBars.ts also does the fallback for indices.
      const daily = await getDailyBars(symbol, from, to);
      if (daily.bars.length === 0 && daily.error) throw daily.error;
      bars = toBars(daily.bars);
    } else {
      try {
        bars = await getHistoricalBars(symbol, timeframe, from, to);
      } catch (err) {
        primaryError = err;
      }
    }
    if (bars.length === 0 && interval !== 'daily') {
      try {
        const fallback = await getFallbackBars(symbol, interval, from, to);
        if (fallback.length > 0) bars = fallback;
      } catch (err) {
        console.error('OHLC fallback failed:', err instanceof Error ? err.message : err);
      }
    }
    // Neither source has bars and the primary errored: report that error as before.
    if (bars.length === 0 && primaryError) throw primaryError;

    // Transform bars to our format. `timestamp` (epoch seconds) is the
    // chart's canonical time — `date` is the US trading-day it falls on, used to
    // join against day-level data (option levels, OI, scan alerts).
    const ohlcData = bars.map(bar => {
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
      data: {
        symbol: symbol.toUpperCase(),
        interval,
        from,
        to,
        data: ohlcData,
      },
    });
  } catch (error) {
    console.error('Error fetching OHLC data:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch OHLC data',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
