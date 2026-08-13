import { NextRequest, NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_WATCHLISTS } from '@/lib/features';
import { getWatchlistsForUser, createWatchlist } from '@/lib/watchlists';

export async function GET() {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_WATCHLISTS);
  if (blocked) return blocked;

  const watchlists = await getWatchlistsForUser(ctx.userId);
  return NextResponse.json({ success: true, data: { watchlists } });
}

export async function POST(request: NextRequest) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_WATCHLISTS);
  if (blocked) return blocked;

  const body = await request.json();
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });
  }

  try {
    const watchlist = await createWatchlist(ctx.userId!, name);
    return NextResponse.json({ success: true, data: { watchlist } });
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
      return NextResponse.json({ success: false, error: 'You already have a watchlist with that name' }, { status: 409 });
    }
    throw error;
  }
}
