'use client';

/**
 * Board chip: the current price (CMP) of an open idea and, once the tracker says it entered, the provisional profit or
 * loss in points, R and %. One batched read (GET /api/ideas/live) serves every card. Provisional and never stored:
 * same maths as the idea page's live mark (lib/ideaLiveMath.ts), not the tracked result.
 */
import { useEffect, useRef, useState } from 'react';
import { api, fmtPct, fmtPrice, fmtR, rTone } from '@/components/ideas/ideaUi';
import { pollDelayMs, type MarketClock } from '@/lib/pollDelay';
import type { LiveMark } from '@/lib/ideaLiveMath';

export interface LiveBlockJson {
  mark: LiveMark;
  basis: 'live' | 'last_close' | null;
  session: 'pre' | 'regular' | 'post' | 'closed';
  asOf: string;
  day?: { change: number | null; changePercent: number | null };
  ext: { label: string; price: number; changePercent: number | null } | null;
}

/** Signed points, e.g. +12.40 / -3.10 (never "-0.00"). */
export const fmtPts = (n: number | null | undefined, digits = 2) => {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = Math.abs(n) < 0.5 * 10 ** -digits ? 0 : n;
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;
};

/** Poll the batched live marks while `enabled` (the Open tab). Paused when the tab is hidden; stops on 401/403/404. */
export function useBoardLive(enabled: boolean) {
  const [live, setLive] = useState<Record<string, LiveBlockJson>>({});
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const gen = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const g = ++gen.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let inFlight = false;
    const ac = new AbortController();

    const tick = async () => {
      if (stopped || inFlight || g !== gen.current) return;
      inFlight = true;
      let next = 20_000;
      try {
        const d = await api<{ live: Record<string, LiveBlockJson>; market: MarketClock | null }>('/api/ideas/live', { signal: ac.signal });
        if (stopped) return;
        setLive(d.live ?? {});
        setFailed(false);
        setLoaded(true);
        next = pollDelayMs(d.market, { regularMs: 20_000, extendedMs: 60_000, closedMaxMs: 15 * 60_000 });
      } catch (e) {
        if (stopped || (e instanceof DOMException && e.name === 'AbortError')) return;
        const status = (e as { status?: number }).status;
        if (status === 401 || status === 403 || status === 404) { stopped = true; setFailed(true); return; }
        setFailed(true);
        next = status === 429 ? 60_000 : 30_000;
      } finally {
        inFlight = false;
      }
      if (stopped) return;
      if (document.visibilityState === 'hidden') return; // resumes from the visibilitychange handler
      timer = setTimeout(tick, next);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !stopped) { if (timer) clearTimeout(timer); timer = null; tick(); }
      else if (timer) { clearTimeout(timer); timer = null; }
    };
    tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      ac.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  return { live, failed, loaded };
}

function entryText(m: LiveMark): string {
  switch (m.state) {
    case 'in_zone': return 'Price is in the entry zone';
    case 'ran_past_target': return 'Ran past target 1 without entering';
    case 'beyond_stop': return 'Beyond the stop, not entered';
    default:
      return m.zone && m.zone.side !== 'inside'
        ? `${m.zone.distancePts.toFixed(2)} pts (${m.zone.distancePct.toFixed(1)}%) ${m.zone.side} the entry zone`
        : 'Not entered yet';
  }
}

export default function LiveChip({ block, loaded }: { block: LiveBlockJson | undefined; loaded: boolean }) {
  if (!block) {
    return <div className="mt-2 pt-2 border-t border-gray-100 text-[11px] text-gray-400">{loaded ? 'Live price not available.' : 'Loading live price…'}</div>;
  }
  const m = block.mark;
  if (m.price == null || m.state === 'unavailable') {
    return <div className="mt-2 pt-2 border-t border-gray-100 text-[11px] text-gray-400">Live price not available.</div>;
  }
  const day = block.day?.changePercent;
  return (
    <div className="mt-2 pt-2 border-t border-gray-100 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
      <div>
        <span className="text-[10px] uppercase text-gray-400 font-semibold mr-1.5">CMP</span>
        <span className="text-sm font-bold text-gray-900">{fmtPrice(m.price)}</span>
        {day != null && <span className={`ml-1.5 text-[11px] font-semibold ${rTone(day)}`}>{fmtPct(day, 2)}</span>}
        <span className="ml-1.5 text-[10px] text-gray-400">{block.basis === 'live' ? 'live' : 'last close'}</span>
      </div>
      {m.entered ? (
        <div>
          <span className="text-[10px] uppercase text-gray-400 font-semibold mr-1.5">If entered</span>
          <span className={`font-bold ${rTone(m.points)}`}>{fmtPts(m.points)} pts</span>
          <span className={`ml-1.5 font-bold ${rTone(m.r)}`}>{fmtR(m.r)}</span>
          <span className={`ml-1.5 ${rTone(m.pct)}`}>{fmtPct(m.pct, 2)}</span>
          <span className="ml-1.5 text-[10px] text-gray-400">{m.targetsReached} of {m.targetsTotal} targets</span>
        </div>
      ) : (
        <div className="text-gray-600">{entryText(m)}</div>
      )}
    </div>
  );
}
