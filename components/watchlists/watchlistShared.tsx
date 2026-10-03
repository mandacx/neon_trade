import Link from 'next/link';
import { formatCurrency, getLevelColor, getLevelDisplayName } from '@/lib/utils';
import { rebaseLevels, findClosestLevel } from '@/lib/calculations';
import type { LevelCalculation } from '@/types/stock';

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

