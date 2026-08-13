import { NextRequest, NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_WATCHLISTS } from '@/lib/features';
import { getWatchlistDetail, renameWatchlist, deleteWatchlist } from '@/lib/watchlists';
import { isCuratedListId } from '@/lib/curatedWatchlists';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_WATCHLISTS);
  if (blocked) return blocked;

  const { id } = await params;
  const watchlist = await getWatchlistDetail(id, ctx.userId);
  if (!watchlist) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true, data: { watchlist } });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_WATCHLISTS);
  if (blocked) return blocked;

  const { id } = await params;
  const watchlistId = Number(id);
  if (isCuratedListId(id) || !Number.isFinite(watchlistId)) {
    return NextResponse.json({ success: false, error: 'System watchlists cannot be edited' }, { status: 400 });
  }

  const body = await request.json();
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });

  try {
    await renameWatchlist(ctx.userId!, watchlistId, name);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
      return NextResponse.json({ success: false, error: 'You already have a watchlist with that name' }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_WATCHLISTS);
  if (blocked) return blocked;

  const { id } = await params;
  const watchlistId = Number(id);
  if (isCuratedListId(id) || !Number.isFinite(watchlistId)) {
    return NextResponse.json({ success: false, error: 'System watchlists cannot be deleted' }, { status: 400 });
  }

  await deleteWatchlist(ctx.userId!, watchlistId);
  return NextResponse.json({ success: true });
}
