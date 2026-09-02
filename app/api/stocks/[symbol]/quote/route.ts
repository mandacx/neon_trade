import { NextRequest, NextResponse } from 'next/server';
import { getSnapshotsMulti } from '@/lib/alpaca';

// Latest traded price plus today's range and change, for the stock header's
// live badge and the live chart candle. Uses /v2/stocks/snapshots rather than
// trades/latest because one snapshot call carries latestTrade + dailyBar +
// prevDailyBar together — the day range and change come free instead of
// costing extra round trips on a 10s poll.
//
// Alpaca still returns the last known trade/bar outside market hours, so this
// degrades to "last session" rather than erroring off-session.
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
    const snapshot = (await getSnapshotsMulti([upper]))[upper];

    // latestTrade is missing for names that haven't printed yet today — fall
    // back to the daily bar's close so the badge still shows a real price.
    const price = snapshot?.latestTrade?.p ?? snapshot?.dailyBar?.c;
    if (!snapshot || price === undefined) {
      return NextResponse.json({ success: true, data: null });
    }

    const prevClose = snapshot.prevDailyBar?.c;
    // Guard the divide: no (or zero) previous close means there's no basis for
    // a change figure, so report null rather than NaN/Infinity.
    const change = prevClose === undefined ? null : price - prevClose;
    const changePercent = prevClose ? ((price - prevClose) / prevClose) * 100 : null;

    return NextResponse.json({
      success: true,
      data: {
        symbol: upper,
        price,
        size: snapshot.latestTrade?.s ?? null,
        timestamp: snapshot.latestTrade?.t
          ? Math.floor(new Date(snapshot.latestTrade.t).getTime() / 1000)
          : null,
        dayOpen: snapshot.dailyBar?.o ?? null,
        dayHigh: snapshot.dailyBar?.h ?? null,
        dayLow: snapshot.dailyBar?.l ?? null,
        prevClose: prevClose ?? null,
        change,
        changePercent,
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
