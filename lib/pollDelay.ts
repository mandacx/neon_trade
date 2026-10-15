/**
 * How long a quote poller should wait, given the market state the quote route
 * returned. Pure and client-safe.
 *
 *   regular   every `regularMs`
 *   pre/post  every `extendedMs` (prices still move; IEX prints are sparser)
 *   closed    sleep until the next session boundary (the 04:00 ET pre-market
 *             start, then 09:30 ...), capped so a sleeping laptop or a changed
 *             calendar can't leave the page stale for long
 */
import type { MarketSession } from '@/lib/marketSession';

export interface MarketClock {
  session: MarketSession;
  nextChangeAt: string | null;
}

export function pollDelayMs(
  market: MarketClock | null | undefined,
  opts: { regularMs: number; extendedMs: number; closedMaxMs?: number },
  nowMs: number = Date.now(),
): number {
  if (!market) return opts.regularMs;
  if (market.session === 'regular') return opts.regularMs;
  if (market.session === 'pre' || market.session === 'post') {
    // Don't overshoot a boundary (e.g. the 09:30 open) by more than a poll.
    const toChange = market.nextChangeAt ? Date.parse(market.nextChangeAt) - nowMs : Infinity;
    return Math.max(2_000, Math.min(opts.extendedMs, toChange + 1_500));
  }
  const cap = opts.closedMaxMs ?? 15 * 60_000;
  const toChange = market.nextChangeAt ? Date.parse(market.nextChangeAt) - nowMs + 1_500 : cap;
  return Math.max(5_000, Math.min(cap, toChange));
}
