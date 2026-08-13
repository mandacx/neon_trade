import { NextRequest, NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_WATCHLISTS, FEATURE_LEVELS, hasFeature } from '@/lib/features';
import { getWatchlistSymbols } from '@/lib/watchlists';
import { getAlertsForSymbolsByExpiry, redactTickerAlerts } from '@/lib/scanAlerts';

export const dynamic = 'force-dynamic';

const WIDGET_LIMIT = 20;

// Latest fired alerts across a watchlist's symbols, for the sidebar widget.
// An explicit `?expiry=YYYY-MM-DD` (the watchlist page's monthly-expiry
// toggle) pins this to exactly that expiry, keeping the widget consistent
// with whatever expiry the table is showing. Without it, expiryCount:3
// (rather than 1) covers a watchlist mixing symbols whose nearest-expiry
// cycles differ — narrower would silently drop one symbol's alerts.
// Re-sorted/truncated by load time after the fact for "latest N".
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_WATCHLISTS);
  if (blocked) return blocked;

  const { id } = await params;
  const symbols = await getWatchlistSymbols(id, ctx.userId);
  if (symbols.length === 0) {
    return NextResponse.json({ success: true, data: { alerts: [], levelsRedacted: false } });
  }

  const expiry = request.nextUrl.searchParams.get('expiry');
  const alerts = await getAlertsForSymbolsByExpiry(symbols, expiry ? { expiryDate: expiry } : { expiryCount: 3 });
  const latest = [...alerts].sort((a, b) => (a.loadDateTime < b.loadDateTime ? 1 : -1)).slice(0, WIDGET_LIMIT);

  const levelsVisible = hasFeature(ctx.features, FEATURE_LEVELS);

  return NextResponse.json({
    success: true,
    data: {
      alerts: levelsVisible ? latest : redactTickerAlerts(latest),
      levelsRedacted: !levelsVisible,
    },
  });
}
