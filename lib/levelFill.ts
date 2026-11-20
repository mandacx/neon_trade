// Carry-forward of price levels the loader failed to calculate. Pure (no app imports) so scripts can import it.
//
// The loader stores a failed calculation as NULL (read as 0 by the db layer) in some levels. Two shapes seen in
// eod_usmkts_price (2026-11-20 check: 100-390 of ~8,000 rows per load date):
//   - the outer levels (put_low, call_high) and the extended ones (call_low, put_high) are empty and the three
//     middle levels (put_int, comb_int, call_int) collapse to one placeholder strike, e.g. SOXL 2026-11-18 expiry
//     2026-12-18: 425.00 / 425.00 / 425.00 with the close at 49.07 (a real day has 54.8 / 64.8 / 95.5);
//   - one or more individual levels are 0 while the rest are normal.
// Rule (the product owner's): a level that has no value is ignored and the previous day's level continues. A row whose
// middle levels are unusable is a failed calculation as a whole, so all seven levels continue from the previous good
// row (a placeholder like 425 is not 0 and would otherwise be plotted). Never invents data: with no earlier good row
// the row is left as it is.

export interface LevelFields {
  put_LOW: number;
  PUT_INT: number;
  PUT_CALL_INT: number;
  CALL_INT: number;
  call_HIGH: number;
  call_low: number;
  put_HIGH: number;
}

export const LEVEL_KEYS = ['put_LOW', 'PUT_INT', 'PUT_CALL_INT', 'CALL_INT', 'call_HIGH', 'call_low', 'put_HIGH'] as const;
type LevelKey = (typeof LEVEL_KEYS)[number];

export interface LevelRow extends LevelFields {
  EXPIRY_DT: string;
  TRADE_DATE: string;
}

/** A level carries a value only when it is a positive number (0 / null / NaN all mean "no data"). */
const has = (v: unknown): boolean => Number(v) > 0;

/** True when the row's levels are not a usable calculation (see the header). */
export function isFailedLevelRow(r: LevelFields): boolean {
  const inner = [r.PUT_INT, r.PUT_CALL_INT, r.CALL_INT];
  if (!inner.every(has)) return true;
  const collapsed = Number(r.PUT_INT) === Number(r.PUT_CALL_INT) && Number(r.PUT_CALL_INT) === Number(r.CALL_INT);
  return collapsed && (!has(r.put_LOW) || !has(r.call_HIGH));
}

/** True when the row is usable but still has at least one empty level (fill those one by one). */
export function hasEmptyLevel(r: LevelFields): boolean {
  return LEVEL_KEYS.some(k => !has(r[k]));
}

/** Whether a row needs anything from an earlier day. */
export function needsFill(r: LevelFields): boolean {
  return isFailedLevelRow(r) || hasEmptyLevel(r);
}

type Last = { levels: LevelFields; from: string };

/**
 * Fills a list of rows in ascending trade-date order, tracking each expiry on its own (`seeds` = the latest good row
 * before the first one, per expiry). Returns new rows, same order, each with `carriedFrom`: the trade date the values
 * were taken from, or null when the row is untouched.
 */
export function fillLevelRows<T extends LevelRow>(rows: T[], seeds: Map<string, LevelRow> = new Map()): Array<T & { carriedFrom: string | null }> {
  const last = new Map<string, Last>();
  for (const [expiry, s] of seeds) {
    if (!isFailedLevelRow(s)) last.set(expiry, { levels: pick(s), from: s.TRADE_DATE });
  }
  return rows.map(row => {
    const prev = last.get(row.EXPIRY_DT);
    let out: T & { carriedFrom: string | null } = { ...row, carriedFrom: null };
    if (prev && needsFill(row)) {
      if (isFailedLevelRow(row)) {
        out = { ...row, ...prev.levels, carriedFrom: prev.from };
      } else {
        const patch: Partial<LevelFields> = {};
        for (const k of LEVEL_KEYS) if (!has(row[k]) && has(prev.levels[k])) patch[k] = prev.levels[k];
        if (Object.keys(patch).length) out = { ...row, ...patch, carriedFrom: prev.from };
      }
    }
    if (!isFailedLevelRow(out)) last.set(row.EXPIRY_DT, { levels: pick(out), from: out.carriedFrom ?? row.TRADE_DATE });
    return out;
  });
}

function pick(r: LevelFields): LevelFields {
  const o = {} as Record<LevelKey, number>;
  for (const k of LEVEL_KEYS) o[k] = Number(r[k]) || 0;
  return o;
}
