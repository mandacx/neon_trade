import { NextRequest, NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_EARNINGS } from '@/lib/features';
import { getEarningsRange, getTrackedSymbols, todayET } from '@/lib/earnings';
import { addDaysET } from '@/lib/earningsFilter';
import { computeReaction } from '@/lib/earningsReaction';
import { getDailyBarsMulti, getSnapshotsChunked } from '@/lib/marketdata';
import { getMarketState } from '@/lib/marketSession';
import { buildQuote, rowQuote } from '@/lib/quote';
import { getSecuritiesMeta } from '@/lib/securitiesFilters';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PERIOD_DAYS = [1, 3, 5, 7, 10, 15, 30, 60, 90];
const MAX_CUSTOM_DAYS = 400;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Earnings page data (Pro). One row per report in the window, for every
 * tracked symbol (those with option levels):
 *
 *   ?mode=upcoming&days=N   today -> today+N
 *   ?mode=reported&days=N   today-N -> today
 *   ?mode=custom&from=&to=  any span (upcoming and reported together)
 *
 * Each row carries the schedule/result, security metadata, the live quote and,
 * for reports already out, the price reaction (lib/earningsReaction.ts). Levels
 * are served separately by /api/earnings/levels, because changing the expiry
 * shouldn't re-fetch quotes and bars.
 */
export async function GET(request: NextRequest) {
  const { blocked } = await requireFeatureApi(FEATURE_EARNINGS);
  if (blocked) return blocked;

  const q = request.nextUrl.searchParams;
  const today = todayET();
  const mode = q.get('mode') ?? 'upcoming';
  let from: string;
  let to: string;
  if (mode === 'custom') {
    from = q.get('from') ?? '';
    to = q.get('to') ?? '';
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
      return NextResponse.json({ success: false, error: 'Custom range needs valid from/to dates (from <= to).' }, { status: 400 });
    }
    if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > MAX_CUSTOM_DAYS * 86_400_000) {
      return NextResponse.json({ success: false, error: `Range is limited to ${MAX_CUSTOM_DAYS} days.` }, { status: 400 });
    }
  } else if (mode === 'upcoming' || mode === 'reported') {
    const days = Number(q.get('days') ?? 7);
    if (!PERIOD_DAYS.includes(days)) {
      return NextResponse.json({ success: false, error: `days must be one of ${PERIOD_DAYS.join(', ')}.` }, { status: 400 });
    }
    from = mode === 'upcoming' ? today : addDaysET(today, -days);
    to = mode === 'upcoming' ? addDaysET(today, days) : today;
  } else {
    return NextResponse.json({ success: false, error: 'mode must be upcoming, reported or custom.' }, { status: 400 });
  }

  const tracked = await getTrackedSymbols();
  const events = await getEarningsRange(from, to, tracked);
  const symbols = Array.from(new Set(events.map(e => e.symbol)));

  const past = events.filter(e => e.kind !== 'upcoming');
  const barsStart = past.length > 0 ? addDaysET(past.reduce((min, e) => (e.date < min ? e.date : min), past[0].date), -7) : null;
  const pastSymbols = Array.from(new Set(past.map(e => e.symbol)));

  const [secMeta, snapshots, bars, market] = await Promise.all([
    getSecuritiesMeta(symbols),
    getSnapshotsChunked(symbols),
    barsStart ? getDailyBarsMulti(pastSymbols, barsStart, addDaysET(today, 1)) : Promise.resolve({}),
    getMarketState(),
  ]);

  const rows = events.map(e => {
    const quote = rowQuote(buildQuote(snapshots[e.symbol], market));
    const meta = secMeta[e.symbol];
    // Daily closes are consolidated and served 15 min late, so today's (still forming) close is the live price.
    let closes = (bars as Record<string, { date: string; close: number }[]>)[e.symbol];
    if (closes && quote.lastPrice != null && closes[closes.length - 1]?.date === today) {
      closes = [...closes.slice(0, -1), { date: today, close: quote.lastPrice }];
    }
    const reaction = e.kind === 'upcoming' ? null : computeReaction(closes, e.date, e.time, quote.lastPrice);
    return {
      ...e,
      name: meta?.name ?? null,
      sector: meta?.sector ?? null,
      industry: meta?.industry ?? null,
      marketCapTier: meta?.market_cap_tier ?? null,
      marketCap: meta?.market_cap ? Number(meta.market_cap) : null,
      ...quote,
      reactionPct: reaction?.reactionPct ?? null,
      refClose: reaction?.refClose ?? null,
      sincePct: reaction?.sincePct ?? null,
    };
  });

  return NextResponse.json({ success: true, data: { rows, from, to, today, mode, market: { session: market.session, nextChangeAt: market.nextChangeAt } } });
}
