'use client';

/**
 * Provisional live mark of an open idea (docs/trade-ideas.md, "Live mark"). Client-only presentation: every number
 * comes from GET /api/ideas/[id]/live (gated on the server). Never the tracked result, never stored.
 * Poll cadence from lib/pollDelay.ts; paused while the tab is hidden; stops on 401/403/404 and when the idea closes;
 * backs off 60 s on 429.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtPct, fmtPrice, fmtR, fmtWhen, rTone, Pill } from '@/components/ideas/ideaUi';
import type { DisclaimerData } from '@/components/ideas/ideaUi';
import { pollDelayMs, type MarketClock } from '@/lib/pollDelay';
import { fmtPts } from '@/components/ideas/LiveChip';
import type { LiveMark as LiveMarkData } from '@/lib/ideaLiveMath';
import type { IdeaView } from '@/lib/ideas';

interface LiveBlockJson {
  mark: LiveMarkData;
  basis: 'live' | 'last_close' | null;
  session: 'pre' | 'regular' | 'post' | 'closed';
  asOf: string;
  day?: { change: number | null; changePercent: number | null };
  ext: { label: string; price: number; changePercent: number | null } | null;
}
interface LiveResponse { live: LiveBlockJson | null; reason?: string; market?: MarketClock; disclaimer?: DisclaimerData }

const SESSION_TEXT: Record<string, string> = {
  regular: 'regular session', pre: 'pre-market, last regular close', post: 'after hours, last regular close', closed: 'market closed, last regular close',
};

function useLiveMark(id: string) {
  const [block, setBlock] = useState<LiveBlockJson | null>(null);
  const [disclaimer, setDisclaimer] = useState<DisclaimerData | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const gen = useRef(0); // bumped by every effect cleanup; a fetch from an older run never touches state or timers
  const dead = useRef(false);
  const run = useRef<() => void>(() => {});

  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  const fetchOnce = useCallback(async () => {
    if (dead.current || inFlight.current) return;
    clear();
    inFlight.current = true;
    setBusy(true);
    const g = gen.current;
    const ac = new AbortController();
    abort.current = ac;
    let next = 20_000;
    try {
      const d = await api<LiveResponse>(`/api/ideas/${id}/live`, { signal: ac.signal });
      if (dead.current || g !== gen.current) return;
      setFailed(false);
      if (d.disclaimer) setDisclaimer(d.disclaimer);
      if (!d.live) { dead.current = true; setStopped(true); return; }
      setBlock(d.live);
      next = pollDelayMs(d.market, { regularMs: 20_000, extendedMs: 60_000, closedMaxMs: 15 * 60_000 });
    } catch (e) {
      if (dead.current || g !== gen.current || (e instanceof DOMException && e.name === 'AbortError')) return;
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403 || status === 404) { dead.current = true; setStopped(true); return; }
      setFailed(true);
      next = status === 429 ? 60_000 : 30_000;
    } finally {
      if (g === gen.current) { inFlight.current = false; setBusy(false); }
    }
    if (dead.current || g !== gen.current) return;
    if (document.visibilityState === 'hidden') return; // resumes from the visibilitychange handler
    timer.current = setTimeout(() => run.current(), next);
  }, [id]);

  useEffect(() => { run.current = fetchOnce; }, [fetchOnce]);

  useEffect(() => {
    dead.current = false;
    setStopped(false);
    fetchOnce();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !dead.current) { clear(); run.current(); }
      else if (document.visibilityState === 'hidden') clear();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      dead.current = true;
      gen.current += 1;
      inFlight.current = false;
      clear();
      abort.current?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchOnce]);

  return { block, disclaimer, failed, busy, stopped, refresh: () => { clear(); run.current(); } };
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-[10px] uppercase text-gray-400 font-semibold">{label}</div><div className="text-sm font-semibold text-gray-900">{children}</div></div>;
}

const pctText = (n: number | null | undefined, digits = 1) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`);
const rText = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}R`);

function describe(m: LiveMarkData): string | null {
  switch (m.state) {
    case 'awaiting_entry':
      return m.zone ? `Not entered yet. Price is ${m.zone.distancePts.toFixed(2)} pts (${m.zone.distancePct.toFixed(1)}%) ${m.zone.side} the entry zone.` : 'Not entered yet.';
    case 'in_zone':
      return m.entryBasis === 'm15'
        ? 'Not entered yet. Price is inside the entry zone; the idea enters when a 15-minute candle closes inside it (checked every 15 minutes).'
        : 'Not entered yet. Price is inside the entry zone; the tracker enters on a completed session that touches it.';
    case 'ran_past_target':
      return 'Not entered yet. Price is already past target 1 without entering.';
    case 'beyond_stop':
      return m.entered
        ? 'Price is beyond the stop. The official result is set when the daily bar is scored.'
        : 'Not entered yet. Price is beyond the stop.';
    default: return null;
  }
}

export default function LiveMark({ idea }: { idea: IdeaView }) {
  const { block, disclaimer, failed, busy, stopped, refresh } = useLiveMark(idea.id);
  const m = block?.mark ?? null;
  const nextTarget = m ? m.targets.find(t => !t.reached) ?? null : null;
  const nextIdx = m && nextTarget ? m.targets.indexOf(nextTarget) : -1;
  const basisText = block ? (block.basis === 'live' ? 'Live' : block.basis === 'last_close' ? 'Last close' : 'No price') : '';
  const note = m ? describe(m) : null;
  const touched = m?.rangeHint;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h3 className="text-sm font-bold text-gray-900">Live mark</h3>
        <Pill meta={{ label: 'Provisional', tone: 'amber' }} title="Marked at the current price on the published plan. Not the tracked result." />
        <button onClick={refresh} disabled={busy || stopped} className="ml-auto px-2 py-1 rounded-md border border-gray-200 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">{busy ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {!m ? (
        <p className="text-xs text-gray-500">{busy ? 'Loading live mark…' : stopped ? 'The live mark is not available for this idea.' : failed ? 'Could not load the live mark.' : 'Loading live mark…'}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-bold text-gray-900">{m.price == null || m.state === 'unavailable' ? '—' : fmtPrice(m.price)}</span>
            <span className="text-xs font-semibold text-gray-600">{basisText}{block && m.price != null ? ` · ${SESSION_TEXT[block.session] ?? block.session}` : ''}</span>
            {block?.day?.changePercent != null && m.price != null && <span className={`text-xs font-semibold ${rTone(block.day.changePercent)}`}>{fmtPts(block.day.change)} ({fmtPct(block.day.changePercent, 2)}) today</span>}
            {block && <span className="text-[11px] text-gray-400">as of {fmtWhen(block.asOf)}</span>}
            {failed && <span className="text-[11px] text-amber-700">Could not refresh; showing the last reading.</span>}
          </div>
          {idea.refPrice != null && m.price != null && m.state !== 'unavailable' && (
            <p className="text-[11px] text-gray-500">
              Since publish: <span className={`font-semibold ${rTone(m.price - idea.refPrice)}`}>{fmtPts(m.price - idea.refPrice)} pts ({fmtPct((m.price - idea.refPrice) / idea.refPrice * 100, 2)})</span> from the last close at publish ({fmtPrice(idea.refPrice)}). Price movement only, in either direction; not the idea&apos;s profit or loss.
            </p>
          )}
          {block?.ext && (
            <p className="text-[11px] text-gray-500">{block.ext.label} {fmtPrice(block.ext.price)}{block.ext.changePercent != null ? ` (${pctText(block.ext.changePercent, 2)})` : ''} from the regular close. Shown for context; not used in the R below.</p>
          )}

          {m.state === 'unavailable' && <p className="text-sm text-gray-700">Price unavailable right now.</p>}
          {note && <p className="text-sm text-gray-800">{note}</p>}

          {m.entered && m.state !== 'unavailable' && (
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
              <Cell label="P&L (points)"><span className={rTone(m.points)}>{fmtPts(m.points)} pts</span> <span className="text-[10px] text-gray-400 font-normal">per share</span></Cell>
              <Cell label="R at this price"><span className={rTone(m.r)}>{fmtR(m.r)}</span></Cell>
              <Cell label="Return"><span className={rTone(m.pct)}>{fmtPct(m.pct, 2)}</span></Cell>
              <Cell label="Targets reached">{m.targetsReached} of {m.targetsTotal}</Cell>
              <Cell label="To stop">{pctText(m.stop.distancePct)} <span className="text-[10px] text-gray-400 font-normal">{m.stop.distancePts == null ? '' : `${fmtPts(m.stop.distancePts)} pts`}</span> <span className="text-[10px] text-gray-400 font-normal">{m.stop.distanceR == null ? '' : `${rText(m.stop.distanceR)} of room`}</span></Cell>
              <Cell label={nextTarget ? `To target ${nextIdx + 1}` : 'Targets'}>
                {nextTarget ? <>{pctText(nextTarget.distancePct)} <span className="text-[10px] text-gray-400 font-normal">{nextTarget.distancePts == null ? '' : `${fmtPts(nextTarget.distancePts)} pts · `}{fmtPrice(nextTarget.price)}</span></> : 'All reached'}
              </Cell>
            </div>
          )}

          {m.state !== 'unavailable' && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-600">
              <span><span className="text-red-700 font-semibold">Stop {fmtPrice(m.stop.price)}</span> ({pctText(m.stop.distancePct)}{m.stop.distancePts != null ? `, ${fmtPts(m.stop.distancePts)} pts` : ''})</span>
              {m.targets.map((t, i) => (
                <span key={i}><span className="text-green-700 font-semibold">{t.reached ? '✓ ' : ''}T{i + 1} {fmtPrice(t.price)}</span> ({pctText(t.distancePct)}{t.distancePts != null ? `, ${fmtPts(t.distancePts)} pts` : ''})</span>
              ))}
            </div>
          )}

          {touched && (touched.stop || touched.targetsTouched > 0) && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
              Today&apos;s range touched {touched.stop ? 'the stop' : `target ${touched.targetsTouched}`}. The official score uses completed daily bars (stop first) and may differ.
            </p>
          )}
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-3">
        Provisional mark at the current price on the published plan. Not the tracked result below, not your trade, not advice.
        {disclaimer?.short ? ` ${disclaimer.short}` : ''}
      </p>
    </div>
  );
}
