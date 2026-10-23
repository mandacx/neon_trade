import type { ExtendedQuote } from '@/lib/quote';
import { formatCurrency } from '@/lib/utils';

/** "4:27 PM ET" for an ISO instant. */
export function fmtEtTime(iso: string): string {
  try {
    return `${new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET`;
  } catch {
    return '';
  }
}

const sign = (v: number) => (v >= 0 ? '+' : '−');

/**
 * Pre-market / after-hours move, measured from the regular-session close (lib/quote.ts
 * decides when it exists). `full` is the stock-page header form; the default is a
 * compact pill for tables. The feed sees only part of extended-hours volume, so the print
 * is the last trade it saw, not a consolidated quote — the tooltip says so.
 */
export default function ExtendedMove({ ext, full = false }: { ext: ExtendedQuote | null | undefined; full?: boolean }) {
  if (!ext) return null;
  const tone = ext.change > 0 ? 'text-green-600' : ext.change < 0 ? 'text-red-600' : 'text-gray-500';
  const pctText = ext.changePercent == null ? '' : `${sign(ext.changePercent)}${Math.abs(ext.changePercent).toFixed(2)}%`;
  const title = `${ext.label}: ${formatCurrency(ext.price)} (${sign(ext.change)}${formatCurrency(Math.abs(ext.change))}${pctText ? `, ${pctText}` : ''}) vs the regular-session close · last trade seen ${fmtEtTime(ext.at)}`;

  if (full) {
    return (
      <span className="inline-flex items-baseline gap-1.5 text-xs" title={title}>
        <span className="font-semibold text-gray-500">{ext.label}</span>
        <span className="font-semibold text-gray-700 tabular-nums">{formatCurrency(ext.price)}</span>
        <span className={`font-bold tabular-nums ${tone}`}>
          {sign(ext.change)}{formatCurrency(Math.abs(ext.change))}{pctText && ` (${pctText})`}
        </span>
        <span className="text-[10px] text-gray-400">{fmtEtTime(ext.at)}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-semibold whitespace-nowrap tabular-nums" title={title}>
      <span className="text-slate-500">{ext.label === 'After hours' ? 'AH' : 'Pre'}</span>
      <span className={tone}>{pctText || sign(ext.change) + formatCurrency(Math.abs(ext.change))}</span>
    </span>
  );
}
