/**
 * Single policy chokepoint for put/call level entitlement.
 *
 * Levels are the platform's proprietary output, so they're the premium gate.
 * Unlike neon_nifty (which splits Index vs. Stocks so those plans can be sold
 * independently), this app is single-asset-class — one FEATURE_LEVELS code
 * covers every symbol. Users without it still see levels, but only for data
 * older than LEVEL_DELAY_DAYS.
 *
 * Every route that serializes level data must go through `levelGate()` — do
 * not re-derive the rule locally, and never gate inside `calculateLevels()`
 * (its output feeds value-based *filters* in the scan-alerts and quadrant
 * pipelines, which must keep seeing real numbers) or in SQL (`calculateLevels`
 * treats 0 as a real price for the five core levels, so NULLed columns would
 * surface as fake $0 levels and poison `findClosestLevel`).
 */
import { hasFeature, FEATURE_LEVELS } from '@/lib/features';

export const LEVEL_DELAY_DAYS = 7;

/**
 * How many days of historical levels a delayed (unentitled) viewer may pull in
 * one range request — a 10-day window ending at the delay cutoff.
 *
 * Without this the free tier is the entire archive: one
 * `?range=true&from=2020-01-01` per symbol returns every historical level, so
 * the whole dataset is a handful of requests away. Pro is uncapped; they've
 * bought the history.
 */
export const DELAYED_RANGE_DAYS = 10;

/** Rate limits for the level endpoints (see lib/rateLimit.ts). */
export const LEVEL_RANGE_RATE = { name: 'levels_range', limit: 10, windowSeconds: 60 };
export const LEVEL_POINT_RATE = { name: 'levels_point', limit: 60, windowSeconds: 60 };

/** 'latest' = entitled to today's levels; 'delayed' = only older than the cutoff. */
export type LevelAccess = 'latest' | 'delayed';

export function levelAccessFor(features: string[] | null | undefined): LevelAccess {
  return hasFeature(features, FEATURE_LEVELS) ? 'latest' : 'delayed';
}

/**
 * Newest `trade_date` (inclusive, `yyyy-MM-dd`) a delayed viewer may see.
 *
 * Deliberately relative to today, not to the latest available trade_date: if
 * the upstream EOD feed stalls for more than LEVEL_DELAY_DAYS, delayed viewers
 * transparently see everything. Anchoring to the data instead would
 * permanently withhold the newest N rows during a stall, which is worse for
 * paying and free users alike.
 */
export function delayCutoff(now: Date = new Date()): string {
  // UTC throughout, so a dev box in a non-UTC zone computes the same cutoff as
  // Vercel (which runs UTC) — see shiftDateUtc for the local-format trap.
  return shiftDateUtc(now.toISOString().slice(0, 10), -LEVEL_DELAY_DAYS);
}

/**
 * Shift a 'yyyy-MM-dd' string by N days, entirely in UTC.
 *
 * Deliberately not `format(subDays(new Date(s), n))`: date-fns' `format` renders
 * in LOCAL time, so parsing a date-only string (which JS treats as UTC
 * midnight) and formatting it locally shifts the result a day in any timezone
 * behind UTC. That would produce an 11-day window from a 10-day cap.
 */
function shiftDateUtc(dateStr: string, days: number): string {
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  return new Date(ms + days * 86400_000).toISOString().slice(0, 10);
}

/** Serialized alongside level data so the client can tell "withheld" from "no data". */
export interface LevelGateMeta {
  levelAccess: LevelAccess;
  /** Feature code to upsell, i.e. /upgrade?feature=<this>. */
  requiredFeature: string;
  /** Cutoff date when delayed; null when the viewer sees everything. */
  levelsWithheldAfter: string | null;
}

export interface LevelGate {
  meta: LevelGateMeta;
  /** True when this row's level fields must be blanked before serializing. */
  withheld: (tradeDate: string) => boolean;
  /** Convenience: true when the viewer sees every row's levels. */
  unrestricted: boolean;
  /**
   * Clamp a requested [from,to] span to what this viewer may pull. Delayed
   * viewers are held to DELAYED_RANGE_DAYS ending at the cutoff; entitled
   * viewers get their range back untouched.
   */
  clampRange: (from: string, to: string) => { from: string; to: string; clamped: boolean };
}

/**
 * Resolve the gate once per request, then apply `withheld()` per row.
 *
 * Callers blank their own level fields rather than passing rows through a
 * generic stripper: each endpoint's payload shape differs (nested `levels`
 * object vs `calculated` array vs per-stock arrays) and, critically, each has
 * its own set of neighbouring fields that must survive — `oi` on the levels
 * range branch, `closestLevel`/`closestValue` on quadrant.
 */
export function levelGate(features: string[] | null | undefined, now: Date = new Date()): LevelGate {
  const levelAccess = levelAccessFor(features);
  const cutoff = levelAccess === 'delayed' ? delayCutoff(now) : null;
  return {
    meta: {
      levelAccess,
      requiredFeature: FEATURE_LEVELS,
      levelsWithheldAfter: cutoff,
    },
    // trade_date is 'yyyy-MM-dd' text, so lexicographic > is a valid date compare.
    withheld: (tradeDate: string) => cutoff !== null && tradeDate > cutoff,
    unrestricted: cutoff === null,
    clampRange: (from: string, to: string) => {
      if (cutoff === null) return { from, to, clamped: false };
      // Anchor the window to the cutoff (or the caller's `to`, whichever is
      // earlier) and walk back DELAYED_RANGE_DAYS.
      const end = to < cutoff ? to : cutoff;
      const minFrom = shiftDateUtc(end, -DELAYED_RANGE_DAYS);
      const start = from > minFrom ? from : minFrom;
      return { from: start, to: end, clamped: start !== from || end !== to };
    },
  };
}
