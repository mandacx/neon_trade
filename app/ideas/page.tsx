'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IDEA_HORIZONS } from '@/lib/ideaTypes';
import {
  DirectionPill, HorizonPill, OutcomePill, RiskPill, Spinner, StatusPill, api, fmtDay, fmtPrice, fmtR, inputClass, rTone,
} from '@/components/ideas/ideaUi';
import type { IdeaView } from '@/lib/ideas';

interface BoardData {
  items: IdeaView[];
  total: number;
  counts: { open: number; closed: number };
  locked: Array<{ term: 'short' | 'long'; open: number }>;
  canPublish: boolean;
}

const TERM_NAME = { short: 'short-term', long: 'long-term' } as const;
const TERM_PLANS = { short: 'Short term, Premium or Platinum', long: 'Long term, Premium or Platinum' } as const;
const TERM_FEATURE = { short: 'ideas_short_term', long: 'ideas_long_term' } as const;

function IdeaCard({ idea }: { idea: IdeaView }) {
  const o = idea.outcome;
  const closed = !['live', 'triggered'].includes(idea.status);
  return (
    <Link href={`/ideas/${idea.id}`} className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-sm transition">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-base font-bold text-gray-900">{idea.symbol}</span>
        <DirectionPill direction={idea.direction} />
        <HorizonPill horizon={idea.horizon} />
        <StatusPill status={idea.status} />
        <RiskPill risk={idea.riskRating} />
        {idea.optionStrategy && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-violet-50 text-violet-700">Option: {idea.optionStrategy.name}</span>}
        <span className="ml-auto text-[11px] text-gray-400">{idea.publishedAt ? fmtDay(idea.publishedAt.slice(0, 10)) : ''}</span>
      </div>
      <div className="mt-1 text-sm text-gray-700">{idea.title}</div>
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-1 text-xs">
        <div><div className="text-[10px] uppercase text-gray-400 font-semibold">Entry zone</div><div className="font-semibold text-gray-800">{fmtPrice(idea.entryLow)} – {fmtPrice(idea.entryHigh)}</div></div>
        <div><div className="text-[10px] uppercase text-gray-400 font-semibold">Stop</div><div className="font-semibold text-red-700">{fmtPrice(idea.stop)}</div></div>
        <div><div className="text-[10px] uppercase text-gray-400 font-semibold">Targets</div><div className="font-semibold text-green-700">{idea.targets.map(t => fmtPrice(t.price)).join(' / ')}</div></div>
        <div><div className="text-[10px] uppercase text-gray-400 font-semibold">Reward : risk</div><div className="font-semibold text-gray-800">{idea.riskReward.blended == null ? '—' : `${idea.riskReward.blended.toFixed(1)} : 1`}</div></div>
        <div>
          <div className="text-[10px] uppercase text-gray-400 font-semibold">{closed ? 'Result' : o?.outcome === 'open' ? 'Open R (unrealised)' : 'Valid until'}</div>
          {closed || o?.outcome === 'open'
            ? <div className={`font-bold ${rTone(o?.r)}`}>{o ? fmtR(o.r) : '—'} {closed && o && <span className="ml-1 align-middle"><OutcomePill outcome={o.outcome} /></span>}</div>
            : <div className="font-semibold text-gray-800">{fmtDay(idea.validUntil)}</div>}
        </div>
      </div>
    </Link>
  );
}

export default function IdeasBoardPage() {
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [horizon, setHorizon] = useState('');
  const [direction, setDirection] = useState('');
  const [symbol, setSymbol] = useState('');
  const [symbolInput, setSymbolInput] = useState('');
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams({ tab });
    if (horizon) qs.set('horizon', horizon);
    if (direction) qs.set('direction', direction);
    if (symbol) qs.set('symbol', symbol);
    api<BoardData>(`/api/ideas?${qs}`)
      .then(d => { if (alive) { setData(d); setError(null); } })
      .catch(e => alive && setError(e instanceof Error ? e.message : 'Could not load ideas'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [tab, horizon, direction, symbol]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {([['open', `Open${data ? ` (${data.counts.open})` : ''}`], ['closed', `Closed${data ? ` (${data.counts.closed})` : ''}`]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setTab(v)} className={`px-3 py-1 rounded-md text-xs font-semibold ${tab === v ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{label}</button>
          ))}
        </div>
        <select aria-label="Horizon" className={inputClass} value={horizon} onChange={e => setHorizon(e.target.value)}>
          <option value="">All horizons</option>
          {IDEA_HORIZONS.map(h => <option key={h.key} value={h.key}>{h.label}</option>)}
        </select>
        <select aria-label="Direction" className={inputClass} value={direction} onChange={e => setDirection(e.target.value)}>
          <option value="">Long & short</option>
          <option value="long">Long</option>
          <option value="short">Short</option>
        </select>
        <form onSubmit={e => { e.preventDefault(); setSymbol(symbolInput.trim().toUpperCase()); }} className="flex gap-1">
          <input className={`${inputClass} w-28 uppercase`} placeholder="Symbol" value={symbolInput} onChange={e => setSymbolInput(e.target.value)} aria-label="Symbol" />
          {symbol && <button type="button" className="text-xs text-gray-500 underline" onClick={() => { setSymbol(''); setSymbolInput(''); }}>clear</button>}
        </form>
        {data?.canPublish && <Link href="/ideas/publish" className="ml-auto px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700">＋ New idea</Link>}
      </div>

      {data?.locked.filter(l => l.open > 0 || true).map(l => (
        <div key={l.term} className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/50 px-4 py-3 text-xs text-indigo-900">
          <span className="font-semibold">{l.open > 0 ? `${l.open} live ${TERM_NAME[l.term]} idea${l.open === 1 ? '' : 's'}` : `${TERM_NAME[l.term][0].toUpperCase()}${TERM_NAME[l.term].slice(1)} ideas`} not on your plan.</span>
          <span>Included in {TERM_PLANS[l.term]}.</span>
          <Link href={`/upgrade?feature=${TERM_FEATURE[l.term]}`} className="ml-auto font-semibold underline underline-offset-2">See plans</Link>
        </div>
      ))}

      {error && <div className="p-3 mb-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
      {loading && !data ? <Spinner label="Loading ideas…" /> : (
        <div className={`space-y-2.5 ${loading ? 'opacity-60' : ''}`}>
          {data && data.items.length === 0 && !error && (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
              {tab === 'open' ? 'No open ideas right now. New ideas appear here as soon as they are published.' : 'No closed ideas match these filters yet.'}
            </div>
          )}
          {data?.items.map(i => <IdeaCard key={i.id} idea={i} />)}
          {data && data.total > data.items.length && <p className="text-xs text-gray-400 text-center">Showing the latest {data.items.length} of {data.total}.</p>}
        </div>
      )}
    </div>
  );
}
