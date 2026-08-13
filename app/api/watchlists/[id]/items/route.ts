import { NextRequest, NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_WATCHLISTS } from '@/lib/features';
import { addSymbolToWatchlist, removeSymbolFromWatchlist } from '@/lib/watchlists';
import { isCuratedListId } from '@/lib/curatedWatchlists';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_WATCHLISTS);
  if (blocked) return blocked;

  const { id } = await params;
  const watchlistId = Number(id);
  if (isCuratedListId(id) || !Number.isFinite(watchlistId)) {
    return NextResponse.json({ success: false, error: 'System watchlists cannot be edited' }, { status: 400 });
  }

  const body = await request.json();
  const symbol = typeof body?.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
  if (!symbol) return NextResponse.json({ success: false, error: 'symbol is required' }, { status: 400 });

  const added = await addSymbolToWatchlist(ctx.userId!, watchlistId, symbol);
  if (!added) {
    return NextResponse.json({ success: false, error: `Unknown symbol "${symbol}"` }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_WATCHLISTS);
  if (blocked) return blocked;

  const { id } = await params;
  const watchlistId = Number(id);
  if (isCuratedListId(id) || !Number.isFinite(watchlistId)) {
    return NextResponse.json({ success: false, error: 'System watchlists cannot be edited' }, { status: 400 });
  }

  const symbol = request.nextUrl.searchParams.get('symbol');
  if (!symbol) return NextResponse.json({ success: false, error: 'symbol query param is required' }, { status: 400 });

  await removeSymbolFromWatchlist(ctx.userId!, watchlistId, symbol);
  return NextResponse.json({ success: true });
}
