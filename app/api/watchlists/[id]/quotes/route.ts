import { NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_EARNINGS, FEATURE_WATCHLISTS, hasFeature } from '@/lib/features';
import { getWatchlistSymbols } from '@/lib/watchlists';
import { getSecuritiesMeta } from '@/lib/securitiesFilters';
import { getSnapshotsMulti } from '@/lib/marketdata';
import { getEarningsSummary } from '@/lib/earnings';
import { getMarketState } from '@/lib/marketSession';
import { buildQuote, rowQuote } from '@/lib/quote';

export const dynamic = 'force-dynamic';

// Live row data (name + last price + today's OHLC + volume + change) for
// every symbol in one watchlist — the table view's data source. Split from
// GET /api/watchlists/[id] (which stays fast/DB-only for the symbol list
// itself) since this one fans out to the market-data feed and is meaningfully slower.
//
// Session-aware (lib/quote.ts): `lastPrice`/`change` are live in the regular
// session and the last regular close after it; `ext` carries the pre-market /
// after-hours move from that close until the next regular session. `market`
// lets the client poll on the real open/close schedule.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_WATCHLISTS);
  if (blocked) return blocked;

  const { id } = await params;
  const symbols = await getWatchlistSymbols(id, ctx.userId);
  // Earnings columns/filters are a separate Pro feature; the client hides
  // them when this is false.
  const earningsEnabled = hasFeature(ctx.features, FEATURE_EARNINGS);
  if (symbols.length === 0) {
    const empty = await getMarketState();
    return NextResponse.json({ success: true, data: { rows: [], earningsEnabled, market: { session: empty.session, nextChangeAt: empty.nextChangeAt } } });
  }

  const [secMeta, snapshots, earnings, market] = await Promise.all([
    getSecuritiesMeta(symbols),
    getSnapshotsMulti(symbols),
    earningsEnabled ? getEarningsSummary(symbols) : Promise.resolve(null),
    getMarketState(),
  ]);

  const rows = symbols.map(symbol => {
    const q = buildQuote(snapshots[symbol], market);

    return {
      symbol,
      name: secMeta[symbol]?.name ?? symbol,
      ...rowQuote(q),
      open: q.dayOpen,
      dayHigh: q.dayHigh,
      dayLow: q.dayLow,
      volume: q.volume,
      ...(earnings ? { earnings: earnings.get(symbol) ?? null } : {}),
    };
  });

  return NextResponse.json({
    success: true,
    data: { rows, earningsEnabled, market: { session: market.session, nextChangeAt: market.nextChangeAt } },
  });
}
