'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import { fmtCount, fmtMoneyCompact, fmtSigned } from '@/lib/format';
import { expiryKind } from '@/lib/oiStrategies';
import type { OptType, SideHint, StrategyCandidate } from '@/types/oiTracker';

export const inputClass = 'px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white';
export const labelClass = 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="p-8 text-center text-sm text-gray-400">
      <div className="inline-block animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full mr-2 align-middle" />
      {label ?? 'Loading…'}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-lg">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)}
          className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${value === v ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-11-20 -> "Nov 20 '26" (string-based; never parsed in local time). */
export function fmtExp(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(day)} '${y.slice(2)}`;
}

const KIND_STYLE = { weekly: 'text-gray-500', monthly: 'text-sky-700', quarterly: 'text-violet-700' } as const;
export function ExpiryCell({ expiry, dte }: { expiry: string; dte?: number }) {
  const k = expiryKind(expiry);
  return (
    <span className="whitespace-nowrap" title={`${k} expiry`}>
      <span className={`font-semibold ${KIND_STYLE[k]}`}>{fmtExp(expiry)}</span>
      {dte != null && <span className="ml-1 text-[10px] text-gray-400">{dte}d</span>}
    </span>
  );
}

export const fmtStrike = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2).replace(/0+$/, ''));

export function TypeBadge({ t }: { t: OptType }) {
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${t === 'call' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{t}</span>;
}

export const tone = (v: number | null | undefined) => (v == null ? 'text-gray-700' : v > 0 ? 'text-green-700' : v < 0 ? 'text-red-700' : 'text-gray-700');

export function SignedCount({ v }: { v: number | null }) {
  return <span className={`font-semibold ${tone(v)}`}>{fmtSigned(v)}</span>;
}

export function Money({ v, signed = true }: { v: number | null; signed?: boolean }) {
  return <span className={signed ? tone(v) : 'text-gray-800'}>{fmtMoneyCompact(v)}</span>;
}

export function HintBadge({ hint }: { hint: SideHint | null }) {
  if (!hint || !hint.side) return <span className="text-[10px] text-gray-300" title={hint?.reason}>—</span>;
  return (
    <span title={hint.reason}
      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${hint.side === 'BTO' ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>
      {hint.side}?
    </span>
  );
}

export function VolToChg({ v }: { v: number | null }) {
  if (v == null) return <span className="text-gray-300">—</span>;
  const cls = v < 1.15 ? 'text-emerald-700 font-semibold' : v > 3 ? 'text-amber-700' : 'text-gray-700';
  return <span className={cls} title={v < 1.15 ? 'Volume ≈ OI change: the session was mostly this opening/closing flow' : v > 3 ? 'Volume far above OI change: much of it was intraday churn' : undefined}>{v.toFixed(2)}×</span>;
}

// ---------------------------------------------------------------------------
// Tracking form
// ---------------------------------------------------------------------------

export interface TrackLegInput {
  underlying: string;
  contract: string;
  optType: OptType;
  strike: number;
  expiry: string;
  oiChg?: number;
  ltp?: number;
  hint?: SideHint | null;
}

export function TrackForm({ legs, label, onClose, onDone }: { legs: TrackLegInput[]; label?: string; onClose: () => void; onDone?: () => void }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const [rows, setRows] = useState(() => legs.map(l => ({ ...l, side: (l.hint?.side ?? 'BTO') as 'BTO' | 'STO', qty: '1', entryPrice: '' })));
  const [entryDate, setEntryDate] = useState(today);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/oi-tracker/tracked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryDate, note: note || null, strategyLabel: label ?? null,
          legs: rows.map(r => ({ underlying: r.underlying, contract: r.contract, side: r.side, qty: Number(r.qty), entryPrice: r.entryPrice === '' ? null : Number(r.entryPrice) })),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Could not save');
      setDone(true);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={legs.length > 1 ? `Track strategy${label ? `: ${label}` : ''}` : `Track ${legs[0].contract}`} onClose={onClose} widthClassName="max-w-2xl">
      {done ? (
        <div className="text-center py-6">
          <div className="text-sm font-semibold text-green-700 mb-1">Added to your tracked positions.</div>
          <div className="text-xs text-gray-500 mb-4">Only you can see them. Open the &quot;My tracked&quot; tab to follow P&amp;L.</div>
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold">Close</button>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.contract} className="border border-gray-100 rounded-lg p-3">
              <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                <span className="font-bold text-gray-900">{r.underlying}</span>
                <ExpiryCell expiry={r.expiry} />
                <span className="font-semibold tabular-nums">{fmtStrike(r.strike)}</span>
                <TypeBadge t={r.optType} />
                <span className="text-gray-400 font-mono text-[10px]">{r.contract}</span>
                {r.oiChg != null && <span className="text-gray-500">OI chg <SignedCount v={r.oiChg} /></span>}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className={labelClass}>Side</label>
                  <Segmented value={r.side} options={[['BTO', 'Buy to open'], ['STO', 'Sell to open']]}
                    onChange={v => setRows(rs => rs.map((x, j) => (j === i ? { ...x, side: v } : x)))} />
                </div>
                <div>
                  <label className={labelClass}>Contracts</label>
                  <input type="number" min={1} value={r.qty} onChange={e => setRows(rs => rs.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className={`${inputClass} w-24`} />
                </div>
                <div>
                  <label className={labelClass}>Entry price</label>
                  <input type="number" step="0.01" min={0} value={r.entryPrice} placeholder="auto"
                    onChange={e => setRows(rs => rs.map((x, j) => (j === i ? { ...x, entryPrice: e.target.value } : x)))} className={`${inputClass} w-28`} />
                </div>
              </div>
              {r.hint && <p className="text-[11px] text-gray-500 mt-2">Hint: {r.hint.reason}</p>}
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={labelClass}>Entry date</label>
              <input type="date" value={entryDate} max={today} onChange={e => setEntryDate(e.target.value)} className={inputClass} />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className={labelClass}>Note (optional)</label>
              <input value={note} maxLength={500} onChange={e => setNote(e.target.value)} className={`${inputClass} w-full`} placeholder="Why you're tracking it" />
            </div>
          </div>
          <p className="text-[11px] text-gray-400">
            Leave the entry price empty to use the contract&apos;s price on the entry date (live mid today, that day&apos;s close for past dates).
            Tracked positions are private to your account.
          </p>
          {error && <div className="text-xs text-red-600">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100">Cancel</button>
            <button onClick={submit} disabled={saving || rows.some(r => !(Number(r.qty) >= 1))}
              className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-50">
              {saving ? 'Saving…' : 'Track'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Strategy candidates
// ---------------------------------------------------------------------------

const STATUS_STYLE = { opened: 'bg-green-50 text-green-700', closed: 'bg-red-50 text-red-700', rolled: 'bg-amber-50 text-amber-700' } as const;

export function StrategyList({ candidates, onOpenStock, onTrack, showUnderlying = true }: {
  candidates: StrategyCandidate[];
  onOpenStock?: (symbol: string) => void;
  onTrack: (c: StrategyCandidate) => void;
  showUnderlying?: boolean;
}) {
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const kinds = [...new Set(candidates.map(c => c.kind))].sort();
  const shown = candidates.filter(c => (!kind || c.kind === kind) && (!q || `${c.underlying} ${c.label}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-100">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search symbol or pattern…" className={`${inputClass} w-52`} />
        <select value={kind} onChange={e => setKind(e.target.value)} className={inputClass}>
          <option value="">All patterns</option>
          {kinds.map(k => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
        </select>
        <span className="ml-auto text-[11px] text-gray-400">{shown.length} of {candidates.length}</span>
      </div>
      {shown.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400">No matching legs within the tolerance.</div>
      ) : (
        <div className="divide-y divide-gray-50 max-h-[70vh] overflow-auto">
          {shown.slice(0, 300).map(c => (
            <div key={c.id} className="px-3 py-2.5 hover:bg-gray-50/60">
              <div className="flex flex-wrap items-center gap-2">
                {showUnderlying && (
                  <button onClick={() => onOpenStock?.(c.underlying)} className="font-bold text-sm text-gray-900 hover:text-blue-600">{c.underlying}</button>
                )}
                <span className="text-xs font-semibold text-gray-800">{c.label}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${STATUS_STYLE[c.status]}`}>{c.status}</span>
                <span className="text-[11px] text-gray-500">qty diff <b className="tabular-nums">{c.qtyDiffPct.toFixed(2)}%</b></span>
                <span className="text-[11px] text-gray-500">{fmtMoneyCompact(c.totalValue)}</span>
                <span className="text-[11px] text-gray-400" title="0–1: closeness of quantities (60%) and leg size (40%)">conf {c.confidence.toFixed(2)}</span>
                <span className="text-[11px] text-gray-400">{c.loadDate}</span>
                <button onClick={() => onTrack(c)} className="ml-auto text-[11px] font-semibold text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-2 py-0.5">Track</button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {c.legs.map(l => (
                  <span key={l.contract} className="inline-flex items-center gap-1 text-[11px] bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">
                    <ExpiryCell expiry={l.expiry} />
                    <span className="font-semibold tabular-nums">{fmtStrike(l.strike)}</span>
                    <TypeBadge t={l.optType} />
                    <SignedCount v={l.oiChg} />
                    {l.vol != null && <span className="text-gray-400">vol {fmtCount(l.vol)}</span>}
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">{c.note}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function strategyToLegs(c: StrategyCandidate): TrackLegInput[] {
  return c.legs.map(l => ({ underlying: c.underlying, contract: l.contract, optType: l.optType, strike: l.strike, expiry: l.expiry, oiChg: l.oiChg, ltp: l.ltp }));
}
