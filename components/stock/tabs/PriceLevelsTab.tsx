'use client';

import ColumnsMenu from '@/components/ui/ColumnsMenu';
import ColRow from '@/components/ui/ColRow';
import { useColumnPrefs } from '@/components/ui/useColumnPrefs';
import type { ColumnMeta } from '@/lib/tableColumns';
import { getLevelDisplayName, formatCurrency, formatPercentage } from '@/lib/utils';
import { altLevelColor } from '@/lib/levelCompare';
import { Spinner } from './shared';

// Price Levels tab of the stock page: close price, all 7 raw DB levels, OI and the
// UPC/UCPR ratio columns per date. Independently rangeable (10D default, or
// 30D/90D/Custom) rather than tied to the chart; StockAnalysis owns the fetch
// because it reuses the chart's already-loaded levels when they cover the range.

export const SEVEN_LEVEL_ORDER = ['put_low', 'put_int', 'put_call_int', 'call_int', 'call_high', 'call_low', 'put_high'];

const PRICE_HISTORY_COLUMNS: ColumnMeta[] = [
  { id: 'date', label: 'Date', required: true },
  { id: 'open', label: 'Open' },
  { id: 'high', label: 'High' },
  { id: 'low', label: 'Low' },
  { id: 'close', label: 'Close', hint: 'Close of that date (the candle close); level distances are measured against it' },
  { id: 'eodClose', label: 'EOD close', hint: 'Stored close for this load date (the previous session close)', defaultOff: true },
  ...SEVEN_LEVEL_ORDER.map(name => ({ id: name, label: getLevelDisplayName(name) })),
  { id: 'callOi', label: 'Call OI' },
  { id: 'putOi', label: 'Put OI' },
  { id: 'oiDiff', label: 'OI Diff' },
  { id: 'upc', label: 'UPC' },
  { id: 'ucpr', label: 'UCPR' },
];

export type RangePreset = '10d' | '30d' | '90d' | 'custom';
export const RANGE_PRESET_DAYS: Record<Exclude<RangePreset, 'custom'>, number> = { '10d': 10, '30d': 30, '90d': 90 };
const RANGE_PRESET_LABELS: Record<RangePreset, string> = { '10d': '10D', '30d': '30D', '90d': '90D', custom: 'Custom' };

export interface PriceHistoryRow {
  date: string;
  close: number;
  eodClose?: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  sevenLevels: Array<{ name: string; price: number; value: number }>;
  oi?: { callOi: number; putOi: number; oiDiff: number } | null;
  ratios?: { upc: number; ucpr: number };
}

export default function PriceLevelsTab({ rows, loading, selectedExpiry, preset, onPreset, customFrom, customTo, onCustomFrom, onCustomTo }: {
  /** Most recent first. */
  rows: PriceHistoryRow[];
  loading: boolean;
  selectedExpiry: string;
  preset: RangePreset;
  onPreset: (p: RangePreset) => void;
  customFrom: string;
  customTo: string;
  onCustomFrom: (d: string) => void;
  onCustomTo: (d: string) => void;
}) {
  const phCols = useColumnPrefs('stockPriceHistory', PRICE_HISTORY_COLUMNS);
  const ph = (id: string) => phCols.isShown(id);

  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h3 className="text-base font-bold">Price Levels History</h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {(['10d', '30d', '90d', 'custom'] as RangePreset[]).map(p => (
              <button
                key={p}
                onClick={() => onPreset(p)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${preset === p ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
              >
                {RANGE_PRESET_LABELS[p]}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="flex items-center gap-1.5 text-xs">
              <input type="date" value={customFrom} onChange={e => onCustomFrom(e.target.value)} className="px-2 py-1 border border-gray-200 rounded text-xs" />
              <span className="text-gray-400">to</span>
              <input type="date" value={customTo} onChange={e => onCustomTo(e.target.value)} className="px-2 py-1 border border-gray-200 rounded text-xs" />
            </div>
          )}
          {loading && <Spinner />}
          <ColumnsMenu metas={PRICE_HISTORY_COLUMNS} {...phCols.menu} />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-4 text-gray-500 text-sm">
          {loading ? 'Loading…' : `No historical level data available${selectedExpiry ? ` for expiry ${selectedExpiry}` : ''} in this range.`}
        </div>
      ) : (
        // Bounded height + internal scroll, so the range presets stay on screen and the
        // column headers stick to the top of this box.
        <div className={`overflow-auto max-h-[65vh] ${phCols.hideUntilReady}`}>
          <table className="w-full text-xs whitespace-nowrap">
            {/* bg-white on the th, and the divider as an inset shadow: preflight's border-collapse
                means collapsed borders don't travel with a sticky cell. */}
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-white [&_th]:shadow-[inset_0_-1px_0_0_#e5e7eb]">
              <ColRow layout={phCols.layout} header className="text-gray-500">
                <th data-col="date" className="sticky text-left py-1.5 pr-3 font-medium">Date</th>
                {ph('open') && (<th data-col="open" className="sticky text-right py-1.5 px-2 font-medium">Open</th>)}
                {ph('high') && (<th data-col="high" className="sticky text-right py-1.5 px-2 font-medium">High</th>)}
                {ph('low') && (<th data-col="low" className="sticky text-right py-1.5 px-2 font-medium">Low</th>)}
                {ph('close') && (<th data-col="close" className="sticky text-right py-1.5 px-2 font-medium" title="The date's own close; level distances are measured against it">Close</th>)}
                {ph('eodClose') && (<th data-col="eodClose" className="sticky text-right py-1.5 px-2 font-medium" title="Stored close for this load date (the previous session's close)">EOD close</th>)}
                {SEVEN_LEVEL_ORDER.filter(name => ph(name)).map((name) => (
                  <th key={name} data-col={name} className="sticky text-right py-1.5 px-2 font-medium">{getLevelDisplayName(name)}</th>
                ))}
                {ph('callOi') && (<th data-col="callOi" className="sticky text-right py-1.5 px-2 font-medium" title="Open interest: call contracts open at the end of the day">Call OI</th>)}
                {ph('putOi') && (<th data-col="putOi" className="sticky text-right py-1.5 px-2 font-medium" title="Open interest: put contracts open at the end of the day">Put OI</th>)}
                {ph('oiDiff') && (<th data-col="oiDiff" className="sticky text-right py-1.5 px-2 font-medium" title="Put OI minus call OI">OI Diff</th>)}
                {ph('upc') && (<th data-col="upc" className="sticky text-right py-1.5 pl-2 font-medium">UPC</th>)}
                {ph('ucpr') && (<th data-col="ucpr" className="sticky text-right py-1.5 pl-2 font-medium">UCPR</th>)}
              </ColRow>
            </thead>
            <tbody>
              {rows.map((row) => {
                const closest = row.sevenLevels.length > 0
                  ? row.sevenLevels.reduce((c, l) => Math.abs(l.value) < Math.abs(c.value) ? l : c)
                  : null;
                const levelsByName = new Map(row.sevenLevels.map(l => [l.name, l]));
                // Put High / Call Low text: red when Put/Call Int is above both, green when below both.
                const altTone = altLevelColor(levelsByName.get('put_call_int')?.price ?? 0, levelsByName.get('put_high')?.price ?? 0, levelsByName.get('call_low')?.price ?? 0);
                return (
                  <ColRow layout={phCols.layout} key={row.date} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td data-col="date" className="py-1.5 pr-3 text-gray-600">{row.date}</td>
                    {ph('open') && (<td data-col="open" className="text-right py-1.5 px-2 text-gray-600">{row.open != null ? formatCurrency(row.open) : '—'}</td>)}
                    {ph('high') && (<td data-col="high" className="text-right py-1.5 px-2 text-gray-600">{row.high != null ? formatCurrency(row.high) : '—'}</td>)}
                    {ph('low') && (<td data-col="low" className="text-right py-1.5 px-2 text-gray-600">{row.low != null ? formatCurrency(row.low) : '—'}</td>)}
                    {ph('close') && (<td data-col="close" className="text-right py-1.5 px-2 font-semibold">{formatCurrency(row.close)}</td>)}
                    {ph('eodClose') && (<td data-col="eodClose" className="text-right py-1.5 px-2 text-gray-400">{row.eodClose != null ? formatCurrency(row.eodClose) : '—'}</td>)}
                    {SEVEN_LEVEL_ORDER.filter(name => ph(name)).map((name) => {
                      const lvl = levelsByName.get(name);
                      const isClosest = !!closest && lvl && closest.name === lvl.name;
                      const tone = (name === 'put_high' || name === 'call_low') && lvl ? altTone : null;
                      return (
                        <td key={name} data-col={name} style={tone ? { color: tone } : undefined} className={`text-right py-1.5 px-2 font-mono ${isClosest ? `bg-blue-50 ${tone ? '' : 'text-blue-700'} font-bold rounded` : ''}`}>
                          {lvl ? formatCurrency(lvl.price) : '—'}
                          {lvl && <span className={`ml-1 ${tone ? '' : isClosest ? 'text-blue-500' : 'text-gray-400'}`}>({formatPercentage(lvl.value)})</span>}
                        </td>
                      );
                    })}
                    {ph('callOi') && (<td data-col="callOi" className="text-right py-1.5 px-2 text-gray-600">{row.oi?.callOi?.toLocaleString() ?? '—'}</td>)}
                    {ph('putOi') && (<td data-col="putOi" className="text-right py-1.5 px-2 text-gray-600">{row.oi?.putOi?.toLocaleString() ?? '—'}</td>)}
                    {ph('oiDiff') && (<td data-col="oiDiff" className="text-right py-1.5 px-2 text-gray-600">{row.oi?.oiDiff?.toLocaleString() ?? '—'}</td>)}
                    {ph('upc') && (<td data-col="upc" className="text-right py-1.5 pl-2 text-gray-600">{row.ratios?.upc ?? '—'}</td>)}
                    {ph('ucpr') && (<td data-col="ucpr" className="text-right py-1.5 pl-2 text-gray-600">{row.ratios?.ucpr ?? '—'}</td>)}
                  </ColRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
