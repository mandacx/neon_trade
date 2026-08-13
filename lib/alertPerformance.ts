import { sql } from '@/lib/db';
import { getAlertsForSymbolsByExpiry, AlertsByExpiryOptions, TickerAlert, ScanLevelName, ScanDirection } from '@/lib/scanAlerts';
import { usTradingDayKey } from '@/lib/utils';

// How a fired alert actually played out by the time its option expiry
// arrived. `not_yet_expired`/`awaiting_data` are both "no verdict yet" but
// distinguished so the UI never guesses at data that legitimately doesn't
// exist yet vs. data the EOD table just hasn't caught up on.
export type PerformanceOutcome = 'favorable' | 'unfavorable' | 'flat' | 'not_yet_expired' | 'awaiting_data';

export interface PerformanceRow extends TickerAlert {
  expiryClose: number | null;
  /** (expiryClose - price) / price, signed by raw market direction (not yet normalized for buy/sell). Null until resolved. */
  movePct: number | null;
  outcome: PerformanceOutcome;
}

// A move smaller than this is "flat" either direction — avoids classifying
// near-zero noise as a directional win or loss.
const FLAT_THRESHOLD = 0.001;
// How far back from expiry_dt the EOD close lookup is allowed to reach —
// bounds a lagging eod_usmkts_price table from ever returning a technically
// earlier close that's actually stale by weeks.
const EOD_LOOKBACK_DAYS = 7;

/**
 * `expiryDate >= todayStr` MUST be checked first. The EOD lookup window is
 * [expiry - EOD_LOOKBACK_DAYS, expiry], which for a *future* expiry still
 * contains recent trade dates, so it happily returns a mid-flight close and
 * movePct comes back non-null. Testing movePct first would short-circuit
 * this branch and score open positions as wins/losses (a documented bug in
 * the sister NSE project's original version — 814 of 928 rows misclassified
 * before the check order was fixed. Don't repeat it).
 */
function classifyOutcome(direction: ScanDirection, movePct: number | null, expiryDate: string, todayStr: string): PerformanceOutcome {
  if (expiryDate >= todayStr) return 'not_yet_expired';
  if (movePct === null) return 'awaiting_data';
  const favorable = direction === 'buy_above' ? movePct > FLAT_THRESHOLD : movePct < -FLAT_THRESHOLD;
  const unfavorable = direction === 'buy_above' ? movePct < -FLAT_THRESHOLD : movePct > FLAT_THRESHOLD;
  if (favorable) return 'favorable';
  if (unfavorable) return 'unfavorable';
  return 'flat';
}

interface ExpiryCloseRow { symbol: string; expiry_dt: string; close: number }

/**
 * Batched resolution of each distinct (symbol, expiry_dt) pair's closing
 * price on or just before expiry — one query for the whole watchlist rather
 * than one round-trip per alert.
 */
async function resolveExpiryCloses(pairs: Array<{ symbol: string; expiryDate: string }>): Promise<Map<string, number>> {
  if (pairs.length === 0) return new Map();
  const symbols = pairs.map(p => p.symbol);
  const expiries = pairs.map(p => p.expiryDate);

  const rows = await sql`
    SELECT
      pair.symbol AS symbol,
      pair.expiry_dt::text AS expiry_dt,
      e.close AS close
    FROM unnest(${symbols}::text[], ${expiries}::date[]) AS pair(symbol, expiry_dt)
    CROSS JOIN LATERAL (
      SELECT close
      FROM public.eod_usmkts_price
      WHERE symbol = pair.symbol
        AND trade_date <= pair.expiry_dt
        AND trade_date >= pair.expiry_dt - ${EOD_LOOKBACK_DAYS} * INTERVAL '1 day'
      ORDER BY trade_date DESC
      LIMIT 1
    ) e
  ` as unknown as ExpiryCloseRow[];

  const map = new Map<string, number>();
  for (const r of rows) map.set(`${r.symbol}__${r.expiry_dt}`, Number(r.close));
  return map;
}

/**
 * Full past-expiry performance dataset for a set of symbols (a watchlist's
 * members). Resolves each alert's outcome against its own option expiry's
 * closing price.
 */
export async function getExpiryPerformanceForSymbols(symbols: string[], opts: AlertsByExpiryOptions = {}): Promise<PerformanceRow[]> {
  const alerts = await getAlertsForSymbolsByExpiry(symbols, opts);
  if (alerts.length === 0) return [];

  // US-Eastern trading-day string, not a plain UTC date: expiry-day boundaries
  // should be judged in the market's own day, not whatever UTC happens to be
  // at request time (e.g. an expiry that's "today" in US Eastern but
  // "tomorrow" in UTC around midnight UTC).
  const todayStr = usTradingDayKey(Date.now() / 1000);

  // Only resolve closes for expiries that have actually passed. Skipping the
  // rest isn't just an optimisation: the lookup window would otherwise return a
  // pre-expiry close for a still-open position, and that value would surface as
  // `expiryClose`/`movePct` in the per-symbol table even though the outcome is
  // correctly 'not_yet_expired'.
  const uniquePairs = new Map<string, { symbol: string; expiryDate: string }>();
  for (const a of alerts) {
    if (a.expiryDate >= todayStr) continue;
    uniquePairs.set(`${a.symbol}__${a.expiryDate}`, { symbol: a.symbol, expiryDate: a.expiryDate });
  }
  const closeMap = await resolveExpiryCloses([...uniquePairs.values()]);

  return alerts.map(a => {
    const expired = a.expiryDate < todayStr;
    const expiryClose = expired ? closeMap.get(`${a.symbol}__${a.expiryDate}`) ?? null : null;
    const movePct = expiryClose !== null ? (expiryClose - a.price) / a.price : null;
    return { ...a, expiryClose, movePct, outcome: classifyOutcome(a.direction, movePct, a.expiryDate, todayStr) };
  });
}

// Call High on top to Put Low on bottom — matches the display order convention in lib/utils.ts.
const LEVEL_ORDER: ScanLevelName[] = ['call_high', 'call_int', 'put_call_int', 'put_int', 'put_low'];
const RESOLVED_OUTCOMES: PerformanceOutcome[] = ['favorable', 'unfavorable', 'flat'];
// Best/worst-symbol rankings need at least this many resolved alerts so one
// lucky/unlucky trade can't dominate the list.
const MIN_SYMBOL_SAMPLE = 2;
const BEST_WORST_LIMIT = 5;

export interface LevelBreakdown {
  level: ScanLevelName;
  total: number;
  favorable: number;
  unfavorable: number;
  flat: number;
  winRate: number | null;
}

export interface SymbolRanking {
  symbol: string;
  count: number;
  winRate: number;
}

export interface PerformanceSummary {
  total: number;
  resolved: number;
  favorable: number;
  unfavorable: number;
  flat: number;
  notYetExpired: number;
  awaitingData: number;
  /**
   * CONTINUATION win rate: price kept moving away from the level it was sitting
   * on. `direction` is definitionally "which side of the level is price on"
   * (derived as `last_price >= levelPrice`), so "favorable" means the move
   * continued rather than reverted.
   */
  winRate: number | null;
  /**
   * REVERSION win rate over the same resolved set — the complement, excluding
   * flats. Reported alongside continuation rather than baking in a polarity,
   * since whether these levels behave as breakout triggers or as
   * support/resistance that holds is a domain call, not something to assume.
   */
  reversionRate: number | null;
  /** Average move %, sign-normalized so positive always means "in the alert's favor" regardless of buy/sell direction. */
  avgMovePct: number | null;
  byLevel: LevelBreakdown[];
  bestSymbols: SymbolRanking[];
  worstSymbols: SymbolRanking[];
}

export function summarizePerformanceRows(rows: PerformanceRow[]): PerformanceSummary {
  const resolvedRows = rows.filter(r => RESOLVED_OUTCOMES.includes(r.outcome));
  const favorable = resolvedRows.filter(r => r.outcome === 'favorable').length;
  const unfavorable = resolvedRows.filter(r => r.outcome === 'unfavorable').length;
  const flat = resolvedRows.filter(r => r.outcome === 'flat').length;
  const notYetExpired = rows.filter(r => r.outcome === 'not_yet_expired').length;
  const awaitingData = rows.filter(r => r.outcome === 'awaiting_data').length;

  const winRate = resolvedRows.length > 0 ? favorable / resolvedRows.length : null;
  // Reversion is measured against directional outcomes only: a flat is neither a
  // continuation nor a reversion, so counting it in this denominator (as
  // winRate does) would make the two rates look inconsistent rather than
  // complementary.
  const directional = favorable + unfavorable;
  const reversionRate = directional > 0 ? unfavorable / directional : null;

  const directionalMoves = resolvedRows.map(r => (r.direction === 'buy_above' ? r.movePct! : -r.movePct!));
  const avgMovePct = directionalMoves.length > 0
    ? directionalMoves.reduce((sum, v) => sum + v, 0) / directionalMoves.length
    : null;

  const byLevelMap = new Map<ScanLevelName, { total: number; favorable: number; unfavorable: number; flat: number }>();
  for (const r of resolvedRows) {
    const cur = byLevelMap.get(r.level) ?? { total: 0, favorable: 0, unfavorable: 0, flat: 0 };
    cur.total++;
    cur[r.outcome as 'favorable' | 'unfavorable' | 'flat']++;
    byLevelMap.set(r.level, cur);
  }
  const byLevel: LevelBreakdown[] = LEVEL_ORDER
    .map(level => {
      const s = byLevelMap.get(level);
      if (!s) return null;
      return { level, ...s, winRate: s.total > 0 ? s.favorable / s.total : null };
    })
    .filter((l): l is LevelBreakdown => l !== null);

  const bySymbolMap = new Map<string, { favorable: number; count: number }>();
  for (const r of resolvedRows) {
    const cur = bySymbolMap.get(r.symbol) ?? { favorable: 0, count: 0 };
    cur.count++;
    if (r.outcome === 'favorable') cur.favorable++;
    bySymbolMap.set(r.symbol, cur);
  }
  const eligible: SymbolRanking[] = [...bySymbolMap.entries()]
    .filter(([, s]) => s.count >= MIN_SYMBOL_SAMPLE)
    .map(([symbol, s]) => ({ symbol, count: s.count, winRate: s.favorable / s.count }));

  // Best and worst are drawn from disjoint halves of the ranking. Slicing the
  // top-5 and bottom-5 of the same list independently meant that with <= 5
  // eligible symbols (easy to hit: MIN_SYMBOL_SAMPLE is only 2) every symbol
  // appeared in BOTH lists, once as a winner and once as a loser.
  const ranked = [...eligible].sort((a, b) => b.winRate - a.winRate || b.count - a.count);
  const half = Math.floor(ranked.length / 2);
  const bestSymbols = ranked.slice(0, Math.min(half, BEST_WORST_LIMIT));
  const worstSymbols = ranked
    .slice(ranked.length - Math.min(half, BEST_WORST_LIMIT))
    .reverse();

  return { total: rows.length, resolved: resolvedRows.length, favorable, unfavorable, flat, notYetExpired, awaitingData, winRate, reversionRate, avgMovePct, byLevel, bestSymbols, worstSymbols };
}
