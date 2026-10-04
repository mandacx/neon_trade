import Link from 'next/link';
import { formatCurrency, getLevelColor, getLevelDisplayName } from '@/lib/utils';
import { rebaseLevels, findClosestLevel } from '@/lib/calculations';
import type { LevelCalculation } from '@/types/stock';
import type { EarningsOutcome, EarningsSummary, EarningsTime } from '@/types/earnings';

// Types, helpers and table cells shared by the full Watchlists page and the
// split-pane Watchlist View.

export interface WatchlistSummary { id: string; name: string; isSystem: boolean; symbolCount: number }
export interface QuoteRow {
  symbol: string;
  name: string;
  lastPrice: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  change: number | null;
  changePercent: number | null;
  /** Present only when the viewer has the earnings feature (quotes route). */
  earnings?: EarningsSummary | null;
}
export interface LevelRow {
  symbol: string;
  expiryDate: string;
  tradeDate: string;
  levels: { name: LevelCalculation['name']; price: number }[];
  closestLevel: 'put_low' | 'put_int' | 'put_call_int' | 'call_int' | 'call_high' | null;
  closestPrice: number | null;
  distance: number | null;
  distancePercent: number | null;
  levelAccess: 'latest' | 'delayed';
  requiredFeature: string | null;
}

// The levels API always measures against the EOD close. Once a live LTP is
// available for the symbol (from the quotes route), rebase onto it so the
// "nearest level" reflects where the price actually is now — same rationale
// as the stock detail page's live rebase.
export function rebaseToLtp(level: LevelRow | undefined, livePrice: number | null | undefined): LevelRow | undefined {
  if (!level || livePrice == null || level.levels.length === 0) return level;
  const closest = findClosestLevel(rebaseLevels(level.levels, livePrice));
  return {
    ...level,
    closestLevel: closest.name as LevelRow['closestLevel'],
    closestPrice: closest.price,
    distance: closest.distance,
    distancePercent: closest.value * 100,
  };
}

export type LevelKey = 'put_low' | 'put_int' | 'put_call_int' | 'call_int' | 'call_high';
export const LEVEL_FILTER_OPTIONS: LevelKey[] = ['call_high', 'call_int', 'put_call_int', 'put_int', 'put_low'];

export function fmtExpiry(dateStr: string): string {
  try {
    return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function fmtPrice(v: number | null): string {
  return v == null ? '—' : formatCurrency(v);
}
export function fmtVolume(v: number | null): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

export function ChangeCell({ change }: { change: number | null }) {
  if (change == null) return <span className="text-xs text-gray-300">—</span>;
  const positive = change > 0;
  const negative = change < 0;
  const tone = positive ? 'bg-green-50 text-green-700' : negative ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums whitespace-nowrap ${tone}`}>
      {positive && '▲'}{negative && '▼'} {positive ? '+' : ''}{formatCurrency(change)}
    </span>
  );
}

export function ChangePercentCell({ changePercent }: { changePercent: number | null }) {
  if (changePercent == null) return <span className="text-xs text-gray-300">—</span>;
  const positive = changePercent > 0;
  const negative = changePercent < 0;
  const tone = positive ? 'bg-green-50 text-green-700' : negative ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums whitespace-nowrap ${tone}`}>
      {positive ? '+' : ''}{changePercent.toFixed(2)}%
    </span>
  );
}

export function ChangeDot({ change }: { change: number | null }) {
  const color = change == null ? 'bg-gray-300' : change > 0 ? 'bg-green-500' : change < 0 ? 'bg-red-500' : 'bg-gray-300';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />;
}

export function LevelCell({ level, compact = false }: { level: LevelRow | undefined; compact?: boolean }) {
  if (!level) return <span className="text-xs text-gray-300">—</span>;
  if (!level.closestLevel) {
    return level.levelAccess === 'delayed' ? (
      <Link
        href={`/upgrade${level.requiredFeature ? `?feature=${level.requiredFeature}` : ''}`}
        onClick={e => e.stopPropagation()}
        className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 hover:bg-amber-100"
      >
        Delayed
      </Link>
    ) : (
      <span className="text-xs text-gray-300">—</span>
    );
  }
  const color = getLevelColor(level.closestLevel);
  if (compact) {
    return (
      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
        <span
          className="inline-block text-[11px] font-bold px-1.5 py-0.5 rounded"
          style={{ backgroundColor: `${color}1A`, color }}
        >
          {getLevelDisplayName(level.closestLevel)}
        </span>
        <span className="text-[11px] text-gray-500 tabular-nums">
          {formatCurrency(level.closestPrice ?? 0)} · {level.distancePercent?.toFixed(2)}%
        </span>
      </div>
    );
  }
  return (
    <div className="text-right">
      <span
        className="inline-block text-xs font-bold px-1.5 py-0.5 rounded"
        style={{ backgroundColor: `${color}1A`, color }}
      >
        {getLevelDisplayName(level.closestLevel)}
      </span>
      <div className="text-[11px] text-gray-500 tabular-nums mt-0.5">
        {formatCurrency(level.closestPrice ?? 0)} · {level.distance?.toFixed(2)} · {level.distancePercent?.toFixed(2)}%
      </div>
      <div className="text-[10px] text-gray-400 mt-0.5">
        Exp {level.expiryDate} · Report {level.tradeDate}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Earnings (Pro feature `earnings`; data from lib/earnings.ts via the quotes
// route). Dates are US/Eastern 'YYYY-MM-DD' strings — compared and stepped as
// strings, never through local-time Date parsing.
// ---------------------------------------------------------------------------

/** Today's date in US/Eastern, 'YYYY-MM-DD'. */
export function easternToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "Oct 28" (UTC-safe). */
export function fmtShortDate(dateStr: string): string {
  try {
    return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

/** BMO = before market open, AMC = after market close. */
export function earningsTimeShort(time: EarningsTime): string {
  return time === 'pre-market' ? 'BMO' : time === 'post-market' ? 'AMC' : time === 'during-market' ? 'Intraday' : '';
}
export function earningsTimeLong(time: EarningsTime): string {
  return time === 'pre-market' ? 'before the open' : time === 'post-market' ? 'after the close' : time === 'during-market' ? 'during market hours' : 'time not announced';
}

export function daysUntilLabel(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tmrw';
  return `${days}d`;
}

export function fmtEps(v: number | null): string {
  if (v == null) return '—';
  return v < 0 ? `-$${Math.abs(v).toFixed(2)}` : `$${v.toFixed(2)}`;
}

export function fmtSales(v: number | null): string {
  if (v == null) return '—';
  return `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v)}`;
}

function nextTone(days: number): string {
  if (days <= 1) return 'bg-red-50 text-red-700';
  if (days <= 7) return 'bg-amber-50 text-amber-700';
  return 'bg-gray-100 text-gray-600';
}

/** Next earnings date. Compact: "E 25d" pill; full: date + session + countdown + estimate. */
export function NextEarningsCell({ earnings, compact = false }: { earnings: EarningsSummary | null | undefined; compact?: boolean }) {
  const next = earnings?.next;
  if (!next) {
    if (earnings?.pending) {
      return (
        <span className="text-[10px] text-gray-400 whitespace-nowrap" title={`Reported ${fmtExpiry(earnings.pending.date)} — results pending`}>
          {compact ? 'Pending' : `Reported ${fmtShortDate(earnings.pending.date)} · pending`}
        </span>
      );
    }
    return <span className="text-xs text-gray-300">—</span>;
  }
  const title = `Next earnings ${fmtExpiry(next.date)} (${earningsTimeLong(next.time)})${next.epsEstimate != null ? ` · EPS est ${fmtEps(next.epsEstimate)}` : ''}`;
  const session = earningsTimeShort(next.time);
  if (compact) {
    return (
      <span title={title} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold tabular-nums whitespace-nowrap ${nextTone(next.daysUntil)}`}>
        E {daysUntilLabel(next.daysUntil)}
      </span>
    );
  }
  return (
    <div className="text-right whitespace-nowrap" title={title}>
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold tabular-nums ${nextTone(next.daysUntil)}`}>
        {fmtShortDate(next.date)}{session && ` · ${session}`}
      </span>
      <div className="text-[10px] text-gray-400 mt-0.5 tabular-nums">
        {next.daysUntil === 0 ? 'today' : `in ${next.daysUntil}d`}{next.epsEstimate != null && ` · est ${fmtEps(next.epsEstimate)}`}
      </div>
    </div>
  );
}

const OUTCOME_TONE: Record<EarningsOutcome, string> = {
  beat: 'bg-green-50 text-green-700',
  miss: 'bg-red-50 text-red-700',
  inline: 'bg-gray-100 text-gray-600',
};
const OUTCOME_LABEL: Record<EarningsOutcome, string> = { beat: 'Beat', miss: 'Miss', inline: 'In-line' };

/** Most recent report: Beat +5.5% / Miss −3.1% / In-line, or Pending when a newer date has no result yet. */
export function LastResultBadge({ earnings }: { earnings: EarningsSummary | null | undefined }) {
  const last = earnings?.last;
  if (earnings?.pending && (!last || last.date < earnings.pending.date)) {
    return (
      <span className="inline-flex px-1.5 py-0.5 rounded text-[11px] font-semibold bg-gray-100 text-gray-500 whitespace-nowrap" title={`Reported ${fmtExpiry(earnings.pending.date)} — results pending`}>
        Pending
      </span>
    );
  }
  if (!last) return <span className="text-xs text-gray-300">—</span>;
  const outcome = last.epsOutcome;
  const pct = last.epsSurprisePct;
  const title = [
    `${last.period ?? 'Last'} reported ${fmtExpiry(last.date)}`,
    `EPS ${fmtEps(last.epsActual)}${last.epsEstimate != null ? ` vs ${fmtEps(last.epsEstimate)} est` : ''}${last.epsAdjusted ? ' (adj.)' : ''}`,
    last.salesActual != null ? `Sales ${fmtSales(last.salesActual)}${last.salesEstimate != null ? ` vs ${fmtSales(last.salesEstimate)} est` : ''}` : null,
  ].filter(Boolean).join(' · ');
  if (!outcome) {
    return <span className="text-[11px] text-gray-500 tabular-nums whitespace-nowrap" title={title}>EPS {fmtEps(last.epsActual)}</span>;
  }
  return (
    <span title={title} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold tabular-nums whitespace-nowrap ${OUTCOME_TONE[outcome]}`}>
      {OUTCOME_LABEL[outcome]}
      {outcome !== 'inline' && pct != null && <span className="font-medium">{pct > 0 ? '+' : ''}{pct.toFixed(1)}%</span>}
    </span>
  );
}

export type EarningsFilter = '' | 'today' | 'week' | '7' | '14' | '30' | 'beforeExpiry' | 'reported7';
export const EARNINGS_FILTER_OPTIONS: { value: EarningsFilter; label: string }[] = [
  { value: '', label: 'Any' },
  { value: 'today', label: 'Reporting today' },
  { value: 'week', label: 'This week' },
  { value: '7', label: 'Next 7 days' },
  { value: '14', label: 'Next 14 days' },
  { value: '30', label: 'Next 30 days' },
  { value: 'beforeExpiry', label: 'Before selected expiry' },
  { value: 'reported7', label: 'Reported last 7 days' },
];

/** Days left in the current Mon–Fri week, US/Eastern (Fri → 0; on a weekend, through next Friday). */
function daysToFriday(today: string): number {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  return dow === 6 ? 6 : dow === 0 ? 5 : 5 - dow;
}

export function earningsMatches(e: EarningsSummary | null | undefined, filter: EarningsFilter, selectedExpiry: string | null): boolean {
  if (!filter) return true;
  const today = easternToday();
  const days = e?.next?.daysUntil;
  switch (filter) {
    case 'today': return days === 0;
    case 'week': return days != null && days <= daysToFriday(today);
    case '7': return days != null && days <= 7;
    case '14': return days != null && days <= 14;
    case '30': return days != null && days <= 30;
    case 'beforeExpiry': return !!e?.next && !!selectedExpiry && e.next.date <= selectedExpiry;
    case 'reported7': {
      const latest = [e?.last?.date, e?.pending?.date].filter((d): d is string => !!d).sort().pop();
      return !!latest && daysFrom(latest, today) >= 0 && daysFrom(latest, today) <= 7;
    }
  }
}

/** Sort keys (the tables' comparators put nulls last). */
export const nextEarningsSortValue = (e: EarningsSummary | null | undefined): number | null => e?.next?.daysUntil ?? null;
export const lastResultSortValue = (e: EarningsSummary | null | undefined): number | null => e?.last?.epsSurprisePct ?? null;

