/**
 * User-tracked option positions for the OI tracker (docs/oi-tracker.md).
 *
 * Private: every statement filters on user_id inside the SQL itself, so an id
 * owned by someone else behaves exactly like a missing one. `visibility` is
 * reserved for a future social feature and is always 'private' here.
 *
 * P&L per leg: (current − entry) × 100 × qty, negated for sell-to-open.
 * Current price: Alpaca option snapshot mid (bid/ask), else last trade, else
 * the day's close; expired contracts use intrinsic value at the expiry-day
 * close of the underlying, else the contract's last bar; closed positions use
 * their exit price.
 */
import { sql } from '@/lib/db';
import { etDateOf } from '@/lib/marketSession';
import { occSql } from '@/lib/oiTracker';
import {
  getDailyBarsMulti, getOptionBarsMulti, getOptionSnapshotsMulti, getSnapshotsMulti, type AlpacaBar, type AlpacaOptionSnapshot,
} from '@/lib/alpaca';
import type { OptType, TrackedPosition } from '@/types/oiTracker';

export const MAX_OPEN_POSITIONS = 300;
export const MAX_LEGS = 4;

const OCC_RE = /^([A-Z][A-Z0-9.]{0,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

export function parseOcc(contract: string): { root: string; expiry: string; optType: OptType; strike: number } | null {
  const m = OCC_RE.exec(contract);
  if (!m) return null;
  return { root: m[1], expiry: `20${m[2]}-${m[3]}-${m[4]}`, optType: m[5] === 'C' ? 'call' : 'put', strike: Number(m[6]) / 1000 };
}

export const todayET = () => etDateOf(Date.now());
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

function snapshotPrice(s: AlpacaOptionSnapshot | undefined): number | null {
  if (!s) return null;
  const bid = s.latestQuote?.bp ?? 0;
  const ask = s.latestQuote?.ap ?? 0;
  if (bid > 0 && ask >= bid) return Math.round(((bid + ask) / 2) * 10000) / 10000;
  return s.latestTrade?.p ?? s.dailyBar?.c ?? null;
}

function rowToPosition(r: any): TrackedPosition {
  return {
    id: String(r.id),
    contract: r.contract,
    underlying: r.underlying,
    expiry: r.expiry,
    optType: r.opt_type,
    strike: Number(r.strike),
    side: r.side,
    qty: Number(r.qty),
    entryDate: r.entry_date,
    entryPrice: Number(r.entry_price),
    entryUnderlying: numOrNull(r.entry_underlying),
    strategyGroup: r.strategy_group ?? null,
    strategyLabel: r.strategy_label ?? null,
    note: r.note ?? null,
    closedAt: r.closed_at ?? null,
    exitPrice: numOrNull(r.exit_price),
    createdAt: new Date(r.created_at).toISOString(),
    currentPrice: null,
    priceSource: null,
    currentUnderlying: null,
    pnl: null,
    pnlPct: null,
    underlyingChgPct: null,
    daysHeld: 0,
    expired: false,
  };
}

const SELECT_COLS = `id, contract, underlying, expiry_dt::text AS expiry, opt_type, strike, side, qty,
  entry_date::text AS entry_date, entry_price, entry_underlying, strategy_group, strategy_label, note,
  closed_at::text AS closed_at, exit_price, created_at`;

export async function listTracked(userId: string): Promise<TrackedPosition[]> {
  const rows = await sql(`SELECT ${SELECT_COLS} FROM public.nt_oi_tracked WHERE user_id = $1 ORDER BY created_at DESC, id`, [userId]);
  return rows.map(rowToPosition);
}

export async function getTracked(userId: string, id: string): Promise<TrackedPosition | null> {
  if (!/^\d+$/.test(id)) return null;
  const rows = await sql(`SELECT ${SELECT_COLS} FROM public.nt_oi_tracked WHERE user_id = $1 AND id = $2`, [userId, id]);
  return rows[0] ? rowToPosition(rows[0]) : null;
}

/** Positions in the same strategy group as `id` (or just `id`), owned by the user. */
export async function getTrackedGroup(userId: string, id: string): Promise<TrackedPosition[]> {
  const pos = await getTracked(userId, id);
  if (!pos) return [];
  if (!pos.strategyGroup) return [pos];
  const rows = await sql(
    `SELECT ${SELECT_COLS} FROM public.nt_oi_tracked WHERE user_id = $1 AND strategy_group = $2 ORDER BY id`,
    [userId, pos.strategyGroup],
  );
  return rows.map(rowToPosition);
}

export interface NewLeg {
  underlying: string;
  contract: string;
  side: 'BTO' | 'STO';
  qty: number;
  entryPrice?: number | null;
}

export class TrackError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Price of an option on a date: snapshot for today, the daily bar close for past dates, else the report LTP. */
async function priceOn(contract: string, underlying: string, date: string): Promise<number | null> {
  if (date >= todayET()) {
    const snaps = await getOptionSnapshotsMulti([contract]);
    const p = snapshotPrice(snaps[contract]);
    if (p != null) return p;
  } else {
    const { bars } = await getOptionBarsMulti([contract], date, date);
    const bar = (bars[contract] ?? []).find(b => b.t.slice(0, 10) === date);
    if (bar) return bar.c;
  }
  const rows = await sql(
    `SELECT r.ltp FROM public.us_opt_chg_rpt r
     WHERE r.symbol_und = $1 AND ${occSql('r')} = $2 AND r.load_dt <= $3::date
     ORDER BY r.load_dt DESC LIMIT 1`,
    [underlying, contract, date],
  );
  return numOrNull(rows[0]?.ltp);
}

/** Underlying price on a date (Alpaca stock data; the report's close for indices such as SPX). */
async function underlyingOn(underlying: string, date: string): Promise<number | null> {
  if (date >= todayET()) {
    const snap = (await getSnapshotsMulti([underlying]))[underlying];
    const p = snap?.latestTrade?.p ?? snap?.dailyBar?.c;
    if (p != null) return p;
  } else {
    const bars = (await getDailyBarsMulti([underlying], date, date))[underlying];
    if (bars?.length) return bars[bars.length - 1].close;
  }
  const rows = await sql`
    SELECT close FROM public.us_opt_chg_rpt
    WHERE symbol_und = ${underlying} AND load_dt <= ${date}::date
    ORDER BY load_dt DESC LIMIT 1
  `;
  return numOrNull(rows[0]?.close);
}

/**
 * Add 1..MAX_LEGS positions. Each contract must appear in us_opt_chg_rpt for
 * the given underlying (validated, then expiry/type/strike are taken from the
 * OCC symbol, never from the client). Legs added together share a strategy group.
 */
export async function createTracked(
  userId: string,
  legs: NewLeg[],
  opts: { entryDate?: string | null; note?: string | null; strategyLabel?: string | null },
): Promise<TrackedPosition[]> {
  if (legs.length < 1 || legs.length > MAX_LEGS) throw new TrackError(`Add between 1 and ${MAX_LEGS} legs`);
  const today = todayET();
  const entryDate = opts.entryDate || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || entryDate > today) throw new TrackError('Entry date must be a past or today\'s date (YYYY-MM-DD)');

  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM public.nt_oi_tracked WHERE user_id = ${userId} AND closed_at IS NULL`;
  if (n + legs.length > MAX_OPEN_POSITIONS) throw new TrackError(`You can track up to ${MAX_OPEN_POSITIONS} open positions`, 409);

  const prepared = [];
  for (const leg of legs) {
    const underlying = String(leg.underlying || '').toUpperCase();
    const contract = String(leg.contract || '').toUpperCase();
    const occ = parseOcc(contract);
    if (!occ || !underlying) throw new TrackError(`Invalid contract ${contract || '(empty)'}`);
    if (leg.side !== 'BTO' && leg.side !== 'STO') throw new TrackError('Side must be BTO or STO');
    const qty = Math.floor(Number(leg.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 100_000) throw new TrackError('Quantity must be 1–100,000 contracts');
    if (occ.expiry < entryDate) throw new TrackError(`${contract} had already expired on ${entryDate}`);
    const known = await sql(`SELECT 1 FROM public.us_opt_chg_rpt r WHERE r.symbol_und = $1 AND ${occSql('r')} = $2 LIMIT 1`, [underlying, contract]);
    if (known.length === 0) throw new TrackError(`${contract} is not in the OI report for ${underlying}`, 404);

    let entryPrice = leg.entryPrice == null || (leg.entryPrice as unknown) === '' ? null : Number(leg.entryPrice);
    if (entryPrice != null && (!Number.isFinite(entryPrice) || entryPrice < 0 || entryPrice > 100_000)) throw new TrackError('Entry price must be a positive number');
    if (entryPrice == null) entryPrice = await priceOn(contract, underlying, entryDate);
    if (entryPrice == null) throw new TrackError(`No price found for ${contract} on ${entryDate}; enter the entry price`, 422);
    prepared.push({ underlying, contract, occ, side: leg.side, qty, entryPrice });
  }

  const underlyingPrices = new Map<string, number | null>();
  for (const u of new Set(prepared.map(p => p.underlying))) underlyingPrices.set(u, await underlyingOn(u, entryDate));

  const group = prepared.length > 1 ? `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}` : null;
  const note = opts.note ? String(opts.note).slice(0, 500) : null;
  const label = opts.strategyLabel ? String(opts.strategyLabel).slice(0, 200) : null;
  const rows = await sql`
    INSERT INTO public.nt_oi_tracked
      (user_id, contract, underlying, expiry_dt, opt_type, strike, side, qty, entry_date, entry_price, entry_underlying,
       strategy_group, strategy_label, note)
    SELECT ${userId}, u.contract, u.underlying, u.expiry, u.opt_type, u.strike, u.side, u.qty, ${entryDate}::date,
           u.entry_price, u.entry_underlying, ${group}, ${label}, ${note}
    FROM unnest(
      ${prepared.map(p => p.contract)}::text[], ${prepared.map(p => p.underlying)}::text[], ${prepared.map(p => p.occ.expiry)}::date[],
      ${prepared.map(p => p.occ.optType)}::text[], ${prepared.map(p => p.occ.strike)}::numeric[], ${prepared.map(p => p.side)}::text[],
      ${prepared.map(p => p.qty)}::int[], ${prepared.map(p => p.entryPrice)}::numeric[],
      ${prepared.map(p => underlyingPrices.get(p.underlying) ?? null)}::numeric[]
    ) AS u(contract, underlying, expiry, opt_type, strike, side, qty, entry_price, entry_underlying)
    RETURNING id
  `;
  const ids = rows.map((r: any) => String(r.id));
  const all = await listTracked(userId);
  return all.filter(p => ids.includes(p.id));
}

export interface TrackedPatch {
  qty?: number;
  entryPrice?: number;
  note?: string | null;
  close?: { date?: string | null; price?: number | null } | null;
  reopen?: boolean;
}

/** Edit or close/reopen one position. Returns null when it doesn't exist for this user. */
export async function updateTracked(userId: string, id: string, patch: TrackedPatch): Promise<TrackedPosition | null> {
  const pos = await getTracked(userId, id);
  if (!pos) return null;
  let qty = pos.qty;
  let entryPrice = pos.entryPrice;
  let note = pos.note;
  let closedAt = pos.closedAt;
  let exitPrice = pos.exitPrice;
  if (patch.qty !== undefined) {
    qty = Math.floor(Number(patch.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 100_000) throw new TrackError('Quantity must be 1–100,000 contracts');
  }
  if (patch.entryPrice !== undefined) {
    entryPrice = Number(patch.entryPrice);
    if (!Number.isFinite(entryPrice) || entryPrice < 0 || entryPrice > 100_000) throw new TrackError('Entry price must be a positive number');
  }
  if (patch.note !== undefined) note = patch.note ? String(patch.note).slice(0, 500) : null;
  if (patch.close) {
    const date = patch.close.date || todayET();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < pos.entryDate || date > todayET()) throw new TrackError('Close date must be between the entry date and today');
    const price = patch.close.price == null ? await priceOn(pos.contract, pos.underlying, date) : Number(patch.close.price);
    if (price == null || !Number.isFinite(price) || price < 0) throw new TrackError('No exit price found; enter it', 422);
    closedAt = date;
    exitPrice = price;
  }
  if (patch.reopen) { closedAt = null; exitPrice = null; }
  await sql`
    UPDATE public.nt_oi_tracked
    SET qty = ${qty}, entry_price = ${entryPrice}, note = ${note}, closed_at = ${closedAt}::date, exit_price = ${exitPrice}
    WHERE user_id = ${userId} AND id = ${id}
  `;
  return getTracked(userId, id);
}

/** Delete one position, or its whole strategy group. Returns the number deleted (0 = not found for this user). */
export async function deleteTracked(userId: string, id: string, wholeGroup = false): Promise<number> {
  if (!/^\d+$/.test(id)) return 0;
  const rows = wholeGroup
    ? await sql`
        DELETE FROM public.nt_oi_tracked t
        WHERE t.user_id = ${userId} AND (t.id = ${id} OR t.strategy_group = (
          SELECT strategy_group FROM public.nt_oi_tracked WHERE user_id = ${userId} AND id = ${id} AND strategy_group IS NOT NULL
        ))
        RETURNING 1`
    : await sql`DELETE FROM public.nt_oi_tracked WHERE user_id = ${userId} AND id = ${id} RETURNING 1`;
  return rows.length;
}

/** Fill current price, P&L and underlying move for the user's positions. */
export async function withPerformance(positions: TrackedPosition[]): Promise<TrackedPosition[]> {
  if (positions.length === 0) return positions;
  const today = todayET();
  const live = positions.filter(p => !p.closedAt && p.expiry >= today);
  const expired = positions.filter(p => !p.closedAt && p.expiry < today);
  const underlyings = [...new Set(positions.map(p => p.underlying))];

  const [optSnaps, stockSnaps, reportCloses] = await Promise.all([
    getOptionSnapshotsMulti(live.map(p => p.contract)),
    getSnapshotsMulti(underlyings),
    sql`
      SELECT DISTINCT ON (symbol_und) symbol_und, close FROM public.us_opt_chg_rpt
      WHERE symbol_und = ANY(${underlyings}) AND load_dt >= CURRENT_DATE - 10
      ORDER BY symbol_und, load_dt DESC
    `,
  ]);
  const reportClose = new Map(reportCloses.map((r: any) => [r.symbol_und as string, Number(r.close)]));

  // Expired: intrinsic at the expiry-day underlying close, else the last option bar.
  const expiryCloses = new Map<string, number>();
  const lastBars = new Map<string, number>();
  if (expired.length) {
    const byExpiry = new Map<string, string[]>();
    for (const p of expired) (byExpiry.get(p.expiry) ?? byExpiry.set(p.expiry, []).get(p.expiry)!).push(p.underlying);
    await Promise.all([...byExpiry.entries()].map(async ([expiry, unds]) => {
      const bars = await getDailyBarsMulti([...new Set(unds)], expiry, expiry);
      for (const [u, list] of Object.entries(bars)) {
        const bar = list.find(b => b.date === expiry);
        if (bar) expiryCloses.set(`${u}|${expiry}`, bar.close);
      }
    }));
    const needBars = expired.filter(p => !expiryCloses.has(`${p.underlying}|${p.expiry}`));
    if (needBars.length) {
      const minStart = needBars.reduce((m, p) => (addDays(p.expiry, -10) < m ? addDays(p.expiry, -10) : m), today);
      const maxEnd = needBars.reduce((m, p) => (p.expiry > m ? p.expiry : m), '0000-00-00');
      const { bars } = await getOptionBarsMulti(needBars.map(p => p.contract), minStart, maxEnd);
      for (const p of needBars) {
        const list = (bars[p.contract] ?? []).filter(b => b.t.slice(0, 10) <= p.expiry);
        if (list.length) lastBars.set(p.contract, list[list.length - 1].c);
      }
    }
  }

  return positions.map(p => {
    const dir = p.side === 'BTO' ? 1 : -1;
    const snap = stockSnaps[p.underlying];
    const und = snap?.latestTrade?.p ?? snap?.dailyBar?.c ?? reportClose.get(p.underlying) ?? null;
    let price: number | null = null;
    let source: TrackedPosition['priceSource'] = null;
    if (p.closedAt) { price = p.exitPrice; source = 'exit'; }
    else if (p.expiry < today) {
      const uc = expiryCloses.get(`${p.underlying}|${p.expiry}`);
      if (uc != null) { price = Math.max(0, p.optType === 'call' ? uc - p.strike : p.strike - uc); source = 'intrinsic'; }
      else if (lastBars.has(p.contract)) { price = lastBars.get(p.contract)!; source = 'last_bar'; }
    } else {
      price = snapshotPrice(optSnaps[p.contract]);
      source = price == null ? null : 'live';
    }
    const end = p.closedAt ?? (p.expiry < today ? p.expiry : today);
    return {
      ...p,
      currentPrice: price,
      priceSource: source,
      currentUnderlying: und,
      pnl: price == null ? null : (price - p.entryPrice) * 100 * p.qty * dir,
      pnlPct: price == null || p.entryPrice === 0 ? null : ((price - p.entryPrice) / p.entryPrice) * 100 * dir,
      underlyingChgPct: und == null || !p.entryUnderlying ? null : ((und - p.entryUnderlying) / p.entryUnderlying) * 100,
      daysHeld: Math.max(0, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${p.entryDate}T00:00:00Z`)) / 86_400_000)),
      expired: p.expiry < today,
    };
  });
}

export interface PnlPoint { date: string; pnl: number; value: number }

/**
 * Daily mark-to-market P&L for a position or its strategy group, from the
 * entry date: daily option bars (completed sessions) plus today's snapshot for
 * live legs. A leg with no bar on a day carries its last known price.
 */
export async function getTrackedHistory(userId: string, id: string): Promise<{ legs: TrackedPosition[]; points: PnlPoint[] } | null> {
  const legs = await getTrackedGroup(userId, id);
  if (legs.length === 0) return null;
  const today = todayET();
  const start = legs.reduce((m, l) => (l.entryDate < m ? l.entryDate : m), legs[0].entryDate);
  const end = legs.reduce((m, l) => {
    const e = l.closedAt ?? (l.expiry < today ? l.expiry : addDays(today, -1));
    return e > m ? e : m;
  }, start);
  const { bars }: { bars: Record<string, AlpacaBar[]> } = start <= end
    ? await getOptionBarsMulti(legs.map(l => l.contract), start, end < today ? end : addDays(today, -1))
    : { bars: {} };
  const byLeg = new Map<string, Map<string, number>>();
  for (const l of legs) byLeg.set(l.contract, new Map((bars[l.contract] ?? []).map(b => [b.t.slice(0, 10), b.c])));

  const liveLegs = legs.filter(l => !l.closedAt && l.expiry >= today);
  if (liveLegs.length) {
    const snaps = await getOptionSnapshotsMulti(liveLegs.map(l => l.contract));
    for (const l of liveLegs) {
      const p = snapshotPrice(snaps[l.contract]);
      if (p != null) byLeg.get(l.contract)!.set(today, p);
    }
  }
  for (const l of legs) if (l.closedAt && l.exitPrice != null) byLeg.get(l.contract)!.set(l.closedAt, l.exitPrice);

  const dates = [...new Set([...byLeg.values()].flatMap(m => [...m.keys()]))].filter(d => d >= start).sort();
  const last = new Map<string, number>();
  const points: PnlPoint[] = [];
  for (const d of dates) {
    let pnl = 0;
    let value = 0;
    for (const l of legs) {
      if (d < l.entryDate) continue;
      const stop = l.closedAt ?? l.expiry;
      const px = d > stop ? last.get(l.contract) : byLeg.get(l.contract)!.get(d) ?? last.get(l.contract) ?? l.entryPrice;
      if (px == null) continue;
      if (d <= stop) last.set(l.contract, px);
      const dir = l.side === 'BTO' ? 1 : -1;
      pnl += (px - l.entryPrice) * 100 * l.qty * dir;
      value += px * 100 * l.qty * dir;
    }
    points.push({ date: d, pnl: Math.round(pnl * 100) / 100, value: Math.round(value * 100) / 100 });
  }
  return { legs, points };
}
