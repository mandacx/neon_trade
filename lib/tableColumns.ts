// Shared types and ids for user-selectable table columns. Dependency-free: the
// server (lib/userPrefs.ts, validating saved preferences) and the client
// (components/ui/useColumnPrefs.ts) both import it.
//
// What is stored per user and table, under the key `cols.<tableId>`, is a
// ColumnPrefs: the HIDDEN column ids, the column ORDER and any resized WIDTHS.
// Storing the hidden set (not the visible one) means a column added to a table
// later shows up by default, and columns that only appear sometimes (after-hours,
// feature-gated) don't need special handling. Ids missing from `order` follow the
// saved ones in the table's own order. Older saves are a bare list of hidden ids.

export interface ColumnMeta {
  id: string;
  /** Name in the Columns menu. */
  label: string;
  /** Short note under the name in the menu. */
  hint?: string;
  /** Can't be hidden (the row's link / identity). */
  required?: boolean;
  /** Hidden until the user turns it on (and for users with no saved choice). */
  defaultOff?: boolean;
}

/** Every table that has a Columns menu. The preferences API only accepts these. */
export const TABLE_IDS = [
  'earnings',
  'watchlists',
  'watchlistChart',
  'scanLatest',
  'scanHistorical',
  'quadrant',
  'performance',
  'performanceSymbol',
  'stockEarnings',
  'stockPriceHistory',
  'stockOptionChain',
  'oiFlowContract',
  'oiFlowUnderlying',
  'oiFlowExpiry',
  'oiFlowStrike',
  'oiFlowDate',
  'oiTracked',
  'oiStockContracts',
  'oiStockExpiries',
  'oiStockLive',
] as const;

export type TableId = (typeof TABLE_IDS)[number];

export const columnsPrefKey = (tableId: string) => `cols.${tableId}`;

/** A column id as it may appear in a saved list. */
export const COLUMN_ID_RE = /^[A-Za-z0-9_.-]{1,40}$/;
export const MAX_SAVED_COLUMNS = 60;

/** The ids hidden for a user with no saved choice. */
export const defaultHidden = (metas: ColumnMeta[]): string[] => metas.filter(c => c.defaultOff && !c.required).map(c => c.id);

export const MIN_COL_WIDTH = 40;
export const MAX_COL_WIDTH = 1200;

export interface ColumnPrefs {
  hidden: string[];
  /** Column ids in the user's order (may omit columns added later). */
  order: string[];
  /** Resized widths in px, by column id. */
  widths: Record<string, number>;
}

const validIds = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length <= MAX_SAVED_COLUMNS && v.every(x => typeof x === 'string' && COLUMN_ID_RE.test(x))
    ? [...new Set(v as string[])]
    : null;

/** A saved value (current object form or the older hidden-ids list) as ColumnPrefs, or null when malformed. */
export function normalizeColumnPrefs(v: unknown): ColumnPrefs | null {
  if (Array.isArray(v)) {
    const hidden = validIds(v);
    return hidden ? { hidden, order: [], widths: {} } : null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as { hidden?: unknown; order?: unknown; widths?: unknown };
  const hidden = validIds(o.hidden ?? []);
  const order = validIds(o.order ?? []);
  if (!hidden || !order) return null;
  const widths: Record<string, number> = {};
  if (o.widths != null) {
    if (typeof o.widths !== 'object' || Array.isArray(o.widths)) return null;
    const entries = Object.entries(o.widths as Record<string, unknown>);
    if (entries.length > MAX_SAVED_COLUMNS) return null;
    for (const [id, w] of entries) {
      if (!COLUMN_ID_RE.test(id) || typeof w !== 'number' || !Number.isFinite(w)) return null;
      widths[id] = Math.round(Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, w)));
    }
  }
  return { hidden, order, widths };
}

/** Saved order first (only ids that still exist), then the remaining ids in the table's own order. */
export const resolveOrder = (ids: string[], saved: string[]): string[] => {
  const known = new Set(ids);
  const head = saved.filter(id => known.has(id));
  const seen = new Set(head);
  return [...head, ...ids.filter(id => !seen.has(id))];
};
