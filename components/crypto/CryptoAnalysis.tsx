'use client';

/**
 * Crypto instrument page (docs/crypto.md): live candles with the selected expiry's put/call levels drawn
 * per trade date, a current / historical expiry selector, the levels history table and open interest by
 * strike. Candles and quotes are free; levels, expiries and OI need the crypto_levels feature.
 *
 * Days are crypto days (08:00 UTC to 08:00 UTC, lib/cryptoInstruments.ts): the levels for trade date D
 * were computed from the 08:08 UTC snapshot and are drawn on every bar of that day.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import TVChart from '@/components/charts/TVChart';
import Header from '@/components/layout/Header';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import { useAuthContext } from '@/components/providers/AuthContextProvider';
import { FEATURE_CRYPTO_LEVELS, hasFeature } from '@/lib/features';
import { findClosestLevel } from '@/lib/calculations';
import { getLevelColor, getLevelDisplayName } from '@/lib/utils';
import type { LevelCalculation } from '@/types/stock';
import { CRYPTO_INTERVALS, CRYPTO_INTERVAL_ORDER, type CryptoInterval } from '@/lib/cryptoInstruments';
import {
  CORE_LEVELS, CryptoTickerStrip, EXPIRY_KIND_STYLE, LEVEL_ORDER, closestLevel, cryptoExpiryKind, fmtOi, fmtPct, fmtPrice,
  pricePrecisionFor, useCryptoTickers, type CryptoLevels,
} from '@/components/crypto/cryptoShared';

const DAY_MS = 86_400_000;

interface Bar { timestamp: number; date: string; open: number; high: number; low: number; close: number; volume: number }
interface InstrumentInfo { slug: string; coin: string; settlement: string; label: string }
interface Expiry { expiry: string; firstTradeDate: string; lastTradeDate: string; current: boolean }
interface LevelRow {
  tradeDate: string; expiry: string; cmp: number | null; strikeSize: number | null;
  levels: CryptoLevels | null; callOi: number; putOi: number; snapshotTs: string | null;
}
interface LevelsData { latestTradeDate: string | null; expiries: Expiry[]; expiry: string | null; history: LevelRow[] }
interface StrikeRow { strike: number; callOi: number; putOi: number; callOiChg: number | null; putOiChg: number | null }
interface OiData { tradeDate: string | null; prevTradeDate: string | null; underlying: number | null; strikes: StrikeRow[] }

type HistoryEntry = { levels: LevelCalculation[]; closestLevel: string; sevenLevels: { name: string; price: number; value: number }[] };
const NO_LEVELS = new Map<string, HistoryEntry>();

/** The five core levels as the chart's LevelCalculation (missing = price 0, which the chart skips). */
function toCalcs(levels: CryptoLevels, ref: number): LevelCalculation[] {
  return CORE_LEVELS.map(name => {
    const price = levels[name] ?? 0;
    return { name: name as LevelCalculation['name'], price, value: ref ? (ref - price) / ref : 0, distance: Math.abs(ref - price) };
  });
}

function mergeBars(a: Bar[], b: Bar[]): Bar[] {
  const m = new Map<number, Bar>();
  a.forEach(x => m.set(x.timestamp, x));
  b.forEach(x => m.set(x.timestamp, x));
  return [...m.values()].sort((x, y) => x.timestamp - y.timestamp);
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(url, { cache: 'no-store', signal });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) return { ok: false, status: res.status, error: body?.error || `Request failed (${res.status})` };
  return { ok: true, data: body.data as T };
}

export default function CryptoAnalysis({ slug }: { slug: string }) {
  const auth = useAuthContext();
  const entitled = hasFeature(auth.features, FEATURE_CRYPTO_LEVELS);
  const tickers = useCryptoTickers();

  const [instruments, setInstruments] = useState<InstrumentInfo[] | null>(null);
  const inst = instruments?.find(i => i.slug === slug) ?? null;

  const [interval, setInterval_] = useState<CryptoInterval>('daily');
  const [bars, setBars] = useState<Bar[] | null>(null);
  const [barsError, setBarsError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Price decimals, fixed from the first candles (TVChart reads it at mount).
  const [precision, setPrecision] = useState<number | null>(null);
  const exhaustedRef = useRef(false);
  const barsRef = useRef<Bar[]>([]);
  useEffect(() => { barsRef.current = bars ?? []; }, [bars]);

  const [levels, setLevels] = useState<LevelsData | null>(null);
  const [levelsError, setLevelsError] = useState<string | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null);
  const [expiryView, setExpiryView] = useState<'current' | 'historical'>('current');
  const [oi, setOi] = useState<OiData | null>(null);

  // Instrument list: the label, the coin strip, and the coin-settled / USDC switch.
  useEffect(() => {
    getJson<{ instruments: InstrumentInfo[] }>('/api/crypto/instruments').then(r => {
      if (r.ok) setInstruments(r.data.instruments);
      else setInstruments([]);
    }).catch(() => setInstruments([]));
  }, []);

  // Candles: replaced on interval change, then topped up so new bars appear without a reload.
  useEffect(() => {
    const ctl = new AbortController();
    setBars(null);
    setBarsError(null);
    exhaustedRef.current = false;
    getJson<{ data: Bar[] }>(`/api/crypto/${slug}/ohlc?interval=${interval}`, ctl.signal)
      .then(r => {
        if (!r.ok) { setBarsError(r.error); return; }
        setBars(r.data.data);
        setPrecision(p => p ?? pricePrecisionFor(r.data.data.at(-1)?.close));
      })
      .catch(err => { if (!ctl.signal.aborted) setBarsError(err instanceof Error ? err.message : 'Failed to load candles'); });
    const every = interval === 'daily' ? 60_000 : 30_000;
    const t = setInterval(async () => {
      const last = barsRef.current[barsRef.current.length - 1];
      if (!last || document.visibilityState !== 'visible') return;
      const r = await getJson<{ data: Bar[] }>(`/api/crypto/${slug}/ohlc?interval=${interval}&from=${last.timestamp * 1000}&to=${Date.now()}`).catch(() => null);
      if (r?.ok && r.data.data.length) setBars(prev => (prev ? mergeBars(prev, r.data.data) : prev));
    }, every);
    return () => { ctl.abort(); clearInterval(t); };
  }, [slug, interval, reloadKey]);

  // Must keep one identity: TVChart rebuilds the chart when onLoadMore changes, which re-fits the view
  // and fires another load-more (a loop that pulled the whole archive). So it reads state through refs.
  const intervalRef = useRef(interval);
  useEffect(() => { intervalRef.current = interval; }, [interval]);
  const loadingMoreRef = useRef(false);
  const onLoadMore = useCallback(async (direction: 'past' | 'future') => {
    if (direction !== 'past' || exhaustedRef.current || loadingMoreRef.current) return;
    const first = barsRef.current[0];
    if (!first) return;
    const iv = intervalRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const to = first.timestamp * 1000 - 1;
      const from = to - CRYPTO_INTERVALS[iv].chunkDays * DAY_MS;
      const r = await getJson<{ data: Bar[] }>(`/api/crypto/${slug}/ohlc?interval=${iv}&from=${from}&to=${to}`);
      // Dropped if the interval changed while it was in flight.
      if (r.ok && iv === intervalRef.current) {
        if (r.data.data.length === 0) exhaustedRef.current = true; // before the instrument's first bar
        else setBars(prev => (prev ? mergeBars(r.data.data, prev) : prev));
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [slug]);

  // Levels for the selected expiry (default: the nearest current one with data).
  useEffect(() => {
    if (!entitled) return;
    const ctl = new AbortController();
    setLevelsError(null);
    getJson<LevelsData>(`/api/crypto/${slug}/levels${selectedExpiry ? `?expiry=${selectedExpiry}` : ''}`, ctl.signal)
      .then(r => {
        if (!r.ok) { setLevelsError(r.status === 401 || r.status === 403 ? 'upgrade' : r.error); return; }
        setLevels(r.data);
        if (!selectedExpiry && r.data.expiry) setSelectedExpiry(r.data.expiry);
      })
      .catch(err => { if (!ctl.signal.aborted) setLevelsError(err instanceof Error ? err.message : 'Failed to load levels'); });
    return () => ctl.abort();
  }, [slug, entitled, selectedExpiry]);

  // Open interest by strike for the selected expiry, latest trade date.
  useEffect(() => {
    if (!entitled || !levels?.expiry) return;
    const ctl = new AbortController();
    getJson<OiData>(`/api/crypto/${slug}/oi?expiry=${levels.expiry}`, ctl.signal)
      .then(r => setOi(r.ok ? r.data : null))
      .catch(() => {});
    return () => ctl.abort();
  }, [slug, entitled, levels?.expiry]);

  const ticker = inst ? tickers[inst.coin] : undefined;
  const livePrice = ticker?.price;
  const lastClose = bars?.length ? bars[bars.length - 1].close : undefined;

  const candleData = useMemo(() => (bars ?? []).map(b => ({ time: b.timestamp, dayKey: b.date, open: b.open, high: b.high, low: b.low, close: b.close })), [bars]);
  const volumeData = useMemo(() => (bars ?? []).map(b => ({ time: b.timestamp, dayKey: b.date, value: b.volume })), [bars]);

  const history = useMemo(() => (levels && levels.expiry === selectedExpiry ? levels.history : []), [levels, selectedExpiry]);

  const historicalLevels = useMemo(() => {
    if (!history.length) return NO_LEVELS;
    const map = new Map<string, HistoryEntry>();
    for (const row of history) {
      if (!row.levels || !row.cmp) continue;
      const calcs = toCalcs(row.levels, row.cmp);
      const real = calcs.filter(c => c.price > 0);
      map.set(row.tradeDate, {
        levels: calcs,
        closestLevel: real.length ? findClosestLevel(real).name : '',
        sevenLevels: LEVEL_ORDER.map(name => ({ name, price: row.levels![name] ?? 0, value: (row.cmp! - (row.levels![name] ?? 0)) / row.cmp! })),
      });
    }
    return map;
  }, [history]);

  const oiData = useMemo(() => history.filter(r => r.levels).map(r => ({ time: r.tradeDate, callOi: r.callOi, putOi: r.putOi, oiDiff: r.putOi - r.callOi })), [history]);

  // Header levels: the expiry's latest row, measured from the live price.
  const latestRow = [...history].reverse().find(r => r.levels) ?? null;
  const refPrice = livePrice ?? latestRow?.cmp ?? 0;
  const currentCalcs = latestRow?.levels && refPrice ? toCalcs(latestRow.levels, refPrice) : [];
  const closest = closestLevel(latestRow?.levels, refPrice);
  const prec = precision ?? pricePrecisionFor(refPrice);

  if (instruments && !inst) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="container mx-auto px-4 py-6">
          <ErrorDisplay error={`No crypto market "${slug}".`} />
          <p className="text-center text-sm"><Link href="/crypto" className="text-blue-700 underline">All crypto markets</Link></p>
        </main>
      </div>
    );
  }

  const coins = (() => {
    const seen = new Map<string, string>();
    instruments?.forEach(i => { if (!seen.has(i.coin)) seen.set(i.coin, i.slug); });
    return [...seen].map(([coin, s]) => ({ coin, slug: s }));
  })();
  const siblings = instruments?.filter(i => inst && i.coin === inst.coin) ?? [];

  const dayChange = ticker?.changePct24h != null ? ticker.price - ticker.price / (1 + ticker.changePct24h / 100) : null;

  const intervalSelector = (
    <div className="flex gap-1">
      {CRYPTO_INTERVAL_ORDER.map(iv => (
        <button
          key={iv}
          onClick={() => setInterval_(iv)}
          className={`px-2 py-0.5 rounded text-xs font-semibold ${interval === iv ? 'bg-blue-600 text-white' : 'bg-white/90 text-gray-700 hover:bg-gray-100 border border-gray-200'}`}
        >
          {CRYPTO_INTERVALS[iv].label}
        </button>
      ))}
    </div>
  );

  const marketSwitch = siblings.length > 1 && (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-gray-500 mr-1">Options settled in</span>
      {siblings.map(s => (
        <Link
          key={s.slug}
          href={`/crypto/${s.slug}`}
          className={`px-2 py-0.5 rounded border font-semibold ${s.slug === slug ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
        >
          {s.settlement === s.coin ? `${s.coin} (coin)` : s.settlement}
        </Link>
      ))}
    </div>
  );

  const visibleExpiries = (levels?.expiries ?? []).filter(e => (expiryView === 'current' ? e.current : !e.current));
  const expiryPanel = !entitled || levelsError === 'upgrade' ? (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="font-semibold mb-1">Crypto price levels</div>
      Put / call levels, expiries and open interest are a paid feature.{' '}
      {auth.loggedIn
        ? <Link href="/upgrade?feature=crypto_levels" className="font-semibold underline">See plans</Link>
        : <Link href={`/login?redirect=/crypto/${slug}`} className="font-semibold underline">Sign in</Link>}
    </div>
  ) : (
    <div className="rounded-xl border border-gray-200 bg-white p-3 w-full min-w-0">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs font-semibold text-gray-700">Expiry</div>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[11px] font-semibold">
          {(['current', 'historical'] as const).map(v => (
            <button key={v} onClick={() => setExpiryView(v)} className={`px-2 py-0.5 ${expiryView === v ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {v === 'current' ? 'Current' : 'Historical'}
            </button>
          ))}
        </div>
      </div>
      {levelsError ? (
        <div className="text-xs text-red-600">{levelsError}</div>
      ) : !levels ? (
        <div className="text-xs text-gray-400">Loading expiries…</div>
      ) : visibleExpiries.length === 0 ? (
        <div className="text-xs text-gray-400">No {expiryView} expiries stored.</div>
      ) : (
        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
          {visibleExpiries.map(e => {
            const kind = cryptoExpiryKind(e.expiry);
            const sel = e.expiry === selectedExpiry;
            return (
              <button
                key={e.expiry}
                onClick={() => setSelectedExpiry(e.expiry)}
                title={`${kind} · levels stored ${e.firstTradeDate} → ${e.lastTradeDate}`}
                className={`px-1.5 py-0.5 rounded border text-[11px] tabular-nums ${sel ? 'bg-blue-600 text-white border-blue-600' : EXPIRY_KIND_STYLE[kind]}`}
              >
                {e.expiry.slice(5)}{e.expiry.slice(0, 4) !== levels.latestTradeDate?.slice(0, 4) ? ` ’${e.expiry.slice(2, 4)}` : ''}
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-gray-500">
        {(['daily', 'weekly', 'monthly', 'quarterly'] as const).map(k => (
          <span key={k} className="inline-flex items-center gap-1"><span className={`inline-block h-2.5 w-2.5 rounded border ${EXPIRY_KIND_STYLE[k]}`} />{k}</span>
        ))}
      </div>
      {latestRow && (
        <div className="mt-2 text-[11px] text-gray-500">
          Levels as of {latestRow.tradeDate}
          {latestRow.snapshotTs ? ` ${latestRow.snapshotTs.slice(11, 16)} UTC` : ''}
          {closest && <> · closest <span className="font-semibold" style={{ color: getLevelColor(closest.name) }}>{getLevelDisplayName(closest.name)}</span> {fmtPrice(closest.price, prec)} ({fmtPct(closest.pct * 100)})</>}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="container mx-auto px-4 py-4">
        <div className="mb-3 flex items-center gap-3">
          <Link href="/crypto" className="text-xs text-blue-700 hover:underline shrink-0">← All crypto</Link>
          <div className="min-w-0 flex-1"><CryptoTickerStrip tickers={tickers} coins={coins} active={inst?.coin} /></div>
        </div>

        {barsError && !bars ? (
          <ErrorDisplay error={barsError} onRetry={() => setReloadKey(k => k + 1)} />
        ) : !bars || !inst || precision === null ? (
          <LoadingSpinner message="Loading chart..." />
        ) : (
          <div className="relative mb-6">
            <TVChart
              key={`${slug}:${precision}`}
              symbol={inst.coin}
              companyName={inst.settlement === inst.coin ? `${inst.coin} options, coin-settled` : `${inst.coin} options, ${inst.settlement}-settled`}
              chips={['24/7', 'Times in UTC']}
              candleData={candleData}
              volumeData={volumeData}
              oiData={oiData}
              levels={currentCalcs}
              closestLevel={closest?.name}
              historicalLevels={historicalLevels}
              selectedExpiry={selectedExpiry ?? undefined}
              isIntraday={interval !== 'daily'}
              livePrice={livePrice}
              quotePrice={livePrice}
              marketSession="regular"
              currentPrice={lastClose}
              dayChange={dayChange}
              dayChangePercent={ticker?.changePct24h ?? null}
              dayHigh={ticker?.high24h ?? null}
              dayLow={ticker?.low24h ?? null}
              headerExtra={intervalSelector}
              headerBelow={marketSwitch || undefined}
              topAside={expiryPanel}
              height={600}
              resizable
              onLoadMore={onLoadMore}
              isLoadingMore={loadingMore}
              pricePrecision={precision}
              timeZone="UTC"
            />
          </div>
        )}

        {entitled && levelsError !== 'upgrade' && history.length > 0 && (
          <div className="grid gap-4 xl:grid-cols-2">
            <LevelsHistoryTable history={history} precision={prec} expiry={selectedExpiry} />
            <OiByStrike oi={oi} precision={prec} price={refPrice} expiry={levels?.expiry ?? null} />
          </div>
        )}
      </main>
    </div>
  );
}

function LevelsHistoryTable({ history, precision, expiry }: { history: LevelRow[]; precision: number; expiry: string | null }) {
  const rows = [...history].reverse();
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm min-w-0">
      <h2 className="px-4 pt-3 pb-2 text-sm font-semibold text-gray-800">Levels by trade date <span className="font-normal text-gray-500">· expiry {expiry}</span></h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-2 py-1.5 text-left">Trade date</th>
              <th className="px-2 py-1.5 text-right">Price</th>
              {LEVEL_ORDER.map(n => <th key={n} className="px-2 py-1.5 text-right whitespace-nowrap" style={{ color: getLevelColor(n) }}>{getLevelDisplayName(n)}</th>)}
              <th className="px-2 py-1.5 text-right">Call OI</th>
              <th className="px-2 py-1.5 text-right">Put OI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 tabular-nums">
            {rows.map(r => {
              const close = closestLevel(r.levels, r.cmp);
              return (
                <tr key={r.tradeDate}>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.tradeDate}</td>
                  <td className="px-2 py-1.5 text-right">{fmtPrice(r.cmp, precision)}</td>
                  {r.levels ? LEVEL_ORDER.map(n => (
                    <td key={n} className={`px-2 py-1.5 text-right ${close?.name === n ? 'font-bold text-blue-700' : ''}`}>{fmtPrice(r.levels![n], precision)}</td>
                  )) : <td colSpan={LEVEL_ORDER.length} className="px-2 py-1.5 text-center text-gray-400">no open interest in this snapshot</td>}
                  <td className="px-2 py-1.5 text-right">{fmtOi(r.callOi)}</td>
                  <td className="px-2 py-1.5 text-right">{fmtOi(r.putOi)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const STRIKES_EACH_SIDE = 12;

function OiByStrike({ oi, precision, price, expiry }: { oi: OiData | null; precision: number; price: number; expiry: string | null }) {
  const view = useMemo(() => {
    if (!oi?.strikes.length) return null;
    const ref = price || oi.underlying || 0;
    let at = oi.strikes.findIndex(s => s.strike >= ref);
    if (at < 0) at = oi.strikes.length - 1;
    const rows = oi.strikes.slice(Math.max(0, at - STRIKES_EACH_SIDE), at + STRIKES_EACH_SIDE);
    const max = Math.max(1, ...rows.map(r => Math.max(r.callOi, r.putOi)));
    return { rows, max, ref };
  }, [oi, price]);

  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm min-w-0">
      <h2 className="px-4 pt-3 pb-2 text-sm font-semibold text-gray-800">
        Open interest by strike <span className="font-normal text-gray-500">· expiry {expiry}{oi?.tradeDate ? ` · ${oi.tradeDate}` : ''}{oi?.prevTradeDate ? ` (change vs ${oi.prevTradeDate})` : ''}</span>
      </h2>
      {!view ? (
        <p className="px-4 pb-4 text-xs text-gray-400">{oi ? 'No strikes stored for this expiry.' : 'Loading…'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-2 py-1.5 text-right">Δ Call</th>
                <th className="px-2 py-1.5 text-right w-2/5">Call OI</th>
                <th className="px-2 py-1.5 text-center">Strike</th>
                <th className="px-2 py-1.5 text-left w-2/5">Put OI</th>
                <th className="px-2 py-1.5 text-left">Δ Put</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r, i) => {
                const atMoney = view.rows[i + 1] && r.strike <= view.ref && view.rows[i + 1].strike > view.ref;
                const chg = (v: number | null) => v == null ? '—' : <span className={v > 0 ? 'text-green-700' : v < 0 ? 'text-red-700' : 'text-gray-400'}>{v > 0 ? '+' : ''}{fmtOi(v)}</span>;
                return (
                  <tr key={r.strike} className={atMoney ? 'border-b-2 border-blue-400' : 'border-b border-gray-50'}>
                    <td className="px-2 py-1 text-right">{chg(r.callOiChg)}</td>
                    <td className="px-2 py-1">
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-gray-600">{fmtOi(r.callOi)}</span>
                        <div className="h-2.5 rounded-l bg-red-400" style={{ width: `${(r.callOi / view.max) * 100}%`, maxWidth: '75%' }} />
                      </div>
                    </td>
                    <td className={`px-2 py-1 text-center font-semibold ${r.strike < view.ref ? 'bg-amber-50/60' : ''}`}>{fmtPrice(r.strike, r.strike >= 100 ? 0 : precision)}</td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        <div className="h-2.5 rounded-r bg-green-500" style={{ width: `${(r.putOi / view.max) * 100}%`, maxWidth: '75%' }} />
                        <span className="text-gray-600">{fmtOi(r.putOi)}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1">{chg(r.putOiChg)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[10px] text-gray-400">Blue rule = live price. Shaded strikes are below it (in the money for calls).</p>
        </div>
      )}
    </section>
  );
}
