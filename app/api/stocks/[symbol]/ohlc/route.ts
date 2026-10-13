import { NextRequest, NextResponse } from 'next/server';
import { getHistoricalBars, convertIntervalToTimeframe, ChartInterval } from '@/lib/alpaca';
import type { AlpacaBar } from '@/lib/alpaca';
import { getBarsForChart } from '@/lib/tradier';
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

    // Convert interval to Alpaca timeframe format
    const timeframe = convertIntervalToTimeframe(interval);

    // Fetch OHLC data from Alpaca. Alpaca's stock-bars API has no indices (SPX
    // returns an empty set, ^GSPC a 400), so when it has nothing for the symbol
    // the bars come from Tradier instead.
    let bars: AlpacaBar[] = [];
    let alpacaError: unknown = null;
    try {
      bars = await getHistoricalBars(symbol, timeframe, from, to);
    } catch (err) {
      alpacaError = err;
    }
    let source: 'alpaca' | 'tradier' = 'alpaca';
    if (bars.length === 0) {
      try {
        const fallback = await getBarsForChart(symbol, interval, from, to);
        if (fallback.length > 0) {
          bars = fallback;
          source = 'tradier';
        }
      } catch (err) {
        console.error('Tradier OHLC fallback failed:', err instanceof Error ? err.message : err);
      }
    }
    // Neither source has bars and Alpaca errored: report that error as before.
    if (bars.length === 0 && alpacaError) throw alpacaError;

    // Transform Alpaca data to our format. `timestamp` (epoch seconds) is the
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
        source,
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
