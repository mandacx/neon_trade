// Shared types and ids for user-selectable table columns. Dependency-free: the
// server (lib/userPrefs.ts, validating saved preferences) and the client
// (components/ui/useColumnPrefs.ts) both import it.
//
// What is stored per user and table is the list of HIDDEN column ids under the
// key `cols.<tableId>`. Storing the hidden set (not the visible one) means a column
// added to a table later shows up by default, and columns that only appear
// sometimes (after-hours, feature-gated) don't need special handling.

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
