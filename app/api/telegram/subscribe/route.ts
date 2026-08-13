import { NextRequest, NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_TELEGRAM_ALERTS } from '@/lib/features';
import { setTelegramSubscription } from '@/lib/telegram';
import { getWatchlistDetail } from '@/lib/watchlists';

export async function POST(request: NextRequest) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_TELEGRAM_ALERTS);
  if (blocked) return blocked;

  const body = await request.json();
  const watchlistId = typeof body?.watchlistId === 'string' ? body.watchlistId : '';
  if (!watchlistId) return NextResponse.json({ success: false, error: 'watchlistId is required' }, { status: 400 });

  // Validates the watchlist is real and (for custom lists) owned by this user.
  const watchlist = await getWatchlistDetail(watchlistId, ctx.userId);
  if (!watchlist) return NextResponse.json({ success: false, error: 'Watchlist not found' }, { status: 404 });

  await setTelegramSubscription(ctx.userId!, watchlistId);
  return NextResponse.json({ success: true });
}
