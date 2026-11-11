/**
 * Trade Ideas Desk: the provisional LIVE MARK of an open idea (docs/trade-ideas.md, "Live mark"). Pure and
 * dependency-free (fixtures: `node scripts/test-idea-scoring.mjs`), so it is safe in routes and Node scripts.
 *
 * What it is: the idea's own published plan marked at the current price. Where price is versus the entry zone,
 * stop and targets and, only once the OFFICIAL tracker says the idea has entered, the R and % at that price.
 * What it is not: the tracked result. It is never stored, never fed to `scoreIdea`, never counted in desk
 * statistics and never raises an alert. A price crossing a level is shown as a state, not a decision.
 *
 * Conventions mirror `scoreIdea`: entry = worst fill in the zone, risk = |entry - stop|, equal split across the
 * targets. No clamping at the stop: a gap fills worse than the stop in the scorer, so clamping would flatter.
 * Dates are ET `YYYY-MM-DD` strings compared as strings (never parsed in local time).
 */
import { entryPriceOf } from './ideaTypes.ts';

export interface LivePlan { direction: string; entryLow: number; entryHigh: number; targets: number[]; stop: number; publishedOn: string }
/** The stored official outcome (subset of IdeaOutcomeView). null = no outcome row yet. */
export interface LiveOfficial { outcome: string; enteredOn: string | null; entryPrice: number | null; targetsHit: number; evaluatedThrough: string | null }
/** Today's / the last session's day range; `date` is the ET session date. */
export interface LiveRange { high: number | null; low: number | null; date: string | null }
export type LiveState = 'awaiting_entry' | 'in_zone' | 'in_trade' | 'beyond_stop' | 'ran_past_target' | 'unavailable';

export interface LiveMark {
  state: LiveState;
  price: number | null;
  /** From the official outcome only; the live price never flips this. */
  entered: boolean;
  /** null unless entered and a price exists. */
  r: number | null;
  /** % of entry, same blending as the scorer. */
  pct: number | null;
  /** Per-share profit or loss in price points, blended like `r` (booked targets + the remainder at the price). null unless entered and a price exists. */
  points: number | null;
  /** max(official targets hit, leading targets the price is at or beyond). */
  targetsReached: number;
  targetsTotal: number;
  /** |entry - stop|. */
  risk: number;
  /** Worst fill in the zone (the official entry price when entered). */
  entryPrice: number;
  /** distancePct >= 0: % of price needed to reach the nearest zone edge; 0 inside. null without a price. */
  zone: { side: 'above' | 'inside' | 'below'; distancePct: number; distancePts: number } | null;
  /** distancePct = (stop - price) / price * 100 (signed, raw). distanceR = (price - stop) * sign / risk (positive = still on the safe side). */
  stop: { price: number; distancePct: number | null; distancePts: number | null; distanceR: number | null };
  /** distancePct = (target - price) / price * 100 (signed, raw). */
  targets: Array<{ price: number; distancePct: number | null; distancePts: number | null; reached: boolean }>;
  rangeHint: { stop: boolean; targetsTouched: number } | null;
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Points (per share) of a scored R: r x |entry - stop|. null when either is missing. Used for closed ideas, whose stored result is in R. */
export function pointsFromR(r: number | null | undefined, entryPrice: number | null | undefined, stop: number | null | undefined): number | null {
  if (!finite(r) || !finite(entryPrice) || !finite(stop)) return null;
  return round(r * Math.abs(entryPrice - stop), 4);
}

/** Total function: never throws and never returns NaN/Infinity (null instead). */
export function liveMark(plan: LivePlan, official: LiveOfficial | null, price: number | null, range?: LiveRange | null): LiveMark {
  const long = plan.direction !== 'short';
  const sign = long ? 1 : -1;
  const planEntry = entryPriceOf(plan.direction, plan.entryLow, plan.entryHigh);
  const risk = Math.abs(planEntry - plan.stop);
  const tgts = Array.isArray(plan.targets) ? plan.targets : [];
  const n = tgts.length;
  const px = finite(price) && price > 0 ? price : null;

  const entered = !!official?.enteredOn && official.outcome === 'open';
  const entry = entered && finite(official?.entryPrice) ? (official!.entryPrice as number) : planEntry;

  const invalid = !(risk > 0) || n === 0 || !finite(risk);
  if (invalid) {
    return {
      state: 'unavailable', price: px, entered: false, r: null, pct: null, points: null, targetsReached: 0, targetsTotal: n,
      risk: finite(risk) ? risk : 0, entryPrice: finite(planEntry) ? planEntry : 0, zone: null,
      stop: { price: plan.stop, distancePct: null, distancePts: null, distanceR: null }, targets: [], rangeHint: null,
    };
  }

  const officialHit = Math.min(Math.max(official?.targetsHit ?? 0, 0), n);
  const hits = (t: number, p: number) => (long ? p >= t : p <= t);
  let reachedByPrice = 0;
  if (px != null) while (reachedByPrice < n && hits(tgts[reachedByPrice], px)) reachedByPrice++;
  const targetsReached = Math.max(officialHit, reachedByPrice);

  const favourable = (p: number) => sign * (p - entry);
  const distPct = (level: number) => (px != null ? (level - px) / px * 100 : null);
  const distPts = (level: number) => (px != null ? round(level - px) : null);

  let state: LiveState;
  let r: number | null = null;
  let pct: number | null = null;
  let points: number | null = null;
  let zone: LiveMark['zone'] = null;

  if (px == null) {
    state = 'unavailable';
  } else if (entered) {
    let booked = 0;
    let bookedPct = 0;
    let bookedPts = 0;
    for (let i = 0; i < targetsReached; i++) {
      bookedPts += favourable(tgts[i]) / n;
      booked += favourable(tgts[i]) / risk / n;
      bookedPct += (favourable(tgts[i]) / entry) * 100 / n;
    }
    const remaining = (n - targetsReached) / n;
    r = round(booked + remaining * (favourable(px) / risk));
    pct = round(bookedPct + remaining * ((favourable(px) / entry) * 100), 2);
    points = round(bookedPts + remaining * favourable(px));
    state = (long ? px <= plan.stop : px >= plan.stop) ? 'beyond_stop' : 'in_trade';
  } else {
    const inside = px >= plan.entryLow && px <= plan.entryHigh;
    if (inside) zone = { side: 'inside', distancePct: 0, distancePts: 0 };
    else if (px > plan.entryHigh) zone = { side: 'above', distancePct: (px - plan.entryHigh) / px * 100, distancePts: round(px - plan.entryHigh) };
    else zone = { side: 'below', distancePct: (plan.entryLow - px) / px * 100, distancePts: round(plan.entryLow - px) };
    if (inside) state = 'in_zone';
    else if (long ? px <= plan.stop : px >= plan.stop) state = 'beyond_stop';
    else if (hits(tgts[0], px)) state = 'ran_past_target';
    else state = 'awaiting_entry';
  }

  let rangeHint: LiveMark['rangeHint'] = null;
  if (range?.date && range.date > plan.publishedOn && range.date > (official?.evaluatedThrough ?? '')) {
    const hi = finite(range.high) ? range.high : null;
    const lo = finite(range.low) ? range.low : null;
    const extreme = long ? lo : hi; // the side that tests the stop
    const favourableSide = long ? hi : lo; // the side that tests the targets
    const stopTouched = extreme != null && (long ? extreme <= plan.stop : extreme >= plan.stop);
    let touched = 0;
    if (favourableSide != null) while (touched < n && hits(tgts[touched], favourableSide)) touched++;
    if (extreme != null || favourableSide != null) rangeHint = { stop: stopTouched, targetsTouched: touched };
  }

  return {
    state, price: px, entered, r, pct, points, targetsReached, targetsTotal: n, risk, entryPrice: entry, zone,
    stop: { price: plan.stop, distancePct: distPct(plan.stop), distancePts: distPts(plan.stop), distanceR: px != null ? (sign * (px - plan.stop)) / risk : null },
    targets: tgts.map((t, i) => ({ price: t, distancePct: distPct(t), distancePts: distPts(t), reached: i < targetsReached })),
    rangeHint,
  };
}
