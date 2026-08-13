import { NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_WATCHLISTS } from '@/lib/features';
import { getWatchlistSymbols } from '@/lib/watchlists';
import { getNearestExpiryLatestForSymbols } from '@/lib/db';
import { calculateLevels, findClosestLevel } from '@/lib/calculations';
import { levelGate } from '@/lib/levelAccess';

export const dynamic = 'force-dynamic';

// Nearest-level-to-price for every symbol in one watchlist, for its own
// nearest future expiry cycle — the table view's "which level is price
// closest to" column. DB-only (no market-data vendor call), so this stays
// its own route rather than folding into quotes/route.ts, mirroring that
// route's own split rationale: different data source, different cost shape.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_WATCHLISTS);
  if (blocked) return blocked;

  const { id } = await params;
  const symbols = await getWatchlistSymbols(id, ctx.userId);
  if (symbols.length === 0) {
    return NextResponse.json({ success: true, data: { rows: [] } });
  }

  const stockRows = await getNearestExpiryLatestForSymbols(symbols);
  const gate = levelGate(ctx.features);

  const rows = stockRows.map(data => {
    const withheld = gate.withheld(data.TRADE_DATE);
    const closest = withheld ? null : findClosestLevel(calculateLevels(data));
    return {
      symbol: data.SYMBOL,
      expiryDate: data.EXPIRY_DT,
      tradeDate: data.TRADE_DATE,
      close: data.CLOSE,
      closestLevel: closest?.name ?? null,
      closestPrice: closest?.price ?? null,
      distance: closest?.distance ?? null,
      distancePercent: closest ? closest.value * 100 : null,
    };
  });

  return NextResponse.json({ success: true, data: { rows, ...gate.meta } });
}
