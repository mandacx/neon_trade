import { NextRequest, NextResponse } from 'next/server';
import { getLatestTrade } from '@/lib/alpaca';

// Latest traded price for the live price badge + live chart candle. Alpaca
// still returns the last known trade outside market hours, so this degrades
// gracefully to "last trade" rather than erroring off-session.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;

    if (!symbol) {
      return NextResponse.json({ success: false, error: 'Symbol parameter is required' }, { status: 400 });
    }

    const trade = await getLatestTrade(symbol);
    if (!trade) {
      return NextResponse.json({ success: true, data: null });
    }

    return NextResponse.json({
      success: true,
      data: {
        symbol: symbol.toUpperCase(),
        price: trade.p,
        size: trade.s,
        timestamp: Math.floor(new Date(trade.t).getTime() / 1000),
      },
    });
  } catch (error) {
    console.error('Error fetching latest quote:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch latest quote', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
