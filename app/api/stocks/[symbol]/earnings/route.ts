import { NextRequest, NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_EARNINGS } from '@/lib/features';
import { getEarningsHistory } from '@/lib/earnings';

/**
 * Reported quarters for one symbol, newest first — the stock page's
 * Earnings History table and chart markers. Pro only (FEATURE_EARNINGS).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { blocked } = await requireFeatureApi(FEATURE_EARNINGS);
  if (blocked) return blocked;

  const { symbol } = await params;
  const requested = Number(request.nextUrl.searchParams.get('limit') || 12);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 40) : 12;

  const history = await getEarningsHistory(symbol, limit);
  return NextResponse.json({ success: true, data: { symbol: symbol.toUpperCase(), history } });
}
