'use client';

import { useCallback, useEffect, useState } from 'react';

interface Req { id: number; symbol: string; requesterEmail: string | null; requestedAt: string; note: string | null; status: string; decidedAt: string | null; decisionNote: string | null }
interface Tracked { symbol: string; companyName: string | null; strikeSize: number | null; active: boolean; deletedAt: string | null; updatedAt: string }
interface Data { pending: Req[]; decided: Req[]; tracked: { rows: Tracked[]; total: number; active: number } }

const DEFAULT_STRIKE = '5';
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT' : '');

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok && json.success !== false, error: json.error };
  } catch { return { ok: false, error: 'Network error' }; }
}

export default function LevelSymbolsAdmin() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showRemoved, setShowRemoved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Per-request edits made before approving.
  const [strike, setStrike] = useState<Record<number, string>>({});
  const [name, setName] = useState<Record<number, string>>({});
  const [addSymbol, setAddSymbol] = useState('');
  const [addName, setAddName] = useState('');
  const [addStrike, setAddStrike] = useState(DEFAULT_STRIKE);

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (search.trim()) q.set('search', search.trim());
    if (showRemoved) q.set('removed', '1');
    try {
      const res = await fetch(`/api/admin/level-symbols?${q}`, { cache: 'no-store' });
      const json = await res.json();
      if (!json.success) { setError(json.error ?? 'Could not load'); return; }
      setError(null); setData(json.data);
    } catch { setError('Network error'); }
  }, [search, showRemoved]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function act(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key); setError(null);
    const r = await fn();
    if (!r.ok) setError(r.error ?? 'Failed');
    await load();
    setBusy(null);
  }

  const btn = 'px-2.5 py-1 text-xs font-semibold rounded-md border disabled:opacity-50';

  return (
    <div className="space-y-6">
      {error && <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-sm font-bold text-gray-900 mb-1">Pending requests {data ? `(${data.pending.length})` : ''}</h2>
        <p className="text-xs text-gray-500 mb-3">Approving adds the symbol to <code>us_symbols</code>; the loader computes its levels on its next run, so they appear after that.</p>
        {data && data.pending.length === 0 && <p className="text-sm text-gray-500">No pending requests.</p>}
        <div className="space-y-2">
          {data?.pending.map(r => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 border border-gray-100 rounded-lg p-2">
              <span className="font-semibold text-gray-900 w-16">{r.symbol}</span>
              <span className="text-xs text-gray-500 flex-1 min-w-[12rem]">
                {r.requesterEmail ?? 'unknown user'} · {fmt(r.requestedAt)}{r.note ? ` · “${r.note}”` : ''}
              </span>
              <input aria-label={`Company name for ${r.symbol}`} placeholder="Company name" value={name[r.id] ?? ''} onChange={e => setName(s => ({ ...s, [r.id]: e.target.value }))} className="border border-gray-300 rounded px-2 py-1 text-xs w-44" />
              <label className="text-xs text-gray-600 flex items-center gap-1">Strike
                <input inputMode="decimal" value={strike[r.id] ?? DEFAULT_STRIKE} onChange={e => setStrike(s => ({ ...s, [r.id]: e.target.value }))} className="border border-gray-300 rounded px-2 py-1 text-xs w-14" />
              </label>
              <button disabled={busy !== null} onClick={() => act(`a${r.id}`, () => call(`/api/admin/level-requests/${r.id}`, 'POST', { action: 'approve', strikeSize: strike[r.id] ?? DEFAULT_STRIKE, companyName: name[r.id] }))} className={`${btn} bg-green-600 border-green-600 text-white`}>Approve</button>
              <button disabled={busy !== null} onClick={() => { const note = window.prompt(`Reject ${r.symbol}? Optional reason:`); if (note !== null) act(`r${r.id}`, () => call(`/api/admin/level-requests/${r.id}`, 'POST', { action: 'reject', note })); }} className={`${btn} border-gray-300 text-gray-700`}>Reject</button>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Add a symbol</h2>
        <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); act('add', async () => { const r = await call('/api/admin/level-symbols', 'POST', { symbol: addSymbol, companyName: addName, strikeSize: addStrike }); if (r.ok) { setAddSymbol(''); setAddName(''); setAddStrike(DEFAULT_STRIKE); } return r; }); }}>
          <input aria-label="Ticker" placeholder="Ticker" value={addSymbol} onChange={e => setAddSymbol(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm w-28 uppercase" />
          <input aria-label="Company name" placeholder="Company name (optional)" value={addName} onChange={e => setAddName(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm w-60" />
          <label className="text-xs text-gray-600 flex items-center gap-1">Strike
            <input inputMode="decimal" value={addStrike} onChange={e => setAddStrike(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm w-16" />
          </label>
          <button type="submit" disabled={busy !== null || !addSymbol.trim()} className={`${btn} bg-blue-600 border-blue-600 text-white`}>Add</button>
        </form>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="text-sm font-bold text-gray-900">Tracked symbols {data ? `(${data.tracked.active} active)` : ''}</h2>
          <input aria-label="Search symbols" placeholder="Search ticker or name" value={search} onChange={e => setSearch(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm w-56" />
          <label className="text-xs text-gray-600 flex items-center gap-1"><input type="checkbox" checked={showRemoved} onChange={e => setShowRemoved(e.target.checked)} /> Show removed</label>
        </div>
        <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500"><tr><th className="text-left px-2 py-1.5">Symbol</th><th className="text-left px-2 py-1.5">Company</th><th className="text-right px-2 py-1.5">Strike</th><th className="text-left px-2 py-1.5">Status</th><th className="px-2 py-1.5" /></tr></thead>
            <tbody>
              {data?.tracked.rows.map(t => (
                <tr key={t.symbol} className="border-t border-gray-100">
                  <td className="px-2 py-1.5 font-semibold">{t.symbol}</td>
                  <td className="px-2 py-1.5 text-gray-600 truncate max-w-[18rem]">{t.companyName}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <button className="hover:underline" title="Edit strike size" onClick={() => { const v = window.prompt(`Strike size for ${t.symbol}`, String(t.strikeSize ?? DEFAULT_STRIKE)); if (v !== null) act(`s${t.symbol}`, () => call(`/api/admin/level-symbols/${encodeURIComponent(t.symbol)}`, 'PATCH', { action: 'strike', strikeSize: v })); }}>{t.strikeSize ?? '—'}</button>
                  </td>
                  <td className="px-2 py-1.5 text-xs">{t.active ? <span className="text-green-700">Active</span> : <span className="text-gray-500">Removed {fmt(t.deletedAt)}</span>}</td>
                  <td className="px-2 py-1.5 text-right">
                    {t.active
                      ? <button disabled={busy !== null} onClick={() => { if (window.confirm(`Stop tracking levels for ${t.symbol}? Existing levels stay visible.`)) act(`d${t.symbol}`, () => call(`/api/admin/level-symbols/${encodeURIComponent(t.symbol)}`, 'PATCH', { action: 'remove' })); }} className={`${btn} border-red-300 text-red-700`}>Remove</button>
                      : <button disabled={busy !== null} onClick={() => act(`u${t.symbol}`, () => call(`/api/admin/level-symbols/${encodeURIComponent(t.symbol)}`, 'PATCH', { action: 'restore' }))} className={`${btn} border-gray-300 text-gray-700`}>Restore</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.tracked.rows.length === 0 && <p className="text-sm text-gray-500 p-3">No symbols match.</p>}
          {data && data.tracked.total > data.tracked.rows.length && <p className="text-xs text-gray-500 p-2">Showing the first {data.tracked.rows.length} of {data.tracked.total}; search to narrow.</p>}
        </div>
      </section>

      {data && data.decided.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-bold text-gray-900 mb-2">Recently decided</h2>
          <ul className="text-xs text-gray-600 space-y-1">
            {data.decided.map(r => <li key={r.id}><span className="font-semibold text-gray-900">{r.symbol}</span> {r.status} · {r.requesterEmail ?? 'unknown user'} · {fmt(r.decidedAt)}{r.decisionNote ? ` · ${r.decisionNote}` : ''}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
