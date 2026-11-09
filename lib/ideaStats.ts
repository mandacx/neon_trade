/**
 * Trade Ideas Desk: desk and publisher statistics (docs/trade-ideas.md, "Performance"). Pure; fixtures in
 * scripts/test-idea-scoring.mjs. One stats engine: every number on the performance page comes from here.
 *
 * Honest numbers: returns are R-multiples and % per idea, never a made-up dollar P&L. Only ideas that
 * entered and finished are counted; every stat block carries `coverage` saying how many ideas were counted,
 * how many were excluded and why. Open ideas are never counted (their R is unrealised).
 */

export interface StatRow {
  id: number;
  symbol: string;
  horizon: string;
  direction: string;
  publisherId: string;
  hasOption: boolean;
  outcome: string;
  r: number | null;
  pctReturn: number | null;
  exitOn: string | null;
  daysToT1: number | null;
  maePct: number | null;
  targetsHit: number;
}

/** Outcomes that are an entered, finished trade. */
export const COUNTED_OUTCOMES = ['target_hit', 'stopped', 'expired', 'closed_by_publisher'];

export interface Coverage {
  total: number;
  counted: number;
  excluded: Record<string, number>;
  from: string | null;
  to: string | null;
}

export interface CurvePoint { date: string; cumR: number; id: number }

export interface Stats {
  n: number;
  wins: number;
  losses: number;
  flat: number;
  /** wins / n. Win = R > 0. */
  hitRate: number | null;
  avgR: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  /** hitRate x avgWinR + lossRate x avgLossR. */
  expectancyR: number | null;
  /** Sum of winning R / absolute sum of losing R. */
  profitFactor: number | null;
  totalR: number;
  avgPct: number | null;
  /** Share of entered ideas that reached at least the first target. */
  t1Rate: number | null;
  avgDaysToT1: number | null;
  /** Average worst move against the entry, % of entry. */
  avgMaePct: number | null;
  maxWinStreak: number;
  maxLossStreak: number;
  best: { id: number; symbol: string; r: number } | null;
  worst: { id: number; symbol: string; r: number } | null;
  curve: CurvePoint[];
  coverage: Coverage;
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r4 = (n: number | null) => (n == null ? null : Math.round(n * 10000) / 10000);

/** Labels and formulas shown next to every metric (the single source of the definitions). */
export const METRIC_DEFINITIONS: Array<{ key: string; label: string; definition: string }> = [
  { key: 'n', label: 'Ideas counted', definition: 'Ideas that entered their zone and finished (all targets hit, stopped, expired or closed early). Open, not-triggered and cancelled ideas are not counted; see coverage.' },
  { key: 'hitRate', label: 'Hit rate', definition: 'Share of counted ideas that ended with a positive R (a win), including partial wins where some targets were hit before the stop.' },
  { key: 'avgR', label: 'Average R', definition: 'Mean R-multiple per counted idea. R = profit divided by the risk to the stop, measured from the worst fill in the entry zone.' },
  { key: 'expectancyR', label: 'Expectancy (R)', definition: 'Hit rate x average winning R + loss rate x average losing R: the average R you could expect from the next idea if the past repeats (it may not).' },
  { key: 'profitFactor', label: 'Profit factor', definition: 'Total winning R divided by total losing R.' },
  { key: 'totalR', label: 'Total R', definition: 'Sum of R across counted ideas; the end of the equity curve.' },
  { key: 't1Rate', label: 'First target reached', definition: 'Share of counted ideas that reached target 1 at any point before ending.' },
  { key: 'avgDaysToT1', label: 'Sessions to target 1', definition: 'Average number of trading sessions between entry and the first target, over ideas that reached it.' },
  { key: 'avgMaePct', label: 'Avg adverse move', definition: 'Average maximum move against the entry price, as a % of the entry price (max adverse excursion).' },
  { key: 'streaks', label: 'Streaks', definition: 'Longest run of consecutive winning / losing ideas, ordered by exit date.' },
];

export function computeStats(rows: StatRow[]): Stats {
  const counted = rows.filter(r => COUNTED_OUTCOMES.includes(r.outcome) && r.r != null);
  const excluded: Record<string, number> = {};
  for (const r of rows) {
    if (COUNTED_OUTCOMES.includes(r.outcome) && r.r != null) continue;
    excluded[r.outcome] = (excluded[r.outcome] ?? 0) + 1;
  }
  const ordered = [...counted].sort((a, b) => ((a.exitOn ?? '') === (b.exitOn ?? '') ? a.id - b.id : (a.exitOn ?? '') < (b.exitOn ?? '') ? -1 : 1));

  const rs = ordered.map(r => r.r as number);
  const wins = rs.filter(r => r > 0);
  const losses = rs.filter(r => r < 0);
  const n = rs.length;
  const hitRate = n ? wins.length / n : null;
  const avgWin = mean(wins);
  const avgLoss = mean(losses);
  const lossRate = n ? losses.length / n : null;
  const expectancy = n ? (hitRate as number) * (avgWin ?? 0) + (lossRate as number) * (avgLoss ?? 0) : null;
  const lossSum = Math.abs(losses.reduce((a, b) => a + b, 0));

  let cum = 0;
  const curve: CurvePoint[] = ordered.map(r => { cum += r.r as number; return { date: r.exitOn ?? '', cumR: r4(cum) as number, id: r.id }; });

  let ws = 0, ls = 0, maxW = 0, maxL = 0;
  for (const r of rs) {
    if (r > 0) { ws++; ls = 0; } else if (r < 0) { ls++; ws = 0; } else { ws = 0; ls = 0; }
    maxW = Math.max(maxW, ws);
    maxL = Math.max(maxL, ls);
  }

  const dates = ordered.map(r => r.exitOn).filter((d): d is string => !!d);
  const withR = ordered.map(r => ({ id: r.id, symbol: r.symbol, r: r.r as number }));
  const bestRow = withR.length ? withR.reduce((a, b) => (b.r > a.r ? b : a)) : null;
  const worstRow = withR.length ? withR.reduce((a, b) => (b.r < a.r ? b : a)) : null;

  return {
    n,
    wins: wins.length,
    losses: losses.length,
    flat: n - wins.length - losses.length,
    hitRate: r4(hitRate),
    avgR: r4(mean(rs)),
    avgWinR: r4(avgWin),
    avgLossR: r4(avgLoss),
    expectancyR: r4(expectancy),
    profitFactor: lossSum > 0 ? r4(wins.reduce((a, b) => a + b, 0) / lossSum) : null,
    totalR: r4(rs.reduce((a, b) => a + b, 0)) ?? 0,
    avgPct: r4(mean(ordered.filter(r => r.pctReturn != null).map(r => r.pctReturn as number))),
    t1Rate: n ? r4(ordered.filter(r => r.targetsHit >= 1).length / n) : null,
    avgDaysToT1: r4(mean(ordered.filter(r => r.daysToT1 != null).map(r => r.daysToT1 as number))),
    avgMaePct: r4(mean(ordered.filter(r => r.maePct != null).map(r => r.maePct as number))),
    maxWinStreak: maxW,
    maxLossStreak: maxL,
    best: bestRow,
    worst: worstRow,
    curve,
    coverage: { total: rows.length, counted: n, excluded, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
  };
}

export type BreakdownKey = 'horizon' | 'direction' | 'symbol' | 'publisherId' | 'hasOption';

/** Stats per group (horizon, direction, symbol, publisher, with/without an option strategy). Groups sort by ideas counted. */
export function breakdownBy(rows: StatRow[], key: BreakdownKey): Array<{ key: string; stats: Stats }> {
  const groups = new Map<string, StatRow[]>();
  for (const r of rows) {
    const k = String(r[key]);
    const g = groups.get(k);
    if (g) g.push(r); else groups.set(k, [r]);
  }
  return [...groups.entries()]
    .map(([k, g]) => ({ key: k, stats: computeStats(g) }))
    .sort((a, b) => b.stats.n - a.stats.n || a.key.localeCompare(b.key));
}
