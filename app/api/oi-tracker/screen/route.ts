import { NextRequest, NextResponse } from 'next/server';
import { guardOi, parseScreenParams, scopeExpiry, scopeWatchlist, serverError } from '@/lib/oiTrackerApi';
import { getOiScreen } from '@/lib/oiTracker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Market-wide OI change screen: contracts or grouped rows, plus a summary. */
export async function GET(request: NextRequest) {
  const { ctx, blocked } = await guardOi(true);
  if (blocked) return blocked;
  const params = parseScreenParams(request.nextUrl.searchParams);
  if (typeof params === 'string') return NextResponse.json({ success: false, error: params }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await getOiScreen(scopeExpiry(scopeWatchlist(params, ctx), ctx)) });
  } catch (error) {
    return serverError('screen', error);
  }
}
