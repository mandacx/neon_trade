'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import ColRow from '@/components/ui/ColRow';
import ColumnsMenu from '@/components/ui/ColumnsMenu';
import { useColumnPrefs } from '@/components/ui/useColumnPrefs';
import type { ColumnMeta } from '@/lib/tableColumns';
import { getLevelDisplayName } from '@/lib/utils';
import { ChangeDot, ChangePercentCell } from '@/components/watchlists/watchlistShared';
import {
  CryptoChangeCell, CryptoLevelCell, CryptoTickerStrip, SortHeader, change24h, closestLevel, fmtCompact, fmtOi, fmtPrice,
  pricePrecisionFor, useCryptoTickers, type CryptoLevelName, type CryptoLevels, type CryptoTicker,
} from '@/components/crypto/cryptoShared';

interface InstrumentRow {
  slug: string;
  coin: string;
  settlement: string;
  label: string;
  latestTradeDate: string;
  ticker: CryptoTicker | null;
  nearest: { expiry: string; tradeDate: string; cmp: number | null; levels: CryptoLevels; callOi: number; putOi: number } | null;
}

type DirectionFilter = 'all' | 'up' | 'down';
type MarketFilter = 'all' | 'coin' | 'usdc';
type ViewMode = 'thin' | 'broad';
type SortKey = 'symbol' | 'lastPrice' | 'change' | 'changePercent' | 'dayLow' | 'dayHigh' | 'volume' | 'level' | 'expiry' | 'putInt' | 'callInt' | 'callOi' | 'putOi';

/** Columns of the markets table, in display order, laid out like the watchlists table. Saved per user (the Columns menu). */
const CRYPTO_COLUMNS: ColumnMeta[] = [
  { id: 'symbol', label: 'Symbol', required: true },
  { id: 'lastPrice', label: 'Last Price' },
  { id: 'change', label: 'Change', hint: 'Over the last 24 hours (crypto trades 24/7)' },
  { id: 'changePercent', label: 'Change %', hint: 'Over the last 24 hours' },
  { id: 'dayLow', label: '24h Low' },
  { id: 'dayHigh', label: '24h High' },
  { id: 'volume', label: '24h Volume', hint: 'In US dollars' },
  { id: 'level', label: 'Nearest Level', hint: 'Of the nearest expiry, measured from the live price' },
  { id: 'expiry', label: 'Expiry', hint: 'Nearest expiry with open interest' },
  { id: 'putInt', label: 'Put Int' },
  { id: 'callInt', label: 'Call Int' },
  { id: 'callOi', label: 'Call OI', hint: 'Open interest at the last snapshot, in contracts' },
  { id: 'putOi', label: 'Put OI', hint: 'Open interest at the last snapshot, in contracts' },
];
// Shown only to viewers with the crypto_levels feature.
const LEVEL_COLUMNS: ReadonlySet<string> = new Set(['level', 'expiry', 'putInt', 'callInt', 'callOi', 'putOi']);
const LEVEL_FILTER_OPTIONS: CryptoLevelName[] = ['call_high', 'call_int', 'put_call_int', 'put_int', 'put_low'];

const RELOAD_MS = 5 * 60_000;
const labelClass = 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1';
const selectClass = 'px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white';

export default function CryptoPage() {
  const [rows, setRows] = useState<InstrumentRow[] | null>(null);
  const [entitled, setEntitled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('all');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [levelFilter, setLevelFilter] = useState<CryptoLevelName | ''>('');
  const [proximityEnabled, setProximityEnabled] = useState(false);
  const [proximityThreshold, setProximityThreshold] = useState(5);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<ViewMode>('thin');
  const cols = useColumnPrefs('crypto', CRYPTO_COLUMNS);
  const live = useCryptoTickers();

  // Instruments and levels change once a day; reload them every few minutes, quotes poll separately.
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch('/api/crypto/instruments', { cache: 'no-store' });
        const body = await res.json();
        if (stopped) return;
        if (!body.success) throw new Error(body.error || 'Failed to load');
        setRows(body.data.instruments);
        setEntitled(body.data.entitled);
        setError(null);
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : 'Failed to load');
      }
    };
    load();
    const t = setInterval(load, RELOAD_MS);
    return () => { stopped = true; clearInterval(t); };
  }, [reloadKey]);

  const coins = useMemo(() => {
    const seen = new Map<string, string>();
    rows?.forEach(r => { if (!seen.has(r.coin)) seen.set(r.coin, r.slug); });
    return [...seen].map(([coin, slug]) => ({ coin, slug }));
  }, [rows]);

  // One row per market with the live quote merged in and the closest level measured from the live price.
  const view = (rows ?? []).map(r => {
    const t = live[r.coin] ?? r.ticker;
    const price = t?.price ?? r.nearest?.cmp ?? null;
    return {
      r, t, price,
      prec: pricePrecisionFor(price),
      change: change24h(price, t?.changePct24h),
      close: closestLevel(r.nearest?.levels, price),
    };
  });
  type ViewRow = (typeof view)[number];

  const thin = viewMode === 'thin';
  const cellPad = thin ? 'px-3 py-1' : 'px-4 py-2.5';
  const colOn = (k: string) => cols.isShown(k) && (entitled || !LEVEL_COLUMNS.has(k));
  const menuColumns = CRYPTO_COLUMNS.filter(c => entitled || !LEVEL_COLUMNS.has(c.id));

  const visible = view.filter(v => {
    const q = search.trim().toUpperCase();
    if (q && !v.r.coin.includes(q) && !v.r.label.toUpperCase().includes(q)) return false;
    if (marketFilter === 'coin' && v.r.coin !== v.r.settlement) return false;
    if (marketFilter === 'usdc' && v.r.coin === v.r.settlement) return false;
    if (directionFilter === 'up' && !((v.change ?? 0) > 0)) return false;
    if (directionFilter === 'down' && !((v.change ?? 0) < 0)) return false;
    if (entitled && levelFilter && v.close?.name !== levelFilter) return false;
    if (entitled && proximityEnabled && (!v.close || Math.abs(v.close.pct * 100) > proximityThreshold)) return false;
    return true;
  });

  function sortValue(v: ViewRow, key: SortKey): number | string | null {
    switch (key) {
      case 'symbol': return v.r.label;
      case 'lastPrice': return v.price;
      case 'change': return v.change;
      case 'changePercent': return v.t?.changePct24h ?? null;
      case 'dayLow': return v.t?.low24h ?? null;
      case 'dayHigh': return v.t?.high24h ?? null;
      case 'volume': return v.t?.volumeUsd24h ?? null;
      case 'level': return v.close ? Math.abs(v.close.pct) : null;
      case 'expiry': return v.r.nearest?.expiry ?? null;
      case 'putInt': return v.r.nearest?.levels.put_int ?? null;
      case 'callInt': return v.r.nearest?.levels.call_int ?? null;
      case 'callOi': return v.r.nearest?.callOi ?? null;
      case 'putOi': return v.r.nearest?.putOi ?? null;
    }
  }

  const sorted = sortKey ? [...visible].sort((a, b) => {
    const av = sortValue(a, sortKey);
    const bv = sortValue(b, sortKey);
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // missing values always sort to the end, regardless of direction
    if (bv == null) return -1;
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortDir === 'asc' ? cmp : -cmp;
  }) : visible;

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }
  const head = (id: SortKey, label: string, align: 'left' | 'right' = 'right') => colOn(id) && (
    <th data-col={id} className={`${cellPad} ${align === 'right' ? 'text-right' : ''}`}>
      <SortHeader label={label} align={align} active={sortKey === id} dir={sortDir} onClick={() => toggleSort(id)} />
    </th>
  );
  const colSpan = CRYPTO_COLUMNS.filter(c => c.required || colOn(c.id)).length;

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
        <div className="container mx-auto px-4 py-6">
          <div className="mb-5">
            <h1 className="text-xl font-bold text-gray-900">Crypto Levels</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Put / call open-interest levels for crypto options, from a daily snapshot at 08:00 UTC (option expiry time). Prices are live, 24/7.
            </p>
          </div>

          {coins.length > 0 && <div className="mb-4"><CryptoTickerStrip tickers={{ ...Object.fromEntries(rows!.filter(r => r.ticker).map(r => [r.coin, r.ticker!])), ...live }} coins={coins} /></div>}

          {!entitled && rows && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Crypto price levels are a paid feature. Prices and charts stay free.{' '}
              <Link href="/upgrade?feature=crypto_levels" className="font-semibold underline">See plans</Link>
            </div>
          )}

          {/* Toolbar: the same controls as the watchlists page, minus what has no crypto equivalent. */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className={labelClass}>Search</label>
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Coin…"
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white w-36"
                  />
                </div>

                <div>
                  <label className={labelClass}>Settlement</label>
                  <select value={marketFilter} onChange={e => setMarketFilter(e.target.value as MarketFilter)} className={selectClass}>
                    <option value="all">All markets</option>
                    <option value="coin">Coin-settled</option>
                    <option value="usdc">USDC-settled</option>
                  </select>
                </div>

                {entitled && (
                  <div>
                    <label className={labelClass}>Level</label>
                    <select value={levelFilter} onChange={e => setLevelFilter(e.target.value as CryptoLevelName | '')} className={selectClass}>
                      <option value="">All levels</option>
                      {LEVEL_FILTER_OPTIONS.map(l => <option key={l} value={l}>{getLevelDisplayName(l)}</option>)}
                    </select>
                  </div>
                )}

                <div>
                  <label className={labelClass}>Direction</label>
                  <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                    {(['all', 'up', 'down'] as DirectionFilter[]).map(d => (
                      <button
                        key={d}
                        onClick={() => setDirectionFilter(d)}
                        className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${directionFilter === d ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
                      >
                        {d === 'all' ? 'All' : d === 'up' ? '▲ Gainers' : '▼ Losers'}
                      </button>
                    ))}
                  </div>
                </div>

                {entitled && (
                  <div>
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1 cursor-pointer select-none">
                      <input type="checkbox" checked={proximityEnabled} onChange={e => setProximityEnabled(e.target.checked)} className="accent-blue-600" />
                      Near a level: {proximityThreshold}%
                    </label>
                    <input
                      type="range" min="1" max="20" step="0.5"
                      value={proximityThreshold}
                      disabled={!proximityEnabled}
                      onChange={e => setProximityThreshold(parseFloat(e.target.value))}
                      className="w-32 accent-blue-500 disabled:opacity-40 mb-2"
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4">
                <div>
                  <label className={labelClass}>Row Height</label>
                  <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                    {(['thin', 'broad'] as ViewMode[]).map(m => (
                      <button
                        key={m}
                        onClick={() => setViewMode(m)}
                        title={m === 'thin' ? 'One line per market — see more at once' : 'Full detail per market'}
                        className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors capitalize ${viewMode === m ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <ColumnsMenu metas={menuColumns} {...cols.menu} />
              </div>
            </div>
          </div>

          {error && !rows ? (
            <ErrorDisplay error={error} onRetry={() => setReloadKey(k => k + 1)} />
          ) : !rows ? (
            <LoadingSpinner message="Loading crypto markets..." />
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <span className="font-semibold text-sm text-gray-900">Markets</span>
                <span className="text-[11px] text-gray-400">
                  {visible.length !== rows.length ? `${visible.length} of ${rows.length} markets` : `${rows.length} markets`}
                </span>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                <div className={`overflow-x-auto ${cols.hideUntilReady}`}>
                  <table className="w-full text-sm">
                    <thead>
                      <ColRow layout={cols.layout} header className="text-left text-[11px] font-semibold text-gray-500 uppercase bg-gray-50 border-b border-gray-100 whitespace-nowrap">
                        <th data-col="symbol" className={cellPad}><SortHeader label="Symbol" active={sortKey === 'symbol'} dir={sortDir} onClick={() => toggleSort('symbol')} /></th>
                        {head('lastPrice', 'Last Price')}
                        {head('change', 'Change')}
                        {head('changePercent', 'Change %')}
                        {head('dayLow', '24h Low')}
                        {head('dayHigh', '24h High')}
                        {head('volume', '24h Volume')}
                        {head('level', 'Nearest Level')}
                        {head('expiry', 'Expiry')}
                        {head('putInt', 'Put Int')}
                        {head('callInt', 'Call Int')}
                        {head('callOi', 'Call OI')}
                        {head('putOi', 'Put OI')}
                      </ColRow>
                    </thead>
                    <tbody>
                      {sorted.map(({ r, t, price, prec, change, close }) => {
                        const href = `/crypto/${r.slug}`;
                        const market = r.coin === r.settlement ? 'coin-settled' : `${r.settlement}-settled`;
                        const n = r.nearest;
                        return (
                          <ColRow layout={cols.layout} key={r.slug} className="border-b border-gray-50 transition-colors hover:bg-blue-50/40">
                            <td data-col="symbol" className={cellPad}>
                              <Link href={href} className={`flex items-center gap-1.5 hover:underline ${thin ? 'whitespace-nowrap' : ''}`}>
                                <ChangeDot change={change} />
                                <span className="font-semibold text-gray-900">{r.coin}</span>
                                {thin && <span className="text-[11px] text-gray-400">{market}</span>}
                              </Link>
                              {!thin && <div className="text-[11px] text-gray-400 pl-3">{market}</div>}
                            </td>
                            {colOn('lastPrice') && <td data-col="lastPrice" className={`${cellPad} text-right font-semibold text-gray-800 tabular-nums`}>
                              <Link href={href} className="hover:underline">{fmtPrice(price, prec)}</Link>
                            </td>}
                            {colOn('change') && <td data-col="change" className={`${cellPad} text-right`}><CryptoChangeCell change={change} precision={prec} /></td>}
                            {colOn('changePercent') && <td data-col="changePercent" className={`${cellPad} text-right`}><ChangePercentCell changePercent={t?.changePct24h ?? null} /></td>}
                            {colOn('dayLow') && <td data-col="dayLow" className={`${cellPad} text-right text-gray-600 tabular-nums`}>{fmtPrice(t?.low24h, prec)}</td>}
                            {colOn('dayHigh') && <td data-col="dayHigh" className={`${cellPad} text-right text-gray-600 tabular-nums`}>{fmtPrice(t?.high24h, prec)}</td>}
                            {colOn('volume') && <td data-col="volume" className={`${cellPad} text-right text-gray-600 tabular-nums`}>{t?.volumeUsd24h != null ? `$${fmtCompact(t.volumeUsd24h)}` : '—'}</td>}
                            {colOn('level') && <td data-col="level" className={cellPad}><CryptoLevelCell close={close} precision={prec} expiry={n?.expiry} tradeDate={n?.tradeDate} compact={thin} /></td>}
                            {colOn('expiry') && <td data-col="expiry" className={`${cellPad} text-right text-gray-600 tabular-nums whitespace-nowrap`}>{n?.expiry ?? '—'}</td>}
                            {colOn('putInt') && <td data-col="putInt" className={`${cellPad} text-right text-gray-600 tabular-nums`}>{fmtPrice(n?.levels.put_int, prec)}</td>}
                            {colOn('callInt') && <td data-col="callInt" className={`${cellPad} text-right text-gray-600 tabular-nums`}>{fmtPrice(n?.levels.call_int, prec)}</td>}
                            {colOn('callOi') && <td data-col="callOi" className={`${cellPad} text-right text-gray-600 tabular-nums`}>{n ? fmtOi(n.callOi) : '—'}</td>}
                            {colOn('putOi') && <td data-col="putOi" className={`${cellPad} text-right text-gray-600 tabular-nums`}>{n ? fmtOi(n.putOi) : '—'}</td>}
                          </ColRow>
                        );
                      })}
                      {rows.length === 0 && (
                        <tr><td colSpan={colSpan} className="text-center text-gray-400 py-8 text-xs">No crypto levels stored yet.</td></tr>
                      )}
                      {rows.length > 0 && visible.length === 0 && (
                        <tr><td colSpan={colSpan} className="text-center text-gray-400 py-8 text-xs">No markets match your filters.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
