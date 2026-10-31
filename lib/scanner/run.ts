/**
 * US Market Scanner runner (server-only). One scan = cached history read (one SQL query for the whole
 * universe) + one cached batched snapshot call + the shared table of today's consolidated bars, all
 * computed in memory. No per-symbol vendor calls. Design: docs/us-scanner.md.
 */
import { sql } from '@/lib/db';
import { getSnapshotsMulti, type Snapshot } from '@/lib/marketdata';
import { getMarketState, type MarketSession, type MarketState } from '@/lib/marketSession';
import { getTrackedSymbols, todayET } from '@/lib/earnings';
import { getScannerUniverse, type UniverseRow } from '@/lib/usUniverse';
import { getOrSet } from '@/lib/ttlCache';
import { CAP_TIER_RANGES, PERIOD_SESSIONS, fundamentalsFilterActive, rankAscending, type ScanParams } from './config.ts';
import { pct, percentileRank, roc, type DayBar } from './indicators.ts';
import { liveBarFrom, premarketFrom, todayNeedsRefresh } from './liveBar.ts';
import { SCANNERS, avgDollarVolM, avgVolume, jumpFlag, passesFundamentals, type Ext52, type Match, type ScanContext, type SymbolSeries } from './scans.ts';
import { readTodayBars, refreshTodayBars, type TodayBars } from './today.ts';

const HISTORY_TTL_MS = 5 * 60_000;
const QUOTES_TTL_MS = 15_000;
const META_TTL_MS = 60 * 60_000;
const SNAPSHOT_CHUNK = 1000;
const TODAY_ATTEMPT_MS = 3 * 60_000;

export interface ScanRow {
  rank: number;
  symbol: string;
  name: string | null;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  kind: 'stock' | 'etf';
  price: number;
  change: number | null;
  changePct: number | null;
  open: number;
  high: number;
  low: number;
  high52: number | null;
  low52: number | null;
  volume: number;
  avgDollarVolM: number;
  marketCapB: number | null;
  // Fundamentals (stocks only, weekly; null when unknown)
  pe: number | null;
  fwdPe: number | null;
  eps: number | null;
  debtB: number | null;
  cashB: number | null;
  /** Debt minus cash; negative = net cash. */
  netDebtB: number | null;
  /** Debt/equity as a ratio (0.78 = 78%). */
  debtToEquity: number | null;
  marginPct: number | null;
  /** When the fundamentals were fetched (ISO). */
  fundAsOf: string | null;
  session: MarketSession;
  hasLevels: boolean;
  metric: number;
  detail: string;
  /** Signed % move quoted in `detail` (see Match.windowChg); null for scans without one. */
  windowChg: number | null;
  flag: string | null;
}

export interface ScanMeta {
  asOf: string;
  /** The newest bar is the running regular session. */
  live: boolean;
  /** Today's volume is incomplete (session running, or no consolidated bar yet). */
  partialToday: boolean;
  /** Today's consolidated bar was not available yet for some rows (their today volume is single-venue). */
  volumeDelayedFeed: boolean;
  /** Volume scans left today out for those rows (scanned the settled sessions instead). */
  volumeScanSettledOnly: boolean;
  lastStoredDate: string | null;
  latestSessionDate: string;
  sessionState: MarketSession;
  nextChangeAt: string | null;
  universe: string;
  scanned: number;
  matched: number;
  returned: number;
}

// ---------------------------------------------------------------------------
// Loaders (cached per instance)
// ---------------------------------------------------------------------------

interface History { series: Map<string, { bars: DayBar[]; closes: number[]; highs: number[]; lows: number[]; ext: Ext52 | null; jump52: { date: string; pct: number } | null }>; lastStoredDate: string | null }

/** Exported for scripts/scanner-dry-run.mts. */
export async function loadHistory(symbols: string[], today: string): Promise<History> {
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - 400 * 86_400_000).toISOString().slice(0, 10);
  const rows = await sql(`
    WITH b AS (
      SELECT symbol, bar_date, o, h, l, c, v,
             row_number() OVER (PARTITION BY symbol ORDER BY bar_date DESC) AS rn,
             lag(c) OVER (PARTITION BY symbol ORDER BY bar_date) AS pc
      FROM public.nt_daily_bars
      WHERE symbol = ANY($1::text[]) AND bar_date >= $2::date AND bar_date < $3::date
    )
    SELECT symbol,
      count(*) FILTER (WHERE rn <= 252)::int AS sessions,
      array_agg(bar_date::text ORDER BY bar_date) FILTER (WHERE rn <= 60) AS d,
      array_agg(o::float8 ORDER BY bar_date) FILTER (WHERE rn <= 60) AS o,
      array_agg(v::float8 ORDER BY bar_date) FILTER (WHERE rn <= 60) AS v,
      array_agg(h::float8 ORDER BY bar_date) FILTER (WHERE rn <= 120) AS h,
      array_agg(l::float8 ORDER BY bar_date) FILTER (WHERE rn <= 120) AS l,
      array_agg(c::float8 ORDER BY bar_date) AS c,
      (max(h) FILTER (WHERE rn <= 252))::float8 AS hi52,
      (min(l) FILTER (WHERE rn <= 252))::float8 AS lo52,
      (array_agg(bar_date::text ORDER BY h DESC, bar_date DESC) FILTER (WHERE rn <= 252))[1] AS hi52_date,
      (array_agg(bar_date::text ORDER BY l ASC, bar_date DESC) FILTER (WHERE rn <= 252))[1] AS lo52_date,
      (array_agg(bar_date::text ORDER BY bar_date DESC) FILTER (WHERE rn <= 252 AND pc > 0 AND abs(c / pc - 1) > 0.3))[1] AS jump_date,
      (array_agg(round(((c / pc - 1) * 100)::numeric, 1)::float8 ORDER BY bar_date DESC) FILTER (WHERE rn <= 252 AND pc > 0 AND abs(c / pc - 1) > 0.3))[1] AS jump_pct
    FROM b WHERE rn <= 260
    GROUP BY symbol
  `, [symbols, from, today]);
  const series: History['series'] = new Map();
  let lastStoredDate: string | null = null;
  for (const r of rows as any[]) {
    const n60 = r.d.length;
    const closes: number[] = r.c;
    const highs: number[] = r.h, lows: number[] = r.l;
    const bars: DayBar[] = r.d.map((date: string, i: number) => ({
      date, o: r.o[i], h: highs[highs.length - n60 + i], l: lows[lows.length - n60 + i], c: closes[closes.length - n60 + i], v: r.v[i],
    }));
    const last = r.d[n60 - 1];
    if (!lastStoredDate || last > lastStoredDate) lastStoredDate = last;
    series.set(r.symbol, {
      bars, closes, highs, lows,
      ext: r.hi52 != null ? { sessions: r.sessions, high: r.hi52, highDate: r.hi52_date, low: r.lo52, lowDate: r.lo52_date } : null,
      jump52: r.jump_date ? { date: r.jump_date, pct: r.jump_pct } : null,
    });
  }
  return { series, lastStoredDate };
}

async function loadQuotes(symbols: string[]): Promise<Record<string, Snapshot>> {
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += SNAPSHOT_CHUNK) chunks.push(symbols.slice(i, i + SNAPSHOT_CHUNK));
  const parts = await Promise.all(chunks.map(c => getSnapshotsMulti(c)));
  const out: Record<string, Snapshot> = Object.assign({}, ...parts);
  if (symbols.length > 0 && Object.keys(out).length === 0) throw new Error('quotes unavailable');
  return out;
}

const nonEmpty = <T extends object>(x: T) => Object.keys(x).length > 0;

let lastTodayAttempt = 0;

/** Kick off a refresh of today's consolidated bars when due (at most once per instance per 3 min). */
export function todayRefreshTask(universe: string[], state: MarketState, today: TodayBars): (() => Promise<void>) | null {
  const now = Date.now();
  if (now - lastTodayAttempt < TODAY_ATTEMPT_MS || !todayNeedsRefresh(today, state, now)) return null;
  lastTodayAttempt = now;
  return async () => {
    try {
      const r = await refreshTodayBars(universe, state.lastSessionDate);
      if (r) console.log('[scanner] today bars refreshed', JSON.stringify(r));
    } catch (error) {
      console.error('[scanner] today bars refresh failed:', error instanceof Error ? error.message : error);
    }
  };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function passesMeta(u: UniverseRow, p: ScanParams): boolean {
  if (p.universe === 'SP500' && !u.inSp500) return false;
  if (p.universe === 'NDX100' && !u.inNdx100) return false;
  if (p.universe === 'DOW30' && !u.inDow30) return false;
  if (p.universe === 'TOP1000' && !u.inTop1000) return false;
  if (p.exchanges.length && !p.exchanges.includes(u.exchange as never)) return false;
  if (p.type === 'stock' && u.kind !== 'stock') return false;
  if (p.type === 'etf' && u.kind !== 'etf') return false;
  if (p.excludeAdr && u.isAdr) return false;
  // Sector / industry / market cap describe companies: they never match ETFs.
  if (p.sector && u.sector !== p.sector) return false;
  if (p.industry && u.industry !== p.industry) return false;
  if (u.kind === 'stock') {
    const capB = u.marketCap != null ? u.marketCap / 1e9 : null;
    if (p.minMktCapB > 0 && (capB === null || capB < p.minMktCapB)) return false;
    if (p.capTier !== 'any') {
      const [lo, hi] = CAP_TIER_RANGES[p.capTier];
      if (capB === null || capB < lo || capB >= hi) return false;
    }
  }
  // Fundamentals describe companies too, but unlike sector they can be missing: an active filter drops ETFs and unknowns.
  if (fundamentalsFilterActive(p) && (u.kind !== 'stock' || !passesFundamentals(u.fundamentals, p))) return false;
  return true;
}

const round = (x: number | null, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

function fundamentalsCols(u: UniverseRow): Pick<ScanRow, 'pe' | 'fwdPe' | 'eps' | 'debtB' | 'cashB' | 'netDebtB' | 'debtToEquity' | 'marginPct' | 'fundAsOf'> {
  const f = u.kind === 'stock' ? u.fundamentals : null;
  const debt = f?.totalDebt ?? null, cash = f?.totalCash ?? null;
  return {
    pe: round(f?.peTrailing != null && f.peTrailing > 0 ? f.peTrailing : null, 1),
    fwdPe: round(f?.peForward != null && f.peForward > 0 ? f.peForward : null, 1),
    eps: round(f?.epsTtm ?? null),
    debtB: round(debt == null ? null : debt / 1e9),
    cashB: round(cash == null ? null : cash / 1e9),
    netDebtB: round(debt == null || cash == null ? null : (debt - cash) / 1e9),
    debtToEquity: round(f?.debtToEquity == null ? null : f.debtToEquity / 100),
    marginPct: round(f?.profitMargin == null ? null : f.profitMargin * 100, 1),
    fundAsOf: f?.asOf ?? null,
  };
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

export interface ScanResult { rows: ScanRow[]; meta: ScanMeta; filters: { sectors: string[]; industries: Record<string, string[]> } }

export async function runScan(p: ScanParams, opts: { onTodayRefresh?: (task: () => Promise<void>) => void } = {}): Promise<ScanResult> {
  const today = todayET();
  const universe = await getOrSet('scanner:universe', META_TTL_MS, getScannerUniverse, u => u.length > 0);
  const symbols = universe.map(u => u.symbol);
  if (!symbols.includes('SPY')) symbols.push('SPY'); // relative strength baseline

  const [history, quotes, state, levelSet] = await Promise.all([
    getOrSet(`scanner:history:${today}`, HISTORY_TTL_MS, () => loadHistory(symbols, today), h => h.series.size > 0),
    getOrSet('scanner:quotes', QUOTES_TTL_MS, () => loadQuotes(symbols), nonEmpty),
    getMarketState(),
    getOrSet('scanner:levels', META_TTL_MS, async () => new Set(await getTrackedSymbols()), s => s.size > 0).catch(() => new Set<string>()),
  ]);
  if (history.series.size === 0) throw new Error('no stored history');

  const todayBars = await readTodayBars(state.lastSessionDate).catch(() => ({ date: state.lastSessionDate, fetchedAt: null, bars: new Map() }) as TodayBars);
  const task = todayRefreshTask(symbols, state, todayBars);
  if (task) opts.onTodayRefresh?.(task);

  // Earnings (only for the earnings scans): next report, and reports whose first reaction session is the latest one.
  let earnings: Map<string, ScanContext['earnings']> | null = null;
  if (p.scan === 'earnings_upcoming' || p.scan === 'earnings_reacted') earnings = await loadEarnings(symbols, state, today).catch(() => new Map());

  // Build every symbol's series once (with the live / missing bars).
  const built = new Map<string, { s: SymbolSeries; jump52: { date: string; pct: number } | null; volumePartial: boolean; splitSuspect: boolean }>();
  const buildSeries = (sym: string) => {
    if (built.has(sym)) return built.get(sym)!;
    const h = history.series.get(sym);
    if (!h || h.bars.length < 5) return null;
    const lastBar = h.bars[h.bars.length - 1];
    const lb = liveBarFrom(quotes[sym], { lastDate: lastBar.date, lastClose: lastBar.c }, state, todayBars.bars.get(sym) ?? null);
    const add = [lb.missing, lb.bar].filter((b): b is DayBar => !!b);
    const s: SymbolSeries = {
      bars: [...h.bars, ...add],
      closes: [...h.closes, ...add.map(b => b.c)],
      highs: [...h.highs, ...add.map(b => b.h)],
      lows: [...h.lows, ...add.map(b => b.l)],
      ext: h.ext,
      hasLive: !!lb.bar,
    };
    const v = { s, jump52: h.jump52, volumePartial: lb.volumePartial, splitSuspect: lb.splitSuspect };
    built.set(sym, v);
    return v;
  };

  const spy = buildSeries('SPY');
  const spyRoc = spy ? roc(spy.s.closes, PERIOD_SESSIONS[p.period]) : null;

  const scanFn = SCANNERS[p.scan];
  const matches: Array<{ u: UniverseRow; s: SymbolSeries; m: Match; row: Omit<ScanRow, 'rank' | 'metric' | 'detail' | 'windowChg' | 'flag'>; flag: string | null }> = [];
  let scanned = 0;
  let anyLive = false;
  let anyPartialVolume = false;
  let volumeSettledOnly = false;
  const isVolumeScan = p.scan === 'volume' || p.scan === 'price_volume';

  for (const u of universe) {
    if (!passesMeta(u, p)) continue;
    const b = buildSeries(u.symbol);
    if (!b) continue;
    const { s } = b;
    const bars = s.bars;
    const lastB = bars[bars.length - 1];
    const prevB = bars.length > 1 ? bars[bars.length - 2] : null;
    const price = lastB.c;
    if (price < p.minPrice || (p.maxPrice !== null && price > p.maxPrice)) continue;
    const dv = avgDollarVolM(s);
    if (dv < p.minDollarVolM) continue;
    if (p.minAvgVol > 0 && avgVolume(s) < p.minAvgVol) continue;
    const changePct = prevB && prevB.c > 0 ? pct(price, prevB.c) : null;
    if (p.minChgPct !== null && (changePct === null || changePct < p.minChgPct)) continue;
    if (p.maxChgPct !== null && (changePct === null || changePct > p.maxChgPct)) continue;
    let hi52 = s.ext?.high ?? null;
    let lo52 = s.ext?.low ?? null;
    if (s.hasLive && hi52 !== null && lastB.h > hi52) hi52 = lastB.h;
    if (s.hasLive && lo52 !== null && lastB.l < lo52) lo52 = lastB.l;
    if (p.nearHighPct !== null && (hi52 === null || pct(price, hi52) < -p.nearHighPct)) continue;
    scanned++;
    if (s.hasLive) anyLive = true;
    if (s.hasLive && b.volumePartial) anyPartialVolume = true;

    // A single-venue volume (no consolidated bar yet) would make every ratio tiny: volume scans use
    // the settled sessions until it arrives (the shared table fills ~15 min after the open).
    const settledOnly = isVolumeScan && s.hasLive && b.volumePartial;
    if (settledOnly) volumeSettledOnly = true;
    const scanSeries: SymbolSeries = settledOnly
      ? { ...s, bars: s.bars.slice(0, -1), closes: s.closes.slice(0, -1), highs: s.highs.slice(0, -1), lows: s.lows.slice(0, -1), hasLive: false }
      : s;
    const ctx: ScanContext = {
      symbol: u.symbol, s: scanSeries, p, spyRoc,
      premarket: p.scan === 'premarket_gap' ? premarketFrom(quotes[u.symbol], state, price, Date.now()) : null,
      earnings: earnings?.get(u.symbol) ?? null,
      fundamentals: u.kind === 'stock' ? u.fundamentals : null,
    };
    const m = scanFn(ctx);
    if (!m) continue;
    let flag = jumpFlag(m, scanSeries, b.jump52);
    if (!flag && b.splitSuspect) flag = 'Stored price history disagrees with the live feed by more than 5% for the same session: probably a split that has not been applied yet. Treat this match with caution.';
    matches.push({
      u, s, m, flag,
      row: {
        symbol: u.symbol, name: u.name, exchange: u.exchange, sector: u.sector, industry: u.industry, kind: u.kind,
        price, change: prevB ? price - prevB.c : null, changePct,
        open: lastB.o, high: lastB.h, low: lastB.l, high52: hi52, low52: lo52, volume: lastB.v,
        avgDollarVolM: Math.round(dv * 10) / 10,
        marketCapB: u.kind === 'stock' && u.marketCap != null ? Math.round((u.marketCap / 1e9) * 100) / 100 : null,
        ...fundamentalsCols(u),
        session: state.session, hasLevels: levelSet.has(u.symbol),
      },
    });
  }

  // Relative strength: add the percentile rank across everything scanned.
  if (p.scan === 'rs_spy' && matches.length > 0) {
    const all: number[] = [];
    for (const [sym, b] of built) {
      if (sym === 'SPY' && !universe.some(u => u.symbol === 'SPY')) continue;
      const r = roc(b.s.closes, PERIOD_SESSIONS[p.period]);
      if (r !== null && spyRoc !== null) all.push(r - spyRoc);
    }
    for (const x of matches) x.m.detail += `; ${percentileRank(all, x.m.metric)}th percentile`;
  }

  const asc = rankAscending(p);
  matches.sort((a, b) => (asc ? a.m.metric - b.m.metric : b.m.metric - a.m.metric) || b.row.avgDollarVolM - a.row.avgDollarVolM);
  const rows: ScanRow[] = matches.slice(0, p.limit).map((x, i) => ({
    ...x.row, rank: i + 1, metric: Math.round(x.m.metric * 100) / 100, detail: x.m.detail, windowChg: x.m.windowChg == null ? null : Math.round(x.m.windowChg * 100) / 100, flag: x.flag,
  }));

  const sectors = [...new Set(universe.filter(u => u.sector).map(u => u.sector!))].sort();
  const industries: Record<string, string[]> = {};
  for (const u of universe) {
    if (!u.sector || !u.industry) continue;
    const list = (industries[u.sector] ??= []);
    if (!list.includes(u.industry)) list.push(u.industry);
  }
  for (const k of Object.keys(industries)) industries[k].sort();

  return {
    rows,
    meta: {
      asOf: new Date().toISOString(),
      live: anyLive && state.session === 'regular',
      partialToday: anyLive && (state.session === 'regular' || anyPartialVolume),
      volumeDelayedFeed: anyPartialVolume,
      volumeScanSettledOnly: volumeSettledOnly,
      lastStoredDate: history.lastStoredDate,
      latestSessionDate: state.lastSessionDate,
      sessionState: state.session,
      nextChangeAt: state.nextChangeAt,
      universe: p.universe,
      scanned,
      matched: matches.length,
      returned: rows.length,
    },
    filters: { sectors, industries },
  };
}

/** Next report per symbol, and which symbols' first post-report session is the latest one. */
async function loadEarnings(symbols: string[], state: MarketState, today: string): Promise<Map<string, ScanContext['earnings']>> {
  const out = new Map<string, ScanContext['earnings']>();
  const latest = state.lastSessionDate;
  const prevRows = await sql`SELECT max(bar_date)::text AS d FROM public.nt_daily_bars WHERE symbol = 'SPY' AND bar_date < ${latest}::date`;
  const prevSession = (prevRows[0] as { d: string | null } | undefined)?.d ?? null;
  const rows = await sql`
    SELECT symbol, report_date::text AS d, time_of_day AS t, status
    FROM public.nt_earnings_calendar
    WHERE symbol = ANY(${symbols}::text[]) AND status <> 'dropped'
      AND report_date >= COALESCE(${prevSession}::date, ${latest}::date) AND report_date <= ${today}::date + 30
    ORDER BY symbol, report_date
  `;
  for (const r of rows as any[]) {
    const e = out.get(r.symbol) ?? { next: null, reactionToday: false };
    const time: string | null = r.t ?? null;
    if (r.d >= today && !e.next) {
      const days = Math.round((Date.parse(`${r.d}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
      e.next = { date: r.d, daysUntil: days, estimated: !time, time };
    }
    const preOrDuring = time === 'pre-market' || time === 'during-market';
    if ((r.d === latest && (preOrDuring || !time)) || (r.d === prevSession && (time === 'post-market' || !time))) e.reactionToday = true;
    out.set(r.symbol, e);
  }
  return out;
}

