/**
 * US equity market sessions from the Alpaca trading calendar (holidays, early
 * closes and the extended-hours window all come from it, so nothing is
 * hard-coded). Server-side; quote routes call getMarketState() and send the
 * result to the client so polling can follow the real session.
 *
 *   pre      session_open (04:00 ET)  -> open (09:30)
 *   regular  open                     -> close (16:00, or 13:00 on early closes)
 *   post     close                    -> session_close (20:00, or 17:00 on early closes)
 *   closed   everything else: overnight, weekends, holidays
 *
 * The calendar endpoint accepts the same keys as the data API (read-only); the
 * paper host is used so nothing here can ever touch a live trading account.
 * If the call fails the weekday/standard-hours rule is used (no holidays) and
 * `approximate` is set.
 */

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

const TRADING_URL = process.env.ALPACA_TRADING_URL || 'https://paper-api.alpaca.markets';
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
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  try {
    if (!key || !secret) throw new Error('Alpaca keys not set');
    const res = await fetch(
      `${TRADING_URL}/v2/calendar?start=${etDateOf(nowMs - 10 * DAY_MS)}&end=${etDateOf(nowMs + 30 * DAY_MS)}`,
      { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret }, cache: 'no-store', signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) throw new Error(`calendar HTTP ${res.status}`);
    const rows = (await res.json()) as Array<{ date: string; open: string; close: string; session_open?: string; session_close?: string }>;
    const days = rows.map(r => ({
      date: r.date,
      preOpenMs: etInstantMs(r.date, colon(r.session_open ?? '0400')),
      openMs: etInstantMs(r.date, colon(r.open)),
      closeMs: etInstantMs(r.date, colon(r.close)),
      postCloseMs: etInstantMs(r.date, colon(r.session_close ?? '2000')),
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
