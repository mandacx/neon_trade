/**
 * OI tracker queries (docs/oi-tracker.md). Server-only.
 *
 * Source: public.us_opt_chg_rpt, a daily *change report* (only contracts whose
 * OI moved by >= ~100 that day), joined to nt_opt_daily_bars for the volume of
 * the session behind each load's OI change (lib/optionVolume.ts).
 *
 * Fast paths (live indexes): one or a few load_dt values (idx on load_dt), or
 * one underlying (leading column of the unique key). Ranges are capped at
 * MAX_LOADS load dates. Filtering, aggregation, sorting and the row limit all
 * run in SQL so a wide range never ships hundreds of thousands of rows.
 */
import { sql } from '@/lib/db';
import { catalogTradeDates } from '@/lib/marketCatalog';
import { previousTradingDay, sessionsForLoads } from '@/lib/marketSession';
import { suggestSide, type StrategyInputRow } from '@/lib/oiStrategies';
import { getWatchlistSymbols } from '@/lib/watchlists';
import type {
  ExpiryKind, OiContractRow, OiGroupBy, OiGroupRow, OiScreenResult, OiSummary, OptType, ValueBasis, ValueBucket,
} from '@/types/oiTracker';

export const MAX_LOADS = 60;
/** The per-contract view is the heavy one (20 loads ≈ 5s, 60 ≈ 13s measured), so it gets a shorter cap. */
export const MAX_LOADS_CONTRACT = 20;
export const MAX_ROWS = 2000;

export interface OiScreenParams {
  from: string;
  to: string;
  groupBy: OiGroupBy;
  symbols?: string[] | null;
  /** Underlyings to leave out (e.g. SPX, NDX, SPY, QQQ). Applied in SQL after every other symbol filter. */
  excludeSymbols?: string[] | null;
  optType?: OptType | null;
  expiryFrom?: string | null;
  expiryTo?: string | null;
  expiries?: string[] | null;
  expiryKind?: ExpiryKind | null;
  /** Monthly/quarterly (3rd Friday) expiries only; set from the viewer's plan (lib/expiryAccess.ts), never from the query string. */
  standardOnly?: boolean;
  dteMin?: number | null;
  dteMax?: number | null;
  direction?: 'opened' | 'closed' | 'both';
  minAbsChg?: number | null;
  valueBasis?: ValueBasis;
  valueBucket?: ValueBucket;
  minValue?: number | null;
  moneyness?: 'itm' | 'otm' | 'all';
  sector?: string | null;
  industry?: string | null;
  marketCapTier?: string | null;
  indexCode?: string | null;
  /** A watchlist id (the user's own, or a curated 'sys:' list); resolved with an ownership check. */
  watchlistId?: string | null;
  /** Owner for watchlistId; another user's list resolves to no symbols. */
  userId?: string | null;
  sort?: string | null;
  sortDir?: 'asc' | 'desc';
  limit?: number;
}

/**
 * Contract key for a us_opt_chg_rpt row. The OCC `symbol` column is only
 * filled from the 2026-10-06 load on (null before); for older rows the OCC
 * symbol is derived from underlying/expiry/type/strike. The derived form equals
 * the real one except for index weeklies (SPXW, NDXP) and adjusted contracts
 * (e.g. LEN1), so those split into two keys across that date.
 */
export function occSql(a: string): string {
  return `COALESCE(${a}.symbol, ${a}.symbol_und || to_char(${a}.expiry_dt, 'YYMMDD') || CASE WHEN TRIM(${a}.opt_type) = 'call' THEN 'C' ELSE 'P' END || lpad((round(${a}.strike_pr * 1000))::bigint::text, 8, '0'))`;
}

const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

/** Latest options load dates (newest first). */
export function getOiLoadDates(limit = 400): Promise<string[]> {
  return catalogTradeDates('opt_chg', limit, async () => {
    const rows = await sql`SELECT DISTINCT load_dt::text AS d FROM public.us_opt_chg_rpt WHERE load_dt >= CURRENT_DATE - 120 ORDER BY d DESC LIMIT ${limit}`;
    return rows.map((r: any) => r.d as string);
  });
}

/** Load dates within [from, to] (ascending), at most `max` (the most recent ones). */
async function loadDatesIn(from: string, to: string, max = MAX_LOADS): Promise<string[]> {
  const rows = await sql`
    SELECT trade_date::text AS d FROM public.nt_market_dates
    WHERE source = 'opt_chg' AND trade_date BETWEEN ${from}::date AND ${to}::date
    ORDER BY trade_date DESC LIMIT ${max}
  `;
  let dates = rows.map((r: any) => r.d as string);
  if (dates.length === 0) {
    const live = await sql`
      SELECT DISTINCT load_dt::text AS d FROM public.us_opt_chg_rpt
      WHERE load_dt BETWEEN ${from}::date AND ${to}::date ORDER BY d DESC LIMIT ${max}
    `;
    dates = live.map((r: any) => r.d as string);
  }
  return dates.sort();
}

/** For each load date, the trading session whose activity it reports (the previous trading day). */
const sessionsFor = sessionsForLoads;

/**
 * The symbol restriction from the symbols list, the securities filters and the
 * watchlist, intersected. null = no restriction; [] = nothing matches (e.g. an
 * empty watchlist), which must return no rows rather than everything.
 */
async function resolveSymbols(p: OiScreenParams): Promise<string[] | null> {
  const [secSymbols, wlSymbols] = await Promise.all([
    symbolsForSecurities(p),
    p.watchlistId ? getWatchlistSymbols(p.watchlistId, p.userId ?? null) : Promise.resolve(null),
  ]);
  let symbols: string[] | null = p.symbols?.length ? p.symbols.map(s => s.toUpperCase()) : null;
  for (const set of [secSymbols, wlSymbols?.map(s => s.toUpperCase()) ?? null]) {
    if (!set) continue;
    const allowed = new Set(set);
    symbols = symbols ? symbols.filter(s => allowed.has(s)) : [...allowed];
  }
  return symbols;
}

/** Symbols matching securities filters, or null when no such filter is set. */
async function symbolsForSecurities(p: OiScreenParams): Promise<string[] | null> {
  if (!p.sector && !p.industry && !p.marketCapTier && !p.indexCode) return null;
  const rows = await sql`
    SELECT symbol FROM public.securities
    WHERE (${p.sector ?? null}::text IS NULL OR sector = ${p.sector ?? null})
      AND (${p.industry ?? null}::text IS NULL OR industry = ${p.industry ?? null})
      AND (${p.marketCapTier ?? null}::text IS NULL OR market_cap_tier = ${p.marketCapTier ?? null})
      AND (${p.indexCode ?? null}::text IS NULL OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          CASE WHEN indices IS NOT NULL AND indices::text NOT IN ('null', '[]', '') THEN indices::jsonb ELSE '[]'::jsonb END
        ) e WHERE e->>'code' = ${p.indexCode ?? null}
      ))
  `;
  return rows.map((r: any) => String(r.symbol).toUpperCase());
}

const CONTRACT_SORTS: Record<string, string> = {
  chg: 'chg', abs_chg: 'ABS(chg)', chg_value: 'chg_value', abs_chg_value: 'ABS(chg_value)', oi: 'oi',
  oi_value: 'oi * 100 * ltp', notional: 'oi * 100 * close', new_pct: 'new_pct', vol: 'vol', vol_to_chg: 'vol_to_chg',
  dte: 'expiry_dt', strike: 'strike_pr', symbol: 'und', expiry: 'expiry_dt', ltp: 'ltp',
};
const GROUP_SORTS: Record<string, string> = {
  net_chg: 'net_chg', abs_net_chg: 'ABS(net_chg)', chg_value: 'chg_value', abs_chg_value: 'abs_chg_value',
  call_opened: 'call_opened', put_opened: 'put_opened', call_closed: 'call_closed', put_closed: 'put_closed',
  vol: 'vol', contracts: 'contracts', oi_value: 'oi_value', key: 'k1, k2',
};

/**
 * Build the shared CTEs. Returns the SQL text (with $n placeholders) and params.
 * `c` = one row per contract (per contract and load date when perDate), with
 * every filter applied; callers select from `c`.
 */
function buildBase(p: OiScreenParams, loads: string[], sessions: string[], symbols: string[] | null, perDate: boolean) {
  const params: unknown[] = [];
  const $ = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const loadsP = $(loads);
  const sessP = $(sessions);
  // Bound only when a DTE filter uses it (Postgres rejects unused parameters).
  let toRef: string | null = null;
  const toP = () => (toRef ??= $(p.to));

  const where: string[] = [`r.load_dt = ANY(${loadsP}::date[])`];
  if (symbols) where.push(`r.symbol_und = ANY(${$(symbols)}::text[])`);
  if (p.excludeSymbols?.length) where.push(`NOT (r.symbol_und = ANY(${$(p.excludeSymbols)}::text[]))`);
  if (p.optType) where.push(`TRIM(r.opt_type) = ${$(p.optType)}`);
  if (p.expiryFrom) where.push(`r.expiry_dt >= ${$(p.expiryFrom)}::date`);
  if (p.expiryTo) where.push(`r.expiry_dt <= ${$(p.expiryTo)}::date`);
  if (p.expiries?.length) where.push(`r.expiry_dt = ANY(${$(p.expiries)}::date[])`);
  // 3rd Friday = monthly; of Mar/Jun/Sep/Dec = quarterly (same rule as the stock page's expiryKind()).
  const third = `(EXTRACT(DOW FROM r.expiry_dt) = 5 AND EXTRACT(DAY FROM r.expiry_dt) BETWEEN 15 AND 21)`;
  if (p.standardOnly) where.push(third);
  if (p.expiryKind === 'weekly') where.push(`NOT ${third}`);
  if (p.expiryKind === 'monthly') where.push(third);
  if (p.expiryKind === 'quarterly') where.push(`${third} AND EXTRACT(MONTH FROM r.expiry_dt) IN (3, 6, 9, 12)`);
  if (p.dteMin != null) where.push(`(r.expiry_dt - ${toP()}::date) >= ${$(p.dteMin)}::int`);
  if (p.dteMax != null) where.push(`(r.expiry_dt - ${toP()}::date) <= ${$(p.dteMax)}::int`);

  const cWhere: string[] = [];
  if (p.direction === 'opened') cWhere.push('chg > 0');
  if (p.direction === 'closed') cWhere.push('chg < 0');
  if (p.minAbsChg) cWhere.push(`ABS(chg) >= ${$(p.minAbsChg)}::bigint`);
  const valueExpr = p.valueBasis === 'oi' ? '(oi * 100 * ltp)' : 'ABS(chg_value)';
  if (p.valueBucket === 'b') cWhere.push(`${valueExpr} >= 1e9`);
  if (p.valueBucket === 'm') cWhere.push(`${valueExpr} >= 1e6 AND ${valueExpr} < 1e9`);
  if (p.valueBucket === 'k') cWhere.push(`${valueExpr} >= 1e3 AND ${valueExpr} < 1e6`);
  if (p.minValue) cWhere.push(`${valueExpr} >= ${$(p.minValue)}::numeric`);
  if (p.moneyness === 'itm') cWhere.push(`((t = 'call' AND strike_pr < close) OR (t = 'put' AND strike_pr > close))`);
  if (p.moneyness === 'otm') cWhere.push(`((t = 'call' AND strike_pr >= close) OR (t = 'put' AND strike_pr <= close))`);

  const dateCol = perDate ? ', load_dt' : '';
  const text = `
    WITH m AS (SELECT * FROM unnest(${loadsP}::date[], ${sessP}::date[]) AS m(load_dt, session)),
    r AS (
      SELECT ${occSql('r')} AS symbol, r.symbol_und, r.expiry_dt, TRIM(r.opt_type) AS t, r.strike_pr, r.load_dt, m.session,
             COALESCE(r.ltp, 0) AS ltp, COALESCE(r.oi, 0) AS oi, COALESCE(r.oi_chg, 0) AS oi_chg, COALESCE(r.close, 0) AS close,
             b.v, b.o AS bo, b.c AS bc, (b.contract IS NOT NULL) AS has_bar
      FROM public.us_opt_chg_rpt r
      JOIN m ON m.load_dt = r.load_dt
      LEFT JOIN public.nt_opt_daily_bars b ON b.contract = ${occSql('r')} AND b.bar_date = m.session
      WHERE ${where.join(' AND ')}
    ),
    a AS (
      SELECT symbol AS contract, symbol_und AS und, expiry_dt, t, strike_pr${dateCol},
        SUM(oi_chg)::bigint AS chg,
        SUM(oi_chg * 100 * ltp) AS chg_value,
        (array_agg(oi ORDER BY load_dt DESC))[1] AS oi,
        (array_agg(ltp ORDER BY load_dt DESC))[1] AS ltp,
        (array_agg(close ORDER BY load_dt DESC))[1] AS close,
        (array_agg(bo ORDER BY load_dt DESC))[1] AS sess_open,
        (array_agg(bc ORDER BY load_dt DESC))[1] AS sess_close,
        SUM(v) FILTER (WHERE has_bar) AS vol,
        COUNT(*)::int AS days, MIN(load_dt)::text AS first_load, MAX(load_dt)::text AS last_load,
        MIN(session)::text AS first_session, MAX(session)::text AS last_session
      FROM r
      GROUP BY symbol, symbol_und, expiry_dt, t, strike_pr${dateCol}
    ),
    c AS (
      SELECT a.*, a.expiry_dt::text AS expiry_s,${perDate ? ' a.load_dt::text AS load_s,' : ''}
        CASE WHEN a.oi - a.chg > 0 THEN a.chg::numeric / (a.oi - a.chg) * 100 END AS new_pct,
        CASE WHEN a.vol IS NOT NULL AND a.chg <> 0 THEN a.vol::numeric / ABS(a.chg) END AS vol_to_chg
      FROM a
      ${cWhere.length ? `WHERE ${cWhere.join(' AND ')}` : ''}
    )`;
  return { text, params, $ };
}

function toContractRow(r: any, to: string): OiContractRow {
  const strike = num(r.strike_pr);
  const close = num(r.close);
  const optType = r.t as OptType;
  const expiry = r.expiry_s as string;
  const oi = num(r.oi);
  const ltp = num(r.ltp);
  const chg = num(r.chg);
  const vol = numOrNull(r.vol);
  const sessOpen = numOrNull(r.sess_open);
  const sessClose = numOrNull(r.sess_close);
  return {
    contract: r.contract,
    underlying: r.und,
    expiry,
    optType,
    strike,
    dte: Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${to}T00:00:00Z`)) / 86_400_000),
    close,
    ltp,
    oi,
    oiChg: chg,
    newPct: numOrNull(r.new_pct),
    chgValue: num(r.chg_value),
    oiValue: oi * 100 * ltp,
    notional: oi * 100 * close,
    moneynessPct: close > 0 ? ((strike - close) / close) * 100 : 0,
    itm: optType === 'call' ? strike < close : strike > close,
    vol,
    volToChg: numOrNull(r.vol_to_chg),
    sessOpen,
    sessClose,
    days: num(r.days),
    firstLoad: r.first_load,
    lastLoad: r.last_load,
    tradeDate: r.last_session,
    firstTradeDate: r.first_session,
    hint: suggestSide(chg, sessOpen, sessClose),
  };
}

const GROUP_KEYS: Record<Exclude<OiGroupBy, 'contract'>, { cols: string; k1: string; k2: string }> = {
  underlying: { cols: 'und', k1: 'und', k2: "''" },
  expiry: { cols: 'und, expiry_dt', k1: 'und', k2: 'expiry_dt::text' },
  strike: { cols: 'und, strike_pr', k1: 'und', k2: 'strike_pr::text' },
  date: { cols: 'load_dt', k1: 'load_dt::text', k2: "''" },
};

function toGroupRow(r: any, groupBy: Exclude<OiGroupBy, 'contract'>): OiGroupRow {
  const callOpened = num(r.call_opened);
  const putOpened = num(r.put_opened);
  return {
    key: `${r.k1}|${r.k2}`,
    underlying: groupBy === 'date' ? null : r.k1,
    expiry: groupBy === 'expiry' ? r.k2 : null,
    strike: groupBy === 'strike' ? Number(r.k2) : null,
    loadDate: groupBy === 'date' ? r.k1 : null,
    tradeDate: groupBy === 'date' ? r.trade_date ?? null : null,
    close: groupBy === 'date' ? null : numOrNull(r.close),
    callOpened,
    callClosed: num(r.call_closed),
    putOpened,
    putClosed: num(r.put_closed),
    callChg: num(r.call_chg),
    putChg: num(r.put_chg),
    netChg: num(r.net_chg),
    callChgValue: num(r.call_chg_value),
    putChgValue: num(r.put_chg_value),
    chgValue: num(r.chg_value),
    absChgValue: num(r.abs_chg_value),
    callOi: num(r.call_oi),
    putOi: num(r.put_oi),
    oiValue: num(r.oi_value),
    pcOpened: callOpened > 0 ? putOpened / callOpened : null,
    vol: numOrNull(r.vol),
    contracts: num(r.contracts),
    topContract: r.top_contract ?? null,
    topChg: numOrNull(r.top_chg),
  };
}

const GROUP_AGGS = `
  COALESCE(SUM(chg) FILTER (WHERE t = 'call' AND chg > 0), 0) AS call_opened,
  COALESCE(SUM(chg) FILTER (WHERE t = 'call' AND chg < 0), 0) AS call_closed,
  COALESCE(SUM(chg) FILTER (WHERE t = 'put' AND chg > 0), 0) AS put_opened,
  COALESCE(SUM(chg) FILTER (WHERE t = 'put' AND chg < 0), 0) AS put_closed,
  COALESCE(SUM(chg) FILTER (WHERE t = 'call'), 0) AS call_chg,
  COALESCE(SUM(chg) FILTER (WHERE t = 'put'), 0) AS put_chg,
  SUM(chg) AS net_chg,
  COALESCE(SUM(chg_value) FILTER (WHERE t = 'call'), 0) AS call_chg_value,
  COALESCE(SUM(chg_value) FILTER (WHERE t = 'put'), 0) AS put_chg_value,
  SUM(chg_value) AS chg_value,
  SUM(ABS(chg_value)) AS abs_chg_value,
  COALESCE(SUM(oi) FILTER (WHERE t = 'call'), 0) AS call_oi,
  COALESCE(SUM(oi) FILTER (WHERE t = 'put'), 0) AS put_oi,
  SUM(oi * 100 * ltp) AS oi_value,
  SUM(vol) AS vol,
  COUNT(*)::int AS contracts,
  MAX(close) AS close,
  MAX(last_session)::text AS trade_date,
  (array_agg(contract ORDER BY ABS(chg) DESC))[1] AS top_contract,
  (array_agg(chg ORDER BY ABS(chg) DESC))[1] AS top_chg`;

/** The main screen: filtered, aggregated, sorted and limited in SQL. */
export async function getOiScreen(p: OiScreenParams): Promise<OiScreenResult> {
  const loads = await loadDatesIn(p.from, p.to, p.groupBy === 'contract' && !p.symbols?.length ? MAX_LOADS_CONTRACT : MAX_LOADS);
  const emptySummary: OiSummary = { contracts: 0, underlyings: 0, opened: 0, closed: 0, openedValue: 0, closedValue: 0, callChgValue: 0, putChgValue: 0, vol: null };
  if (loads.length === 0) {
    return { from: p.from, to: p.to, loadDates: [], groupBy: p.groupBy, rows: [], summary: emptySummary, truncated: false, volumeCoverage: { loads: 0, withVolume: 0 } };
  }
  const [sessions, symbols] = await Promise.all([sessionsFor(loads), resolveSymbols(p)]);

  const limit = Math.min(Math.max(p.limit ?? 500, 1), MAX_ROWS);
  const dir = p.sortDir === 'asc' ? 'ASC' : 'DESC';
  const perDate = p.groupBy === 'date';

  const base = buildBase(p, loads, sessions, symbols, perDate);
  let rowsText: string;
  if (p.groupBy === 'contract') {
    const sortExpr = CONTRACT_SORTS[p.sort ?? ''] ?? 'ABS(chg_value)';
    rowsText = `${base.text} SELECT * FROM c ORDER BY ${sortExpr} ${dir} NULLS LAST, contract LIMIT ${limit + 1}`;
  } else {
    const g = GROUP_KEYS[p.groupBy];
    let sortExpr = p.groupBy === 'date' && !p.sort ? 'k1' : GROUP_SORTS[p.sort ?? ''] ?? 'abs_chg_value';
    if (p.sort === 'key' && p.groupBy === 'strike') sortExpr = 'k1, strike_pr'; // numeric, not text
    const sortDir = p.groupBy === 'date' && !p.sort ? 'DESC' : dir;
    rowsText = `${base.text} SELECT ${g.k1} AS k1, ${g.k2} AS k2, ${GROUP_AGGS} FROM c GROUP BY ${g.cols}
      ORDER BY ${sortExpr} ${sortDir} NULLS LAST LIMIT ${limit + 1}`;
  }
  const summaryText = `${base.text}
    SELECT COUNT(*)::int AS contracts, COUNT(DISTINCT und)::int AS underlyings,
      COALESCE(SUM(chg) FILTER (WHERE chg > 0), 0) AS opened, COALESCE(SUM(chg) FILTER (WHERE chg < 0), 0) AS closed,
      COALESCE(SUM(chg_value) FILTER (WHERE chg > 0), 0) AS opened_value, COALESCE(SUM(chg_value) FILTER (WHERE chg < 0), 0) AS closed_value,
      COALESCE(SUM(chg_value) FILTER (WHERE t = 'call'), 0) AS call_chg_value, COALESCE(SUM(chg_value) FILTER (WHERE t = 'put'), 0) AS put_chg_value,
      SUM(vol) AS vol
    FROM c`;
  const coverageText = `
    SELECT COUNT(*)::int AS n FROM unnest($1::date[], $2::date[]) AS m(load_dt, session)
    WHERE EXISTS (SELECT 1 FROM public.nt_opt_daily_bars b WHERE b.bar_date = m.session)`;

  const [rows, summaryRows, coverage] = await Promise.all([
    sql(rowsText, base.params),
    sql(summaryText, base.params),
    sql(coverageText, [loads, sessions]),
  ]);
  const truncated = rows.length > limit;
  const trimmed = rows.slice(0, limit);
  const s: any = summaryRows[0] ?? {};
  return {
    from: loads[0],
    to: loads[loads.length - 1],
    loadDates: loads,
    groupBy: p.groupBy,
    rows: p.groupBy === 'contract'
      ? trimmed.map((r: any) => toContractRow(r, p.to))
      : trimmed.map((r: any) => toGroupRow(r, p.groupBy as Exclude<OiGroupBy, 'contract'>)),
    summary: {
      contracts: num(s.contracts), underlyings: num(s.underlyings), opened: num(s.opened), closed: num(s.closed),
      openedValue: num(s.opened_value), closedValue: num(s.closed_value), callChgValue: num(s.call_chg_value),
      putChgValue: num(s.put_chg_value), vol: numOrNull(s.vol),
    },
    truncated,
    volumeCoverage: { loads: loads.length, withVolume: num(coverage[0]?.n) },
  };
}

/** Per-load-date contract rows for strategy detection (each load date separately). */
export async function getStrategyRows(p: OiScreenParams & { minLeg: number }): Promise<StrategyInputRow[]> {
  const loads = await loadDatesIn(p.from, p.to, MAX_LOADS_CONTRACT);
  if (loads.length === 0) return [];
  const [sessions, symbols] = await Promise.all([sessionsFor(loads), resolveSymbols(p)]);
  // Leg filters only: direction/value/moneyness would hide one leg of a pair.
  const base = buildBase({ ...p, direction: 'both', valueBucket: 'all', minValue: null, moneyness: 'all', minAbsChg: p.minLeg }, loads, sessions, symbols, true);
  const rows = await sql(`${base.text} SELECT * FROM c LIMIT 20000`, base.params);
  return rows.map((r: any) => ({
    contract: r.contract, underlying: r.und, loadDate: r.load_s as string, tradeDate: r.last_session as string, expiry: r.expiry_s as string, optType: r.t as OptType,
    strike: num(r.strike_pr), oiChg: num(r.chg), ltp: num(r.ltp), close: num(r.close), vol: numOrNull(r.vol),
  }));
}

export interface StockFullOiRow { expiry: string; callOi: number; putOi: number }

/**
 * Full call/put OI per expiry for one symbol from eod_usmkts_price (the change
 * report only holds contracts that moved, so it can't give totals), at the
 * latest trade date on or before `to`.
 */
export async function getStockFullOi(symbol: string, to: string): Promise<{ tradeDate: string | null; rows: StockFullOiRow[] }> {
  const sym = symbol.toUpperCase();
  const rows = await sql`
    WITH d AS (
      SELECT MAX(trade_date) AS td FROM public.eod_usmkts_price
      WHERE upper(symbol) = ${sym} AND trade_date <= ${to}::date
    )
    SELECT e.trade_date::text AS "tradeDate", e.expiry_dt::text AS expiry,
           COALESCE(e.call_oi, 0) AS "callOi", COALESCE(e.put_oi, 0) AS "putOi"
    FROM public.eod_usmkts_price e, d
    WHERE upper(e.symbol) = ${sym} AND e.trade_date = d.td AND e.expiry_dt >= d.td
    ORDER BY e.expiry_dt
  `;
  return {
    tradeDate: rows[0]?.tradeDate ?? null,
    rows: rows.map((r: any) => ({ expiry: r.expiry, callOi: num(r.callOi), putOi: num(r.putOi) })),
  };
}

/** Previous trading session for a load date (exposed for the routes). */
export { previousTradingDay };
