import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, rateLimitHeaders, rateLimitKey } from '@/lib/rateLimit';
import { resolveLimit } from '@/lib/rateLimitConfig';
import { getSymbolNews } from '@/lib/news';

export const dynamic = 'force-dynamic';

// Latest news for one stock (stock page News tab). Public, like the rest of the stock page. `?refresh=1`
// (the tab's Refresh button) skips the 60 s server cache and calls the feed again (a list fetched in the
// last 5 s is reused). Rate limited per IP (`news`, admin-editable). The response is plain text only.

const LIMITER = 'news';

export async function GET(request: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const symbol = (await params).symbol.toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return NextResponse.json({ success: false, error: 'Invalid symbol' }, { status: 400 });

  const { limit: cap, windowSeconds } = await resolveLimit(LIMITER, false);
  const limit = await checkRateLimit(LIMITER, rateLimitKey(request.headers, null), cap, windowSeconds);
  if (!limit.allowed) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded', message: 'Too many news refreshes, wait a minute.' },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  try {
    const data = await getSymbolNews(symbol, request.nextUrl.searchParams.get('refresh') === '1');
    return NextResponse.json({ success: true, data }, { headers: { ...rateLimitHeaders(limit), 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error loading news:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: 'News is unavailable right now' }, { status: 502 });
  }
}
