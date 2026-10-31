/**
 * The scan functions: one per ScanKey, each a pure function of one symbol's series and the params.
 * Dependency-free (tested by scripts/test-us-scanner.mjs). Market-wide pieces (SPY's return for
 * relative strength, earnings dates, pre-market quotes) arrive in the context.
 */
import { LOW_DEBT_TO_EQUITY_PCT, PERIOD_SESSIONS, PV_COMBO_LABELS, type ScanKey, type ScanParams } from './config.ts';
import { atrPct, crossWithin, findJump, insideDay, mean, pct, rangeBreakout, roc, sma, streak, volumeRatio, type DayBar } from './indicators.ts';

export interface Ext52 { sessions: number; high: number; highDate: string; low: number; lowDate: string }

export interface SymbolSeries {
  /** Last ~60 bars, oldest first; the live bar (if any) is the last one. */
  bars: DayBar[];
  /** Last ~260 closes (+ live). */
  closes: number[];
  /** Last ~120 highs / lows (+ live). */
  highs: number[];
  lows: number[];
  /** 52-week extremes over the stored (settled) sessions. */
  ext: Ext52 | null;
  hasLive: boolean;
}

/** Stored company fundamentals (same shape as lib/usUniverse.ts Fundamentals, minus the date). */
export interface FundamentalsLite {
  peTrailing: number | null;
  peForward: number | null;
  epsTtm: number | null;
  totalDebt: number | null;
  totalCash: number | null;
  /** Percent. */
  debtToEquity: number | null;
  /** Fraction. */
  profitMargin: number | null;
}

export interface ScanContext {
  symbol: string;
  s: SymbolSeries;
  p: ScanParams;
  /** Pre-market trade price (only during pre-market, only when the feed has one). */
  premarket?: { price: number; prevClose: number } | null;
  /** SPY's return over the RS period (%). */
  spyRoc?: number | null;
  earnings?: {
    /** Next scheduled report and days until it (US/Eastern dates). */
    next?: { date: string; daysUntil: number; estimated: boolean; time: string | null } | null;
    /** A report that makes today the first session after it (reported yesterday after the close, or today before the open). */
    reactionToday?: boolean;
  } | null;
  fundamentals?: FundamentalsLite | null;
}

export interface Match {
  metric: number;
  detail: string;
  /** Signed % move the detail text quotes when it is not the metric itself (streak, price window, ...); shown in its own column. */
  windowChg?: number;
  /** Bars the match looked at (for the corporate-action jump flag); none for single-day scans. */
  lookback?: number;
  /** 52-week scans flag a jump anywhere in the year. */
  use52?: boolean;
}

const fmt = (x: number, d = 2) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (x: number, d = 2) => `${x > 0 ? '+' : ''}${fmt(x, d)}%`;
const money = (x: number) => `$${fmt(x)}`;
const last = <T,>(xs: T[]) => xs[xs.length - 1];
const billions = (x: number) => `$${fmt(Math.abs(x) / 1e9, Math.abs(x) >= 100e9 ? 0 : 1)}B`;

/**
 * The fundamentals filters (P/E, profitable, debt, margin) for one stock. Missing data never passes an
 * active filter: no fundamentals at all fails, and so does e.g. an unknown debt under a debt filter.
 */
export function passesFundamentals(f: FundamentalsLite | null | undefined, p: Pick<ScanParams, 'maxPe' | 'profitable' | 'debt' | 'minMarginPct'>): boolean {
  if (!f) return false;
  if (p.profitable && !(f.epsTtm != null && f.epsTtm > 0)) return false;
  if (p.maxPe !== null && !(f.peTrailing != null && f.peTrailing > 0 && f.peTrailing <= p.maxPe)) return false;
  if (p.minMarginPct !== null && !(f.profitMargin != null && f.profitMargin * 100 >= p.minMarginPct)) return false;
  if (p.debt !== 'any') {
    const debt = f.totalDebt, cash = f.totalCash;
    const netCash = debt != null && cash != null && cash >= debt;
    if (p.debt === 'none' && debt !== 0) return false;
    if (p.debt === 'netcash' && !netCash) return false;
    if (p.debt === 'low' && !(netCash || (f.debtToEquity != null && f.debtToEquity >= 0 && f.debtToEquity < LOW_DEBT_TO_EQUITY_PCT))) return false;
  }
  return true;
}

/** One-line summary: "P/E 14.6 (fwd 18.5) · net cash $123B · D/E 0.21 · margin 50.0%". */
export function fundamentalsDetail(f: FundamentalsLite): string {
  const parts: string[] = [];
  if (f.peTrailing != null && f.peTrailing > 0) parts.push(`P/E ${fmt(f.peTrailing, 1)}${f.peForward != null && f.peForward > 0 ? ` (fwd ${fmt(f.peForward, 1)})` : ''}`);
  else if (f.epsTtm != null && f.epsTtm <= 0) parts.push('loss-making');
  if (f.totalDebt != null && f.totalCash != null) {
    const net = f.totalDebt - f.totalCash;
    parts.push(f.totalDebt === 0 ? 'no debt' : net <= 0 ? `net cash ${billions(net)}` : `net debt ${billions(net)}`);
  } else if (f.totalDebt != null) parts.push(`debt ${billions(f.totalDebt)}`);
  if (f.debtToEquity != null) parts.push(`D/E ${fmt(f.debtToEquity / 100)}`);
  if (f.profitMargin != null) parts.push(`margin ${fmt(f.profitMargin * 100, 1)}%`);
  return parts.join(' · ');
}

function streakScan(c: ScanContext, dir: 1 | -1): Match | null {
  const { len, from } = streak(c.s.bars, dir);
  if (len < c.p.n) return null;
  const cum = pct(last(c.s.bars).c, c.s.bars[from].c);
  return { metric: len, detail: `${len} closes ${dir === 1 ? 'higher' : 'lower'} in a row, ${signed(cum)}`, windowChg: cum, lookback: len + 1 };
}

function extremeScan(c: ScanContext, side: 'high' | 'low'): Match | null {
  const e = c.s.ext;
  if (!e || e.sessions < 200) return null; // IPOs / short history: no 52-week claim
  const b = c.s.bars;
  const lb = last(b);
  const live = c.s.hasLive ? lb : null;
  let level = side === 'high' ? e.high : e.low;
  let date = side === 'high' ? e.highDate : e.lowDate;
  if (live && (side === 'high' ? live.h > level : live.l < level)) {
    level = side === 'high' ? live.h : live.l;
    date = live.date;
  }
  const idx = b.findIndex(x => x.date === date);
  if (idx < 0) return null; // set further back than the bars we hold (> ~60 sessions): never within N <= 10
  const ago = b.length - 1 - idx;
  if (ago >= c.p.n) return null;
  const dist = pct(lb.c, level);
  return {
    metric: Math.abs(dist),
    detail: `52-wk ${side} ${money(level)} set ${ago === 0 ? 'in the latest session' : `${ago} session${ago === 1 ? '' : 's'} ago`}; price ${signed(dist)} from it`,
    use52: true,
  };
}

function gapScan(c: ScanContext, dir: 1 | -1): Match | null {
  const b = c.s.bars;
  if (b.length < 2) return null;
  const today = last(b), prev = b[b.length - 2];
  const gap = pct(today.o, prev.c);
  if (dir === 1 ? gap < c.p.minGapPct : gap > -c.p.minGapPct) return null;
  const filled = dir === 1 ? today.l <= prev.c : today.h >= prev.c;
  return {
    metric: Math.abs(gap),
    detail: `Gap ${signed(gap)} (open ${money(today.o)} vs ${money(prev.c)}), ${filled ? 'gap filled' : 'gap open'}`,
    lookback: 2,
  };
}

function rocSessions(p: ScanParams): number { return PERIOD_SESSIONS[p.period]; }

export const SCANNERS: Record<ScanKey, (c: ScanContext) => Match | null> = {
  streak_up: c => streakScan(c, 1),
  streak_down: c => streakScan(c, -1),
  high52: c => extremeScan(c, 'high'),
  low52: c => extremeScan(c, 'low'),

  volume: c => {
    const r = volumeRatio(c.s.bars, c.p.n);
    if (r === null || r < c.p.volX) return null;
    return { metric: r, detail: `${c.p.n === 1 ? 'Volume' : `${c.p.n}-session avg volume`} ${fmt(r, 1)}× the prior 20 sessions`, lookback: c.p.n + 20 };
  },
  price_volume: c => {
    const b = c.s.bars;
    if (b.length < c.p.n + 1) return null;
    const r = volumeRatio(b, c.p.n);
    if (r === null) return null;
    const chg = pct(last(b).c, b[b.length - 1 - c.p.n].c);
    const up = c.p.combo.startsWith('up');
    const surge = c.p.combo.endsWith('surge');
    if (up ? chg <= 0 : chg >= 0) return null;
    if (surge ? r < c.p.volX : r > 0.7) return null;
    return { metric: r, detail: `${PV_COMBO_LABELS[c.p.combo]}: price ${signed(chg)} over ${c.p.n} session${c.p.n === 1 ? '' : 's'}, volume ${fmt(r, 1)}×`, windowChg: chg, lookback: c.p.n + 20 };
  },

  gap_up: c => gapScan(c, 1),
  gap_down: c => gapScan(c, -1),
  premarket_gap: c => {
    const pm = c.premarket;
    if (!pm || !(pm.prevClose > 0)) return null;
    const gap = pct(pm.price, pm.prevClose);
    if (c.p.dir === 'up' ? gap < c.p.minGapPct : gap > -c.p.minGapPct) return null;
    return { metric: Math.abs(gap), detail: `Pre-market ${money(pm.price)}, ${signed(gap)} vs the ${money(pm.prevClose)} close` };
  },

  open_high: c => {
    const t = last(c.s.bars);
    if (!(t.o > 0) || ((t.h - t.o) / t.o) * 100 > c.p.tolPct) return null;
    return { metric: pct(t.c, t.o), detail: `Open ${money(t.o)} = high of the day, now ${signed(pct(t.c, t.o))} — selling pressure` };
  },
  open_low: c => {
    const t = last(c.s.bars);
    if (!(t.o > 0) || ((t.o - t.l) / t.o) * 100 > c.p.tolPct) return null;
    return { metric: pct(t.c, t.o), detail: `Open ${money(t.o)} = low of the day, now ${signed(pct(t.c, t.o))} — buying pressure` };
  },

  roc: c => {
    const n = rocSessions(c.p);
    const r = roc(c.s.closes, n);
    if (r === null) return null;
    if (c.p.dir === 'up' ? r <= 0 : r >= 0) return null;
    return { metric: r, detail: `${signed(r)} over ${c.p.period} (${n} sessions)`, lookback: n + 1 };
  },
  sma_position: c => {
    const m = sma(c.s.closes, c.p.sma);
    if (m === null || !(m > 0)) return null;
    const d = pct(last(c.s.closes), m);
    if (c.p.dir === 'up' ? d <= 0 : d >= 0) return null;
    return { metric: d, detail: `${signed(d)} ${d > 0 ? 'above' : 'below'} the ${c.p.sma}-session average (${money(m)})`, lookback: c.p.sma };
  },
  ma_cross: c => {
    const x = crossWithin(c.s.closes, 50, 200, c.p.n);
    if (!x || x.type !== (c.p.dir === 'up' ? 'golden' : 'death')) return null;
    return {
      metric: x.ago,
      detail: `${x.type === 'golden' ? 'Golden cross: 50-day SMA crossed above' : 'Death cross: 50-day SMA crossed below'} the 200-day ${x.ago === 0 ? 'in the latest session' : `${x.ago} session${x.ago === 1 ? '' : 's'} ago`}`,
      lookback: 200 + c.p.n,
    };
  },

  atr_pct: c => {
    const a = atrPct(c.s.bars, 14);
    if (a === null || a < c.p.atrMin || (c.p.atrMax !== null && a > c.p.atrMax)) return null;
    return { metric: a, detail: `14-session ATR ${fmt(a)}% of price`, lookback: 15 };
  },
  inside_day: c => {
    const r = insideDay(c.s.bars);
    if (!r) return null;
    return { metric: r.ratio, detail: `Inside day: range ${fmt(r.ratio * 100, 0)}% of the prior session’s`, lookback: 2 };
  },
  range_breakout: c => {
    const r = rangeBreakout(c.s.highs, c.s.lows, last(c.s.closes), c.p.n, c.p.dir);
    if (!r) return null;
    return {
      metric: Math.abs(r.beyondPct),
      detail: `Closed ${signed(r.beyondPct)} ${c.p.dir === 'up' ? 'above the' : 'below the'} ${c.p.n}-session ${c.p.dir === 'up' ? 'high' : 'low'} (${money(r.level)})`,
      lookback: c.p.n + 1,
    };
  },

  // The percentile is added by the runner, which sees every symbol's excess return.
  rs_spy: c => {
    const n = rocSessions(c.p);
    const r = roc(c.s.closes, n);
    if (r === null || c.spyRoc == null) return null;
    const excess = r - c.spyRoc;
    if (c.p.dir === 'up' ? excess <= 0 : excess >= 0) return null;
    return { metric: excess, detail: `${signed(r)} over ${c.p.period} vs SPY ${signed(c.spyRoc)} (${signed(excess)})`, windowChg: r, lookback: n + 1 };
  },

  earnings_upcoming: c => {
    const nx = c.earnings?.next;
    if (!nx || nx.daysUntil < 0 || nx.daysUntil > c.p.n) return null;
    const when = nx.daysUntil === 0 ? 'today' : nx.daysUntil === 1 ? 'tomorrow' : `in ${nx.daysUntil} days`;
    return { metric: nx.daysUntil, detail: `Reports ${when} (${nx.estimated ? '~' : ''}${nx.date}${nx.time ? `, ${nx.time}` : ''})` };
  },
  earnings_reacted: c => {
    if (!c.earnings?.reactionToday) return null;
    const b = c.s.bars;
    if (b.length < 2 || !c.s.hasLive) return null;
    const today = last(b), prev = b[b.length - 2];
    const gap = pct(today.o, prev.c);
    if (Math.abs(gap) < c.p.minGapPct) return null;
    return { metric: Math.abs(gap), detail: `Earnings reaction: gap ${signed(gap)}, now ${signed(pct(today.c, prev.c))} on the day`, windowChg: pct(today.c, prev.c), lookback: 2 };
  },

  // Ranked by trailing P/E; the filters (applied by the runner) decide which stocks qualify.
  fundamentals: c => {
    const f = c.fundamentals;
    if (!f || f.peTrailing == null || !(f.peTrailing > 0)) return null;
    return { metric: f.peTrailing, detail: fundamentalsDetail(f) };
  },
};

/** The corporate-action warning for a match: a >30% one-session move in the bars the match used. */
export function jumpFlag(m: Match, s: SymbolSeries, jump52: { date: string; pct: number } | null): string | null {
  const j = m.use52 ? jump52 : m.lookback ? findJump(s.bars, Math.min(m.lookback, s.bars.length)) : null;
  if (!j) return null;
  return `Price moved ${j.pct > 0 ? '+' : ''}${j.pct}% in one session on ${j.date}: possibly a split or other corporate action the price history does not reflect. Treat this match with caution.`;
}

/** Mean of the last `n` settled bars' dollar volume (the live bar excluded), in $M. */
export function avgDollarVolM(s: SymbolSeries, n = 20): number {
  const settled = s.hasLive ? s.bars.slice(0, -1) : s.bars;
  const w = settled.slice(-n);
  return w.length ? mean(w.map(b => b.c * b.v)) / 1e6 : 0;
}
export function avgVolume(s: SymbolSeries, n = 20): number {
  const settled = s.hasLive ? s.bars.slice(0, -1) : s.bars;
  const w = settled.slice(-n);
  return w.length ? mean(w.map(b => b.v)) : 0;
}
