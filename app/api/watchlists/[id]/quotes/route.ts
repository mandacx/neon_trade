import { NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_WATCHLISTS } from '@/lib/features';
import { getWatchlistSymbols } from '@/lib/watchlists';
import { getSecuritiesMeta } from '@/lib/securitiesFilters';
import { getSnapshotsMulti } from '@/lib/alpaca';

export const dynamic = 'force-dynamic';

// Live row data (name + last price + today's OHLC + volume + change) for
// every symbol in one watchlist — the table view's data source. Split from
// GET /api/watchlists/[id] (which stays fast/DB-only for the symbol list
// itself) since this one fans out to Alpaca and is meaningfully slower.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_WATCHLISTS);
  if (blocked) return blocked;

  const { id } = await params;
  const symbols = await getWatchlistSymbols(id, ctx.userId);
  if (symbols.length === 0) {
    return NextResponse.json({ success: true, data: { rows: [] } });
  }

  const [secMeta, snapshots] = await Promise.all([
    getSecuritiesMeta(symbols),
    getSnapshotsMulti(symbols),
  ]);

  const rows = symbols.map(symbol => {
    const snap = snapshots[symbol];
    const dailyBar = snap?.dailyBar;
    const prevClose = snap?.prevDailyBar?.c ?? null;
    const lastPrice = dailyBar?.c ?? snap?.latestTrade?.p ?? null;
    const change = lastPrice !== null && prevClose !== null ? lastPrice - prevClose : null;
    const changePercent = change !== null && prevClose ? (change / prevClose) * 100 : null;

    return {
      symbol,
      name: secMeta[symbol]?.name ?? symbol,
      lastPrice,
      open: dailyBar?.o ?? null,
      dayHigh: dailyBar?.h ?? null,
      dayLow: dailyBar?.l ?? null,
      volume: dailyBar?.v ?? null,
      change,
      changePercent,
    };
  });

  return NextResponse.json({ success: true, data: { rows } });
}
