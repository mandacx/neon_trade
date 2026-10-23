/**
 * Today's ("latest session") bar for a symbol, from the live snapshot plus the delayed consolidated
 * bar. Pure and dependency-free (tested by scripts/test-us-scanner.mjs), DST-safe (dates are taken in
 * America/New_York through Intl, never with fixed offsets).
 *
 * Is the snapshot a new session? The snapshot's regular-session bar is stamped with its trading date,
 * so the test is a date comparison against the last STORED session:
 *   - snapshot date <= last stored date            -> nothing new (weekend, holiday, before the open)
 *   - snapshot date  > last stored date and equal to
 *     the calendar's latest session                -> the live bar (partial while the session runs)
 *   - the snapshot's previous bar is newer than the
 *     last stored date                             -> a settled session is missing from storage
 *                                                     (the morning top-up has not run): use it too
 * The close comparison of the older design is kept as a consistency check: when the snapshot's previous
 * close (the same session as our last stored one) differs from the stored close by more than 5%, the
 * stored history is probably pre-split, and the row is flagged.
 */
import type { DayBar } from './indicators.ts';

export interface SnapshotLike {
  latestTrade?: { p: number; t: string };
  dailyBar?: { o: number; h: number; l: number; c: number; v: number; t: string };
  prevDailyBar?: { o?: number; h?: number; l?: number; c: number; v?: number; t?: string };
}

export interface MarketStateLike {
  session: 'pre' | 'regular' | 'post' | 'closed';
  /** ET date of the most recent trading day whose regular session has started. */
  lastSessionDate: string;
  /** When that session closed (or will close). */
  lastCloseAt: string;
}

/** ET calendar date of an instant. */
export function etDate(isoOrMs: string | number): string {
  const d = new Date(typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs));
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export interface LiveBarResult {
  /** The newest session's bar, or null when storage already has the newest session. */
  bar: DayBar | null;
  /** A settled session newer than storage, to append before `bar`. */
  missing: DayBar | null;
  /** True when the bar's volume is single-venue (no delayed consolidated bar yet). */
  volumePartial: boolean;
  /** Stored history disagrees with the feed by > 5% on the same session (probably a split). */
  splitSuspect: boolean;
}

const NONE: LiveBarResult = { bar: null, missing: null, volumePartial: false, splitSuspect: false };
const finite = (...xs: Array<number | undefined>) => xs.every(x => typeof x === 'number' && Number.isFinite(x));

export function liveBarFrom(
  snap: SnapshotLike | undefined,
  stored: { lastDate: string | null; lastClose: number | null },
  state: MarketStateLike,
  delayed: DayBar | null,
): LiveBarResult {
  const d = snap?.dailyBar;
  if (!d || !finite(d.o, d.h, d.l, d.c) || !(d.o > 0) || !(d.c > 0)) return NONE;
  const date = etDate(d.t);
  if (stored.lastDate && date <= stored.lastDate) return NONE;
  if (date !== state.lastSessionDate) return NONE; // a stale snapshot from before the latest session

  let missing: DayBar | null = null;
  let splitSuspect = false;
  const pv = snap?.prevDailyBar;
  if (pv?.t && finite(pv.c)) {
    const pdate = etDate(pv.t);
    if (stored.lastDate && pdate > stored.lastDate && pdate < date && finite(pv.o, pv.h, pv.l)) {
      missing = { date: pdate, o: pv.o!, h: pv.h!, l: pv.l!, c: pv.c, v: Number(pv.v) || 0 };
    } else if (pdate === stored.lastDate && stored.lastClose && stored.lastClose > 0) {
      splitSuspect = Math.abs(pv.c / stored.lastClose - 1) > 0.05;
    }
  }

  const rt: DayBar = { date, o: d.o, h: d.h, l: d.l, c: d.c, v: Number(d.v) || 0 };
  if (delayed && delayed.date === date && delayed.o > 0) {
    return {
      bar: { date, o: delayed.o, h: Math.max(delayed.h, rt.c), l: Math.min(delayed.l, rt.c), c: rt.c, v: delayed.v },
      missing, volumePartial: false, splitSuspect,
    };
  }
  return { bar: rt, missing, volumePartial: true, splitSuspect };
}

/**
 * The pre-market price vs the last regular close, only during pre-market and only when the feed's last
 * trade is from today's pre-market (after the previous session's close).
 */
export function premarketFrom(snap: SnapshotLike | undefined, state: MarketStateLike, lastClose: number | null, nowMs: number): { price: number; prevClose: number } | null {
  if (state.session !== 'pre' || !lastClose || !(lastClose > 0)) return null;
  const t = snap?.latestTrade;
  if (!t || !(t.p > 0)) return null;
  const at = Date.parse(t.t);
  if (!(at > Date.parse(state.lastCloseAt)) || etDate(at) !== etDate(nowMs)) return null;
  return { price: t.p, prevClose: lastClose };
}

// ---------------------------------------------------------------------------
// When to refresh the shared table of today's consolidated bars (lib/scanner/today.ts)
// ---------------------------------------------------------------------------

const REFRESH_MS = 3 * 60_000;
/** The consolidated feed's delay plus a margin: after close + this, a refresh gives the final bar. */
const SETTLE_MS = 17 * 60_000;

/** Whether the table should be refreshed for the latest session (pure; exported for tests). */
export function todayNeedsRefresh(t: { fetchedAt: string | null; bars: { size: number } }, state: MarketStateLike, nowMs: number): boolean {
  const closeMs = Date.parse(state.lastCloseAt);
  if (!t.fetchedAt || t.bars.size === 0) return true;
  const fetched = Date.parse(t.fetchedAt);
  if (fetched >= closeMs + SETTLE_MS) return false; // final
  if (state.session === 'regular') return nowMs - fetched >= REFRESH_MS;
  return nowMs >= closeMs + SETTLE_MS; // after the close: one final refresh once settled
}

