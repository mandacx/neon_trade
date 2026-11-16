import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, rateLimitHeaders, rateLimitKey } from '@/lib/rateLimit';
import { resolveLimit } from '@/lib/rateLimitConfig';
import { getMarketNews } from '@/lib/news';

export const dynamic = 'force-dynamic';

// Latest headlines on the most-followed stocks for the landing page card (see getMarketNews). Public; served from the 60 s server cache
// (no refresh switch here). Headlines, teaser, link and thumbnail only, never article body text.

const LIMITER = 'news';

export async function GET(request: NextRequest) {
  const { limit: cap, windowSeconds } = await resolveLimit(LIMITER, false);
  const limit = await checkRateLimit(LIMITER, rateLimitKey(request.headers, null), cap, windowSeconds);
  if (!limit.allowed) {
    return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429, headers: rateLimitHeaders(limit) });
  }
  try {
    return NextResponse.json({ success: true, data: await getMarketNews() }, { headers: rateLimitHeaders(limit) });
  } catch (error) {
    console.error('Error loading home news:', error instanceof Error ? error.message : error);
    // The card is optional: degrade to "no news" rather than an error.
    return NextResponse.json({ success: true, data: { items: [], fetchedAt: new Date().toISOString() } });
  }
}
