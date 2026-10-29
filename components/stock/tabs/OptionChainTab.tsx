'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Term from '@/components/ui/Term';
import { EarningsExpiryChip } from '@/components/stock/EarningsPanel';
import type { EarningsSummary } from '@/types/earnings';
import type { Right } from '@/lib/payoff/bs';
import { buildCtx, nearest, newLegId, priceLeg, repriceLegs, resolveTemplate, type ChainCtx, type Leg, type Levels, type OptionChain } from '@/lib/payoff/chain';
import { STRATEGY_BY_ID, needsFarExpiry, type StrategyTemplate } from '@/lib/payoff/strategies';
import StrategyPicker from '@/components/stock/strategy/StrategyPicker';
import LegEditor from '@/components/stock/strategy/LegEditor';
import StrikeRuler from '@/components/stock/strategy/StrikeRuler';
import StrategyBuilder from '@/components/stock/strategy/StrategyBuilder';
import ChainTable from '@/components/stock/strategy/ChainTable';
import { Spinner } from './shared';

// Option Chain tab of the stock page: live chain for the selected expiry plus the
// Strategy Builder (docs/strategy-builder.md). Pro feature `strategy_builder`.
// Quotes are read once per expiry and only re-read when the user clicks
// "Refresh quotes" — never on a timer — so a position under review doesn't move.

const etTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' });

function age(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min old` : `${Math.floor(m / 60)} h ${m % 60} min old`;
}

export default function OptionChainTab({ symbol, selectedExpiry, expiryMode, expiries, levels, earnings, entitled, loggedIn, onOpenContract }: {
  symbol: string;
  selectedExpiry: string;
  expiryMode: 'current' | 'historical';
  /** Upcoming expiries, nearest first. */
  expiries: string[];
  /** This app's levels for the selected expiry (strangles / condors anchor on them). */
  levels: Levels;
  earnings: EarningsSummary | null;
  entitled: boolean;
  loggedIn: boolean;
  onOpenContract: (strike: number, optType: 'call' | 'put', occRoot?: string) => void;
}) {
  const [chains, setChains] = useState<Map<string, OptionChain>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Set<string> | null>(null);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  // Why a level-anchored strike moved nearer the money (lib/payoff/chain.ts resolveTemplate).
  const [pickNotes, setPickNotes] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const builtForRef = useRef<string | null>(null);
  const chainsRef = useRef(chains);
  chainsRef.current = chains;

  // Clock for the "n min old" label only (no requests).
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);

  const ctxs = useMemo(() => {
    const m = new Map<string, ChainCtx>();
    chains.forEach((c, d) => m.set(d, buildCtx(c, Date.parse(c.asOf))));
    return m;
  }, [chains]);
  const near = ctxs.get(selectedExpiry) ?? null;
  const farExpiry = expiries.find(d => d > selectedExpiry) ?? null;
  const far = farExpiry ? ctxs.get(farExpiry) ?? null : null;
  const spot = near?.spot ?? 0;

  const fetchChains = useCallback(async (list: string[]): Promise<Map<string, OptionChain>> => {
    const out = new Map<string, OptionChain>();
    setLoading(s => new Set([...s, ...list]));
    try {
      await Promise.all(list.map(async expiry => {
        const res = await fetch(`/api/stocks/${symbol}/chain?expiry=${expiry}`);
        const json = await res.json().catch(() => null);
        if (res.status === 429) { setError(json?.message ?? 'Too many quote requests; wait a minute.'); return; }
        if (!res.ok || !json?.success) { setError(json?.message ?? json?.error ?? 'Could not load the option chain.'); return; }
        if (Array.isArray(json.enabledStrategies)) setEnabled(new Set(json.enabledStrategies));
        if (json.data) out.set(expiry, json.data as OptionChain);
        else if (expiry === selectedExpiry) setError(json.message ?? `No live option chain for ${expiry}.`);
      }));
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(s => { const n = new Set(s); list.forEach(d => n.delete(d)); return n; });
    }
    if (out.size) setChains(prev => new Map([...prev, ...out]));
    return out;
  }, [symbol, selectedExpiry]);

  const ensureCtx = useCallback(async (expiry: string): Promise<ChainCtx | null> => {
    const have = chainsRef.current.get(expiry);
    const c = have ?? (await fetchChains([expiry])).get(expiry);
    return c ? buildCtx(c, Date.parse(c.asOf)) : null;
  }, [fetchChains]);

  // First chain for an expiry: once, when it is selected (no refetch on revisit).
  useEffect(() => {
    if (!entitled || expiryMode !== 'current' || !selectedExpiry || chainsRef.current.has(selectedExpiry)) return;
    setError(null);
    fetchChains([selectedExpiry]);
  }, [entitled, expiryMode, selectedExpiry, fetchChains]);

  // Expiry switched with a position open: rebuild the template on the new expiry, or move
  // the legs that were on the old one to the nearest strikes of the new one.
  useEffect(() => {
    if (!near || builtForRef.current === selectedExpiry) return;
    const prev = builtForRef.current;
    builtForRef.current = selectedExpiry;
    if (!prev || !legs.length) return;
    const t = templateId ? STRATEGY_BY_ID.get(templateId) : undefined;
    if (t && !needsFarExpiry(t)) {
      const r = resolveTemplate(t, near, null, levels);
      if (r.legs) { setLegs(r.legs); setPickNotes(r.notes ?? []); return; }
    }
    setTemplateId(null);
    setPickNotes([]);
    setLegs(ls => ls.map(l => {
      if (l.kind !== 'option' || l.expiry !== prev) return priceLeg(l, l.expiry ? ctxs.get(l.expiry) : undefined, near.spot);
      const ks = l.right === 'C' ? near.calls : near.puts;
      return priceLeg({ ...l, expiry: selectedExpiry, strike: ks.length ? nearest(ks, l.strike ?? near.spot) : l.strike, prevPremium: undefined }, near, near.spot);
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, selectedExpiry]);

  async function pick(t: StrategyTemplate) {
    if (!near) return;
    let farCtx = far;
    if (needsFarExpiry(t) && !farCtx && farExpiry) farCtx = await ensureCtx(farExpiry);
    const r = resolveTemplate(t, near, farCtx, levels);
    if (!r.legs) { setError(`${t.name}: ${r.error}`); return; }
    setError(null);
    setPickNotes(r.notes ?? []);
    setTemplateId(t.id);
    builtForRef.current = selectedExpiry;
    setLegs(r.legs);
  }

  function addFromChain(right: Right, strike: number, side: 1 | -1) {
    if (!near) return;
    setTemplateId(null);
    setPickNotes([]);
    builtForRef.current = selectedExpiry;
    setLegs(ls => {
      const same = ls.find(l => l.kind === 'option' && l.right === right && l.strike === strike && l.expiry === selectedExpiry && Math.sign(l.qty) === side);
      if (same) return ls.map(l => (l === same ? { ...l, qty: l.qty + side } : l));
      return [...ls, priceLeg({ id: newLegId(), kind: 'option', right, strike, expiry: selectedExpiry, qty: side, premium: 0 }, near, near.spot)];
    });
  }

  async function refresh() {
    const used = [...new Set([selectedExpiry, ...legs.filter(l => l.kind === 'option' && l.expiry).map(l => l.expiry!)])];
    setError(null);
    const fresh = await fetchChains(used);
    if (!fresh.size) return;
    const next = new Map(ctxs);
    fresh.forEach((c, d) => next.set(d, buildCtx(c, Date.parse(c.asOf))));
    const s = next.get(selectedExpiry)?.spot ?? spot;
    setLegs(ls => repriceLegs(ls, next, s));
  }

  if (!entitled) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 text-center">
        <h3 className="text-base font-bold mb-1">Live option chain &amp; Strategy Builder</h3>
        <p className="text-sm text-gray-600 max-w-xl mx-auto">
          Pick a market view (bullish, bearish, neutral, volatile) or any of 45 strategies, see the payoff at expiry and before it,
          probability of profit, breakevens and greeks, priced from the live chain.
        </p>
        <Link href={loggedIn ? '/upgrade?feature=strategy_builder' : '/login'} className="inline-block mt-3 px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
          {loggedIn ? 'Upgrade to use it' : 'Sign in'}
        </Link>
      </div>
    );
  }
  if (expiryMode !== 'current') {
    return <div className="bg-white rounded-lg shadow-md p-6 text-center text-sm text-gray-500">Live quotes exist only for expiries that have not passed. Switch to a current expiry above.</div>;
  }

  const chain = chains.get(selectedExpiry);
  const busy = loading.size > 0;
  const enabledSet = enabled ?? new Set<string>();
  const legExpiries = expiries.slice(0, 16);
  const templateName = templateId ? STRATEGY_BY_ID.get(templateId)?.name : null;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-md p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold">
              Strategy Builder <span className="text-xs font-normal text-gray-400">{symbol.toUpperCase()} · expiry {selectedExpiry}</span>
            </h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 mt-0.5">
              {chain ? (
                <>
                  <span>Spot <b className="text-gray-800">{chain.spot.toFixed(2)}</b></span>
                  {near?.atmIv && <span><Term k="atm">ATM</Term> <Term k="iv">IV</Term> <b className="text-gray-800">{(near.atmIv * 100).toFixed(1)}%</b></span>}
                  <span title="Quotes are not refreshed automatically; use Refresh quotes.">Quotes as of {etTime(chain.asOf)} ET · {age(chain.asOf, now)}</span>
                  {chain.root !== symbol.toUpperCase() && <span>Root {chain.root}</span>}
                </>
              ) : busy ? <span>Loading the chain…</span> : null}
              <EarningsExpiryChip earnings={earnings} expiry={selectedExpiry} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {busy && <Spinner />}
            <button onClick={refresh} disabled={busy || !chain}
              title="Re-read the chain and re-price your legs at the new mids"
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              ↻ Refresh quotes
            </button>
          </div>
        </div>
        {error && <div className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">{error}</div>}
      </div>

      {/* Chain on the left third (sticky while the builder scrolls), builder on the right. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start">
      {chain && (
        <div className="bg-white rounded-lg shadow-md p-3 min-w-0 lg:sticky lg:top-2">
          <h3 className="text-base font-bold mb-1">Option chain <span className="text-xs font-normal text-gray-400">{selectedExpiry}</span></h3>
          <ChainTable chain={chain} onAdd={addFromChain} onOpenContract={(strike, t) => onOpenContract(strike, t, chain.root !== symbol.toUpperCase() ? chain.root : undefined)} />
        </div>
      )}

      {near && chain && (
        <div className="space-y-4 min-w-0">
        <div className="bg-white rounded-lg shadow-md p-4">
          <StrategyPicker near={near} far={far} farExpiry={farExpiry} levels={levels} enabled={enabledSet} activeId={templateId} onPick={pick} />
        </div>
        <div className="bg-white rounded-lg shadow-md p-4 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-bold">{templateName ?? (legs.length ? 'Custom position' : 'Position')}</h3>
            {templateName && <span className="text-[11px] text-gray-400">Edit any leg; the payoff updates as you go.</span>}
          </div>
          {templateName && pickNotes.map((n, i) => (
            <p key={i} className="text-[11px] text-sky-800 bg-sky-50 border border-sky-200 rounded-md px-2.5 py-1">{n}</p>
          ))}
          <LegEditor legs={legs} onChange={ls => { setLegs(ls); }} ctxs={ctxs} expiries={legExpiries} spot={spot} onNeedChain={ensureCtx} />
          <StrikeRuler legs={legs} ctxs={ctxs} spot={spot}
            onStrike={(id, strike) => setLegs(ls => ls.map(l => (l.id === id ? priceLeg({ ...l, strike, prevPremium: undefined }, l.expiry ? ctxs.get(l.expiry) : undefined, spot) : l)))} />
          <StrategyBuilder legs={legs} spot={spot} atmIv={near.atmIv} asOf={chain.asOf} />
        </div>
        </div>
      )}
      </div>
    </div>
  );
}
