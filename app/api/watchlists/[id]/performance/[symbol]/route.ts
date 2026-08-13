import { NextRequest, NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_PERFORMANCE } from '@/lib/features';
import { getWatchlistDetail } from '@/lib/watchlists';
import { getExpiryPerformanceForSymbols } from '@/lib/alertPerformance';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; symbol: string }> }) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_PERFORMANCE);
  if (blocked) return blocked;

  const { id, symbol } = await params;
  const watchlist = await getWatchlistDetail(id, ctx.userId);
  if (!watchlist) return NextResponse.json({ success: false, error: 'Watchlist not found' }, { status: 404 });

  const upperSymbol = symbol.toUpperCase();
  if (!watchlist.symbols.includes(upperSymbol)) {
    return NextResponse.json({ success: false, error: 'Symbol not in this watchlist' }, { status: 404 });
  }

  const expiryCountParam = Number(request.nextUrl.searchParams.get('expiryCount'));
  const expiryCount = Number.isFinite(expiryCountParam) && expiryCountParam > 0 ? expiryCountParam : undefined;

  const rows = await getExpiryPerformanceForSymbols([upperSymbol], { expiryCount });
  return NextResponse.json({ success: true, data: { symbol: upperSymbol, rows } });
}
