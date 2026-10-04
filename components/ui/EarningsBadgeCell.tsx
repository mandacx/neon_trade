import type { EarningsBadge } from '@/types/earnings';
import { fmtShortDate, earningsTimeShort, daysUntilLabel } from '@/components/watchlists/watchlistShared';

/**
 * Compact next-earnings cell for list surfaces that carry an EarningsBadge
 * (quadrant stock list, scan-alert tables, home rows). Amber when the report
 * falls on/before the row's expiry — the case that matters for its levels.
 */
export default function EarningsBadgeCell({ badge, showDate = true }: { badge: EarningsBadge | null | undefined; showDate?: boolean }) {
  if (!badge?.nextDate || badge.daysUntil == null) return <span className="text-xs text-gray-300">—</span>;
  const session = earningsTimeShort(badge.nextTime);
  const title = `Earnings ${badge.nextDate}${session ? ` (${session})` : ''}${badge.beforeExpiry ? ' — before this expiry' : ''}`;
  const tone = badge.beforeExpiry
    ? 'bg-amber-50 text-amber-800 border border-amber-300'
    : badge.daysUntil <= 7
      ? 'bg-amber-50 text-amber-700'
      : 'bg-gray-100 text-gray-600';
  return (
    <span title={title} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums whitespace-nowrap ${tone}`}>
      {badge.beforeExpiry && <span aria-hidden>⚠</span>}
      {showDate ? `${fmtShortDate(badge.nextDate)} · ${daysUntilLabel(badge.daysUntil)}` : `ER ${daysUntilLabel(badge.daysUntil)}`}
    </span>
  );
}
