/**
 * US Market Scanner: scan catalogue, parameters, presets and server-side parameter validation.
 * Client-safe and dependency-free (the page imports it; scripts/test-us-scanner.mjs tests it).
 * Design: docs/us-scanner.md.
 */

export const SCAN_KEYS = [
  'streak_up', 'streak_down',
  'high52', 'low52',
  'volume', 'price_volume',
  'gap_up', 'gap_down', 'premarket_gap',
  'open_high', 'open_low',
  'roc', 'sma_position', 'ma_cross',
  'atr_pct', 'inside_day', 'range_breakout',
  'rs_spy',
  'earnings_upcoming', 'earnings_reacted',
] as const;
export type ScanKey = (typeof SCAN_KEYS)[number];

export const SCAN_GROUPS = ['Streaks', '52-week', 'Volume', 'Gaps', 'Open patterns', 'Momentum', 'Volatility', 'Relative strength', 'Earnings'] as const;
export type ScanGroup = (typeof SCAN_GROUPS)[number];

export const PV_COMBOS = ['up_surge', 'down_surge', 'up_dry', 'down_dry'] as const;
export type PvCombo = (typeof PV_COMBOS)[number];
export const PV_COMBO_LABELS: Record<PvCombo, string> = {
  up_surge: 'Price up + volume surge',
  down_surge: 'Price down + volume surge',
  up_dry: 'Price up + thin volume',
  down_dry: 'Price down + thin volume',
};

export const UNIVERSES = ['ALL', 'SP500', 'NDX100', 'DOW30', 'TOP1000'] as const;
export type UniverseKey = (typeof UNIVERSES)[number];
export const UNIVERSE_LABELS: Record<UniverseKey, string> = {
  ALL: 'Liquid US (all)',
  SP500: 'S&P 500',
  NDX100: 'Nasdaq-100',
  DOW30: 'Dow 30',
  TOP1000: 'Top 1000 by cap (≈ Russell 1000)',
};

export const EXCHANGES = ['NYSE', 'NASDAQ', 'NYSE American', 'NYSE Arca', 'Cboe BZX'] as const;
export type Exchange = (typeof EXCHANGES)[number];

export const TYPES = ['stock', 'all', 'etf'] as const;
export type InstrumentType = (typeof TYPES)[number];
export const TYPE_LABELS: Record<InstrumentType, string> = { stock: 'Common stock only', all: 'Stocks + ETFs', etf: 'ETFs only' };

export const CAP_TIERS = ['any', 'micro', 'small', 'mid', 'large', 'mega'] as const;
export type CapTier = (typeof CAP_TIERS)[number];
/** Market-cap bands in $B, [min, max). */
export const CAP_TIER_RANGES: Record<Exclude<CapTier, 'any'>, [number, number]> = {
  micro: [0.05, 0.3], small: [0.3, 2], mid: [2, 10], large: [10, 200], mega: [200, Infinity],
};
export const CAP_TIER_LABELS: Record<CapTier, string> = {
  any: 'Any', micro: 'Micro ($50M–$300M)', small: 'Small ($300M–$2B)', mid: 'Mid ($2B–$10B)', large: 'Large ($10B–$200B)', mega: 'Mega ($200B+)',
};

export const PERIODS = ['1M', '3M', '6M'] as const;
export type Period = (typeof PERIODS)[number];
/** Trading sessions per period. */
export const PERIOD_SESSIONS: Record<Period, number> = { '1M': 21, '3M': 63, '6M': 126 };

export const SMA_LENGTHS = [20, 50, 200] as const;
export type SmaLength = (typeof SMA_LENGTHS)[number];

export const LIMITS = [50, 100, 200] as const;

export interface ScanParams {
  scan: ScanKey;
  /** Sessions / days, meaning depends on the scan (see SCANS[].nLabel). */
  n: number;
  combo: PvCombo;
  /** Direction for scans with two sides (see SCANS[].dirLabels). */
  dir: 'up' | 'down';
  period: Period;
  sma: SmaLength;
  volX: number;
  minGapPct: number;
  tolPct: number;
  atrMin: number;
  atrMax: number | null;
  // Common filters
  universe: UniverseKey;
  /** Empty = every exchange. */
  exchanges: Exchange[];
  type: InstrumentType;
  excludeAdr: boolean;
  sector: string | null;
  industry: string | null;
  minPrice: number;
  maxPrice: number | null;
  minDollarVolM: number;
  minAvgVol: number;
  minMktCapB: number;
  capTier: CapTier;
  minChgPct: number | null;
  maxChgPct: number | null;
  /** Price within this % below the 52-week high (null = off). */
  nearHighPct: number | null;
  limit: number;
}

export interface ScanInfo {
  key: ScanKey;
  group: ScanGroup;
  label: string;
  /** Label of the N select, or null when the scan has no N. */
  nLabel: string | null;
  /** [up label, down label] when the scan uses `dir`. */
  dirLabels: [string, string] | null;
  usesPeriod?: boolean;
  usesSma?: boolean;
  usesVolX?: boolean;
  usesCombo?: boolean;
  usesGap?: boolean;
  usesTol?: boolean;
  usesAtr?: boolean;
  metricLabel: string;
  /** Label of the extra signed-% column for scans whose detail quotes a move that is not the metric. */
  changeLabel?: string;
  help: string;
}

export const ALLOWED_N: Record<ScanKey, number[]> = {
  streak_up: [3, 5, 7, 10, 15, 30],
  streak_down: [3, 5, 7, 10, 15, 30],
  high52: [1, 3, 5, 10],
  low52: [1, 3, 5, 10],
  volume: [1, 3, 5, 7, 10, 15, 30],
  price_volume: [1, 3, 5, 7, 10, 15, 30],
  gap_up: [1], gap_down: [1], premarket_gap: [1],
  open_high: [1], open_low: [1],
  roc: [1], sma_position: [1],
  ma_cross: [1, 3, 5, 10, 20],
  atr_pct: [1], inside_day: [1],
  range_breakout: [10, 20, 55, 100],
  rs_spy: [1],
  earnings_upcoming: [1, 3, 5, 7, 14],
  earnings_reacted: [1],
};

export const SCANS: ScanInfo[] = [
  { key: 'streak_up', group: 'Streaks', label: 'Consecutive gainers', nLabel: 'Closes higher in a row ≥', dirLabels: null, metricLabel: 'Streak', changeLabel: 'Streak chg %',
    help: 'Stocks that closed higher than the day before at least N sessions in a row. Today counts while the market is open.' },
  { key: 'streak_down', group: 'Streaks', label: 'Consecutive losers', nLabel: 'Closes lower in a row ≥', dirLabels: null, metricLabel: 'Streak', changeLabel: 'Streak chg %',
    help: 'Stocks that closed lower than the day before at least N sessions in a row. Today counts while the market is open.' },
  { key: 'high52', group: '52-week', label: '52-week high', nLabel: 'Hit within last (sessions)', dirLabels: null, metricLabel: 'Off high %',
    help: 'Set a new 52-week high (highest high of the last 252 sessions) within the last N sessions. Needs at least 200 sessions of history.' },
  { key: 'low52', group: '52-week', label: '52-week low', nLabel: 'Hit within last (sessions)', dirLabels: null, metricLabel: 'Off low %',
    help: 'Set a new 52-week low within the last N sessions. Needs at least 200 sessions of history.' },
  { key: 'volume', group: 'Volume', label: 'Volume gainers', nLabel: 'Average volume over (sessions)', dirLabels: null, usesVolX: true, metricLabel: 'Volume ×',
    help: 'Average volume of the last N sessions vs the 20 sessions before them. Today’s volume is partial while the market is open.' },
  { key: 'price_volume', group: 'Volume', label: 'Price × volume', nLabel: 'Window (sessions)', dirLabels: null, usesVolX: true, usesCombo: true, metricLabel: 'Volume ×', changeLabel: 'Price chg %',
    help: 'Price direction over the last N sessions combined with a volume surge (≥ the multiple) or thin volume (≤ 0.7×) vs the 20 sessions before.' },
  { key: 'gap_up', group: 'Gaps', label: 'Top gappers (up)', nLabel: null, dirLabels: null, usesGap: true, metricLabel: 'Gap %',
    help: 'Opened at least the minimum % above the previous close. “Gap filled” means the price has since traded back to the previous close.' },
  { key: 'gap_down', group: 'Gaps', label: 'Top gappers (down)', nLabel: null, dirLabels: null, usesGap: true, metricLabel: 'Gap %',
    help: 'Opened at least the minimum % below the previous close. “Gap filled” means the price has since traded back to the previous close.' },
  { key: 'premarket_gap', group: 'Gaps', label: 'Pre-market gappers', nLabel: null, dirLabels: ['Up', 'Down'], usesGap: true, metricLabel: 'Pre-mkt %',
    help: 'Pre-market price vs the previous close. Only during pre-market (04:00–09:30 ET), and only for names with a pre-market trade on our feed.' },
  { key: 'open_high', group: 'Open patterns', label: 'Open = High', nLabel: null, dirLabels: null, usesTol: true, metricLabel: 'Since open %',
    help: 'Today’s open is (within the tolerance) the high of the day: sellers in control since the open.' },
  { key: 'open_low', group: 'Open patterns', label: 'Open = Low', nLabel: null, dirLabels: null, usesTol: true, metricLabel: 'Since open %',
    help: 'Today’s open is (within the tolerance) the low of the day: buyers in control since the open.' },
  { key: 'roc', group: 'Momentum', label: 'Rate of change', nLabel: null, dirLabels: ['Top gainers', 'Top losers'], usesPeriod: true, metricLabel: 'Change %',
    help: 'Price change over 1, 3 or 6 months (21, 63 or 126 sessions).' },
  { key: 'sma_position', group: 'Momentum', label: 'Price vs moving average', nLabel: null, dirLabels: ['Above', 'Below'], usesSma: true, metricLabel: 'From SMA %',
    help: 'Price above or below its 20, 50 or 200-session simple moving average, ranked by the distance.' },
  { key: 'ma_cross', group: 'Momentum', label: 'Golden / death cross', nLabel: 'Crossed within (sessions)', dirLabels: ['Golden cross', 'Death cross'], metricLabel: 'Sessions ago',
    help: 'The 50-session moving average crossed above (golden) or below (death) the 200-session average within the last N sessions.' },
  { key: 'atr_pct', group: 'Volatility', label: 'ATR %', nLabel: null, dirLabels: null, usesAtr: true, metricLabel: 'ATR %',
    help: 'Average true range over 14 sessions as a % of price, between the minimum and maximum you set.' },
  { key: 'inside_day', group: 'Volatility', label: 'Inside day', nLabel: null, dirLabels: null, metricLabel: 'Range vs prior',
    help: 'Today’s (or the last session’s) high and low are inside the previous session’s range: a contraction that often precedes a breakout.' },
  { key: 'range_breakout', group: 'Volatility', label: 'Range breakout', nLabel: 'Range of the last (sessions)', dirLabels: ['Above the high', 'Below the low'], metricLabel: 'Beyond %',
    help: 'Price closed above the highest high (or below the lowest low) of the previous N sessions.' },
  { key: 'rs_spy', group: 'Relative strength', label: 'Relative strength vs SPY', nLabel: null, dirLabels: ['Outperforming', 'Underperforming'], usesPeriod: true, metricLabel: 'vs SPY %', changeLabel: 'Stock chg %',
    help: 'Return over 1, 3 or 6 months minus SPY’s, with the percentile rank across all scanned names.' },
  { key: 'earnings_upcoming', group: 'Earnings', label: 'Earnings coming up', nLabel: 'Reporting within (days)', dirLabels: null, metricLabel: 'Days to report',
    help: 'Scheduled to report earnings within the next N days (dates marked ~ are estimates).' },
  { key: 'earnings_reacted', group: 'Earnings', label: 'Earnings reaction', nLabel: null, dirLabels: null, usesGap: true, metricLabel: 'Gap %', changeLabel: 'Day chg %',
    help: 'Reported yesterday after the close or today before the open, and gapped at least the minimum % either way.' },
];

export const SCAN_INFO: Record<ScanKey, ScanInfo> = Object.fromEntries(SCANS.map(s => [s.key, s])) as Record<ScanKey, ScanInfo>;

/** Scans where a smaller metric ranks first ("smaller is stronger"). Direction-dependent scans are resolved by `rankAscending`. */
export function rankAscending(p: Pick<ScanParams, 'scan' | 'dir'>): boolean {
  switch (p.scan) {
    case 'high52': case 'low52': case 'open_high': case 'ma_cross': case 'inside_day': case 'earnings_upcoming':
      return true;
    case 'roc': case 'sma_position': case 'rs_spy':
      return p.dir === 'down';
    default:
      return false;
  }
}

export const DEFAULT_PARAMS: ScanParams = {
  scan: 'streak_up', n: 3, combo: 'up_surge', dir: 'up', period: '1M', sma: 50,
  volX: 1.5, minGapPct: 2, tolPct: 0.1, atrMin: 3, atrMax: null,
  universe: 'ALL', exchanges: [], type: 'stock', excludeAdr: false, sector: null, industry: null,
  minPrice: 5, maxPrice: null, minDollarVolM: 10, minAvgVol: 0, minMktCapB: 0, capTier: 'any',
  minChgPct: null, maxChgPct: null, nearHighPct: null, limit: 100,
};

export interface Preset { key: string; label: string; params: Partial<ScanParams> }

export const PRESETS: Preset[] = [
  { key: 'momentum', label: 'Momentum leaders', params: { scan: 'rs_spy', dir: 'up', period: '3M', nearHighPct: 10, minDollarVolM: 25 } },
  { key: 'oversold', label: 'Oversold bounce', params: { scan: 'streak_down', n: 5, nearHighPct: null, minDollarVolM: 25, capTier: 'large' } },
  { key: 'breakout', label: 'Breakout on volume', params: { scan: 'range_breakout', n: 55, dir: 'up', minDollarVolM: 20 } },
  { key: 'gapgo', label: 'Gap & go', params: { scan: 'gap_up', minGapPct: 3, minDollarVolM: 20 } },
  { key: 'accumulation', label: 'Quiet accumulation', params: { scan: 'price_volume', combo: 'up_dry', n: 10, minDollarVolM: 25 } },
];

// ---------------------------------------------------------------------------
// Validation: every value from the query string is checked and clamped here.
// ---------------------------------------------------------------------------

type Raw = Record<string, string | string[] | undefined>;

const str = (v: Raw[string]): string | undefined => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

function num(v: Raw[string], min: number, max: number, dflt: number): number {
  const s = str(v);
  if (s === undefined) return dflt;
  const x = Number(s);
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : dflt;
}
function numOrNull(v: Raw[string], min: number, max: number, dflt: number | null): number | null {
  const s = str(v);
  if (s === undefined) return dflt;
  if (s === '' || s === 'null' || s === 'any') return null;
  const x = Number(s);
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : dflt;
}
function oneOf<T extends string | number>(v: Raw[string], allowed: readonly T[], dflt: T): T {
  const s = str(v);
  if (s === undefined) return dflt;
  const hit = allowed.find(a => String(a).toUpperCase() === s.toUpperCase());
  return hit ?? dflt;
}
const text = (v: Raw[string], max = 80): string | null => {
  const s = str(v);
  return s && s.length <= max && /^[\w &,.\-/()']+$/.test(s) ? s : null;
};

export function normalizeParams(raw: Raw): ScanParams {
  const d = DEFAULT_PARAMS;
  const scan = oneOf(raw.scan, SCAN_KEYS, d.scan);
  const allowed = ALLOWED_N[scan];
  const nRaw = Math.trunc(num(raw.n, 0, 1000, allowed[0]));
  const n = allowed.includes(nRaw) ? nRaw : allowed[0];
  const exRaw = (Array.isArray(raw.exchange) ? raw.exchange.join(',') : str(raw.exchange) ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const exchanges = EXCHANGES.filter(e => exRaw.some(x => x.toUpperCase() === e.toUpperCase()));
  const atrMin = num(raw.atrMin, 0, 50, d.atrMin);
  const atrMaxRaw = numOrNull(raw.atrMax, 0, 100, d.atrMax);
  const minPrice = num(raw.minPrice, 0, 100_000, d.minPrice);
  const maxPriceRaw = numOrNull(raw.maxPrice, 0, 1_000_000, d.maxPrice);
  const minChg = numOrNull(raw.minChg, -100, 1000, d.minChgPct);
  const maxChg = numOrNull(raw.maxChg, -100, 1000, d.maxChgPct);
  const sector = text(raw.sector);
  return {
    scan, n,
    combo: oneOf(raw.combo, PV_COMBOS, d.combo),
    dir: oneOf(raw.dir, ['up', 'down'] as const, d.dir),
    period: oneOf(raw.period, PERIODS, d.period),
    sma: oneOf(raw.sma, SMA_LENGTHS, d.sma),
    volX: num(raw.volX, 1, 50, d.volX),
    minGapPct: num(raw.minGap, 0, 50, d.minGapPct),
    tolPct: num(raw.tol, 0, 5, d.tolPct),
    atrMin,
    atrMax: atrMaxRaw !== null && atrMaxRaw < atrMin ? atrMin : atrMaxRaw,
    universe: oneOf(raw.universe, UNIVERSES, d.universe),
    exchanges,
    type: oneOf(raw.type, TYPES, d.type),
    excludeAdr: str(raw.noAdr) === '1' || str(raw.noAdr) === 'true',
    sector,
    // Industry only makes sense inside a sector.
    industry: sector ? text(raw.industry, 120) : null,
    minPrice,
    maxPrice: maxPriceRaw !== null && maxPriceRaw < minPrice ? minPrice : maxPriceRaw,
    minDollarVolM: num(raw.minDollarVolM, 0, 100_000, d.minDollarVolM),
    minAvgVol: Math.round(num(raw.minAvgVol, 0, 1e10, d.minAvgVol)),
    minMktCapB: num(raw.minMktCapB, 0, 10_000, d.minMktCapB),
    capTier: oneOf(raw.cap, CAP_TIERS, d.capTier),
    minChgPct: minChg,
    maxChgPct: maxChg !== null && minChg !== null && maxChg < minChg ? minChg : maxChg,
    nearHighPct: numOrNull(raw.nearHigh, 0, 100, d.nearHighPct),
    limit: oneOf(raw.limit, LIMITS, d.limit as (typeof LIMITS)[number]),
  };
}

/** Params → query string (only what differs from the defaults, so links stay short). Inverse of normalizeParams. */
export function toQuery(p: ScanParams): string {
  const d = DEFAULT_PARAMS;
  const q = new URLSearchParams();
  const info = SCAN_INFO[p.scan];
  q.set('scan', p.scan);
  if (info.nLabel) q.set('n', String(p.n));
  if (info.dirLabels) q.set('dir', p.dir);
  if (info.usesCombo) q.set('combo', p.combo);
  if (info.usesPeriod) q.set('period', p.period);
  if (info.usesSma) q.set('sma', String(p.sma));
  if (info.usesVolX) q.set('volX', String(p.volX));
  if (info.usesGap) q.set('minGap', String(p.minGapPct));
  if (info.usesTol) q.set('tol', String(p.tolPct));
  if (info.usesAtr) { q.set('atrMin', String(p.atrMin)); if (p.atrMax !== null) q.set('atrMax', String(p.atrMax)); }
  if (p.universe !== d.universe) q.set('universe', p.universe);
  if (p.exchanges.length) q.set('exchange', p.exchanges.join(','));
  if (p.type !== d.type) q.set('type', p.type);
  if (p.excludeAdr) q.set('noAdr', '1');
  if (p.sector) q.set('sector', p.sector);
  if (p.industry) q.set('industry', p.industry);
  if (p.minPrice !== d.minPrice) q.set('minPrice', String(p.minPrice));
  if (p.maxPrice !== null) q.set('maxPrice', String(p.maxPrice));
  if (p.minDollarVolM !== d.minDollarVolM) q.set('minDollarVolM', String(p.minDollarVolM));
  if (p.minAvgVol) q.set('minAvgVol', String(p.minAvgVol));
  if (p.minMktCapB) q.set('minMktCapB', String(p.minMktCapB));
  if (p.capTier !== 'any') q.set('cap', p.capTier);
  if (p.minChgPct !== null) q.set('minChg', String(p.minChgPct));
  if (p.maxChgPct !== null) q.set('maxChg', String(p.maxChgPct));
  if (p.nearHighPct !== null) q.set('nearHigh', String(p.nearHighPct));
  if (p.limit !== d.limit) q.set('limit', String(p.limit));
  return q.toString();
}
