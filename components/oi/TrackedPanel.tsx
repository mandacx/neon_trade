'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Modal from '@/components/ui/Modal';
import DataTable, { type Column } from '@/components/oi/DataTable';
import { ExpiryCell, Money, Segmented, Spinner, TypeBadge, fmtStrike, tone } from '@/components/oi/oiShared';
import { fmtMoneyCompact } from '@/lib/format';
import type { TrackedPosition } from '@/types/oiTracker';

type Status = 'open' | 'closed' | 'all';

function HistoryModal({ position, onClose }: { position: TrackedPosition; onClose: () => void }) {
  const [points, setPoints] = useState<Array<{ date: string; pnl: number }> | null>(null);
  const [legs, setLegs] = useState<TrackedPosition[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/oi-tracker/tracked/${position.id}/history`)
      .then(r => r.json())
      .then(j => { if (j.success) { setPoints(j.data.points); setLegs(j.data.legs); } else setError(j.error || 'Failed to load'); })
      .catch(() => setError('Failed to load'));
  }, [position.id]);
  const title = position.strategyLabel ?? `${position.side} ${position.qty} × ${position.contract}`;
  return (
    <Modal title={`P&L since entry · ${title}`} onClose={onClose} widthClassName="max-w-3xl">
      {error ? <div className="text-sm text-red-600">{error}</div> : !points ? <Spinner /> : points.length === 0 ? (
        <div className="text-sm text-gray-400 p-6 text-center">No price history yet.</div>
      ) : (
        <>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtMoneyCompact(v, 1)} />
                <Tooltip formatter={(v: number) => fmtMoneyCompact(v)} />
                <ReferenceLine y={0} stroke="#9ca3af" />
                <Line type="monotone" dataKey="pnl" name="P&L" stroke="#2563eb" dot={points.length < 40} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[11px] text-gray-500 mt-2 space-y-0.5">
            {legs.map(l => <div key={l.id}>{l.side} {l.qty} × {l.contract} @ {l.entryPrice.toFixed(2)} on {l.entryDate}{l.closedAt ? ` · closed ${l.closedAt} @ ${l.exitPrice?.toFixed(2)}` : ''}</div>)}
            <div className="text-gray-400">Daily closes of each contract (completed sessions) plus today&apos;s live mid; a day without a trade carries the last price.</div>
          </div>
        </>
      )}
    </Modal>
  );
}

export default function TrackedPanel({ refreshKey, onOpenStock }: { refreshKey: number; onOpenStock: (symbol: string) => void }) {
  const [positions, setPositions] = useState<TrackedPosition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('open');
  const [history, setHistory] = useState<TrackedPosition | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetch('/api/oi-tracker/tracked')
      .then(r => r.json())
      .then(j => { if (j.success) setPositions(j.data.positions); else setError(j.error || 'Failed to load'); })
      .catch(() => setError('Failed to load'));
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  async function act(p: TrackedPosition, action: 'close' | 'reopen' | 'delete') {
    if (action === 'delete' && !confirm(p.strategyGroup ? 'Delete this leg? (Use "Delete group" to remove every leg.)' : 'Delete this tracked position?')) return;
    setBusy(p.id);
    try {
      const res = action === 'delete'
        ? await fetch(`/api/oi-tracker/tracked/${p.id}`, { method: 'DELETE' })
        : await fetch(`/api/oi-tracker/tracked/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'close' ? { close: {} } : { reopen: true }) });
      const j = await res.json();
      if (!j.success) alert(j.error || 'Failed');
      load();
    } finally {
      setBusy(null);
    }
  }

  async function deleteGroup(p: TrackedPosition) {
    if (!confirm(`Delete all legs of "${p.strategyLabel ?? 'this strategy'}"?`)) return;
    await fetch(`/api/oi-tracker/tracked/${p.id}?group=1`, { method: 'DELETE' });
    load();
  }

  const shown = useMemo(() => (positions ?? []).filter(p => status === 'all' || (status === 'open' ? !p.closedAt : !!p.closedAt)), [positions, status]);
  const totals = useMemo(() => {
    const open = (positions ?? []).filter(p => !p.closedAt);
    const closed = (positions ?? []).filter(p => p.closedAt);
    const sum = (xs: TrackedPosition[]) => xs.reduce((s, p) => s + (p.pnl ?? 0), 0);
    return { open: open.length, closed: closed.length, openPnl: sum(open), closedPnl: sum(closed) };
  }, [positions]);

  const cols: Column<TrackedPosition>[] = [
    { key: 'underlying', label: 'Symbol', type: 'text', value: p => p.underlying, render: p => (
      <button onClick={e => { e.stopPropagation(); onOpenStock(p.underlying); }} className="font-bold text-gray-900 hover:text-blue-600">{p.underlying}</button>
    ) },
    { key: 'strategy', label: 'Strategy', type: 'text', value: p => p.strategyLabel ?? '', render: p => (p.strategyLabel ? <span className="text-[11px] text-gray-600 max-w-[180px] truncate inline-block align-middle" title={p.strategyLabel}>{p.strategyLabel}</span> : <span className="text-gray-300">—</span>) },
    { key: 'expiry', label: 'Expiry', type: 'date', value: p => p.expiry, render: p => <ExpiryCell expiry={p.expiry} /> },
    { key: 'strike', label: 'Strike', type: 'number', value: p => p.strike, render: p => <b>{fmtStrike(p.strike)}</b> },
    { key: 'type', label: 'Type', type: 'text', value: p => p.optType, render: p => <TypeBadge t={p.optType} /> },
    { key: 'side', label: 'Side', type: 'text', value: p => p.side, render: p => <span className={`text-[11px] font-bold ${p.side === 'BTO' ? 'text-emerald-700' : 'text-orange-700'}`}>{p.side}</span> },
    { key: 'qty', label: 'Qty', type: 'number', value: p => p.qty },
    { key: 'entryDate', label: 'Entry date', type: 'date', value: p => p.entryDate },
    { key: 'entry', label: 'Entry', type: 'number', value: p => p.entryPrice, render: p => p.entryPrice.toFixed(2) },
    { key: 'current', label: 'Current', type: 'number', value: p => p.currentPrice, render: p => (
      <span title={p.priceSource ? { live: 'Live mid (bid/ask)', last_bar: 'Last daily close before expiry', intrinsic: 'Intrinsic value at expiry close', exit: 'Your exit price' }[p.priceSource] : 'No price'}>
        {p.currentPrice?.toFixed(2) ?? '—'}{p.priceSource && p.priceSource !== 'live' && <span className="text-[9px] text-gray-400 ml-0.5">{p.priceSource === 'exit' ? 'exit' : p.priceSource === 'intrinsic' ? 'intr' : 'last'}</span>}
      </span>
    ) },
    { key: 'pnl', label: 'P&L $', type: 'number', value: p => p.pnl, render: p => <span className="font-semibold"><Money v={p.pnl} /></span> },
    { key: 'pnlPct', label: 'P&L %', type: 'number', value: p => p.pnlPct, render: p => <span className={tone(p.pnlPct)}>{p.pnlPct == null ? '—' : `${p.pnlPct > 0 ? '+' : ''}${p.pnlPct.toFixed(1)}%`}</span> },
    { key: 'und', label: 'Underlying', type: 'number', value: p => p.underlyingChgPct, render: p => (
      <span title={p.entryUnderlying != null ? `${p.entryUnderlying.toFixed(2)} → ${p.currentUnderlying?.toFixed(2) ?? '—'}` : undefined} className={tone(p.underlyingChgPct)}>
        {p.underlyingChgPct == null ? '—' : `${p.underlyingChgPct > 0 ? '+' : ''}${p.underlyingChgPct.toFixed(2)}%`}
      </span>
    ), title: 'Underlying move since entry' },
    { key: 'days', label: 'Days', type: 'number', value: p => p.daysHeld },
    { key: 'status', label: 'Status', type: 'text', value: p => (p.closedAt ? 'closed' : p.expired ? 'expired' : 'open'), render: p => (
      <span className={`text-[10px] font-bold uppercase ${p.closedAt ? 'text-gray-500' : p.expired ? 'text-amber-700' : 'text-blue-700'}`}>{p.closedAt ? `closed ${p.closedAt}` : p.expired ? 'expired' : 'open'}</span>
    ) },
    { key: 'note', label: 'Note', type: 'text', value: p => p.note ?? '', render: p => <span className="text-[11px] text-gray-500 max-w-[160px] truncate inline-block align-middle" title={p.note ?? ''}>{p.note ?? ''}</span> },
    { key: 'act', label: '', type: 'text', value: () => null, sortable: false, filterable: false, render: p => (
      <span className="flex gap-2 text-[11px] font-semibold" onClick={e => e.stopPropagation()}>
        <button onClick={() => setHistory(p)} className="text-blue-600 hover:text-blue-800">Chart</button>
        {p.closedAt
          ? <button disabled={busy === p.id} onClick={() => act(p, 'reopen')} className="text-gray-600 hover:text-gray-900">Reopen</button>
          : <button disabled={busy === p.id} onClick={() => act(p, 'close')} className="text-gray-600 hover:text-gray-900" title="Close at today's price">Close</button>}
        <button disabled={busy === p.id} onClick={() => act(p, 'delete')} className="text-red-600 hover:text-red-800">Delete</button>
        {p.strategyGroup && <button onClick={() => deleteGroup(p)} className="text-red-400 hover:text-red-700">Delete group</button>}
      </span>
    ) },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 px-3 py-2 border-b border-gray-100">
        <Segmented<Status> value={status} onChange={setStatus} options={[['open', `Open (${totals.open})`], ['closed', `Closed (${totals.closed})`], ['all', 'All']]} />
        <span className="text-xs text-gray-600">Open P&amp;L <b className={tone(totals.openPnl)}>{fmtMoneyCompact(totals.openPnl)}</b></span>
        <span className="text-xs text-gray-600">Realised P&amp;L <b className={tone(totals.closedPnl)}>{fmtMoneyCompact(totals.closedPnl)}</b></span>
        <span className="text-[11px] text-gray-400 ml-auto">Private to your account. P&amp;L = (current − entry) × 100 × qty, reversed for sell-to-open.</span>
      </div>
      {error ? <div className="p-8 text-center text-sm text-red-600">{error}</div> : !positions ? <Spinner label="Loading your positions and live prices…" /> : (
        <DataTable rows={shown} columns={cols} rowKey={p => p.id} initialSort={{ key: 'entryDate', dir: 'desc' }} csvName="tracked-options"
          onRowClick={p => setHistory(p)} emptyText={status === 'open' ? 'No open positions. Use "Track" on any contract or strategy.' : 'Nothing here yet.'} />
      )}
      {history && <HistoryModal position={history} onClose={() => setHistory(null)} />}
    </div>
  );
}
