import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { FEATURE_OPTION_CHAIN, FEATURE_STRATEGY_BUILDER, hasFeature } from '@/lib/features';
import { filterExpiries } from '@/lib/expiryAccess';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rateLimit';
import { resolveLimit } from '@/lib/rateLimitConfig';
import { getOptionExpirations } from '@/lib/marketdata';
import { etDateOf } from '@/lib/marketSession';

export const dynamic = 'force-dynamic';

// Upcoming listed expiries for any optionable symbol, for the stock page's Option Chain tab when the
// symbol has no price levels (so our own expiry list, built from the levels data, is empty).
// Same gate and limiter as /chain (`option_chain` or `strategy_builder`); one upstream request,
// cached 6 h per symbol because listings rarely change. Vendor-neutral response.

const LIMITER = 'option_chain';
const CACHE_MS = 6 * 3_600_000;
const cache = new Map<string, { at: number; dates: string[] }>();

export async function GET(_request: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn) return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 });
  if (!hasFeature(ctx.features, FEATURE_STRATEGY_BUILDER) && !hasFeature(ctx.features, FEATURE_OPTION_CHAIN)) {
    return NextResponse.json({ success: false, error: 'Upgrade required', feature: FEATURE_OPTION_CHAIN }, { status: 403 });
  }
  const symbol = (await params).symbol.toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return NextResponse.json({ success: false, error: 'Invalid symbol' }, { status: 400 });

  const { limit: cap, windowSeconds } = await resolveLimit(LIMITER, false);
  const limit = await checkRateLimit(LIMITER, `user:${ctx.userId}`, cap, windowSeconds);
  if (!limit.allowed) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded', message: 'Too many quote requests, wait a minute.' },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  try {
    const hit = cache.get(symbol);
    let dates = hit && Date.now() - hit.at < CACHE_MS ? hit.dates : null;
    if (!dates) {
      dates = await getOptionExpirations(symbol);
      if (cache.size > 500) cache.clear();
      cache.set(symbol, { at: Date.now(), dates });
    }
    const today = etDateOf(Date.now());
    // Plans limited to monthly/quarterly expiries never see the weeklies (lib/expiryAccess.ts).
    const expiryDates = filterExpiries(ctx.features, dates.filter(d => d >= today));
    return NextResponse.json({ success: true, data: { symbol, expiryDates } }, { headers: rateLimitHeaders(limit) });
  } catch (error) {
    console.error('Error loading option expiries:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: 'Failed to load the option expiries' }, { status: 500 });
  }
}
