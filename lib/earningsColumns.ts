// Column registry for the earnings tracker table (app/earnings/page.tsx).
import type { ColumnMeta } from '@/lib/tableColumns';

/** Display order: the Columns menu lists them in this order and the table renders them in it. */
export const EARNINGS_COLUMNS: ColumnMeta[] = [
  { id: 'symbol', label: 'Symbol', required: true },
  { id: 'company', label: 'Company' },
  { id: 'sector', label: 'Sector' },
  { id: 'marketCap', label: 'Market cap', hint: 'Compact $ value; sortable' },
  { id: 'date', label: 'Report date' },
  { id: 'epsEst', label: 'EPS est' },
  { id: 'epsAct', label: 'EPS act' },
  { id: 'epsSurprise', label: 'EPS surprise' },
  { id: 'salesEst', label: 'Sales est' },
  { id: 'salesAct', label: 'Sales act' },
  { id: 'salesSurprise', label: 'Sales surprise' },
  { id: 'ltp', label: 'LTP' },
  { id: 'change', label: 'Chg $' },
  { id: 'changePercent', label: 'Chg %' },
  { id: 'ext', label: 'Ext. hrs', hint: 'Only appears while a report has a pre/after-hours price' },
  { id: 'reaction', label: 'Reaction' },
  { id: 'since', label: 'Since report' },
  { id: 'level', label: 'Level', hint: 'Closest level at the chosen expiry' },
];
