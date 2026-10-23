import { NextRequest, NextResponse, after } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_EARNINGS, FEATURE_US_MARKET_SCANNER, hasFeature } from '@/lib/features';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rateLimit';
import { resolveLimit } from '@/lib/rateLimitConfig';
import { normalizeParams } from '@/lib/scanner/config';
import { runScan } from '@/lib/scanner/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const LIMITER = 'us_scanner';

/**
 * US Market Scanner (lib/scanner, docs/us-scanner.md). Every query parameter is validated and clamped by
 * normalizeParams. Response: { success, data: { params, rows, meta, filters } }.
 */
export async function GET(request: NextRequest) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_US_MARKET_SCANNER);
  if (blocked) return blocked;
  const { limit: cap, windowSeconds } = await resolveLimit(LIMITER, false);
  const limit = await checkRateLimit(LIMITER, `user:${ctx.userId}`, cap, windowSeconds);
  if (!limit.allowed) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded', message: 'Too many requests, slow down for a minute.' },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  const params = normalizeParams(Object.fromEntries(request.nextUrl.searchParams));
  if ((params.scan === 'earnings_upcoming' || params.scan === 'earnings_reacted') && !hasFeature(ctx.features, FEATURE_EARNINGS)) {
    return NextResponse.json({ success: false, error: 'Upgrade required', feature: FEATURE_EARNINGS }, { status: 403 });
  }
  try {
    const result = await runScan(params, { onTodayRefresh: task => after(task) });
    return NextResponse.json({ success: true, data: { params, ...result } });
  } catch (error) {
    console.error('[scanner] scan failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: 'Scan failed' }, { status: 500 });
  }
}
