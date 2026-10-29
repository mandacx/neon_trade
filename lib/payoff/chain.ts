/**
 * Chain context (strike lists, mids, fitted carry, ATM IV, time to expiry), leg
 * pricing from a chain, and template → legs resolution. Dependency-free.
 */
import { bsGreeks, type Right } from './bs.ts';
import { fitCarry, midKey, pricingVol, type Carry } from './carry.ts';
import type { LevelAnchor, StrategyTemplate } from './strategies.ts';

/** One side of a chain row, as served by /api/stocks/[symbol]/chain (vendor-neutral). */
export interface OptQuote {
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  vol: number | null;
  /** Open interest: the previous session's close (the source gives no date). Absent when not loaded. */
  oi?: number | null;
}

export interface ChainRow { strike: number; call?: OptQuote; put?: OptQuote }

export interface OptionChain {
  symbol: string;
  /** OCC root of the contracts (SPXW for SPX weeklies). */
  root: string;
  expiry: string;
  spot: number;
  /** ISO time the quotes were read. */
  asOf: string;
  rows: ChainRow[];
}

export interface ChainCtx {
  chain: OptionChain;
  expiry: string;
  /** Years to the expiry's 16:00 ET close, from `nowMs`. */
  T: number;
  spot: number;
  mids: Map<string, number>;
  calls: number[];
  puts: number[];
  carry: Carry;
  atmIv: number | null;
  quote: (right: Right, strike: number) => OptQuote | undefined;
}

const YEAR_MS = 365 * 86_400_000;

/** Epoch ms of 16:00 America/New_York on `expiry` (YYYY-MM-DD), DST-aware. */
export function expiryCloseMs(expiry: string): number {
  const guess = Date.parse(`${expiry}T20:00:00Z`); // 16:00 EDT
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(guess));
  return guess + (16 - (hour % 24)) * 3_600_000;
}

export function yearsTo(expiry: string, nowMs: number): number {
  return Math.max(expiryCloseMs(expiry) - nowMs, 0) / YEAR_MS;
}

export function buildCtx(chain: OptionChain, nowMs: number): ChainCtx {
  const spot = chain.spot;
  const T = yearsTo(chain.expiry, nowMs);
  const mids = new Map<string, number>();
  const byKey = new Map<string, OptQuote>();
  const calls: number[] = [], puts: number[] = [];
  for (const r of chain.rows) {
    if (r.call) { byKey.set(midKey('C', r.strike), r.call); if (r.call.mid && r.call.mid > 0) { mids.set(midKey('C', r.strike), r.call.mid); calls.push(r.strike); } }
    if (r.put) { byKey.set(midKey('P', r.strike), r.put); if (r.put.mid && r.put.mid > 0) { mids.set(midKey('P', r.strike), r.put.mid); puts.push(r.strike); } }
  }
  calls.sort((a, b) => a - b);
  puts.sort((a, b) => a - b);
  const ivs: number[] = [];
  for (const [right, ks] of [['C', calls], ['P', puts]] as const) {
    if (!ks.length) continue;
    const k = nearest(ks, spot);
    const iv = byKey.get(midKey(right, k))?.iv;
    if (iv && iv > 0) ivs.push(iv);
  }
  return {
    chain, expiry: chain.expiry, T, spot, mids, calls, puts,
    carry: fitCarry(mids, calls, puts, spot, T),
    atmIv: ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null,
    quote: (right, strike) => byKey.get(midKey(right, strike)),
  };
}

export function nearest(ks: number[], x: number): number {
  let best = ks[0];
  for (const k of ks) if (Math.abs(k - x) < Math.abs(best - x)) best = k;
  return best;
}

/**
 * A position leg. Options price per share (×100 per contract); stock qty is in
 * lots of 100 shares and its premium is the entry price per share.
 */
export interface Leg {
  id: string;
  kind: 'option' | 'stock';
  right?: Right;
  qty: number;
  strike?: number;
  expiry?: string;
  /** Entry price per share: the chain mid when priced (spot for stock). */
  premium: number;
  /** The previous premium, set when a quote refresh changed it. */
  prevPremium?: number;
  bid?: number | null;
  ask?: number | null;
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  /** Years to this leg's expiry when it was priced. */
  T?: number;
  basis?: number;
  disc?: number;
  /** The vol that reproduces `premium` through the carry-aware model. */
  ivPx?: number | null;
  /** True when the chain has no usable quote for this contract. */
  missing?: boolean;
}

let legSeq = 0;
export const newLegId = () => `leg${++legSeq}`;

/** Price (or re-price) an option leg from its expiry's chain; stock legs take spot. */
export function priceLeg(leg: Leg, ctx: ChainCtx | undefined, spot: number): Leg {
  if (leg.kind === 'stock') return { ...leg, premium: spot, delta: 1, missing: false };
  if (!ctx || leg.right === undefined || leg.strike === undefined) return { ...leg, missing: true };
  const q = ctx.quote(leg.right, leg.strike);
  const mid = q?.mid ?? null;
  if (!q || !mid || mid <= 0) return { ...leg, missing: true };
  let greeks = { delta: q.delta, gamma: q.gamma, theta: q.theta, vega: q.vega };
  if (greeks.delta == null && q.iv) {
    const g = bsGreeks(leg.right, ctx.spot, leg.strike, ctx.T, q.iv);
    if (g) greeks = g;
  }
  return {
    ...leg,
    expiry: ctx.expiry,
    premium: round(mid, 4),
    bid: q.bid, ask: q.ask, iv: q.iv, ...greeks,
    T: ctx.T, basis: ctx.carry.basis, disc: ctx.carry.disc,
    ivPx: pricingVol(leg.right, ctx.spot, leg.strike, ctx.T, mid, ctx.carry),
    missing: false,
  };
}

/** Re-price every leg after a quote refresh, remembering the old premium where it moved. */
export function repriceLegs(legs: Leg[], ctxs: Map<string, ChainCtx>, spot: number): Leg[] {
  return legs.map(l => {
    const next = priceLeg(l, l.kind === 'option' && l.expiry ? ctxs.get(l.expiry) : undefined, spot);
    return Math.abs(next.premium - l.premium) > 1e-9 ? { ...next, prevPremium: l.premium } : { ...next, prevPremium: undefined };
  });
}

export type Levels = Partial<Record<LevelAnchor, number>>;

export type ResolveResult =
  | { legs: Leg[]; /** Level anchors moved toward the money, in words. */ notes?: string[]; error?: undefined }
  | { legs?: undefined; notes?: undefined; error: string };

/**
 * A level-anchored strike is only used when its option is worth something: below this mid
 * (the larger of $0.05 and 0.1% of spot) the anchor walks toward the money. Close to expiry the
 * Put Low / Call High levels can sit where every option is ~$0 (seen 2026-10-28: AAPL 2-day
 * iron condor priced at $0 credit, 0% POP).
 */
export const minAnchorPremium = (spot: number) => Math.max(0.05, spot * 0.001);

/**
 * Concrete legs for a template: anchor = strike nearest spot (or the level),
 * then `steps` listed strikes up/down. `far` legs come from `far` (the next
 * listed expiry). Fails, with a reason, if a strike or quote is missing.
 */
export function resolveTemplate(t: StrategyTemplate, near: ChainCtx, far: ChainCtx | null, levels: Levels = {}): ResolveResult {
  const spot = near.spot;
  const anchorPrice = (a: string) =>
    a === 'call_high' ? (levels.call_high && levels.call_high > 0 ? levels.call_high : spot * 1.1)
    : a === 'put_low' ? (levels.put_low && levels.put_low > 0 ? levels.put_low : spot * 0.9)
    : spot;
  const minPrem = minAnchorPremium(spot);
  const notes: string[] = [];
  // Anchor index per expiry + right + anchor, so a condor's wing steps from the same (moved) strike.
  const anchors = new Map<string, number>();
  const anchorIndex = (ctx: ChainCtx, right: Right, a: string, ks: number[]): number => {
    const key = `${ctx.expiry}|${right}|${a}`;
    const have = anchors.get(key);
    if (have !== undefined) return have;
    const target = anchorPrice(a);
    let idx = 0;
    for (let i = 1; i < ks.length; i++) if (Math.abs(ks[i] - target) < Math.abs(ks[idx] - target)) idx = i;
    if (a !== 'atm') {
      // Walk toward the money while the anchored option has no premium, never past the money.
      const mid = (k: number) => ctx.mids.get(midKey(right, k)) ?? 0;
      const from = ks[idx];
      if (right === 'C') while (idx > 0 && ks[idx - 1] >= spot && mid(ks[idx]) < minPrem) idx--;
      else while (idx < ks.length - 1 && ks[idx + 1] <= spot && mid(ks[idx]) < minPrem) idx++;
      if (ks[idx] !== from) {
        const name = a === 'call_high' ? 'Call High' : 'Put Low';
        notes.push(`${name} (${round(target)}) is too far out for ${ctx.expiry}: its ${right === 'C' ? 'calls' : 'puts'} have no premium, so the strike moved nearer the money to ${ks[idx]}.`);
      }
    }
    anchors.set(key, idx);
    return idx;
  };
  const legs: Leg[] = [];
  for (const tl of t.legs) {
    if (tl.kind === 'stock') { legs.push(priceLeg({ id: newLegId(), kind: 'stock', qty: tl.qty, premium: spot }, undefined, spot)); continue; }
    const ctx = tl.far ? far : near;
    if (!ctx) return { error: 'Needs a later expiry, and none is available.' };
    const ks = tl.right === 'C' ? ctx.calls : ctx.puts;
    if (!ks.length) return { error: `No priced ${tl.right === 'C' ? 'calls' : 'puts'} for ${ctx.expiry}.` };
    const idx = anchorIndex(ctx, tl.right!, tl.strike!.anchor, ks) + tl.strike!.steps;
    if (idx < 0 || idx >= ks.length) return { error: 'Not enough listed strikes for this strategy.' };
    const leg = priceLeg({ id: newLegId(), kind: 'option', right: tl.right, qty: tl.qty, strike: ks[idx], premium: 0 }, ctx, spot);
    if (leg.missing) return { error: `No quote for the ${ks[idx]} ${tl.right === 'C' ? 'call' : 'put'}.` };
    legs.push(leg);
  }
  return notes.length ? { legs, notes } : { legs };
}

export const round = (x: number, dp = 2) => Math.round(x * 10 ** dp) / 10 ** dp;
