'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import TVChart from '@/components/charts/TVChart';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import Header from '@/components/layout/Header';
import ScanAlertsTicker from '@/components/ui/ScanAlertsTicker';
import OptionContractModal from '@/components/stock/OptionContractModal';
import { EarningsHeaderLines, EarningsExpiryChip, EarningsHistoryTable } from '@/components/stock/EarningsPanel';
import Tabs from '@/components/ui/Tabs';
import PriceLevelsTab, { RANGE_PRESET_DAYS, type RangePreset } from '@/components/stock/tabs/PriceLevelsTab';
import OpenInterestTab from '@/components/stock/tabs/OpenInterestTab';
import OptionChainTab from '@/components/stock/tabs/OptionChainTab';
import { shiftDateString } from '@/components/stock/tabs/shared';
import { useAuthContext } from '@/components/providers/AuthContextProvider';
import { FEATURE_OPTION_CHAIN, FEATURE_STRATEGY_BUILDER, hasFeature } from '@/lib/features';
import type { EarningsResult, EarningsSummary } from '@/types/earnings';
import { LevelCalculation, ScanAlert } from '@/types/stock';
import { getLevelColor, getLevelDisplayName, formatCurrency, formatPercentage } from '@/lib/utils';
import { isIntradayInterval } from '@/lib/marketdata/intervals';
import type { ExtendedQuote } from '@/lib/quote';
import type { MarketSession } from '@/lib/marketSession';
import { pollDelayMs } from '@/lib/pollDelay';
import ExtendedMove from '@/components/ui/ExtendedMove';
import { useChartPrefs } from '@/components/charts/useChartPrefs';
import { format, subDays } from 'date-fns';

type SelectableInterval = '1min' | '5min' | '15min' | '30min' | '1hour' | 'daily';

// initialDays = default lookback on first load / interval switch; chunkDays = how
// much more to pull per scroll-back "load more". Finer intervals use smaller
// windows so a single fetch/pagination round stays a reasonable size.
const INTERVAL_CONFIG: Record<SelectableInterval, { initialDays: number; chunkDays: number; label: string }> = {
  '1min': { initialDays: 2, chunkDays: 1, label: '1m' },
  '5min': { initialDays: 5, chunkDays: 3, label: '5m' },
  '15min': { initialDays: 10, chunkDays: 5, label: '15m' },
  '30min': { initialDays: 20, chunkDays: 10, label: '30m' },
  '1hour': { initialDays: 30, chunkDays: 15, label: '1H' },
  // 85 calendar days ~ 60 daily bars, loaded first and then in chunks of the same size as
  // the chart scrolls back (TVChart draws 12px candles, so a typical screen needs ~100
  // bars: one or two chunks load on open). Each chunk costs one /levels range call and
  // that endpoint allows only 10 a minute, which is why load-more skips the duplicate
  // whole-range refetch below (see skipLevelsRefetchRef).
  daily: { initialDays: 85, chunkDays: 85, label: '1D' },
};
const INTERVAL_ORDER: SelectableInterval[] = ['1min', '5min', '15min', '30min', '1hour', 'daily'];

// One row of the 7-level historical table: the DB's full level set (superset of
// the 5 "official" levels used for closest-level business logic elsewhere).
type SevenLevel = { name: string; price: number; value: number };
type LevelHistoryEntry = {
  levels: LevelCalculation[];
  closestLevel: string;
  /** The date's own session close (the candle's close) when known: the levels' proximity is measured against it. Else the stored close. */
  close: number;
  /** The stored EOD close for this load date (the previous session's close). */
  eodClose?: number;
  /** The date's own session open / high / low (null when the bar is unknown). */
  open?: number | null;
  high?: number | null;
  low?: number | null;
  sevenLevels: SevenLevel[];
  oi?: { callOi: number; putOi: number; oiDiff: number } | null;
  ratios?: { upc: number; ucpr: number };
};
/**
 * Which symbol / expiry / date range the chart's `historicalLevels` already holds (from the last fetch, plus any
 * chunks merged by load-more). A request for a range inside it would only return what is already loaded, so it
 * is skipped: opening a stock, switching interval and the Price Levels History panel all used to ask the levels
 * endpoint (limited to 10 range calls a minute per user) for data the page already had.
 */
interface LevelsCoverage { symbol: string; expiry: string; from: string; to: string }
const coversRange = (c: LevelsCoverage | null, symbol: string, expiry: string, from: string, to: string) =>
  !!c && c.symbol === symbol && c.expiry === expiry && from >= c.from && to <= c.to;

const NO_LEVELS = new Map<string, LevelHistoryEntry>();

// Tabs below the chart (docs/CHANGES.md 2026-10-28 "stock page tabs"); `?tab=` keeps the open one.
type StockTab = 'levels' | 'oi' | 'chain' | 'earnings';
const STOCK_TABS: StockTab[] = ['levels', 'oi', 'chain', 'earnings'];

// Shape of /api/stocks/[symbol]/quote. Every field but `price` can be null —
// The snapshot omits prevDailyBar/dailyBar for names that haven't printed, and the
// route reports null rather than a NaN change in that case.
interface LiveQuote {
  /** Live in the regular session; the last regular close outside it. */
  price: number;
  dayOpen: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  prevClose: number | null;
  change: number | null;
  changePercent: number | null;
  /** Pre-market / after-hours move from the regular close; null when nothing printed. */
  ext: ExtendedQuote | null;
  /** Which session it is and when it next changes (drives the polling cadence). */
  market: { session: MarketSession; nextChangeAt: string | null };
}

// public.securities metadata, returned alongside `data` by the details route.
interface SecurityMeta {
  name: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  marketCapTier: string | null;
  exchange: string | null;
}

// Compact market cap for the header chip: $31.2B rather than $31,200,000,000.
function formatMarketCap(value: number | null): string | null {
  if (!value || value <= 0) return null;
  const units: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M']];
  for (const [size, suffix] of units) {
    if (value >= size) return `$${(value / size).toFixed(value / size >= 100 ? 0 : 1)}${suffix}`;
  }
  return `$${value.toLocaleString()}`;
}

type ExpiryMode = 'current' | 'historical';


// TVChart's onLoadMore reports its bars' `firstVisibleTime`/`lastVisibleTime`
// as epoch-second strings (chart time values), used only as a fallback for
// when `ohlcData` is momentarily empty — the common case is a real
// 'YYYY-MM-DD' string from an actual loaded bar.
// Merges a freshly loaded chunk into existing series data: de-duplicates on the
// key (later chunk wins) and returns ascending order, so overlapping or
// out-of-order loads can never leave duplicate or misordered bars on the chart.
function mergeSorted<T>(a: T[], b: T[], key: (item: T) => string | number): T[] {
  const byKey = new Map<string | number, T>();
  a.forEach(item => byKey.set(key(item), item));
  b.forEach(item => byKey.set(key(item), item));
  return Array.from(byKey.values()).sort((x, y) => {
    const kx = key(x), ky = key(y);
    return kx < ky ? -1 : kx > ky ? 1 : 0;
  });
}

function dateStringFrom(dateOnly: string | undefined, epochSecondsStr: string): string {
  if (dateOnly) return dateOnly;
  const epoch = Number(epochSecondsStr);
  return Number.isFinite(epoch) ? format(new Date(epoch * 1000), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
}

// Buckets already-most-recent-first-sorted expiry dates by year, preserving
// that order — most recent year first, most recent date first within a year.
function groupExpiriesByYear(dates: string[]): { year: string; dates: string[] }[] {
  const byYear = new Map<string, string[]>();
  dates.forEach(date => {
    const year = date.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(date);
  });
  return Array.from(byYear.entries()).map(([year, dates]) => ({ year, dates }));
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Buckets expiry dates into consecutive month groups, preserving input order.
// `label` carries a 'yy suffix on the first month of each year after the first
// ("Jan '27"), so a long ladder of LEAPS stays readable without repeating the
// year on every group.
function groupExpiriesByMonth(dates: string[], showYearSuffix = true): { key: string; label: string; dates: string[] }[] {
  const groups: { key: string; label: string; dates: string[] }[] = [];
  dates.forEach(date => {
    const key = date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.dates.push(date);
      return;
    }
    const prevYear = last?.key.slice(0, 4);
    const year = date.slice(0, 4);
    const month = MONTH_NAMES[parseInt(date.slice(5, 7), 10) - 1] ?? date.slice(5, 7);
    const suffix = showYearSuffix && prevYear !== undefined && prevYear !== year ? ` '${year.slice(2)}` : '';
    groups.push({ key, label: `${month}${suffix}`, dates: [date] });
  });
  return groups;
}

// Calendar days from today to a 'YYYY-MM-DD' date, in UTC to dodge the
// local-timezone off-by-one described at shiftDateString.
function daysUntil(dateStr: string): number {
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  return Math.round((Date.parse(`${dateStr}T00:00:00Z`) - Date.parse(`${todayStr}T00:00:00Z`)) / 86_400_000);
}

// Horizontally scrolling row with no native scrollbar — left/right arrow
// buttons page it instead, and disable at either end.
function HScrollRow({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges(prev => {
      const next = { left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 };
      return prev.left === next.left && prev.right === next.right ? prev : next;
    });
  }, []);

  // Re-measure after every render: the children (and so scrollWidth) change
  // whenever the expiry list or selection does.
  useEffect(() => { update(); });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update]);

  const scrollByPage = (dir: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7), behavior: 'smooth' });
  };

  const arrowClass = 'shrink-0 w-6 h-6 flex items-center justify-center rounded-sm border border-gray-200 bg-white text-gray-600 text-xs hover:bg-gray-50 disabled:opacity-30 disabled:hover:bg-white';
  return (
    <div className="flex items-start gap-1.5 min-w-0">
      <button type="button" aria-label="Scroll left" disabled={!edges.left} onClick={() => scrollByPage(-1)} className={`${arrowClass} mt-0.5`}>◀</button>
      <div
        ref={ref}
        onScroll={update}
        className="flex items-start gap-3 overflow-x-auto min-w-0 flex-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      <button type="button" aria-label="Scroll right" disabled={!edges.right} onClick={() => scrollByPage(1)} className={`${arrowClass} mt-0.5`}>▶</button>
    </div>
  );
}

// Expiry flavours, so the ladder reads at a glance: standard monthlies fall on
// the 3rd Friday (day 15-21), and the quarter-end months among them (Mar / Jun
// / Sep / Dec) are the big ones. Anything else is a weekly. Computed in UTC for
// the same reason as shiftDateString.
type ExpiryKind = 'weekly' | 'monthly' | 'quarterly';
function expiryKind(dateStr: string): ExpiryKind {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDate();
  if (d.getUTCDay() !== 5 || day < 15 || day > 21) return 'weekly';
  return d.getUTCMonth() % 3 === 2 ? 'quarterly' : 'monthly';
}
const EXPIRY_KIND_STYLES: Record<ExpiryKind, { idle: string; legend: string; label: string }> = {
  weekly: { idle: 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50', legend: 'border-gray-200 bg-white text-gray-600', label: 'Weekly' },
  monthly: { idle: 'border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100', legend: 'border-sky-300 bg-sky-50 text-sky-800', label: 'Monthly' },
  quarterly: { idle: 'border-violet-300 bg-violet-100 text-violet-800 hover:bg-violet-200', legend: 'border-violet-300 bg-violet-100 text-violet-800', label: 'Quarterly' },
};


// `embedded` renders just the chart block for use inside another page (the
// Watchlist View's split pane): no site Header, scan-alerts ticker, section
// jump buttons or the Price Levels History / Option Chain tables below, and no
// fetches for those tables. Callers should pass `key={symbol}` so switching
// symbols remounts with fresh per-symbol state (selected expiry, etc.).
export default function StockAnalysis({ symbol, embedded = false }: { symbol: string; embedded?: boolean }) {

  const [stockData, setStockData] = useState<any>(null);
  const [ohlcData, setOhlcData] = useState<any[]>([]);
  const [oiData, setOiData] = useState<any[]>([]);
  const [scanAlerts, setScanAlerts] = useState<ScanAlert[]>([]);
  const [levels, setLevels] = useState<LevelCalculation[]>([]);
  const [closestLevel, setClosestLevel] = useState<string>('');
  const [historicalLevels, setHistoricalLevels] = useState<Map<string, LevelHistoryEntry>>(new Map());
  // The expiry `historicalLevels` was loaded for. The chart only gets the map while it matches the selected
  // expiry, so a failed or slow fetch can never leave another expiry's levels in the crosshair tooltip.
  const [levelsExpiry, setLevelsExpiry] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // True while the levels/OI panel is refetching for a newly-selected expiry —
  // distinct from `isLoading` (first paint) so the expiry buttons can show a
  // spinner instead of blanking the whole page on every click.
  const [levelsRefreshing, setLevelsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiryDates, setExpiryDates] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>('current');
  const [historicalExpiryDates, setHistoricalExpiryDates] = useState<string[]>([]);
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  // The chart's saved settings (interval, expiry, toggles, period, height; lib/chartPrefs.ts). The data load
  // below waits until they are known, so its first requests already use the saved interval and expiry
  // instead of loading the defaults and then reloading.
  const chartPrefs = useChartPrefs();
  const [chartInterval, setChartInterval] = useState<SelectableInterval>(() => chartPrefs.prefs.interval);
  const [prefsApplied, setPrefsApplied] = useState(chartPrefs.ready);
  const savedExpiryRef = useRef<string | null>(chartPrefs.ready ? chartPrefs.prefs.expiry : null);
  // Full snapshot, not just the price — the header shows today's change and
  // day range, and the levels panel rebases onto the live price (see
  // displayLevels below).
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [security, setSecurity] = useState<SecurityMeta | null>(null);
  // Earnings (Pro feature `earnings`): summary comes with the details call;
  // `earningsLocked` stays null until that call answers, so the history
  // fetch below only fires for entitled viewers.
  const [earnings, setEarnings] = useState<EarningsSummary | null>(null);
  const [earningsLocked, setEarningsLocked] = useState<boolean | null>(null);
  const [earningsHistory, setEarningsHistory] = useState<EarningsResult[] | null>(null);
  const authCtx = useAuthContext();
  const livePrice = quote?.price;
  // The price everything "current" is measured against. Live data is
  // deliberately withheld in historical-expiry mode — those levels belong to
  // an expiry that has already passed, so today's price says nothing about
  // them. One value so the chart, the levels panel, the header and the
  // Analysis line can never disagree about which basis is in play.
  const basisPrice = expiryMode === 'current' ? livePrice : undefined;

  // Chart + Price Levels + Stock Information are one collapsible stack behind
  // a single toggle — not three things with their own controls. Collapsing
  // hides the chart along with the detail panel, so the page drops straight to
  // the Price Levels History table below.
  const [chartStackCollapsed, setChartStackCollapsed] = useState(false);

  // Price Levels History table — deliberately independent of the chart's own
  // date range (which grows unbounded as the user scrolls back): its own
  // fetch, its own date window, defaulting to the last 10 days.
  const [priceHistoryMap, setPriceHistoryMap] = useState<Map<string, LevelHistoryEntry>>(new Map());
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);
  const [priceHistoryPreset, setPriceHistoryPreset] = useState<RangePreset>('10d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');


  // Selected contract for the OHLCV popup — set from the Open Interest or Option Chain tab.
  const [selectedOptContract, setSelectedOptContract] = useState<{ strike: number; optType: 'call' | 'put'; occRoot?: string; expiry?: string } | null>(null);

  // Tabs below the chart. Each tab mounts (and fetches) the first time it is opened and then stays
  // mounted, so switching back is instant. The open tab is kept in ?tab= via history.replaceState
  // (read once on mount; no useSearchParams, so the embedded chart needs no Suspense boundary).
  const [tab, setTab] = useState<StockTab>('levels');
  const [visitedTabs, setVisitedTabs] = useState<Set<StockTab>>(() => new Set(['levels']));
  useEffect(() => {
    if (embedded) return;
    const t = new URLSearchParams(window.location.search).get('tab') as StockTab | null;
    if (t && STOCK_TABS.includes(t)) { setTab(t); setVisitedTabs(v => new Set([...v, t])); }
  }, [embedded]);
  // The chart belongs to the first tab (the quote, Analysis and expiry selector above the tabs stay
  // visible in every tab); embedded always shows it.
  const showChart = embedded || tab === 'levels';
  function openTab(t: StockTab) {
    setTab(t);
    setVisitedTabs(v => (v.has(t) ? v : new Set([...v, t])));
    const url = new URL(window.location.href);
    if (t === 'levels') url.searchParams.delete('tab'); else url.searchParams.set('tab', t);
    window.history.replaceState(window.history.state, '', url);
  }

  function handleExpiryModeChange(mode: ExpiryMode) {
    setExpiryMode(mode);
    if (mode === 'historical') {
      if (historicalExpiryDates.length > 0) {
        setSelectedExpiry(historicalExpiryDates[0]);
        setExpandedYears(new Set([historicalExpiryDates[0].slice(0, 4)]));
      }
    } else if (expiryDates.length > 0) {
      setSelectedExpiry(expiryDates[0]);
    }
  }

  function toggleExpiryYear(year: string) {
    // One year open at a time — opening another collapses the previous one,
    // so the month row never grows sideways with two years' worth of dates.
    setExpandedYears(prev => (prev.has(year) ? new Set<string>() : new Set([year])));
  }

  // Track loaded date ranges to avoid duplicate fetches
  const loadedRangesRef = useRef<{ from: string; to: string }[]>([]);

  // Gates the chart-window-jump effect below so it only fires on an actual
  // current<->historical transition, not on every mount (which is already
  // 'current' by default and already loads its own today-anchored window).
  const prevExpiryModeRef = useRef<ExpiryMode>('current');

  // Stable refs so handleLoadMore never changes reference (prevents chart recreation)
  const ohlcDataRef = useRef<any[]>([]);
  const isLoadingMoreRef = useRef(false);
  // Set by handleLoadMore just before it merges a chunk of bars: it fetches that chunk's levels itself, so the
  // whole-range levels refetch effect (which re-runs on every ohlcData change) must skip this one change.
  const skipLevelsRefetchRef = useRef(false);
  const levelsCoverageRef = useRef<LevelsCoverage | null>(null);
  const selectedExpiryRef = useRef('');
  const chartIntervalRef = useRef<SelectableInterval>('daily');
  // Bumped every time the loaded OHLC window is replaced wholesale (initial
  // load, interval switch, expiry jump). A scroll-back handleLoadMore that
  // started against an older window compares against this and discards its
  // result — otherwise its chunk gets prepended to the new window and leaves a
  // hole of missing bars between the two.
  const windowEpochRef = useRef(0);
  // True while the expiry-jump effect is replacing the OHLC window.
  const [windowLoading, setWindowLoading] = useState(false);
  // Reported quarters for the chart markers and the Earnings History table —
  // only once the details call has said the viewer has the earnings feature.
  useEffect(() => {
    if (earningsLocked !== false) return;
    let cancelled = false;
    fetch(`/api/stocks/${symbol}/earnings?limit=12`)
      .then(res => (res.ok ? res.json() : null))
      .then(json => { if (!cancelled) setEarningsHistory(json?.success ? json.data.history : []); })
      .catch(() => { if (!cancelled) setEarningsHistory([]); });
    return () => { cancelled = true; };
  }, [symbol, earningsLocked]);

  useEffect(() => { ohlcDataRef.current = ohlcData; }, [ohlcData]);
  useEffect(() => { isLoadingMoreRef.current = isLoadingMore; }, [isLoadingMore]);
  useEffect(() => { selectedExpiryRef.current = selectedExpiry; }, [selectedExpiry]);
  useEffect(() => { chartIntervalRef.current = chartInterval; }, [chartInterval]);

  // Saved settings arrived: take the interval and expiry in one render with `prefsApplied`, so the load
  // below runs once with them.
  useEffect(() => {
    if (!chartPrefs.ready || prefsApplied) return;
    savedExpiryRef.current = chartPrefs.prefs.expiry;
    chartIntervalRef.current = chartPrefs.prefs.interval;
    setChartInterval(chartPrefs.prefs.interval);
    setPrefsApplied(true);
  }, [chartPrefs.ready, chartPrefs.prefs, prefsApplied]);

  /** "Reset chart" (the chart resets its own toggles, period and height): back to the daily interval and the nearest expiry. */
  function resetChartSettings() {
    chartPrefs.reset();
    savedExpiryRef.current = null;
    setChartInterval('daily');
    if (expiryMode === 'current' && expiryDates.length > 0) setSelectedExpiry(expiryDates[0]);
  }

  useEffect(() => {
    if (!symbol || !prefsApplied) return;

    const fetchData = async () => {
      windowEpochRef.current++;
      setIsLoading(true);
      setError(null);
      try {
        const { initialDays } = INTERVAL_CONFIG[chartInterval];
        const to = format(new Date(), 'yyyy-MM-dd');
        const from = format(subDays(new Date(), initialDays), 'yyyy-MM-dd');

        // Track initial loaded range
        loadedRangesRef.current = [{ from, to }];

        // The expiry to open on: the user's current one, else their saved pick if this stock still lists it,
        // else the nearest. Resolved once per load so the levels request and the page agree.
        const pickExpiry = (dates: string[]) =>
          selectedExpiryRef.current || (savedExpiryRef.current && dates.includes(savedExpiryRef.current) ? savedExpiryRef.current : dates[0]);

        // The levels-history request only needs the expiry (and the window we
        // already know), so it is chained off the expiry-dates response and
        // runs alongside OHLC instead of waiting for it. The window is the
        // requested from/to rather than the OHLC bars' own first/last date —
        // a superset, so every bar still finds its levels row.
        const expiryPromise = fetch(`/api/stocks/${symbol}/expiry-dates?all=true`)
          .then(res => (res.ok ? res.json() : null))
          .catch(() => null);
        const histLevelsPromise = expiryPromise.then(expiryData => {
          const dates: string[] = expiryData?.success ? expiryData.data.expiryDates : [];
          if (dates.length === 0) return null;
          const expiryToUse = pickExpiry(dates);
          // Already loaded (e.g. switching interval: the new window is inside the one we hold): keep it.
          if (coversRange(levelsCoverageRef.current, symbol, expiryToUse, from, to)) return null;
          return fetch(`/api/stocks/${symbol}/levels?expiry=${expiryToUse}&range=true&from=${from}&to=${to}`)
            .then(res => (res.ok ? res.json() : null))
            .catch(histErr => {
              console.error('Error fetching initial historical levels:', histErr);
              return null;
            });
        });

        const [detailsRes, ohlcRes, scanAlertsRes, expiryData, histLevelsData] = await Promise.all([
          fetch(`/api/stocks/${symbol}`),
          fetch(`/api/stocks/${symbol}/ohlc?from=${from}&to=${to}&interval=${chartInterval}`),
          fetch(`/api/stocks/${symbol}/scan-alerts?from=${from}&to=${to}`),
          expiryPromise,
          histLevelsPromise,
        ]);

        // OHLC is required for the chart, but a failure must not block the
        // levels / OI / details below — record it and throw once they're applied.
        let ohlcError: Error | null = null;
        try {
          if (!ohlcRes.ok) {
            const errorData = await ohlcRes.json().catch(() => ({}));
            throw new Error(`OHLC data failed: ${errorData.error || ohlcRes.statusText}`);
          }
          const ohlc = await ohlcRes.json();
          if (!ohlc.success) throw new Error(ohlc.error || 'Failed to fetch OHLC data');
          setOhlcData(ohlc.data.data || []);
        } catch (e) {
          ohlcError = e instanceof Error ? e : new Error('Failed to fetch OHLC data');
        }

        // Details is optional (symbol may not exist in DB)
        const details = detailsRes.ok ? await detailsRes.json() : { success: true, data: null };
        if (expiryData?.success) setHistoricalExpiryDates(expiryData.data.historicalExpiryDates || []);

        if (scanAlertsRes.ok) {
          const scanAlertsData = await scanAlertsRes.json();
          if (scanAlertsData.success) setScanAlerts(scanAlertsData.data.alerts || []);
        }

        // Set stock details only if available from database. Its latest-row
        // levels are the fallback for symbols with no unexpired expiry; the
        // per-expiry history below overrides them when present.
        if (details.success && details.data) {
          setStockData(details.data);
          setLevels(details.data.levels || []);
          setClosestLevel(details.data.closestLevel?.name ?? '');
        }
        // Sits outside `data` so it's present in broker-only mode too.
        if (details.success) {
          setSecurity(details.security ?? null);
          setEarnings(details.earnings ?? null);
          setEarningsLocked(!!details.earningsLocked);
        }

        // Set expiry dates if available. Keep the user's existing selection across
        // interval switches — only default to the nearest expiry on true first load.
        if (expiryData?.success && expiryData.data.expiryDates.length > 0) {
          setExpiryDates(expiryData.data.expiryDates);
          setSelectedExpiry(pickExpiry(expiryData.data.expiryDates));

          if (histLevelsData?.success && histLevelsData.data && histLevelsData.data.history) {
            const levelsMap = new Map();
            let latestDate = '';
            let latestLevels: any = null;

            histLevelsData.data.history.forEach((item: any) => {
              levelsMap.set(item.date, {
                levels: item.calculated,
                closestLevel: item.closestLevel,
                close: item.close,
                eodClose: item.eodClose,
                open: item.open,
                high: item.high,
                low: item.low,
                sevenLevels: item.sevenLevels || [],
                oi: item.oi,
                ratios: item.ratios,
              });
              if (!latestDate || item.date > latestDate) {
                latestDate = item.date;
                latestLevels = item;
              }
            });

            setHistoricalLevels(levelsMap);
            const levelsFor = pickExpiry(expiryData.data.expiryDates);
            setLevelsExpiry(levelsFor);
            levelsCoverageRef.current = { symbol, expiry: levelsFor, from, to };

            const oiDataFromLevels = histLevelsData.data.history
              .filter((item: any) => item.oi != null)
              .map((item: any) => ({
                time: item.date || item.tradeDate || item.TRADE_DATE,
                callOi: Number(item.oi.callOi) || 0,
                putOi: Number(item.oi.putOi) || 0,
                oiDiff: Number(item.oi.oiDiff) || 0,
              }));

            setOiData(oiDataFromLevels);

            if (latestLevels) {
              setLevels(latestLevels.calculated || []);
              setClosestLevel(latestLevels.closestLevel);
            }
          }
        }
        if (ohlcError) throw ohlcError;
      } catch (err) {
        console.error('Error fetching stock data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load stock data');
      } finally {
        setIsLoading(false);
        setIsInitialLoad(false);
      }
    };

    fetchData();
  }, [symbol, chartInterval, prefsApplied]);

  // Fetch historical levels data when expiry date changes (skip initial load)
  useEffect(() => {
    if (!symbol || !selectedExpiry || isInitialLoad || ohlcData.length === 0) return;
    if (skipLevelsRefetchRef.current) {
      // The chunk's levels were fetched by handleLoadMore, so no refetch. The run this change just
      // cleaned up may have been cancelled mid-flight, and a cancelled run never clears the
      // "refreshing" overlay (its finally is guarded by `cancelled`), so clear it here or the
      // chart shows "Loading chart…" forever.
      skipLevelsRefetchRef.current = false;
      setLevelsRefreshing(false);
      return;
    }

    {
      const ds = ohlcData.map(d => d.date).sort();
      if (coversRange(levelsCoverageRef.current, symbol, selectedExpiry, ds[0], ds[ds.length - 1])) {
        setLevelsRefreshing(false); // a cancelled run may have left the overlay on
        return;
      }
    }

    // `ohlcData` and `selectedExpiry` don't always land in the same render —
    // switching expiries can fire this effect once with the OLD ohlcData
    // (mismatched date range for the new expiry) before the new ohlcData
    // arrives and fires it again correctly. Without this guard, whichever
    // response resolves LAST wins, which isn't always the correct one —
    // the stale request can overwrite good data if it's slower.
    let cancelled = false;
    setLevelsRefreshing(true);

    const clearLevels = () => {
      setHistoricalLevels(new Map());
      setLevelsExpiry(selectedExpiry);
      levelsCoverageRef.current = null;
      setLevels([]);
      setClosestLevel('');
      setOiData([]);
    };

    const fetchHistoricalLevels = async () => {
      try {
        const dates = ohlcData.map(d => d.date).sort();
        const from = dates[0];
        const to = dates[dates.length - 1];

        const response = await fetch(`/api/stocks/${symbol}/levels?expiry=${selectedExpiry}&range=true&from=${from}&to=${to}`);
        if (cancelled) return;

        if (response.ok) {
          const levelsData = await response.json();
          if (cancelled) return;

          if (levelsData.success && levelsData.data && levelsData.data.history) {
            const levelsMap = new Map();
            let latestDate = '';
            let latestLevels: any = null;

            levelsData.data.history.forEach((item: any) => {
              levelsMap.set(item.date, {
                levels: item.calculated,
                closestLevel: item.closestLevel,
                close: item.close,
                eodClose: item.eodClose,
                open: item.open,
                high: item.high,
                low: item.low,
                sevenLevels: item.sevenLevels || [],
                oi: item.oi,
                ratios: item.ratios,
              });
              if (!latestDate || item.date > latestDate) {
                latestDate = item.date;
                latestLevels = item;
              }
            });

            setHistoricalLevels(levelsMap);
            setLevelsExpiry(selectedExpiry);
            levelsCoverageRef.current = { symbol, expiry: selectedExpiry, from, to };

            const oiDataFromLevels = levelsData.data.history
              .filter((item: any) => item.oi != null)
              .map((item: any) => ({
                time: item.date || item.tradeDate || item.TRADE_DATE,
                callOi: Number(item.oi.callOi) || 0,
                putOi: Number(item.oi.putOi) || 0,
                oiDiff: Number(item.oi.oiDiff) || 0,
              }));

            setOiData(oiDataFromLevels);

            // No row for this expiry in the window: show nothing rather than the previous expiry's levels.
            setLevels(latestLevels ? latestLevels.calculated || [] : []);
            setClosestLevel(latestLevels ? latestLevels.closestLevel : '');
          } else {
            clearLevels();
          }
        } else {
          // e.g. 429 rate limit: the data held belongs to the previous expiry, so drop it.
          clearLevels();
        }
      } catch (err) {
        console.error('Error fetching historical levels:', err);
        if (!cancelled) clearLevels();
      } finally {
        if (!cancelled) setLevelsRefreshing(false);
      }
    };

    fetchHistoricalLevels();
    return () => { cancelled = true; };
  }, [selectedExpiry, symbol, isInitialLoad, ohlcData]);

  // Jump the chart's loaded OHLC window to surround the selected expiry when
  // switching into (or between) historical expiries, rather than requiring a
  // manual scroll-back via handleLoadMore. Gated by prevExpiryModeRef so it's
  // a no-op on mount and while staying in 'current' mode — the mount effect
  // above already loads that default today-anchored window. The existing
  // historical-levels-overlay effect just above already depends on
  // `ohlcData` and recomputes its own range from it, so replacing `ohlcData`
  // here is enough to make that effect re-fetch the matching levels/OI too.
  useEffect(() => {
    const prevMode = prevExpiryModeRef.current;
    prevExpiryModeRef.current = expiryMode;
    if (!symbol || !selectedExpiry || isInitialLoad) return;
    if (expiryMode === 'current' && prevMode === 'current') return;

    let cancelled = false;
    windowEpochRef.current++;
    setWindowLoading(true);

    const jumpToWindow = async () => {
      const { initialDays } = INTERVAL_CONFIG[chartInterval];
      let from: string, to: string;
      if (expiryMode === 'historical') {
        // A little padding past expiry (the underlying keeps trading after
        // the option contract expires) capped at today, so the window never
        // reaches into dates with no data at all.
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const paddedTo = shiftDateString(selectedExpiry, 5);
        to = paddedTo < todayStr ? paddedTo : todayStr;
        from = shiftDateString(selectedExpiry, -initialDays);
      } else {
        // Returning to 'current' — restore the same default window the
        // mount effect computes.
        to = format(new Date(), 'yyyy-MM-dd');
        from = format(subDays(new Date(), initialDays), 'yyyy-MM-dd');
      }

      loadedRangesRef.current = [{ from, to }];

      try {
        const [ohlcRes, scanAlertsRes] = await Promise.all([
          fetch(`/api/stocks/${symbol}/ohlc?from=${from}&to=${to}&interval=${chartInterval}`),
          fetch(`/api/stocks/${symbol}/scan-alerts?from=${from}&to=${to}`),
        ]);
        if (cancelled) return;

        if (ohlcRes.ok) {
          const ohlc = await ohlcRes.json();
          if (!cancelled && ohlc.success) setOhlcData(ohlc.data.data || []);
        }
        if (scanAlertsRes.ok) {
          const scanAlertsData = await scanAlertsRes.json();
          if (!cancelled && scanAlertsData.success) setScanAlerts(scanAlertsData.data.alerts || []);
        }
      } catch (err) {
        console.error('Error jumping chart window to expiry:', err);
      } finally {
        if (!cancelled) setWindowLoading(false);
      }
    };

    jumpToWindow();
    return () => { cancelled = true; };
  }, [symbol, selectedExpiry, expiryMode, chartInterval, isInitialLoad]);

  // Price Levels History table — its own independent fetch/date-range, not
  // tied to the chart's (see state comment above). Re-fetches on symbol,
  // expiry, or range-preset/custom-date change.
  const levelsTabOpened = visitedTabs.has('levels');
  useEffect(() => {
    if (embedded || !levelsTabOpened || !symbol || !selectedExpiry) return;

    let from: string, to: string;
    if (priceHistoryPreset === 'custom') {
      if (!customFrom || !customTo) return; // wait for both custom dates before fetching
      from = customFrom;
      to = customTo;
    } else {
      // For an already-expired expiry, "last 10/30/90 days" means the N days
      // leading up to expiry, not the N days up to today — today's data has
      // nothing to do with a contract that already expired.
      to = expiryMode === 'historical' ? selectedExpiry : format(new Date(), 'yyyy-MM-dd');
      from = shiftDateString(to, -RANGE_PRESET_DAYS[priceHistoryPreset]);
    }

    // Inside the range the chart already holds: build the rows from it instead of asking again.
    if (coversRange(levelsCoverageRef.current, symbol, selectedExpiry, from, to)) {
      setPriceHistoryMap(new Map([...historicalLevels].filter(([d]) => d >= from && d <= to)));
      setPriceHistoryLoading(false);
      return;
    }

    let cancelled = false;
    setPriceHistoryLoading(true);
    fetch(`/api/stocks/${symbol}/levels?expiry=${selectedExpiry}&range=true&from=${from}&to=${to}`)
      .then(res => res.json())
      .then(json => {
        if (cancelled) return;
        const map = new Map<string, LevelHistoryEntry>();
        if (json.success && json.data?.history) {
          json.data.history.forEach((item: any) => {
            map.set(item.date, {
              levels: item.calculated,
              closestLevel: item.closestLevel,
              close: item.close,
              eodClose: item.eodClose,
              open: item.open,
              high: item.high,
              low: item.low,
              sevenLevels: item.sevenLevels || [],
              oi: item.oi,
              ratios: item.ratios,
            });
          });
        }
        setPriceHistoryMap(map);
      })
      .catch(() => { if (!cancelled) setPriceHistoryMap(new Map()); })
      .finally(() => { if (!cancelled) setPriceHistoryLoading(false); });

    return () => { cancelled = true; };
  }, [embedded, levelsTabOpened, symbol, selectedExpiry, expiryMode, priceHistoryPreset, customFrom, customTo]);

  // Live price — polls the quote snapshot on the real market schedule: every
  // 10s in the regular session, every 30s in pre-market / after-hours (the
  // extended-hours move keeps updating), and when the market is closed it
  // sleeps until the next session boundary (04:00 ET pre-market, then 09:30)
  // instead of polling blindly. The server reports the session and the next
  // change with every quote (lib/marketSession.ts).
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    let lastMarket: LiveQuote['market'] | null = null;

    function poll() {
      fetch(`/api/stocks/${symbol}/quote`)
        .then(r => r.json())
        .then(res => {
          if (cancelled || !res.success || !res.data) return;
          lastMarket = res.data.market ?? null;
          setQuote(res.data);
        })
        .catch(() => {})
        .finally(() => {
          if (cancelled) return;
          timeoutId = setTimeout(poll, pollDelayMs(lastMarket, { regularMs: 10_000, extendedMs: 30_000 }));
        });
    }

    poll();
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [symbol]);

  // Handle loading more historical data
  const handleLoadMore = useCallback(async (
    direction: 'past' | 'future',
    firstVisibleTime: string,
    lastVisibleTime: string
  ) => {
    if (isLoadingMoreRef.current || !symbol) return;

    const epoch = windowEpochRef.current;
    const isStale = () => epoch !== windowEpochRef.current;

    try {
      setIsLoadingMore(true);

      let from: string;
      let to: string;
      const { chunkDays } = INTERVAL_CONFIG[chartIntervalRef.current];

      const currentOhlcData = ohlcDataRef.current;
      if (direction === 'past') {
        const earliestDateStr = dateStringFrom(currentOhlcData[0]?.date, firstVisibleTime);
        to = shiftDateString(earliestDateStr, -1);
        from = shiftDateString(earliestDateStr, -chunkDays);
      } else {
        const latestDateStr = dateStringFrom(currentOhlcData[currentOhlcData.length - 1]?.date, lastVisibleTime);
        from = shiftDateString(latestDateStr, 1);
        to = format(new Date(), 'yyyy-MM-dd');
      }

      // Check if this range is already loaded
      const isAlreadyLoaded = loadedRangesRef.current.some(range => {
        return from >= range.from && to <= range.to;
      });

      if (isAlreadyLoaded) {
        setIsLoadingMore(false);
        return;
      }

      const ohlcResponse = await fetch(`/api/stocks/${symbol}/ohlc?from=${from}&to=${to}&interval=${chartIntervalRef.current}`);

      if (!ohlcResponse.ok) {
        throw new Error('Failed to load more data');
      }

      const result = await ohlcResponse.json();

      // The window was replaced (expiry/interval switch) while this chunk was
      // in flight — it belongs to the old window, so drop it.
      if (isStale()) return;

      // Always mark range as loaded to prevent re-fetching empty ranges
      loadedRangesRef.current.push({ from, to });

      if (result.success && result.data.data.length > 0) {
        const newData = result.data.data;

        // Merge new data with existing data (its levels are fetched below, so skip the whole-range refetch)
        skipLevelsRefetchRef.current = true;
        setOhlcData(prevData =>
          mergeSorted(prevData, newData, (b: any) => b.timestamp ?? b.date)
        );

        const scanAlertsResponse = await fetch(`/api/stocks/${symbol}/scan-alerts?from=${from}&to=${to}`);
        if (isStale()) return;
        if (scanAlertsResponse.ok) {
          const scanAlertsResult = await scanAlertsResponse.json();
          if (!isStale() && scanAlertsResult.success && scanAlertsResult.data.alerts.length > 0) {
            const newAlerts: ScanAlert[] = scanAlertsResult.data.alerts;
            setScanAlerts(prevAlerts => {
              const seen = new Set(prevAlerts.map(a => `${a.symbol}|${a.expiryDate}|${a.loadDateTime}`));
              const deduped = newAlerts.filter(a => !seen.has(`${a.symbol}|${a.expiryDate}|${a.loadDateTime}`));
              return direction === 'past' ? [...deduped, ...prevAlerts] : [...prevAlerts, ...deduped];
            });
          }
        }

        const expiryAtStart = selectedExpiryRef.current;
        // Dates the page already holds levels for (e.g. an intraday window inside the daily history) need no request.
        if (expiryAtStart && !isStale() && !coversRange(levelsCoverageRef.current, symbol, expiryAtStart, from, to)) {
          const levelsResponse = await fetch(
            `/api/stocks/${symbol}/levels?expiry=${expiryAtStart}&range=true&from=${from}&to=${to}`
          );

          if (levelsResponse.ok) {
            const levelsResult = await levelsResponse.json();

            if (!isStale() && selectedExpiryRef.current === expiryAtStart && levelsResult.success && levelsResult.data?.history) {
              const historyData = levelsResult.data.history;

              setHistoricalLevels(prevMap => {
                const newMap = new Map(prevMap);
                historyData.forEach((item: any) => {
                  newMap.set(item.date, {
                    levels: item.calculated || [],
                    closestLevel: item.closestLevel || '',
                    close: item.close,
                    eodClose: item.eodClose,
                    open: item.open,
                    high: item.high,
                    low: item.low,
                    sevenLevels: item.sevenLevels || [],
                    oi: item.oi,
                    ratios: item.ratios,
                  });
                });
                return newMap;
              });
              // The chunk is merged into what is loaded, so the loaded range grows with it.
              const cov = levelsCoverageRef.current;
              if (cov && cov.symbol === symbol && cov.expiry === expiryAtStart) {
                levelsCoverageRef.current = { ...cov, from: from < cov.from ? from : cov.from, to: to > cov.to ? to : cov.to };
              }

              const newOiData = historyData
                .filter((item: any) => item.oi != null)
                .map((item: any) => ({
                  time: item.date,
                  callOi: Number(item.oi.callOi) || 0,
                  putOi: Number(item.oi.putOi) || 0,
                  oiDiff: Number(item.oi.oiDiff) || 0,
                }));

              setOiData(prevData => mergeSorted(prevData, newOiData, (o: any) => o.time));
            }
          }
        }
      }
    } catch (err) {
      console.error('Error loading more data:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [symbol]);


  // The API computes each level's value against the DB's EOD close — the
  // `(CLOSE - LEVEL) / CLOSE` formula the levels product is defined on. Once a
  // live quote arrives, rebase onto it so the panel, the closest-level badge,
  // the chart highlight and the Analysis line all describe where the price
  // actually is *now*, not where it closed. Without this, a stock that has
  // moved several percent since the close reports the wrong closest level.
  //
  // This is the one place calculation happens client-side rather than in an
  // API route (see CLAUDE.md): the live price is polled by the browser, so
  // rebasing server-side would mean a round trip per poll.
  //
  // Only the *current* levels rebase. historicalLevels stays untouched — each
  // past bar's percentages are correctly relative to that day's own close.
  // ...but only in current-expiry mode. Historical levels belong to an expiry
  // that has already passed, so measuring them against today's price would be
  // meaningless — the chart already suppresses livePrice there for the same
  // reason, and this keeps the panel consistent with it.
  const displayLevels = useMemo(() => {
    if (!basisPrice || levels.length === 0) return levels;
    return levels.map((l: any) => {
      const value = (basisPrice - l.price) / basisPrice;
      return { ...l, value, distance: Math.abs(basisPrice - l.price), percentage: formatPercentage(value) };
    });
  }, [levels, basisPrice]);

  // Always derive closest level from the displayed levels array (avoids stale/mismatched string state)
  const closestLevelName = useMemo(() => {
    if (displayLevels.length > 0) {
      return displayLevels.reduce((c: any, l: any) => Math.abs(l.value) < Math.abs(c.value) ? l : c).name;
    }
    return stockData?.closestLevel?.name || closestLevel || '';
  }, [displayLevels, stockData, closestLevel]);

  // The newest loaded row's reference close (its own session's close when known, see lib/dayBars.ts). The levels
  // shown without a live price (a historical expiry, or no quote) are measured against it, so the Analysis line
  // names this price rather than the stored previous-session close.
  const latestRefClose = useMemo(() => {
    let day = '';
    let close: number | undefined;
    if (levelsExpiry !== selectedExpiry) return undefined;
    historicalLevels.forEach((e, d) => { if (d > day && e.close > 0) { day = d; close = e.close; } });
    return close;
  }, [historicalLevels, levelsExpiry, selectedExpiry]);

  const candleData = useMemo(() => ohlcData.map(d => ({
    time: d.timestamp,
    dayKey: d.date,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
  })), [ohlcData]);

  const volumeData = useMemo(() => ohlcData.map(d => ({
    time: d.timestamp,
    dayKey: d.date,
    value: d.volume,
  })), [ohlcData]);

  const chartOiData = useMemo(() => oiData.map(d => ({
    time: d.time,
    callOi: d.callOi,
    putOi: d.putOi,
    oiDiff: d.oiDiff,
  })), [oiData]);

  // Most-recent-first rows for the Price Levels History table — from its own
  // independently-fetched map, not the chart's historicalLevels.
  const priceHistoryRows = useMemo(() => {
    return Array.from(priceHistoryMap.entries())
      .map(([date, entry]) => ({ date, ...entry }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [priceHistoryMap]);

  // Call High / Put Low for the selected expiry: strangle and condor templates anchor on them.
  const builderLevels = useMemo(() => {
    const by = new Map(levels.map(l => [l.name, l.price]));
    return { call_high: by.get('call_high') || undefined, put_low: by.get('put_low') || undefined };
  }, [levels]);
  const upcomingExpiries = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    return expiryDates.filter(d => d >= today).sort();
  }, [expiryDates]);

  // One expiry pill — shared by the current and historical ladders.
  function renderExpiryButton(date: string) {
    const isActive = date === selectedExpiry;
    const alertCount = scanAlerts.filter(a => a.expiryDate === date).length;
    // Expiries on/after the next report carry the earnings event inside them.
    const spansEarnings = !!earnings?.next && date >= earnings.next.date;
    return (
      <button
        key={date}
        onClick={() => {
          setSelectedExpiry(date);
          // Remember the pick for the next visit. A past (historical) expiry isn't remembered: it can't be the default.
          if (expiryMode === 'current') chartPrefs.save({ expiry: date });
        }}
        title={spansEarnings ? `${date} — after earnings on ${earnings!.next!.date}` : date}
        aria-pressed={isActive}
        className={`px-2 py-0.5 rounded-sm text-xs font-medium border transition-all ${
          isActive
            ? 'border-blue-600 bg-blue-600 text-white'
            : EXPIRY_KIND_STYLES[expiryKind(date)].idle
        }`}
      >
        {parseInt(date.slice(8, 10), 10)}
        {spansEarnings && (
          <span className={`inline-block ml-0.5 w-1.5 h-1.5 rounded-full align-top ${isActive ? 'bg-amber-300' : 'bg-amber-500'}`} aria-label="after earnings" />
        )}
        {isActive && levelsRefreshing && (
          <span className="inline-block ml-1.5 animate-spin h-2.5 w-2.5 border-2 border-white border-t-transparent rounded-full align-middle" />
        )}
        {alertCount > 0 && (
          <span className={`ml-1 text-[10px] ${isActive ? 'opacity-90' : 'text-purple-600'}`}>🔔{alertCount}</span>
        )}
      </button>
    );
  }

  // A month label bar with its day pills underneath.
  function renderMonthGroup(group: { key: string; label: string; dates: string[] }) {
    return (
      <div key={group.key} className="flex flex-col gap-1 shrink-0">
        <div className={`text-center text-[10px] font-bold uppercase tracking-wide rounded-sm px-2 py-0.5 ${
          expiryMode === 'historical' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
        }`}>
          {group.label}
        </div>
        <div className="flex items-center gap-1">{group.dates.map(renderExpiryButton)}</div>
      </div>
    );
  }

  const hasExpiries = !isLoading && (expiryDates.length > 0 || historicalExpiryDates.length > 0);
  const expiryPanel = hasExpiries ? (
    <div className="bg-white rounded-lg shadow-md px-3 py-2 min-w-0 w-full">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
        <span className="text-xs font-bold text-gray-800 uppercase tracking-wide">
          Expiration
          {selectedExpiry && (() => {
            const days = daysUntil(selectedExpiry);
            return <span className="ml-1.5 text-blue-600 normal-case">{days > 0 ? `${days}d` : days === 0 ? 'today' : 'expired'}</span>;
          })()}
        </span>
        {levelsRefreshing && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-blue-600">
            <span className="inline-block animate-spin h-2.5 w-2.5 border-2 border-blue-600 border-t-transparent rounded-full" />
            Refreshing levels…
          </span>
        )}
        <div className="hidden sm:flex items-center gap-1" aria-label="Expiry colour key">
          {(Object.keys(EXPIRY_KIND_STYLES) as ExpiryKind[]).map(k => (
            <span key={k} className={`px-1.5 py-px rounded-sm border text-[10px] font-medium ${EXPIRY_KIND_STYLES[k].legend}`}>
              {EXPIRY_KIND_STYLES[k].label}
            </span>
          ))}
          {earnings?.next && (
            <span className="flex items-center gap-1 px-1.5 py-px text-[10px] font-medium text-gray-600" title={`Next earnings ${earnings.next.date}`}>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" /> After earnings
            </span>
          )}
        </div>
        {historicalExpiryDates.length > 0 && (
          <div className="flex gap-1 bg-gray-100 p-0.5 rounded-full">
            <button
              onClick={() => handleExpiryModeChange('current')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                expiryMode === 'current' ? 'bg-blue-600 text-white shadow-sm' : 'text-blue-700 hover:bg-blue-50'
              }`}
            >
              Current
            </button>
            <button
              onClick={() => handleExpiryModeChange('historical')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                expiryMode === 'historical' ? 'bg-amber-600 text-white shadow-sm' : 'text-amber-700 hover:bg-amber-50'
              }`}
            >
              Historical
            </button>
          </div>
        )}
      </div>

      {/* Months sit side by side and scroll horizontally — a long LEAPS
          ladder would otherwise wrap into a tall block over the chart. */}
      <div>
        {expiryMode === 'current' ? (
          <HScrollRow>{groupExpiriesByMonth(expiryDates).map(renderMonthGroup)}</HScrollRow>
        ) : historicalExpiryDates.length === 0 ? (
          <span className="text-xs text-gray-400">No historical expiries found for this symbol.</span>
        ) : (
          (() => {
            const years = groupExpiriesByYear(historicalExpiryDates);
            const expandedDates = years.filter(y => expandedYears.has(y.year)).flatMap(y => y.dates);
            return (
              <div className="flex flex-col gap-2 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {years.map(({ year, dates }) => {
                    const isExpanded = expandedYears.has(year);
                    return (
                      <button
                        key={year}
                        onClick={() => toggleExpiryYear(year)}
                        aria-expanded={isExpanded}
                        className="flex items-center gap-1 px-2.5 py-0.5 rounded-sm text-xs font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                      >
                        <span className={`inline-block transition-transform text-gray-400 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                        {year}
                        <span className="text-gray-400 font-normal">({dates.length})</span>
                      </button>
                    );
                  })}
                </div>
                {expandedDates.length > 0 && (
                  <HScrollRow>{groupExpiriesByMonth(expandedDates).map(renderMonthGroup)}</HScrollRow>
                )}
              </div>
            );
          })()
        )}
      </div>
    </div>
  ) : null;

  const closestLvl = closestLevelName
    ? displayLevels.find((l: any) => l.name === closestLevelName) || stockData?.levels?.find((l: any) => l.name === closestLevelName)
    : null;
  // Closest-level analysis, stacked above the expiry card in the header's
  // right-hand column.
  const analysisBlock = closestLvl ? (
    <div className="p-2 bg-gradient-to-r from-blue-50 to-green-50 rounded-lg self-stretch">
      <p className="text-[11px]">
        <strong>Analysis:</strong>{' '}
        {/* Name the basis explicitly — the distance is measured from the
            live price or the EOD close, and the two disagree intra-day. */}
        The {basisPrice !== undefined && quote?.market.session === 'regular' ? 'live' : 'closing'} price of{' '}
        {formatCurrency(basisPrice ?? latestRefClose ?? stockData?.close)} is closest to the{' '}
        <strong className="text-blue-700">{getLevelDisplayName(closestLevelName)}</strong>{' '}
        level at {formatCurrency(closestLvl.price)}, with a distance
        of {formatPercentage(closestLvl.value)}.{' '}
        <Link href="/guide" className="font-medium text-blue-600 hover:underline">What do these mean?</Link>
      </p>
    </div>
  ) : null;

  // Icon-only collapse/expand control for the whole chart block. Lives in the
  // chart toolbar while open and in the slim bar once collapsed.
  const collapseButton = (
    <button
      type="button"
      onClick={() => setChartStackCollapsed(v => !v)}
      aria-expanded={!chartStackCollapsed}
      aria-label={chartStackCollapsed ? 'Expand chart' : 'Collapse chart'}
      title={chartStackCollapsed ? 'Expand chart' : 'Collapse chart'}
      className="ml-auto flex items-center justify-center w-8 h-8 rounded text-gray-500 bg-gray-100 hover:bg-gray-200 hover:text-gray-700 transition-colors"
    >
      <span className={`inline-block transition-transform ${chartStackCollapsed ? '' : 'rotate-180'}`}>▾</span>
    </button>
  );

  // Dates and earnings lines, tucked under the quote in the chart header
  // (replaces the old side panel's Stock Information card).
  const headerBelow = (
    <div className="mt-2 space-y-2 max-w-md">
      {(selectedExpiry || stockData?.tradeDate) && (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-600">
          {selectedExpiry && (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <span>Expiry: <strong className="text-gray-800">{selectedExpiry}</strong></span>
              <EarningsExpiryChip earnings={earnings} expiry={selectedExpiry} />
            </span>
          )}
          {stockData?.tradeDate && <span>Trade date: <strong className="text-gray-800">{stockData.tradeDate}</strong></span>}
        </div>
      )}
      <EarningsHeaderLines earnings={earnings} locked={earningsLocked} />
    </div>
  );

  const intervalSelector = (
    <div className="flex items-center gap-1">
      {INTERVAL_ORDER.map((iv) => (
        <button
          key={iv}
          onClick={() => { setChartInterval(iv); chartPrefs.save({ interval: iv }); }}
          className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
            chartInterval === iv
              ? 'bg-green-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {INTERVAL_CONFIG[iv].label}
        </button>
      ))}
    </div>
  );

  // Tab bar: between the header and the chart, or under the slim bar when the block is collapsed.
  const tabBar = (
    <Tabs<StockTab>
      className="mb-4"
      value={tab}
      onChange={t => openTab(t)}
      tabs={[
        { id: 'levels', tone: 'green', label: 'Chart & Price Levels', title: 'Price chart with the level lines, and all seven levels, close and OI per day for the selected expiry' },
        { id: 'oi', tone: 'orange', label: 'Open Interest', title: 'Open interest trend, OI change by strike and by contract' },
        { id: 'chain', tone: 'blue', label: 'Option Chain', title: 'Live option chain and the Strategy Builder (payoff, POP, greeks)', badge: hasFeature(authCtx.features, FEATURE_STRATEGY_BUILDER) || hasFeature(authCtx.features, FEATURE_OPTION_CHAIN) ? undefined : 'Pro' },
        { id: 'earnings', tone: 'amber', label: 'Earnings', title: 'Reported quarters: EPS and sales vs consensus', badge: earningsLocked === true ? 'Pro' : undefined },
      ]}
    />
  );

  if (isLoading) {
    return (
      <>
        {!embedded && <Header />}
        <LoadingSpinner message={`Loading ${symbol} data...`} />
      </>
    );
  }

  if (error) {
    return (
      <>
        {!embedded && <Header />}
        <ErrorDisplay error={error} onRetry={() => window.location.reload()} />
      </>
    );
  }

  return (
    <>
      {!embedded && <Header />}
      <div className={embedded ? '' : 'min-h-screen bg-gray-50'}>
        <div className={embedded ? '' : 'container mx-auto px-4 pt-3 pb-8'}>
          {!embedded && (
            <div className="mb-4">
              <ScanAlertsTicker />
            </div>
          )}

          {/* The whole block (header, expiry selector, chart) collapses behind one icon button in
              the chart toolbar, to a slim bar that keeps the quote and the expiry selector — the
              tabs still depend on the selected expiry. */}
          {chartStackCollapsed && (
            <div className="mb-8 space-y-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-white rounded-lg shadow-md px-3 py-2">
                <span className="text-xl font-bold">{symbol.toUpperCase()}</span>
                {(livePrice ?? stockData?.close) !== undefined && (
                  <span className="text-base text-gray-600">{formatCurrency(livePrice ?? stockData?.close)}</span>
                )}
                {livePrice !== undefined && quote?.change != null && (
                  <span className={`text-xs font-bold ${quote.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {quote.change >= 0 ? '+' : '−'}{formatCurrency(Math.abs(quote.change))}
                    {quote.changePercent != null && ` (${quote.changePercent >= 0 ? '+' : '−'}${Math.abs(quote.changePercent).toFixed(2)}%)`}
                  </span>
                )}
                {livePrice !== undefined && quote?.ext && <ExtendedMove ext={quote.ext} full />}
                {collapseButton}
              </div>
              {expiryPanel}
              {!embedded && tabBar}
            </div>
          )}

          {/* Header (quote, Analysis, expiry selector), then the tab bar, then the chart. Other tabs
              hide only the chart, not unmount it: a remount re-fits the view and fires a load-more
              (an extra ohlc + rate-limited levels call) on every switch back. */}
          {!chartStackCollapsed && (
            <div className={embedded || !showChart ? 'relative' : 'relative mb-8'}>
              <TVChart
                symbol={symbol.toUpperCase()}
                candleData={candleData}
                volumeData={volumeData}
                oiData={chartOiData}
                levels={displayLevels}
                closestLevel={closestLevelName}
                historicalLevels={levelsExpiry === selectedExpiry ? historicalLevels : NO_LEVELS}
                scanAlerts={scanAlerts}
                earningsEvents={earningsHistory ?? undefined}
                selectedExpiry={selectedExpiry}
                isIntraday={isIntradayInterval(chartInterval)}
                livePrice={basisPrice}
                quotePrice={livePrice}
                marketSession={livePrice !== undefined ? quote?.market.session : undefined}
                extended={livePrice !== undefined ? quote?.ext : undefined}
                currentPrice={stockData?.close}
                dayChange={livePrice !== undefined ? quote?.change : undefined}
                dayChangePercent={livePrice !== undefined ? quote?.changePercent : undefined}
                dayHigh={livePrice !== undefined ? quote?.dayHigh : undefined}
                dayLow={livePrice !== undefined ? quote?.dayLow : undefined}
                companyName={security?.name}
                chips={[security?.industry ?? security?.sector, formatMarketCap(security?.marketCap ?? null)]}
                headerExtra={intervalSelector}
                topAside={(analysisBlock || expiryPanel) && (
                  <div className="flex flex-col gap-3 w-full min-w-0">
                    {analysisBlock}
                    {expiryPanel}
                  </div>
                )}
                headerBelow={headerBelow}
                afterHeader={!embedded && tabBar}
                chartHidden={!showChart}
                toolbarEnd={collapseButton}
                height={embedded ? 520 : 600}
                resizable={!embedded}
                settings={chartPrefs.prefs}
                onSettingsChange={chartPrefs.save}
                onResetSettings={resetChartSettings}
                onLoadMore={handleLoadMore}
                isLoadingMore={isLoadingMore}
              />
              {(windowLoading || levelsRefreshing) && (
                <div
                  role="status"
                  aria-live="polite"
                  className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-[1px]"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-blue-600">
                    <span className="inline-block animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full" />
                    Loading {selectedExpiry} chart…
                  </div>
                </div>
              )}
            </div>
          )}

          {!embedded && (
            <div>
              {visitedTabs.has('levels') && (
                <div hidden={tab !== 'levels'}>
                  <PriceLevelsTab
                    rows={priceHistoryRows}
                    loading={priceHistoryLoading}
                    selectedExpiry={selectedExpiry}
                    preset={priceHistoryPreset}
                    onPreset={setPriceHistoryPreset}
                    customFrom={customFrom}
                    customTo={customTo}
                    onCustomFrom={setCustomFrom}
                    onCustomTo={setCustomTo}
                  />
                </div>
              )}
              {visitedTabs.has('oi') && selectedExpiry && (
                <div hidden={tab !== 'oi'}>
                  <OpenInterestTab
                    symbol={symbol}
                    selectedExpiry={selectedExpiry}
                    expiryMode={expiryMode}
                    onOpenContract={(strike, optType, expiry, occRoot) => setSelectedOptContract({ strike, optType, expiry, occRoot })}
                  />
                </div>
              )}
              {visitedTabs.has('chain') && (
                <div hidden={tab !== 'chain'}>
                  <OptionChainTab
                    symbol={symbol.toUpperCase()}
                    selectedExpiry={selectedExpiry}
                    expiryMode={expiryMode}
                    expiries={upcomingExpiries}
                    expiriesReady={!isLoading}
                    levels={builderLevels}
                    earnings={earnings}
                    entitled={hasFeature(authCtx.features, FEATURE_STRATEGY_BUILDER) || hasFeature(authCtx.features, FEATURE_OPTION_CHAIN)}
                    builder={hasFeature(authCtx.features, FEATURE_STRATEGY_BUILDER)}
                    loggedIn={authCtx.loggedIn}
                    onOpenContract={(strike, optType, occRoot) => setSelectedOptContract({ strike, optType, occRoot })}
                  />
                </div>
              )}
              {visitedTabs.has('earnings') && (
                <div hidden={tab !== 'earnings'}>
                  {earningsLocked === false ? (
                    <EarningsHistoryTable history={earningsHistory} loading={earningsHistory === null} className="" />
                  ) : (
                    <div className="bg-white rounded-lg shadow-md p-6 text-center text-sm text-gray-600">
                      {earningsLocked === null ? 'Loading…' : (
                        <>Earnings dates and results (EPS and sales vs consensus) are a Pro feature.{' '}
                          <Link href="/upgrade?feature=earnings" className="font-semibold text-blue-600 hover:underline">Upgrade</Link></>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {selectedOptContract && selectedExpiry && (
        <OptionContractModal
          symbol={symbol}
          expiry={selectedOptContract.expiry ?? selectedExpiry}
          strike={selectedOptContract.strike}
          optType={selectedOptContract.optType}
          occRoot={selectedOptContract.occRoot}
          onClose={() => setSelectedOptContract(null)}
        />
      )}
    </>
  );
}
