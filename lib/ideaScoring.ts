/**
 * Trade Ideas Desk: mechanical scoring of one idea against daily bars (docs/trade-ideas.md, "Scoring").
 * Pure and dependency-light (fixtures: `node scripts/test-idea-scoring.mjs`). The publisher never reports an
 * outcome; the original entry zone, targets and stop (immutable once published) are what get scored.
 *
 * Rules, all on daily bars (so every result is labelled `basis = daily_bars_stop_first`):
 *  1. Only sessions after the publish date count (the publish day's own bar may pre-date the idea).
 *  2. ENTRY: the bar's range overlaps the entry zone. Entry price is the worst fill in the zone for the
 *     trader (long: zone high, short: zone low), so R is never flattered by a better fill.
 *     If price runs to the first target, or through the stop, without touching the zone, the idea never
 *     entered: `not_triggered` (not a win).
 *  3. STOP FIRST on an ambiguous bar: if one bar touches both the stop and a target, the stop is assumed
 *     to have come first. On the entry bar the same rule applies. After the entry bar, a gap through the
 *     stop fills at the open (worse than the stop); a target fills at the target price, never better.
 *  4. LADDER: the position is split equally across the targets; each target hit books its share at that
 *     target's price. What is left when the stop is hit exits at the stop; at the valid-until date it
 *     exits at the close (marked to market); on an early close it exits at that session's close.
 *  5. R = profit / risk, where risk = |entry price - stop|. Stop-moved and partial-booked updates are
 *     commentary and do not change the score.
 *  6. Outcome `open`: entered, not finished; its R is unrealised and is never counted in desk statistics.
 *
 * `asOf` is the last calendar date whose session is complete (callers pass yesterday, US/Eastern).
 */
import { entryPriceOf, SCORE_BASIS, type EntryBasis } from './ideaTypes.ts';

export interface ScoreBar { date: string; open: number; high: number; low: number; close: number }

/** A COMPLETED regular-session 15-minute bar: `t` is its ISO start instant, `date` its ET session date. */
export interface ScoreIntradayBar extends ScoreBar { t: string }

export interface ScorePlan {
  direction: string; // 'long' | 'short'
  entryLow: number;
  entryHigh: number;
  targets: number[];
  stop: number;
  publishedOn: string; // ET date the idea went live
  validUntil: string;
  /** ISO instant the idea went live; with the 'm15' basis only 15-minute bars that START at or after it can enter the idea. */
  publishedAt?: string | null;
  /** Default 'daily'. */
  entryBasis?: EntryBasis;
}

/** A publisher action that ends the idea early: a 'closed' or 'cancelled' update, effective on that ET date. */
export interface ScoreClosure { kind: 'closed' | 'cancelled'; effectiveOn: string }

export interface ScoreEvent { type: 'triggered' | 'target_hit' | 'stopped' | 'expired' | 'closed_by_publisher' | 'not_triggered' | 'cancelled'; date: string; price: number | null; detail?: string; /** ISO instant of the bar that decided it (the 15-minute entry bar), when known. */ at?: string }

export interface ScoreResult {
  /** Which rule set produced this (`nt_idea_outcomes.basis`). */
  basis: string;
  outcome: 'pending' | 'open' | 'target_hit' | 'stopped' | 'expired' | 'closed_by_publisher' | 'not_triggered' | 'cancelled';
  /** True when nothing later can change this result (every outcome except pending/open). */
  final: boolean;
  enteredOn: string | null;
  entryPrice: number | null;
  exitOn: string | null;
  exitPrice: number | null;
  targetsHit: number;
  targetsTotal: number;
  /** Realised R for finished ideas; unrealised (marked to the last close) for `open`; null when never entered. */
  r: number | null;
  pctReturn: number | null;
  /** Worst move against the entry, % of entry (>= 0). */
  maePct: number | null;
  /** Best move in favour, % of entry (>= 0). */
  mfePct: number | null;
  daysToT1: number | null;
  daysHeld: number | null;
  events: ScoreEvent[];
  evaluatedThrough: string | null;
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** Sessions between two dates, counted from the bar list (trading days), not calendar days. */
function sessionsBetween(bars: ScoreBar[], from: string, to: string): number {
  return bars.filter(b => b.date > from && b.date <= to).length;
}

/**
 * `intraday` (only read when `plan.entryBasis === 'm15'`): completed regular-session 15-minute bars from the publish time
 * to now. The ENTRY is the first bar that closes inside the zone; the entry day's stop and targets are then judged on the
 * 15-minute bars after the entry bar (the day's high and low include moves from before the entry), and later days on
 * `bars` as before. Before entry, a bar that closes through the stop or at/past target 1 without a close in the zone ends
 * the idea as `not_triggered`.
 */
export function scoreIdea(plan: ScorePlan, bars: ScoreBar[], closure: ScoreClosure | null, asOf: string, intraday: ScoreIntradayBar[] = []): ScoreResult {
  const long = plan.direction !== 'short';
  const sign = long ? 1 : -1;
  const entry = entryPriceOf(plan.direction, plan.entryLow, plan.entryHigh);
  const risk = Math.abs(entry - plan.stop);
  const n = plan.targets.length;
  const events: ScoreEvent[] = [];

  const m15 = plan.entryBasis === 'm15';
  const base: ScoreResult = {
    basis: SCORE_BASIS[m15 ? 'm15' : 'daily'],
    outcome: 'pending', final: false, enteredOn: null, entryPrice: null, exitOn: null, exitPrice: null,
    targetsHit: 0, targetsTotal: n, r: null, pctReturn: null, maePct: null, mfePct: null,
    daysToT1: null, daysHeld: null, events, evaluatedThrough: null,
  };
  if (!(risk > 0) || n === 0) return { ...base, outcome: 'not_triggered', final: true, events: [{ type: 'not_triggered', date: plan.publishedOn, price: null, detail: 'invalid plan' }] };

  // The window of sessions this idea can use.
  let last = plan.validUntil < asOf ? plan.validUntil : asOf;
  if (closure && closure.effectiveOn < last) last = closure.effectiveOn;
  const window = bars.filter(b => b.date > plan.publishedOn && b.date <= last).sort((a, b) => (a.date < b.date ? -1 : 1));

  // 'm15' entry: the first completed 15-minute bar that closes inside the zone (or the idea ending before one did).
  type Step = ScoreBar & { i?: boolean; /** ISO instant the 15-minute bar closed (a fill happens at the close). */ at?: string };
  const closeAt = (t: string) => new Date(Date.parse(t) + 15 * 60_000).toISOString();
  let entryBar: ScoreIntradayBar | null = null;
  let ibars: ScoreIntradayBar[] = [];
  if (m15) {
    const lastI = closure && closure.effectiveOn < plan.validUntil ? closure.effectiveOn : plan.validUntil;
    const from = plan.publishedAt ? Date.parse(plan.publishedAt) : NaN;
    ibars = intraday
      .filter(b => b.date <= lastI && Number.isFinite(b.close) && (Number.isNaN(from) ? b.date > plan.publishedOn : Date.parse(b.t) >= from))
      .sort((a, b) => (a.t < b.t ? -1 : 1));
  }
  const evaluatedThrough = ((): string | null => {
    const d = window.length ? window[window.length - 1].date : null;
    const i = ibars.length ? ibars[ibars.length - 1].date : null;
    return d && i ? (d > i ? d : i) : d ?? i;
  })();

  let entered = false;
  let enteredOn: string | null = null;
  let targetsHit = 0;
  let t1Date: string | null = null;
  let booked = 0; // realised R from targets
  let bookedPct = 0;
  let minLow = Infinity;
  let maxHigh = -Infinity;
  let exit: { date: string; price: number; kind: 'stopped' | 'target_hit' } | null = null;
  let neverEntered: { date: string; why: string } | null = null;

  const favourable = (px: number) => sign * (px - entry);

  let list: Step[] = window;
  if (m15) {
    for (const b of ibars) {
      if (b.close >= plan.entryLow && b.close <= plan.entryHigh) { entryBar = b; break; }
      const ranToTarget = long ? b.close >= plan.targets[0] : b.close <= plan.targets[0];
      const hitStop = long ? b.close <= plan.stop : b.close >= plan.stop;
      if (ranToTarget) { neverEntered = { date: b.date, why: 'closed at or past the first target without a close inside the entry zone' }; break; }
      if (hitStop) { neverEntered = { date: b.date, why: 'closed through the stop without a close inside the entry zone' }; break; }
    }
    list = [];
    if (entryBar) {
      const eb: ScoreIntradayBar = entryBar;
      entered = true;
      enteredOn = eb.date;
      events.push({ type: 'triggered', date: eb.date, price: entry, at: closeAt(eb.t), detail: '15-minute close in the entry zone' });
      // After the entry bar: the same day's later 15-minute bars, then complete daily bars for the following days.
      const after: Step[] = ibars.filter(b => b.date === eb.date && b.t > eb.t).map(b => ({ date: b.date, open: b.open, high: b.high, low: b.low, close: b.close, i: true, at: closeAt(b.t) }));
      list = [...after, ...window.filter(b => b.date > eb.date)];
    }
  }

  for (const b of list) {
    if (!entered) {
      const touches = b.low <= plan.entryHigh && b.high >= plan.entryLow;
      if (!touches) {
        // Ran away or broke down without ever touching the zone: the idea never entered.
        const ranToTarget = long ? b.low > plan.entryHigh && b.high >= plan.targets[0] : b.high < plan.entryLow && b.low <= plan.targets[0];
        const hitStop = long ? b.high < plan.entryLow && b.low <= plan.stop : b.low > plan.entryHigh && b.high >= plan.stop;
        if (ranToTarget) { neverEntered = { date: b.date, why: 'ran to the first target without touching the entry zone' }; break; }
        if (hitStop) { neverEntered = { date: b.date, why: 'fell through the stop without touching the entry zone' }; break; }
        continue;
      }
      entered = true;
      enteredOn = b.date;
      events.push({ type: 'triggered', date: b.date, price: entry });
    }

    // Excursions include the entry bar (conservative: its low may pre-date the fill).
    minLow = Math.min(minLow, b.low);
    maxHigh = Math.max(maxHigh, b.high);

    // Stop first, including on the entry bar. After the entry bar a gap through the stop fills at the open.
    const stopTouched = long ? b.low <= plan.stop : b.high >= plan.stop;
    if (stopTouched) {
      const gap = (b.date !== enteredOn || b.i === true) && (long ? b.open < plan.stop : b.open > plan.stop);
      const px = gap ? b.open : plan.stop;
      exit = { date: b.date, price: px, kind: 'stopped' };
      events.push({ type: 'stopped', date: b.date, price: px, detail: gap ? 'gapped through the stop' : undefined, ...(b.at ? { at: b.at } : {}) });
      break;
    }
    // Targets in ladder order; several may fall on one bar.
    while (targetsHit < n && (long ? b.high >= plan.targets[targetsHit] : b.low <= plan.targets[targetsHit])) {
      const px = plan.targets[targetsHit];
      booked += favourable(px) / risk / n;
      bookedPct += (favourable(px) / entry) * 100 / n;
      targetsHit++;
      if (targetsHit === 1) t1Date = b.date;
      events.push({ type: 'target_hit', date: b.date, price: px, detail: `T${targetsHit}`, ...(b.at ? { at: b.at } : {}) });
    }
    if (targetsHit === n) { exit = { date: b.date, price: plan.targets[n - 1], kind: 'target_hit' }; break; }
  }

  const finishNever = (type: 'not_triggered' | 'cancelled', date: string, detail: string): ScoreResult => ({
    ...base, outcome: type, final: true, exitOn: date, events: [...events, { type, date, price: null, detail }], evaluatedThrough,
  });

  if (!entered) {
    if (neverEntered) return finishNever('not_triggered', neverEntered.date, neverEntered.why);
    if (closure) {
      // Withdrawn (or closed) before it entered: nothing was ever traded.
      return finishNever('cancelled', closure.effectiveOn, 'withdrawn before entry');
    }
    if (asOf >= plan.validUntil) return finishNever('not_triggered', plan.validUntil, 'valid-until passed without entering the zone');
    return { ...base, evaluatedThrough };
  }

  const mae = Number.isFinite(minLow) ? Math.max(0, long ? ((entry - minLow) / entry) * 100 : ((maxHigh - entry) / entry) * 100) : null;
  const mfe = Number.isFinite(maxHigh) ? Math.max(0, long ? ((maxHigh - entry) / entry) * 100 : ((entry - minLow) / entry) * 100) : null;
  const common = { enteredOn, entryPrice: entry, targetsHit, targetsTotal: n, maePct: mae == null ? null : round(mae, 2), mfePct: mfe == null ? null : round(mfe, 2), evaluatedThrough };
  // Trading days after the entry day (m15: the entry day is the anchor; it has no daily row in `list`).
  const dayList: ScoreBar[] = m15 && enteredOn ? [{ date: enteredOn, open: 0, high: 0, low: 0, close: 0 }, ...window.filter(b => b.date > enteredOn!)] : window;
  const daysToT1 = t1Date && enteredOn ? sessionsBetween(dayList, enteredOn, t1Date) : null;
  const remaining = (n - targetsHit) / n;
  const held = (to: string) => (enteredOn ? sessionsBetween(dayList, enteredOn, to) : null);

  const done = (outcome: ScoreResult['outcome'], date: string, px: number): ScoreResult => {
    const r = booked + remaining * (favourable(px) / risk);
    const pct = bookedPct + remaining * ((favourable(px) / entry) * 100);
    return { ...base, ...common, outcome, final: true, exitOn: date, exitPrice: px, r: round(r), pctReturn: round(pct, 2), daysToT1, daysHeld: held(date), events };
  };

  if (exit) return done(exit.kind, exit.date, exit.price);

  const lastStep: Step | undefined = list.length ? list[list.length - 1]
    : entryBar ? { date: entryBar.date, open: entryBar.open, high: entryBar.high, low: entryBar.low, close: entryBar.close, i: true }
    : window[window.length - 1];
  // A 15-minute step is marked at that day's official close when the complete daily bar exists.
  const lastBar = lastStep && lastStep.i ? { ...lastStep, close: bars.find(x => x.date === lastStep.date)?.close ?? lastStep.close } : lastStep;
  // Publisher closed it: exit at the close of the last session on or before the effective date, once that session is complete.
  if (closure && asOf >= closure.effectiveOn && lastBar) {
    events.push({ type: 'closed_by_publisher', date: lastBar.date, price: lastBar.close });
    return done('closed_by_publisher', lastBar.date, lastBar.close);
  }
  // Valid-until passed with the position still open: mark to the last close.
  if (asOf >= plan.validUntil && lastBar) {
    events.push({ type: 'expired', date: lastBar.date, price: lastBar.close, detail: 'marked to the last close' });
    return done('expired', lastBar.date, lastBar.close);
  }
  // Still running: unrealised R marked to the last close.
  const mark = lastBar ? lastBar.close : entry;
  const r = booked + remaining * (favourable(mark) / risk);
  const pct = bookedPct + remaining * ((favourable(mark) / entry) * 100);
  return {
    ...base, ...common, outcome: 'open', final: false, exitOn: null, exitPrice: null,
    r: round(r), pctReturn: round(pct, 2), daysToT1, daysHeld: lastBar && enteredOn ? sessionsBetween(dayList, enteredOn, lastBar.date) : null, events,
  };
}

/** Whole calendar days between two YYYY-MM-DD dates (for display only). */
export const calendarDays = dayDiff;
