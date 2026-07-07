import { NextRequest, NextResponse } from 'next/server';
import { getHistoricalBars, convertIntervalToTimeframe, ChartInterval } from '@/lib/alpaca';
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

    // Fetch OHLC data from Alpaca
    const bars = await getHistoricalBars(symbol, timeframe, from, to);

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
