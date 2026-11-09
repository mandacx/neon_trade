/**
 * "I took this": the subscriber's own record of an idea (docs/trade-ideas.md). Pure maths (fixtures:
 * scripts/test-idea-scoring.mjs). The quantity and the price are the subscriber's own, never defaulted from the idea;
 * nothing here places an order. Amounts are in the subscriber's own units (price x quantity), not a platform P&L.
 */
import { entryPriceOf } from './ideaTypes.ts';

export interface TakenPlan { direction: string; entryLow: number; entryHigh: number; stop: number; targets: number[] }

export interface TakenInput { qty: number; entryPrice: number }

export const MAX_QTY = 1_000_000_000;

/** Validate the subscriber's own numbers. Quantity and price are both required. */
export function validateTaken(raw: any): { ok: true; input: TakenInput; note: string | null } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const qty = typeof raw?.qty === 'number' ? raw.qty : raw?.qty != null && raw.qty !== '' ? Number(raw.qty) : NaN;
  const entryPrice = typeof raw?.entryPrice === 'number' ? raw.entryPrice : raw?.entryPrice != null && raw.entryPrice !== '' ? Number(raw.entryPrice) : NaN;
  if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY) errors.push('Enter your own quantity (more than 0).');
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) errors.push('Enter the price you paid or will pay.');
  const note = typeof raw?.note === 'string' && raw.note.trim() ? raw.note.trim().slice(0, 500) : null;
  if (errors.length) return { ok: false, errors };
  return { ok: true, input: { qty: Math.round(qty * 1e4) / 1e4, entryPrice: Math.round(entryPrice * 1e6) / 1e6 }, note };
}

export interface TakenPreview {
  positionValue: number;
  /** Loss if the original stop is hit, at the subscriber's own price and quantity. */
  riskAmount: number;
  riskPct: number;
  /** Profit if the whole position is closed at each target. */
  atTarget: Array<{ price: number; profit: number; r: number }>;
  warnings: string[];
}

export function previewTaken(plan: TakenPlan, input: TakenInput): TakenPreview {
  const sign = plan.direction === 'short' ? -1 : 1;
  const risk = Math.abs(input.entryPrice - plan.stop);
  const warnings: string[] = [];
  const stopOnWrongSide = sign * (plan.stop - input.entryPrice) >= 0;
  if (stopOnWrongSide) warnings.push('Your price is already beyond the stop, so this idea no longer works for you.');
  else if (input.entryPrice < plan.entryLow || input.entryPrice > plan.entryHigh) {
    warnings.push(`Your price is outside the published entry zone (${plan.entryLow} to ${plan.entryHigh}), so your result will differ from the desk's tracked result.`);
  }
  const atTarget = plan.targets.map(t => ({
    price: t,
    profit: round(sign * (t - input.entryPrice) * input.qty),
    r: risk > 0 && !stopOnWrongSide ? round(sign * (t - input.entryPrice) / risk, 2) : 0,
  }));
  return {
    positionValue: round(input.entryPrice * input.qty),
    riskAmount: stopOnWrongSide ? 0 : round(risk * input.qty),
    riskPct: stopOnWrongSide ? 0 : round((risk / input.entryPrice) * 100, 2),
    atTarget,
    warnings,
  };
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Profit and % for one trade at an exit (or mark) price. */
export function tradeResult(direction: string, input: TakenInput, px: number): { profit: number; pct: number } {
  const sign = direction === 'short' ? -1 : 1;
  return { profit: round(sign * (px - input.entryPrice) * input.qty), pct: round((sign * (px - input.entryPrice) / input.entryPrice) * 100, 2) };
}

export interface CompareRow { ideaId: number; taken: boolean; ideaPct: number | null; myPct: number | null }

export interface Followed {
  /** Ideas I took that the desk finished AND I closed: the like-for-like set. */
  followed: { n: number; myAvgPct: number | null; deskAvgPct: number | null };
  /** Finished, counted ideas I could read and did not take. */
  notFollowed: { n: number; deskAvgPct: number | null };
  /** Ideas I took that are not in the comparison yet, and why. */
  pending: { stillOpenForMe: number; ideaNotFinished: number };
}

const mean = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 2) : null);

/**
 * Followed vs not followed. `rows` = every counted (entered and finished) idea in the viewer's terms, flagged `taken`,
 * with the desk's % return and, for taken ones the viewer has closed, the viewer's own %. Both averages for the
 * followed set use the same ideas, so the comparison is like for like.
 */
export function compareFollowed(rows: CompareRow[], pending: Followed['pending']): Followed {
  const both = rows.filter(r => r.taken && r.myPct != null && r.ideaPct != null);
  const notTaken = rows.filter(r => !r.taken && r.ideaPct != null);
  return {
    followed: { n: both.length, myAvgPct: mean(both.map(r => r.myPct as number)), deskAvgPct: mean(both.map(r => r.ideaPct as number)) },
    notFollowed: { n: notTaken.length, deskAvgPct: mean(notTaken.map(r => r.ideaPct as number)) },
    pending,
  };
}

/** The plan side of an idea as `TakenPlan`, from the entry price convention shared with scoring. */
export const conservativeEntry = entryPriceOf;
