import { NextRequest, NextResponse } from 'next/server';
import { getHistoricalBars, convertIntervalToTimeframe } from '@/lib/alpaca';
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
    const interval = (searchParams.get('interval') || 'daily') as 'daily' | 'weekly' | 'monthly';

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
    
    // Transform Alpaca data to our format
    const ohlcData = bars.map(bar => ({
      date: bar.t.split('T')[0], // Extract date from timestamp
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
    }));

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
