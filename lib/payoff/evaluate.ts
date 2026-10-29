/**
 * Position valuation and payoff analysis (docs/strategy-builder.md). Port of
 * options-alert-lab payoff.py (`_value_at`, `_payoff_curve`, `_prob_profit`,
 * `_net_greeks`, `_heatmap`), generalised so each leg carries its own time to
 * expiry: calendars and diagonals value the far leg with Black-76 at the near
 * expiry instead of intrinsic.
 *
 * Time is "days from now" (`day`); a leg's remaining time is T_leg - day/365.
 * "At expiry" means the nearest option leg's expiry.
 */
import { black76, intrinsic } from './bs.ts';
import { legCarry } from './carry.ts';
import { round, type Leg } from './chain.ts';

export interface Scenario {
  /** Days from now (fractional allowed). */
  day: number;
  /** Added to every leg's vol, in vol points (5 = +5%). */
  ivShift?: number;
}

export interface Point { s: number; pnl: number }

const optionLegs = (legs: Leg[]) => legs.filter(l => l.kind === 'option' && !l.missing);
const usable = (legs: Leg[]) => legs.filter(l => !l.missing && l.qty !== 0);

/** Entry value: Σ qty·100·premium (stock at its entry price). */
export function entryValue(legs: Leg[]): number {
  return usable(legs).reduce((v, l) => v + l.qty * 100 * l.premium, 0);
}

/** Position value with the underlying at S under a scenario. */
export function valueAt(legs: Leg[], S: number, sc: Scenario): number {
  let v = 0;
  for (const l of usable(legs)) {
    if (l.kind === 'stock') { v += l.qty * 100 * S; continue; }
    const tau = Math.max((l.T ?? 0) - sc.day / 365, 0);
    const base = l.ivPx ?? l.iv ?? 0;
    const sig = base > 0 ? Math.max(base + (sc.ivShift ?? 0) / 100, 1e-4) : 0;
    if (tau > 0 && sig > 0) {
      const c = legCarry(l.basis ?? 1, l.disc ?? 1, l.T ?? 0, tau);
      v += l.qty * 100 * black76(l.right!, S, l.strike!, tau, sig, c.basis, c.disc);
    } else {
      v += l.qty * 100 * intrinsic(l.right!, l.strike!, S);
    }
  }
  return v;
}

/** Days from now to the nearest option leg's expiry (0 for a stock-only position). */
export function daysToNearExpiry(legs: Leg[]): number {
  const ts = optionLegs(legs).map(l => l.T ?? 0);
  return ts.length ? Math.min(...ts) * 365 : 0;
}

/** Price grid over [lo, hi] with every strike inserted, so kinks are exact. */
export function priceGrid(legs: Leg[], lo: number, hi: number, n = 161): number[] {
  const set = new Set<number>();
  const step = (hi - lo) / (n - 1);
  for (let i = 0; i < n; i++) set.add(round(lo + i * step, 4));
  for (const l of optionLegs(legs)) if (l.strike! > lo && l.strike! < hi) set.add(l.strike!);
  return [...set].sort((a, b) => a - b);
}

export function curve(legs: Leg[], grid: number[], sc: Scenario): Point[] {
  const v0 = entryValue(legs);
  return grid.map(s => ({ s, pnl: valueAt(legs, s, sc) - v0 }));
}

export function breakevens(pts: Point[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a.pnl < 0 && b.pnl >= 0) || (a.pnl > 0 && b.pnl <= 0)) {
      const t = (0 - a.pnl) / (b.pnl - a.pnl);
      out.push(round(a.s + t * (b.s - a.s), 2));
    }
  }
  return [...new Set(out)];
}

/** Risk-neutral lognormal CDF of the underlying at T years. */
export function lognormalCdf(S0: number, sigma: number, T: number) {
  const sd = sigma * Math.sqrt(T);
  const mu = Math.log(S0) - 0.5 * sigma * sigma * T;
  return (s: number) => {
    if (s <= 0) return 0;
    const z = (Math.log(s) - mu) / sd;
    return 0.5 * (1 + erfApprox(z / Math.SQRT2));
  };
}

function erfApprox(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  return sign * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
}

/** P(P&L at expiry > 0): integrates the lognormal over profitable grid slabs, plus the tails. */
export function probProfit(pts: Point[], S0: number, sigma: number | null, T: number): number | null {
  if (!sigma || sigma <= 0 || T <= 0 || S0 <= 0 || pts.length < 2) return null;
  const cdf = lognormalCdf(S0, sigma, T);
  let p = 0;
  if (pts[0].pnl > 0) p += cdf(pts[0].s);
  for (let i = 1; i < pts.length; i++) {
    if ((pts[i - 1].pnl + pts[i].pnl) / 2 > 0) p += cdf(pts[i].s) - cdf(pts[i - 1].s);
  }
  if (pts[pts.length - 1].pnl > 0) p += 1 - cdf(pts[pts.length - 1].s);
  return round(Math.min(Math.max(p, 0), 1), 4);
}

export interface NetGreeks { delta: number; gamma: number; theta: number; vega: number }

/** Σ qty·100·greek over option legs; each stock lot adds 100 delta. */
export function netGreeks(legs: Leg[]): NetGreeks {
  const g = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const l of usable(legs)) {
    if (l.kind === 'stock') { g.delta += l.qty * 100; continue; }
    g.delta += l.qty * 100 * (l.delta ?? 0);
    g.gamma += l.qty * 100 * (l.gamma ?? 0);
    g.theta += l.qty * 100 * (l.theta ?? 0);
    g.vega += l.qty * 100 * (l.vega ?? 0);
  }
  return { delta: round(g.delta), gamma: round(g.gamma, 4), theta: round(g.theta), vega: round(g.vega) };
}

export interface Analysis {
  /** Entry value (Σ qty·100·premium, stock included); > 0 is money paid. */
  v0: number;
  /** Option premium only: > 0 net debit, < 0 net credit. */
  netPremium: number;
  maxProfit: number;
  maxLoss: number;
  unboundedProfit: boolean;
  unboundedLoss: boolean;
  breakevens: number[];
  /** maxProfit / |maxLoss|; null when either side is unbounded or the loss is ~0. */
  rewardRisk: number | null;
  pop: number | null;
  greeks: NetGreeks;
  /** Capital estimate: max loss (a floor when the loss is unbounded) or the debit. */
  margin: { value: number; floor: boolean };
  /** Days to the nearest expiry. */
  dte: number;
}

/**
 * Metrics at the nearest expiry. Max/min are taken over [0, 3×spot] (a stock
 * can go to zero), and unbounded-ness from the slope far above spot.
 */
export function analyze(legs: Leg[], spot: number, atmIv: number | null): Analysis | null {
  const live = usable(legs);
  if (!live.length || spot <= 0) return null;
  const dte = daysToNearExpiry(live);
  const sc: Scenario = { day: dte };
  const pts = curve(live, priceGrid(live, 0, spot * 3, 601), sc);
  const v0 = entryValue(live);
  const far = (k: number) => valueAt(live, spot * k, sc) - v0;
  const slope = (far(10) - far(5)) / (spot * 5);
  const unboundedProfit = slope > 1;
  const unboundedLoss = slope < -1;
  const pnls = pts.map(p => p.pnl);
  const maxProfit = Math.max(...pnls);
  const maxLoss = Math.min(...pnls);
  const netPremium = optionLegs(live).reduce((v, l) => v + l.qty * 100 * l.premium, 0);
  return {
    v0: round(v0),
    netPremium: round(netPremium),
    maxProfit: round(maxProfit),
    maxLoss: round(maxLoss),
    unboundedProfit,
    unboundedLoss,
    // Only within [¼×, 2×] spot: far out, a calendar's long leg drifts with the fitted carry and can
    // cross zero again at prices that mean nothing (seen live: AAPL 345 calendar, "breakeven" 1033).
    breakevens: breakevens(pts).filter(b => b >= spot * 0.25 && b <= spot * 2),
    rewardRisk: !unboundedProfit && !unboundedLoss && maxLoss < -1e-6 ? round(maxProfit / Math.abs(maxLoss)) : null,
    pop: probProfit(pts, spot, atmIv, dte / 365),
    greeks: netGreeks(live),
    margin: { value: round(Math.max(Math.abs(Math.min(maxLoss, 0)), Math.max(netPremium, 0))), floor: unboundedLoss },
    dte,
  };
}

export interface Heatmap {
  /** Descending (high at top). */
  prices: number[];
  /** Day offsets from now; the last is the nearest expiry. */
  days: number[];
  /** pnl[row][col]. */
  pnl: number[][];
  /** Position value[row][col] (for the "contract value" view). */
  value: number[][];
  v0: number;
}

export function heatmap(legs: Leg[], spot: number, opts: { range: number; ivShift?: number; rows?: number; cols?: number }): Heatmap {
  const live = usable(legs);
  const dte = daysToNearExpiry(live);
  const rows = opts.rows ?? 21;
  const rng = Math.max(0.02, Math.min(opts.range, 0.9));
  const lo = Math.max(0.01, spot * (1 - rng)), hi = spot * (1 + rng);
  const prices = Array.from({ length: rows }, (_, i) => round(hi - (i * (hi - lo)) / (rows - 1), 2));
  const ncol = Math.max(2, Math.min(opts.cols ?? 13, Math.floor(dte) + 1));
  const days = [...new Set(Array.from({ length: ncol }, (_, i) => (i === ncol - 1 ? dte : Math.round((dte * i) / (ncol - 1)))))];
  const v0 = entryValue(live);
  const value = prices.map(p => days.map(d => round(valueAt(live, p, { day: d, ivShift: opts.ivShift }))));
  return { prices, days, value, pnl: value.map(r => r.map(v => round(v - v0))), v0: round(v0) };
}
