import { NextRequest, NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_EARNINGS, FEATURE_PERFORMANCE, hasFeature } from '@/lib/features';
import { getWatchlistDetail } from '@/lib/watchlists';
import { getExpiryPerformanceForSymbols, summarizePerformanceRows, tagEarningsInWindow, splitByEarnings } from '@/lib/alertPerformance';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_PERFORMANCE);
  if (blocked) return blocked;

  const { id } = await params;
  const watchlist = await getWatchlistDetail(id, ctx.userId);
  if (!watchlist) return NextResponse.json({ success: false, error: 'Watchlist not found' }, { status: 404 });

  const expiryCountParam = Number(request.nextUrl.searchParams.get('expiryCount'));
  const expiryCount = Number.isFinite(expiryCountParam) && expiryCountParam > 0 ? expiryCountParam : undefined;

  const baseRows = await getExpiryPerformanceForSymbols(watchlist.symbols, { expiryCount });
  // Earnings (Pro): tag alerts whose window contained a report, and split the
  // stats — do levels hold through earnings as well as without?
  const earningsEnabled = hasFeature(ctx.features, FEATURE_EARNINGS);
  const rows = earningsEnabled ? await tagEarningsInWindow(baseRows) : baseRows;
  const summary = summarizePerformanceRows(rows);
  const earningsSplit = earningsEnabled ? splitByEarnings(rows) : null;
  // Underlying rows, so the client can drill into any stat tile / level row and
  // list the actual alerts behind it, grouped by symbol.
  return NextResponse.json({ success: true, data: { watchlist: { id: watchlist.id, name: watchlist.name }, summary, earningsSplit, alerts: rows } });
}
