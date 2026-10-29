'use client';

import DataTable, { type Column } from '@/components/oi/DataTable';
import { ExpiryCell, TypeBadge, fmtStrike } from '@/components/oi/oiShared';
import { parseOcc } from '@/lib/occ';

/** One contract's live session volume and quote (lib/oiLive.ts `LiveOption`). */
export interface LiveOption {
  contract: string; vol: number | null; barDate: string | null; prevVol: number | null; last: number | null;
  bid: number | null; ask: number | null; iv: number | null; delta: number | null; gamma: number | null; theta: number | null;
}

const COLUMNS: Column<LiveOption>[] = [
  { key: 'contract', label: 'Contract', type: 'text', value: r => r.contract, render: r => {
    const o = parseOcc(r.contract);
    return o ? <span className="flex items-center gap-1.5"><ExpiryCell expiry={o.expiry} /><b>{fmtStrike(o.strike)}</b><TypeBadge t={o.optType} /></span> : r.contract;
  } },
  { key: 'vol', label: 'Volume', type: 'number', value: r => r.vol, render: r => <b>{(r.vol ?? 0).toLocaleString()}</b> },
  { key: 'prevVol', label: 'Prev vol', type: 'number', value: r => r.prevVol, render: r => (r.prevVol ?? 0).toLocaleString() },
  { key: 'x', label: 'Vol ×', type: 'number', value: r => (r.prevVol ? (r.vol ?? 0) / r.prevVol : null), render: r => (r.prevVol ? `${((r.vol ?? 0) / r.prevVol).toFixed(1)}×` : '—'), title: 'Latest session volume / the session before' },
  { key: 'last', label: 'Last', type: 'number', value: r => r.last, render: r => r.last?.toFixed(2) ?? '—' },
  { key: 'iv', label: 'IV', type: 'number', value: r => r.iv, render: r => (r.iv == null ? '—' : `${(r.iv * 100).toFixed(0)}%`) },
  { key: 'delta', label: 'Δ', type: 'number', value: r => r.delta, render: r => r.delta?.toFixed(2) ?? '—' },
  { key: 'barDate', label: 'Session', type: 'date', value: r => r.barDate },
];

/**
 * Contracts ranked by volume in the latest session (older bars are not ranked; lib/oiLive.ts). Used by the OI tracker's stock modal and the stock
 * page's Open Interest tab; both share the saved column choice (`oiStockLive`).
 */
export default function LiveVolumeTable({ symbol, rows, count, session, stale = 0, onOpenContract }: {
  symbol: string;
  rows: LiveOption[];
  /** Live contracts in the chain (before taking the top by volume). */
  count: number;
  /** The session ranked (latest bar date); contracts whose last trade is older are left out. */
  session?: string | null;
  /** Traded contracts left out because their last bar is from an older session. */
  stale?: number;
  onOpenContract?: (contract: string) => void;
}) {
  return (
    <DataTable tableId="oiStockLive" rows={rows} columns={COLUMNS} rowKey={r => r.contract} initialSort={{ key: 'vol', dir: 'desc' }} maxHeight="60vh"
      onRowClick={onOpenContract ? r => onOpenContract(r.contract) : undefined}
      csvName={`${symbol}-live-volume`} toolbar={<span className="text-[11px] text-gray-400" title={stale ? `${stale.toLocaleString()} contracts last traded in an earlier session and are not ranked` : undefined}>
        Top {rows.length} by volume in the {session ?? 'latest'} session, of {count.toLocaleString()} live contracts{stale ? ` (${stale.toLocaleString()} last traded earlier, not ranked)` : ''}
      </span>} />
  );
}
