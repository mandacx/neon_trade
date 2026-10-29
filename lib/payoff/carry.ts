/**
 * Carry fitted from a chain's own put-call parity, and per-leg calibration so a
 * position marks at exactly its entry mids (no phantom P&L at entry). Port of
 * options-alert-lab payoff.py `_fit_carry`, `_leg_carry`, `calibrate_legs`.
 *
 * Why: with zero carry the model says C - P = S - K while the market quotes
 * C - P = disc·(F - K). On a few-months chain that gap is dollars per share and
 * has the same sign on long puts and short calls, so collars, married puts and
 * covered calls would show it as instant P&L.
 */
import { impliedVol, type Right } from './bs.ts';

const DISC_RANGE: [number, number] = [0.85, 1.05];
const BASIS_RANGE: [number, number] = [0.8, 1.3];
const MIN_STRIKES = 4;

export interface Carry { basis: number; disc: number }

/**
 * Regress C - P on K over near-the-money strikes (±15% of spot) that quote both
 * sides: slope = -disc, intercept = disc·F. Returns {1, 1} (no carry) when the
 * chain can't support the fit or the answer is implausible.
 */
export function fitCarry(mids: Map<string, number>, calls: number[], puts: number[], S0: number, T: number): Carry {
  const none = { basis: 1, disc: 1 };
  if (T <= 0 || S0 <= 0) return none;
  const putSet = new Set(puts);
  const xs: number[] = [], ys: number[] = [];
  for (const k of calls) {
    if (!putSet.has(k) || k <= 0.85 * S0 || k >= 1.15 * S0) continue;
    const c = mids.get(midKey('C', k)), p = mids.get(midKey('P', k));
    if (c && p) { xs.push(k); ys.push(c - p); }
  }
  const n = xs.length;
  if (n < MIN_STRIKES) return none;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  if (sxx <= 0) return none;
  const slope = sxy / sxx;
  const disc = -slope;
  if (disc < DISC_RANGE[0] || disc > DISC_RANGE[1]) return none;
  const basis = (my - slope * mx) / disc / S0;
  if (basis < BASIS_RANGE[0] || basis > BASIS_RANGE[1]) return none;
  return { basis, disc };
}

export const midKey = (right: Right, strike: number) => `${right}${strike}`;

/** A leg's carry rescaled from the chain's tenor `tRef` to `tau` (both are exponentials in time). */
export function legCarry(basis: number, disc: number, tRef: number, tau: number): Carry {
  if (!(tRef > 0) || tau <= 0) return { basis: 1, disc: 1 };
  const k = tau / tRef;
  return { basis: basis ** k, disc: disc ** k };
}

/** The vol that reproduces `premium` through the carry-aware model; null if out of the model's range. */
export function pricingVol(right: Right, S0: number, strike: number, T: number, premium: number, carry: Carry): number | null {
  return impliedVol(right, S0, strike, T, premium, carry.basis, carry.disc);
}
