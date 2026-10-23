/**
 * Turns a market-data snapshot into one consistent quote: the regular-session
 * price and day change, plus (outside regular hours) the extended-hours move
 * measured from the regular close. Pure; the market state comes from
 * lib/marketSession.ts.
 *
 * What the snapshot gives (checked live, after the close):
 *   dailyBar      the REGULAR session's bar (an after-hours print does not change it)
 *   prevDailyBar  the session before that
 *   latestTrade   the latest print including extended hours (condition code "T")
 * So:
 *   in the regular session   price = latest trade, change vs prevDailyBar close, no ext
 *   otherwise                price = the last regular close (dailyBar), change = that close
 *                            vs the close before it, and `ext` = latest trade vs the
 *                            regular close, if it printed after the regular close.
 * The ext figure stays until the next regular session starts (overnight,
 * weekends and holidays included). The feed sees only part of extended-hours
 * volume, so many names have no ext print; then `ext` is null and nothing is
 * shown rather than a stale or invented number.
 */
import type { Snapshot } from '@/lib/marketdata';
import type { MarketState } from '@/lib/marketSession';
import { etDateOf, etInstantMs } from '@/lib/marketSession';

export interface ExtendedQuote {
  label: 'Pre-market' | 'After hours';
  price: number;
  change: number;
  changePercent: number | null;
  /** ISO time of the print. */
  at: string;
}

export interface Quote {
  /** Live while the regular session is open, the last regular close otherwise. */
  price: number | null;
  prevClose: number | null;
  change: number | null;
  changePercent: number | null;
  dayOpen: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  ext: ExtendedQuote | null;
}

const EMPTY: Quote = { price: null, prevClose: null, change: null, changePercent: null, dayOpen: null, dayHigh: null, dayLow: null, volume: null, ext: null };

/** The compact per-row shape list/table routes send (watchlists, earnings, home). */
export function rowQuote(q: Quote) {
  return { lastPrice: q.price, change: q.change, changePercent: q.changePercent, ext: q.ext };
}

const pct = (diff: number, base: number | null) => (base ? (diff / base) * 100 : null);

export function buildQuote(snap: Snapshot | undefined, state: MarketState): Quote {
  if (!snap) return EMPTY;
  const daily = snap.dailyBar;
  const prev = snap.prevDailyBar;
  const trade = snap.latestTrade;
  const dailyDate = daily?.t?.slice(0, 10) ?? null;

  if (state.session === 'regular') {
    const price = trade?.p ?? daily?.c ?? null;
    const prevClose = prev?.c ?? null;
    const change = price !== null && prevClose !== null ? price - prevClose : null;
    return {
      price, prevClose, change, changePercent: change !== null ? pct(change, prevClose) : null,
      dayOpen: daily?.o ?? null, dayHigh: daily?.h ?? null, dayLow: daily?.l ?? null, volume: daily?.v ?? null, ext: null,
    };
  }

  // Not in the regular session: find the last completed regular bar. Normally it is
  // dailyBar. If the snapshot has already rolled to a newer (extended-hours-only) bar,
  // the regular session is prevDailyBar and the close before it isn't in the snapshot.
  let regularClose: number | null;
  let prevClose: number | null;
  let regular: typeof daily | undefined = daily;
  if (daily && dailyDate !== null && dailyDate > state.lastSessionDate) {
    regularClose = prev?.c ?? null;
    prevClose = null;
    regular = undefined;
  } else {
    regularClose = daily?.c ?? null;
    prevClose = prev?.c ?? null;
  }
  const change = regularClose !== null && prevClose !== null ? regularClose - prevClose : null;

  let ext: ExtendedQuote | null = null;
  if (trade && regularClose !== null && Date.parse(trade.t) >= Date.parse(state.lastCloseAt)) {
    const tradeMs = Date.parse(trade.t);
    const preMarket = etDateOf(tradeMs) > state.lastSessionDate && tradeMs < etInstantMs(etDateOf(tradeMs), '09:30');
    const diff = trade.p - regularClose;
    ext = { label: preMarket ? 'Pre-market' : 'After hours', price: trade.p, change: diff, changePercent: pct(diff, regularClose), at: trade.t };
  }

  return {
    price: regularClose, prevClose, change, changePercent: change !== null ? pct(change, prevClose) : null,
    dayOpen: regular?.o ?? null, dayHigh: regular?.h ?? null, dayLow: regular?.l ?? null, volume: regular?.v ?? null, ext,
  };
}
