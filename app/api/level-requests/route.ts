import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rateLimit';
import { resolveLimit } from '@/lib/rateLimitConfig';
import { createRequest, listUserRequests } from '@/lib/levelRequests';
import { cleanText, MAX_NOTE_LENGTH, normalizeLevelSymbol } from '@/lib/levelRequestRules';

export const dynamic = 'force-dynamic';

const LIMITER = 'level_request';

/** The signed-in user's own requests, newest first. */
export async function GET() {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.userId) return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 });
  try {
    return NextResponse.json({ success: true, data: { requests: await listUserRequests(ctx.userId) } });
  } catch (error) {
    console.error('[level-requests] list failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: true, data: { requests: [] } });
  }
}

/** Ask an admin to add a stock to the levels list. Body: { symbol, note? }. Any signed-in user. */
export async function POST(request: NextRequest) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.userId) return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 });

  const { limit: cap, windowSeconds } = await resolveLimit(LIMITER, false);
  const hit = await checkRateLimit(LIMITER, `user:${ctx.userId}`, cap, windowSeconds);
  if (!hit.allowed) {
    return NextResponse.json({ success: false, error: 'Rate limit exceeded', message: 'Too many requests, try again in a minute.' }, { status: 429, headers: rateLimitHeaders(hit) });
  }

  let body: { symbol?: unknown; note?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }
  const symbol = normalizeLevelSymbol(body?.symbol);
  if (!symbol) return NextResponse.json({ success: false, error: 'Enter a valid US ticker, for example AAPL or BRK.B.' }, { status: 400 });

  try {
    const out = await createRequest(ctx.userId, symbol, cleanText(body?.note, MAX_NOTE_LENGTH));
    if (!out.ok) return NextResponse.json({ success: false, error: out.code, message: out.message }, { status: out.code === 'too_many' ? 429 : 409 });
    return NextResponse.json({ success: true, data: { id: out.id, symbol } });
  } catch (error) {
    console.error('[level-requests] create failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: 'Could not save the request' }, { status: 500 });
  }
}
