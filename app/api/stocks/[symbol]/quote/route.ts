import { NextRequest, NextResponse } from 'next/server';
import { getSnapshotsMulti } from '@/lib/alpaca';
import { getMarketState } from '@/lib/marketSession';
import { buildQuote } from '@/lib/quote';

export const dynamic = 'force-dynamic';

// The stock header's live badge and the live chart candle. Uses
// /v2/stocks/snapshots rather than trades/latest because one snapshot call
// carries latestTrade + dailyBar + prevDailyBar together.
//
// Session-aware (lib/quote.ts): during regular hours `price`/`change` are live
// against the previous close; outside them `price`/`change` are the last
// regular session's close and day change, and `ext` is the pre-market /
// after-hours move from that close (null if nothing printed). `market` tells
// the client which session it is and when it next changes, so polling can
// follow the real open/close times.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;

    if (!symbol) {
      return NextResponse.json({ success: false, error: 'Symbol parameter is required' }, { status: 400 });
    }

    const upper = symbol.toUpperCase();
    const [snapshots, market] = await Promise.all([getSnapshotsMulti([upper]), getMarketState()]);
    const snapshot = snapshots[upper];
    const q = buildQuote(snapshot, market);
    if (!snapshot || q.price === null) {
      return NextResponse.json({ success: true, data: null });
    }

    return NextResponse.json({
      success: true,
      data: {
        symbol: upper,
        price: q.price,
        size: snapshot.latestTrade?.s ?? null,
        timestamp: snapshot.latestTrade?.t
          ? Math.floor(new Date(snapshot.latestTrade.t).getTime() / 1000)
          : null,
        dayOpen: q.dayOpen,
        dayHigh: q.dayHigh,
        dayLow: q.dayLow,
        prevClose: q.prevClose,
        change: q.change,
        changePercent: q.changePercent,
        ext: q.ext,
        market: { session: market.session, nextChangeAt: market.nextChangeAt, approximate: market.approximate },
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
