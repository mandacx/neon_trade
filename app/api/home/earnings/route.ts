import { NextRequest, NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_EARNINGS } from '@/lib/features';
import { earningsBadge, getEarningsEvents, getEarningsSummary, getTrackedSymbols } from '@/lib/earnings';
import { getSecuritiesMeta } from '@/lib/securitiesFilters';
import type { EarningsBadge, EarningsEvent } from '@/types/earnings';

export const dynamic = 'force-dynamic';

const CARD_LIMIT = 10;

/**
 * Home-page earnings (Pro). Kept out of /api/home/data on purpose: that route
 * is public and CDN-cached for every visitor, so per-entitlement data can't
 * ride along in it.
 *
 *   upcoming   reports in the next 7 days, biggest companies first
 *   reported   reports in the last 3 days (beat/miss), biggest first
 *   badges     ?pairs=SYM:YYYY-MM-DD,… → EarningsBadge per symbol, relative to
 *              that row's expiry (the Top OI tables)
 */
export async function GET(request: NextRequest) {
  const { blocked } = await requireFeatureApi(FEATURE_EARNINGS);
  if (blocked) return blocked;

  const pairs = (request.nextUrl.searchParams.get('pairs') ?? '')
    .split(',')
    .map(p => p.trim().split(':'))
    .filter(([sym, exp]) => /^[A-Za-z.\-]{1,10}$/.test(sym ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(exp ?? ''))
    .slice(0, 50);

  const tracked = await getTrackedSymbols();
  const [events, secMeta, summaries] = await Promise.all([
    getEarningsEvents(tracked, { aheadDays: 7, backDays: 3 }),
    getSecuritiesMeta(tracked),
    pairs.length > 0 ? getEarningsSummary(pairs.map(([s]) => s)) : Promise.resolve(null),
  ]);

  const cap = (s: string) => Number(secMeta[s]?.market_cap ?? 0);
  const withName = (e: EarningsEvent) => ({ ...e, name: secMeta[e.symbol]?.name ?? null });
  const byCap = (a: EarningsEvent, b: EarningsEvent) => cap(b.symbol) - cap(a.symbol);

  const upcoming = events.filter(e => e.kind === 'upcoming').sort((a, b) => a.daysUntil - b.daysUntil || byCap(a, b));
  const reported = events.filter(e => e.kind === 'reported').sort(byCap);
  // Biggest names first, then shown in date order within the card.
  const topUpcoming = [...upcoming].sort(byCap).slice(0, CARD_LIMIT).sort((a, b) => a.daysUntil - b.daysUntil || byCap(a, b));

  const badges: Record<string, EarningsBadge | null> = {};
  if (summaries) {
    for (const [sym, exp] of pairs) badges[sym.toUpperCase()] = earningsBadge(summaries.get(sym.toUpperCase()), exp);
  }

  return NextResponse.json({
    success: true,
    data: {
      upcoming: topUpcoming.map(withName),
      upcomingTotal: upcoming.length,
      reported: reported.slice(0, CARD_LIMIT).map(withName),
      reportedTotal: reported.length,
      badges,
    },
  });
}
