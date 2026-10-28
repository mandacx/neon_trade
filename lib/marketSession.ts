/**
 * US equity market sessions from the exchange trading calendar (holidays, early
 * closes and the extended-hours window all come from it, so nothing is
 * hard-coded). Server-side; quote routes call getMarketState() and send the
 * result to the client so polling can follow the real session.
 *
 *   pre      session_open (04:00 ET)  -> open (09:30)
 *   regular  open                     -> close (16:00, or 13:00 on early closes)
 *   post     close                    -> session_close (20:00, or 17:00 on early closes)
 *   closed   everything else: overnight, weekends, holidays
 *
 * The calendar comes from the market-data facade (read-only; see lib/marketdata).
 * If the call fails the weekday/standard-hours rule is used (no holidays) and
 * `approximate` is set.
 */
import { fetchCalendar } from '@/lib/marketdata';

export type MarketSession = 'pre' | 'regular' | 'post' | 'closed';

export interface MarketState {
  session: MarketSession;
  /** ET date ('YYYY-MM-DD') of the most recent trading day whose regular session has started. */
  lastSessionDate: string;
  /** When that day's regular session closed (or will close, if it is in progress). */
  lastCloseAt: string;
  /** Next moment the session changes (ISO), or null if unknown. */
  nextChangeAt: string | null;
  /** True when the calendar couldn't be loaded and standard weekday hours were assumed. */
  approximate: boolean;
}
interface CalendarDay { date: string; preOpenMs: number; openMs: number; closeMs: number; postCloseMs: number }

const DAY_MS = 86_400_000;
const CALENDAR_TTL_MS = 6 * 60 * 60_000;
const FALLBACK_TTL_MS = 5 * 60_000;

const etParts = (ms: number) => {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find(x => x.type === t)?.value ?? 0);
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour') % 24, mi: g('minute'), s: g('second') };
};

/** America/New_York offset from UTC (ms, negative) in effect at instant `ms`. */
function etOffsetMs(ms: number): number {
  const { y, mo, d, h, mi, s } = etParts(ms);
  return Date.UTC(y, mo - 1, d, h, mi, s) - Math.floor(ms / 1000) * 1000;
}

/** The instant of an ET wall-clock time ('HH:MM') on an ET date ('YYYY-MM-DD'). */
export function etInstantMs(date: string, hhmm: string): number {
  const wall = Date.parse(`${date}T${hhmm}:00Z`);
  let t = wall;
  for (let i = 0; i < 3; i++) t = wall - etOffsetMs(t);
  return t;
}

/** 'YYYY-MM-DD' in America/New_York for an instant. */
export function etDateOf(ms: number): string {
  const { y, mo, d } = etParts(ms);
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const colon = (t: string) => (t.includes(':') ? t : `${t.slice(0, 2)}:${t.slice(2)}`);

function weekdayFallback(nowMs: number): CalendarDay[] {
  const days: CalendarDay[] = [];
  for (let i = -10; i <= 30; i++) {
    const date = etDateOf(nowMs + i * DAY_MS);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    days.push({ date, preOpenMs: etInstantMs(date, '04:00'), openMs: etInstantMs(date, '09:30'), closeMs: etInstantMs(date, '16:00'), postCloseMs: etInstantMs(date, '20:00') });
  }
  return days;
}

let cache: { days: CalendarDay[]; at: number; approximate: boolean } | null = null;

async function loadCalendar(nowMs: number): Promise<{ days: CalendarDay[]; approximate: boolean }> {
  if (cache && nowMs - cache.at < (cache.approximate ? FALLBACK_TTL_MS : CALENDAR_TTL_MS)) return cache;
  try {
    const rows = await fetchCalendar(etDateOf(nowMs - 10 * DAY_MS), etDateOf(nowMs + 30 * DAY_MS));
    const days = rows.map(r => ({
      date: r.date,
      preOpenMs: etInstantMs(r.date, colon(r.sessionOpen ?? '0400')),
      openMs: etInstantMs(r.date, colon(r.open)),
      closeMs: etInstantMs(r.date, colon(r.close)),
      postCloseMs: etInstantMs(r.date, colon(r.sessionClose ?? '2000')),
    }));
    if (days.length === 0) throw new Error('empty calendar');
    cache = { days, at: nowMs, approximate: false };
  } catch (err) {
    console.error('[marketSession] calendar unavailable, assuming standard hours:', err instanceof Error ? err.message : err);
    // Keep serving a stale real calendar rather than dropping holidays.
    cache = cache && !cache.approximate ? { ...cache, at: nowMs - CALENDAR_TTL_MS + FALLBACK_TTL_MS } : { days: weekdayFallback(nowMs), at: nowMs, approximate: true };
  }
  return cache;
}

/** Pure session math over a calendar (exported for checks). */
export function stateFromCalendar(days: CalendarDay[], nowMs: number, approximate = false): MarketState {
  let session: MarketSession = 'closed';
  let last: CalendarDay | null = null;
  let next: number | null = null;
  for (const d of days) {
    if (d.openMs <= nowMs && (!last || d.openMs > last.openMs)) last = d;
    if (nowMs >= d.preOpenMs && nowMs < d.openMs) session = 'pre';
    else if (nowMs >= d.openMs && nowMs < d.closeMs) session = 'regular';
    else if (nowMs >= d.closeMs && nowMs < d.postCloseMs) session = 'post';
    for (const b of [d.preOpenMs, d.openMs, d.closeMs, d.postCloseMs]) if (b > nowMs && (next === null || b < next)) next = b;
  }
  // Before the first calendar day (shouldn't happen): treat the first day as "last".
  const lastDay = last ?? days[0];
  return {
    session,
    lastSessionDate: lastDay.date,
    lastCloseAt: new Date(lastDay.closeMs).toISOString(),
    nextChangeAt: next === null ? null : new Date(next).toISOString(),
    approximate,
  };
}

export async function getMarketState(now: Date = new Date()): Promise<MarketState> {
  const { days, approximate } = await loadCalendar(now.getTime());
  return stateFromCalendar(days, now.getTime(), approximate);
}

const rangeCache = new Map<string, { days: string[]; at: number }>();

/**
 * Trading dates ('YYYY-MM-DD', ascending) between `start` and `end` inclusive,
 * from the exchange calendar for that exact range (so it also works for old
 * dates, unlike the rolling window above). Falls back to weekdays if the call
 * fails; that fallback ignores holidays.
 */
export async function tradingDaysBetween(start: string, end: string): Promise<string[]> {
  const key = `${start}|${end}`;
  const hit = rangeCache.get(key);
  if (hit && Date.now() - hit.at < CALENDAR_TTL_MS) return hit.days;
  let days: string[];
  try {
    days = (await fetchCalendar(start, end)).map(r => r.date).sort();
  } catch (err) {
    console.error('[marketSession] calendar range unavailable, using weekdays:', err instanceof Error ? err.message : err);
    days = [];
    for (let t = Date.parse(`${start}T12:00:00Z`); t <= Date.parse(`${end}T12:00:00Z`); t += DAY_MS) {
      const dow = new Date(t).getUTCDay();
      if (dow !== 0 && dow !== 6) days.push(new Date(t).toISOString().slice(0, 10));
    }
    return days; // not cached, so the next call retries the calendar
  }
  if (rangeCache.size > 200) rangeCache.clear();
  rangeCache.set(key, { days, at: Date.now() });
  return days;
}

/**
 * For each option-report load date (ascending), the trading session whose activity
 * it reports: the previous trading day (the OI published on the morning of D
 * results from D-1; docs/oi-tracker.md). One calendar call for the whole span.
 */
export async function sessionsForLoads(loads: string[]): Promise<string[]> {
  if (loads.length === 0) return [];
  const start = new Date(Date.parse(`${loads[0]}T12:00:00Z`) - 14 * DAY_MS).toISOString().slice(0, 10);
  const days = await tradingDaysBetween(start, loads[loads.length - 1]);
  return loads.map(d => {
    const before = days.filter(x => x < d);
    return before.length ? before[before.length - 1] : d;
  });
}

/** The trading day before `date` ('YYYY-MM-DD'), or null if none in the prior two weeks. */
export async function previousTradingDay(date: string): Promise<string | null> {
  const end = new Date(Date.parse(`${date}T12:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${date}T12:00:00Z`) - 14 * DAY_MS).toISOString().slice(0, 10);
  const days = await tradingDaysBetween(start, end);
  return days.length ? days[days.length - 1] : null;
}
