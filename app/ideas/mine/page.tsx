'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DirectionPill, HorizonPill, OutcomePill, Spinner, api, fmtPct, fmtPrice, fmtR, fmtWhen, inputClass, rTone } from '@/components/ideas/ideaUi';
import type { TakenView } from '@/lib/ideaTaken';
import type { Followed } from '@/lib/ideaTakenMath';

interface Data { trades: TakenView[]; comparison: Followed; notes: string[] }
const money = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }));

function CloseForm({ t, onDone }: { t: TakenView; onDone: () => void }) {
  const [px, setPx] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setErr(null);
    try { await api(`/api/ideas/taken/${t.id}`, { method: 'PATCH', body: JSON.stringify({ exitPrice: px === '' ? null : Number(px) }) }); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input className={`${inputClass} w-24`} type="number" step="any" min="0" placeholder="Exit price" value={px} onChange={e => setPx(e.target.value)} aria-label="Your exit price" />
      <button onClick={submit} disabled={busy} className="text-xs font-semibold text-indigo-600 disabled:opacity-60">Close</button>
      {err && <span className="text-[11px] text-red-600">{err}</span>}
    </span>
  );
}

export default function MyTradesPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Data>('/api/ideas/taken').then(d => { setData(d); setError(null); }).catch(e => setError(e instanceof Error ? e.message : 'Could not load your trades'));
  }, []);
  useEffect(load, [load]);

  async function remove(id: string) {
    if (!window.confirm('Remove this record from My trades?')) return;
    try { await api(`/api/ideas/taken/${id}`, { method: 'DELETE' }); load(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not remove'); }
  }

  if (error) return <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>;
  if (!data) return <Spinner label="Loading your trades…" />;
  const c = data.comparison;
  const open = data.trades.filter(t => t.open);
  const closed = data.trades.filter(t => !t.open);

  const Row = ({ t }: { t: TakenView }) => (
    <tr className="hover:bg-gray-50 align-top">
      <td className="py-1.5 pr-2"><Link href={`/ideas/${t.ideaId}`} className="font-semibold text-indigo-700 hover:underline">{t.symbol}</Link> <DirectionPill direction={t.direction} /><div className="text-[10px] text-gray-400">{t.title}</div></td>
      <td className="pr-2"><HorizonPill horizon={t.horizon} /></td>
      <td className="pr-2 text-right">{t.qty}</td>
      <td className="pr-2 text-right">{fmtPrice(t.entryPrice)}<div className="text-[10px] text-gray-400">{fmtWhen(t.takenAt)}</div></td>
      <td className="pr-2 text-right">{t.open ? (t.mark != null ? <>{fmtPrice(t.mark)}<div className="text-[10px] text-gray-400">latest</div></> : '—') : fmtPrice(t.exitPrice)}</td>
      <td className={`pr-2 text-right font-semibold ${rTone(t.profit)}`}>{money(t.profit)}<div className="text-[10px] font-normal">{fmtPct(t.pct, 2)}{t.open ? ' unrealised' : ''}</div></td>
      <td className="pr-2">{t.ideaOutcome ? <OutcomePill outcome={t.ideaOutcome} /> : <span className="text-[11px] text-gray-400">{t.ideaStatus}</span>}{t.ideaR != null && <div className={`text-[11px] font-semibold ${rTone(t.ideaR)}`}>desk {fmtR(t.ideaR)}</div>}</td>
      <td className="text-right whitespace-nowrap">{t.open && <CloseForm t={t} onDone={load} />} <button className="ml-2 text-[11px] text-gray-400 hover:text-red-600" onClick={() => remove(t.id)}>remove</button></td>
    </tr>
  );
  const head = (
    <thead><tr className="text-left text-[10px] uppercase text-gray-400"><th className="py-1 pr-2">Idea</th><th className="pr-2">Horizon</th><th className="pr-2 text-right">Qty</th><th className="pr-2 text-right">Your price</th><th className="pr-2 text-right">Now / exit</th><th className="pr-2 text-right">Your result</th><th className="pr-2">Desk result</th><th /></tr></thead>
  );

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-sm font-bold text-gray-900 mb-2">Followed vs not followed</h2>
        {c.followed.n === 0 && c.notFollowed.n === 0 ? (
          <p className="text-xs text-gray-500">Nothing to compare yet. Once ideas you took have finished and you have closed your trade, your results appear here next to the desk&apos;s.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg bg-gray-50 p-3"><div className="text-[10px] uppercase font-semibold text-gray-400">Ideas I took (closed, finished)</div><div className="text-lg font-bold">{c.followed.n}</div></div>
            <div className="rounded-lg bg-gray-50 p-3"><div className="text-[10px] uppercase font-semibold text-gray-400">My average return</div><div className={`text-lg font-bold ${rTone(c.followed.myAvgPct)}`}>{fmtPct(c.followed.myAvgPct, 2)}</div><div className="text-[11px] text-gray-500">desk on the same ideas: {fmtPct(c.followed.deskAvgPct, 2)}</div></div>
            <div className="rounded-lg bg-gray-50 p-3"><div className="text-[10px] uppercase font-semibold text-gray-400">Ideas I did not take</div><div className="text-lg font-bold">{c.notFollowed.n}</div><div className="text-[11px] text-gray-500">desk average: {fmtPct(c.notFollowed.deskAvgPct, 2)}</div></div>
          </div>
        )}
        {(c.pending.stillOpenForMe > 0 || c.pending.ideaNotFinished > 0) && <p className="text-[11px] text-gray-500 mt-2">Not in the comparison yet: {c.pending.stillOpenForMe} finished idea(s) you have not closed, {c.pending.ideaNotFinished} idea(s) still running.</p>}
        {data.notes.map(n => <p key={n} className="text-[11px] text-gray-500 mt-1">{n}</p>)}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-3 overflow-x-auto">
        <h3 className="text-sm font-bold text-gray-900 mb-2">Open ({open.length})</h3>
        {open.length === 0 ? <p className="text-xs text-gray-500">No open trades. Use &ldquo;I took this&rdquo; on an idea to record one.</p> : <table className="w-full text-xs">{head}<tbody className="divide-y divide-gray-100">{open.map(t => <Row key={t.id} t={t} />)}</tbody></table>}
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-3 overflow-x-auto">
        <h3 className="text-sm font-bold text-gray-900 mb-2">Closed ({closed.length})</h3>
        {closed.length === 0 ? <p className="text-xs text-gray-500">None yet.</p> : <table className="w-full text-xs">{head}<tbody className="divide-y divide-gray-100">{closed.map(t => <Row key={t.id} t={t} />)}</tbody></table>}
      </div>
    </div>
  );
}
