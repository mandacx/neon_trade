'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import IdeaChart from '@/components/ideas/IdeaChart';
import TakeThis from '@/components/ideas/TakeThis';
import {
  DirectionPill, HorizonPill, OutcomePill, RiskPill, Spinner, StatusPill, api, fmtDay, fmtPct, fmtPrice, fmtR, fmtWhen, inputClass, labelClass, rTone,
} from '@/components/ideas/ideaUi';
import { updateTypeMeta, OPEN_STATUSES, IDEA_UPDATE_TYPES } from '@/lib/ideaTypes';
import { Pill } from '@/components/ideas/ideaUi';
import type { IdeaView } from '@/lib/ideas';

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-[10px] uppercase text-gray-400 font-semibold">{label}</div><div className="text-sm font-semibold text-gray-900">{children}</div></div>;
}

function UpdateForm({ idea, onDone }: { idea: IdeaView; onDone: () => void }) {
  const open = OPEN_STATUSES.includes(idea.status);
  const [type, setType] = useState('note');
  const [body, setBody] = useState('');
  const [stop, setStop] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const types = IDEA_UPDATE_TYPES.filter(t => open || t.key === 'note');

  async function submit() {
    if ((type === 'closed' || type === 'cancelled') && !window.confirm(type === 'closed' ? 'Close this idea early? It will be scored at that session\'s close and cannot be reopened.' : 'Withdraw this idea? It cannot be reopened.')) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/ideas/${idea.id}/updates`, {
        method: 'POST',
        body: JSON.stringify({ type, body, stop: type === 'stop_moved' ? Number(stop) : undefined, price: type === 'partial_booked' && price ? Number(price) : undefined }),
      });
      setBody(''); setStop(''); setPrice('');
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
      <div className="text-xs font-bold text-gray-700">Add an update (append-only: it cannot be edited or deleted)</div>
      <div className="flex flex-wrap gap-2">
        <select className={inputClass} value={type} onChange={e => setType(e.target.value)} aria-label="Update type">
          {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        {type === 'stop_moved' && <input className={`${inputClass} w-28`} type="number" step="any" placeholder="New stop" value={stop} onChange={e => setStop(e.target.value)} />}
        {type === 'partial_booked' && <input className={`${inputClass} w-28`} type="number" step="any" placeholder="Price (optional)" value={price} onChange={e => setPrice(e.target.value)} />}
      </div>
      <textarea className={`${inputClass} w-full`} rows={2} placeholder={type === 'note' ? 'What changed or what to watch' : 'Optional comment'} value={body} onChange={e => setBody(e.target.value)} maxLength={2000} />
      <p className="text-[11px] text-gray-500">{updateTypeMeta(type).description}</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button onClick={submit} disabled={busy} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60">{busy ? 'Saving…' : 'Post update'}</button>
    </div>
  );
}

export default function IdeaPage() {
  const { id } = useParams<{ id: string }>();
  const [idea, setIdea] = useState<IdeaView | null>(null);
  const [canPublish, setCanPublish] = useState(false);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);

  const load = useCallback(() => {
    api<{ idea: IdeaView; canPublish: boolean }>(`/api/ideas/${id}`)
      .then(d => { setIdea(d.idea); setCanPublish(d.canPublish); setError(null); })
      .catch(e => setError({ status: e.status, message: e instanceof Error ? e.message : 'Could not load the idea' }));
  }, [id]);
  useEffect(load, [load]);

  if (error) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
        <p className="text-sm text-gray-700">{error.status === 404 ? 'This idea was not found, or it is not part of your plan.' : error.message}</p>
        <Link href="/ideas" className="inline-block mt-3 text-sm font-semibold text-indigo-600 underline">Back to the board</Link>
      </div>
    );
  }
  if (!idea) return <Spinner label="Loading idea…" />;

  const o = idea.outcome;
  const closed = !OPEN_STATUSES.includes(idea.status) && idea.status !== 'draft';

  return (
    <div className="space-y-4">
      <div>
        <Link href="/ideas" className="text-xs font-semibold text-indigo-600 hover:underline">← Board</Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold text-gray-900">{idea.symbol}</h2>
          <DirectionPill direction={idea.direction} />
          <HorizonPill horizon={idea.horizon} />
          <StatusPill status={idea.status} />
          <RiskPill risk={idea.riskRating} />
          <Link href={`/stock/${idea.symbol}`} target="_blank" className="ml-auto text-xs font-semibold text-indigo-600 underline underline-offset-2">Open full stock analysis ↗</Link>
        </div>
        <p className="text-sm text-gray-700 mt-1">{idea.title}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {idea.publishedAt ? `Published ${fmtWhen(idea.publishedAt)}` : 'Draft'}{idea.refPrice != null ? ` · last close at publish ${fmtPrice(idea.refPrice)}` : ''}. The plan below is frozen as published; changes appear in the timeline.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          <Stat label="Entry zone">{fmtPrice(idea.entryLow)} – {fmtPrice(idea.entryHigh)}</Stat>
          <Stat label="Stop"><span className="text-red-700">{fmtPrice(idea.stop)}</span></Stat>
          {idea.targets.map((t, i) => <Stat key={i} label={t.label || `Target ${i + 1}`}><span className="text-green-700">{fmtPrice(t.price)}</span> <span className="text-[10px] text-gray-400 font-normal">{idea.riskReward.perTarget[i]?.toFixed(1)}R</span></Stat>)}
          <Stat label="Reward : risk">{idea.riskReward.blended == null ? '—' : `${idea.riskReward.blended.toFixed(1)} : 1`}</Stat>
          <Stat label="Valid until">{fmtDay(idea.validUntil)}</Stat>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">Reward : risk is measured from the worst fill inside the entry zone ({idea.direction === 'short' ? 'zone low' : 'zone high'}) to each target, over the risk to the stop.</p>
      </div>

      {idea.status !== 'draft' && idea.status !== 'scheduled' && <TakeThis idea={idea} />}

      <div className="bg-white border border-gray-200 rounded-xl p-2 sm:p-3">
        <IdeaChart plan={{ symbol: idea.symbol, entryLow: idea.entryLow, entryHigh: idea.entryHigh, targets: idea.targets, stop: idea.stop, from: (idea.publishedAt ?? idea.createdAt).slice(0, 10) }} />
      </div>

      {o && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h3 className="text-sm font-bold text-gray-900">Tracked result</h3>
            <OutcomePill outcome={o.outcome} />
            <span className="text-[11px] text-gray-400">Scored mechanically from daily bars through {o.evaluatedThrough ? fmtDay(o.evaluatedThrough) : '—'}. Stop first if one bar touches both stop and a target.</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            <Stat label="Entered">{o.enteredOn ? `${fmtDay(o.enteredOn)} @ ${fmtPrice(o.entryPrice)}` : 'Not yet'}</Stat>
            <Stat label={closed ? 'Result' : 'R so far (unrealised)'}><span className={rTone(o.r)}>{fmtR(o.r)}</span></Stat>
            <Stat label="Return"><span className={rTone(o.pctReturn)}>{fmtPct(o.pctReturn, 2)}</span></Stat>
            <Stat label="Targets hit">{o.targetsHit} of {o.targetsTotal}</Stat>
            <Stat label="Exit">{o.exitOn ? `${fmtDay(o.exitOn)} @ ${fmtPrice(o.exitPrice)}` : '—'}</Stat>
            <Stat label="Worst move against">{o.maePct == null ? '—' : `${o.maePct.toFixed(1)}%`}</Stat>
          </div>
        </div>
      )}

      {idea.rationale && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-bold text-gray-900 mb-1">Rationale</h3>
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{idea.rationale}</p>
        </div>
      )}

      {idea.optionStrategy && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-bold text-gray-900 mb-1">Option strategy: {idea.optionStrategy.name}</h3>
          <p className="text-[11px] text-gray-400 mb-2">Shown for reference. The idea is tracked on the underlying stock&apos;s price above, not on option prices.</p>
          {idea.optionStrategy.expiry && <p className="text-xs text-gray-600 mb-1">Expiry {fmtDay(idea.optionStrategy.expiry)}</p>}
          <ul className="text-sm text-gray-800 space-y-0.5">
            {idea.optionStrategy.legs.map((l, i) => <li key={i}><span className={l.side === 'buy' ? 'text-green-700 font-semibold' : 'text-red-700 font-semibold'}>{l.side === 'buy' ? 'Buy' : 'Sell'}</span> {l.qty} × {idea.symbol} {l.strike} {l.type}</li>)}
          </ul>
          {idea.optionStrategy.note && <p className="text-xs text-gray-600 mt-1.5">{idea.optionStrategy.note}</p>}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-bold text-gray-900 mb-2">Timeline</h3>
        {(idea.updates?.length ?? 0) === 0 && !o?.enteredOn ? <p className="text-xs text-gray-500">No updates yet.</p> : (
          <ol className="space-y-2 border-l-2 border-gray-100 pl-3">
            {idea.publishedAt && <li><div className="text-[11px] text-gray-400">{fmtWhen(idea.publishedAt)}</div><div className="text-sm text-gray-800">Idea published.</div></li>}
            {idea.updates?.map(u => (
              <li key={u.id}>
                <div className="flex items-center gap-2 text-[11px] text-gray-400">{fmtWhen(u.createdAt)} <Pill meta={updateTypeMeta(u.type)} /></div>
                <div className="text-sm text-gray-800">
                  {u.type === 'stop_moved' && typeof u.payload.stop === 'number' && <span className="font-semibold">Stop moved to {fmtPrice(u.payload.stop)}. </span>}
                  {u.type === 'partial_booked' && <span className="font-semibold">Partial booked{typeof u.payload.price === 'number' ? ` at ${fmtPrice(u.payload.price)}` : ''}. </span>}
                  {u.body}
                </div>
              </li>
            ))}
          </ol>
        )}
        {idea.updates && idea.updates.some(u => u.type === 'stop_moved') && <p className="text-[11px] text-gray-400 mt-2">A moved stop is the publisher&apos;s own management; the tracked result above still uses the original stop.</p>}
        {canPublish && <UpdateForm idea={idea} onDone={load} />}
      </div>
    </div>
  );
}
