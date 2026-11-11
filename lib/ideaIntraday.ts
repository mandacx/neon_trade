/**
 * Trade Ideas Desk: completed regular-session 15-minute bars for the 15-minute entry rule
 * (docs/trade-ideas.md, "Scoring"). Server-only: it reads the market-data facade.
 *
 * What comes back: only bars that are COMPLETE (their 15 minutes have elapsed) and that fall inside the regular session
 * of a trading day (the exchange calendar gives holidays and early closes). Pre-market and after-hours bars never count.
 * Intraday bars are single-venue (IEX): their closes are real-time but their highs and lows can miss other venues' prints.
 *
 * Throws when the feed fails (the caller must not read a failure as "no entry yet").
 */
import { getHistoricalBars, fetchCalendar } from '@/lib/marketdata';
import { etDateOf, etInstantMs } from '@/lib/marketSession';
import type { ScoreIntradayBar } from '@/lib/ideaScoring';

const BAR_MS = 15 * 60_000;
const colon = (t: string) => (t.includes(':') ? t : `${t.slice(0, 2)}:${t.slice(2)}`);

/** Regular-session [open, close) in ms for each ET date in [from, to]; weekdays 09:30-16:00 if the calendar call fails. */
async function sessionWindows(from: string, to: string): Promise<Map<string, { openMs: number; closeMs: number }>> {
  const out = new Map<string, { openMs: number; closeMs: number }>();
  try {
    const rows = await fetchCalendar(from, to);
    if (rows.length === 0) throw new Error('empty calendar');
    for (const r of rows) out.set(r.date, { openMs: etInstantMs(r.date, colon(r.open)), closeMs: etInstantMs(r.date, colon(r.close)) });
  } catch (err) {
    console.error('[ideaIntraday] calendar unavailable, assuming weekday 09:30-16:00:', err instanceof Error ? err.message : err);
    for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86_400_000) {
      const d = new Date(t).toISOString().slice(0, 10);
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (dow !== 0 && dow !== 6) out.set(d, { openMs: etInstantMs(d, '09:30'), closeMs: etInstantMs(d, '16:00') });
    }
  }
  return out;
}

/** Completed regular-session 15-minute bars of `symbol` that start at or after `fromIso`, up to `nowMs`. */
export async function getCompleted15mBars(symbol: string, fromIso: string, nowMs: number = Date.now()): Promise<ScoreIntradayBar[]> {
  const fromMs = Date.parse(fromIso);
  if (!Number.isFinite(fromMs) || fromMs >= nowMs) return [];
  const raw = await getHistoricalBars(symbol, '15Min', new Date(fromMs).toISOString(), new Date(nowMs).toISOString());
  const windows = await sessionWindows(etDateOf(fromMs), etDateOf(nowMs));
  const out: ScoreIntradayBar[] = [];
  for (const b of raw) {
    const startMs = Date.parse(b.t);
    if (!Number.isFinite(startMs) || startMs < fromMs || startMs + BAR_MS > nowMs) continue; // before the window, or not complete yet
    const date = etDateOf(startMs);
    const w = windows.get(date);
    if (!w || startMs < w.openMs || startMs + BAR_MS > w.closeMs) continue; // not a trading day, or outside the regular session
    if (![b.o, b.h, b.l, b.c].every(Number.isFinite)) continue;
    out.push({ t: new Date(startMs).toISOString(), date, open: b.o, high: b.h, low: b.l, close: b.c });
  }
  return out.sort((a, b) => (a.t < b.t ? -1 : 1));
}
