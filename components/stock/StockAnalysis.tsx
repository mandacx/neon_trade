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
import type { EarningsResult, EarningsSummary } from '@/types/earnings';
import { LevelCalculation, ScanAlert } from '@/types/stock';
import { getLevelColor, getLevelDisplayName, formatCurrency, formatPercentage, isUsMarketHours } from '@/lib/utils';
import { isIntradayInterval } from '@/lib/alpaca';
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
  daily: { initialDays: 60, chunkDays: 60, label: '1D' },
};
const INTERVAL_ORDER: SelectableInterval[] = ['1min', '5min', '15min', '30min', '1hour', 'daily'];

// One row of the 7-level historical table: the DB's full level set (superset of
// the 5 "official" levels used for closest-level business logic elsewhere).
type SevenLevel = { name: string; price: number; value: number };
type LevelHistoryEntry = {
  levels: LevelCalculation[];
  closestLevel: string;
  close: number;
  sevenLevels: SevenLevel[];
  oi?: { callOi: number; putOi: number; oiDiff: number };
  ratios?: { upc: number; ucpr: number };
};
const SEVEN_LEVEL_ORDER = ['put_low', 'put_int', 'put_call_int', 'call_int', 'call_high', 'call_low', 'put_high'];

type RangePreset = '10d' | '30d' | '90d' | 'custom';
const RANGE_PRESET_DAYS: Record<Exclude<RangePreset, 'custom'>, number> = { '10d': 10, '30d': 30, '90d': 90 };
const RANGE_PRESET_LABELS: Record<RangePreset, string> = { '10d': '10D', '30d': '30D', '90d': '90D', custom: 'Custom' };

type OptChainRow = { optType: 'put' | 'call'; strike: number; ltp: number; oi: number; oiChg: number; close: number; loadDate: string };
type OptChainSortKey = 'loadDate' | 'close' | 'strike' | 'optType' | 'ltp' | 'oi' | 'oiChg' | 'absOiChg' | 'chgOpenIntPrice' | 'absChgOpenIntPrice';

type OptChainPreset = '10d' | '30d' | '90d' | 'all';
const OPT_CHAIN_PRESET_DAYS: Record<Exclude<OptChainPreset, 'all'>, number> = { '10d': 10, '30d': 30, '90d': 90 };
const OPT_CHAIN_PRESET_LABELS: Record<OptChainPreset, string> = { '10d': '10D', '30d': '30D', '90d': '90D', all: 'All' };
// us_opt_chg_rpt history per symbol+expiry runs to roughly a few months
// (confirmed ~80 trading days for a typical contract) — far enough back to
// stand in for "all" without a separate unbounded-query code path.
const OPT_CHAIN_ALL_FROM = '2000-01-01';

// Shape of /api/stocks/[symbol]/quote. Every field but `price` can be null —
// Alpaca omits prevDailyBar/dailyBar for names that haven't printed, and the
// route reports null rather than a NaN change in that case.
interface LiveQuote {
  price: number;
  dayOpen: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  prevClose: number | null;
  change: number | null;
  changePercent: number | null;
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

// Shifts a 'YYYY-MM-DD' date-only string by `days` calendar days, entirely
// in UTC. `new Date('YYYY-MM-DD')` parses as UTC midnight, but date-fns'
// format() reads back in the LOCAL timezone — mixing the two silently
// shifts the result by a day whenever local time trails UTC (any
// negative-offset timezone). Doing the arithmetic in UTC throughout avoids
// ever crossing that boundary.
function shiftDateString(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

function Spinner() {
  return <div className="inline-block animate-spin h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent rounded-full" />;
}

function OptChainSortLabel({ label, active, dir, onClick, align = 'right' }: {
  label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void; align?: 'left' | 'right';
}) {
  return (
    <button onClick={onClick} className={`flex items-center gap-0.5 hover:text-gray-700 ${align === 'right' ? 'ml-auto' : ''}`}>
      {label}
      <span className={active ? 'text-blue-500' : 'text-gray-300'}>{active ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </button>
  );
}

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
  const [chartInterval, setChartInterval] = useState<SelectableInterval>('daily');
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
  const earningsSectionRef = useRef<HTMLDivElement>(null);
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
  const [priceHistoryCollapsed, setPriceHistoryCollapsed] = useState(false);
  const [priceHistoryPreset, setPriceHistoryPreset] = useState<RangePreset>('10d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Option-chain OI (public.us_opt_chg_rpt) — per-strike put/call OI snapshot
  // for the selected expiry, refetched whenever the expiry changes.
  const [optChainRows, setOptChainRows] = useState<OptChainRow[]>([]);
  const [optChainLoading, setOptChainLoading] = useState(false);
  const [optChainRange, setOptChainRange] = useState<{ from: string; to: string } | null>(null);
  const [optChainCollapsed, setOptChainCollapsed] = useState(false);
  const [optChainPreset, setOptChainPreset] = useState<OptChainPreset>('10d');
  const [optChainSearch, setOptChainSearch] = useState('');
  const [optChainTypeFilter, setOptChainTypeFilter] = useState<'all' | 'call' | 'put'>('all');
  const [optChainColFilters, setOptChainColFilters] = useState({ strike: '' });
  const [optChainSortKey, setOptChainSortKey] = useState<OptChainSortKey>('loadDate');
  const [optChainSortDir, setOptChainSortDir] = useState<'asc' | 'desc'>('desc');

  // Selected contract for the OHLCV popup — set by clicking an Option Chain row.
  const [selectedOptContract, setSelectedOptContract] = useState<{ strike: number; optType: 'call' | 'put' } | null>(null);

  const priceLevelsSectionRef = useRef<HTMLDivElement>(null);
  const optChainSectionRef = useRef<HTMLDivElement>(null);

  function jumpToSection(ref: React.RefObject<HTMLDivElement | null>, expand?: () => void) {
    expand?.();
    requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
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

  useEffect(() => {
    if (!symbol) return;

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
          const expiryToUse = selectedExpiryRef.current || dates[0];
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
          setSelectedExpiry(selectedExpiryRef.current || expiryData.data.expiryDates[0]);

          if (histLevelsData?.success && histLevelsData.data && histLevelsData.data.history) {
            const levelsMap = new Map();
            let latestDate = '';
            let latestLevels: any = null;

            histLevelsData.data.history.forEach((item: any) => {
              levelsMap.set(item.date, {
                levels: item.calculated,
                closestLevel: item.closestLevel,
                close: item.close,
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
  }, [symbol, chartInterval]);

  // Fetch historical levels data when expiry date changes (skip initial load)
  useEffect(() => {
    if (!symbol || !selectedExpiry || isInitialLoad || ohlcData.length === 0) return;

    // `ohlcData` and `selectedExpiry` don't always land in the same render —
    // switching expiries can fire this effect once with the OLD ohlcData
    // (mismatched date range for the new expiry) before the new ohlcData
    // arrives and fires it again correctly. Without this guard, whichever
    // response resolves LAST wins, which isn't always the correct one —
    // the stale request can overwrite good data if it's slower.
    let cancelled = false;
    setLevelsRefreshing(true);

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

            const oiDataFromLevels = levelsData.data.history
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
          } else {
            setHistoricalLevels(new Map());
            setLevels([]);
            setClosestLevel('');
            setOiData([]);
          }
        }
      } catch (err) {
        console.error('Error fetching historical levels:', err);
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
  useEffect(() => {
    if (embedded || !symbol || !selectedExpiry) return;

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
  }, [embedded, symbol, selectedExpiry, expiryMode, priceHistoryPreset, customFrom, customTo]);

  // Option-chain OI — fetches every daily snapshot within the selected
  // window (10D/30D/90D/All) for the selected expiry, not just the latest day.
  useEffect(() => {
    if (embedded || !symbol || !selectedExpiry) return;

    // Same expiry-anchoring as the Price Levels History effect above.
    const to = expiryMode === 'historical' ? selectedExpiry : format(new Date(), 'yyyy-MM-dd');
    const from = optChainPreset === 'all' ? OPT_CHAIN_ALL_FROM : shiftDateString(to, -OPT_CHAIN_PRESET_DAYS[optChainPreset]);

    let cancelled = false;
    setOptChainLoading(true);
    fetch(`/api/stocks/${symbol}/opt-chain?expiry=${selectedExpiry}&from=${from}&to=${to}`)
      .then(res => res.json())
      .then(json => {
        if (cancelled) return;
        if (json.success) {
          setOptChainRows(json.data.rows || []);
          setOptChainRange({ from: json.data.from, to: json.data.to });
        } else {
          setOptChainRows([]);
          setOptChainRange(null);
        }
      })
      .catch(() => { if (!cancelled) { setOptChainRows([]); setOptChainRange(null); } })
      .finally(() => { if (!cancelled) setOptChainLoading(false); });
    return () => { cancelled = true; };
  }, [embedded, symbol, selectedExpiry, expiryMode, optChainPreset]);

  // Live price — polls Alpaca's latest trade. Fast during market hours for a
  // genuinely "live" feel, much slower off-hours since the price can't move.
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    function poll() {
      fetch(`/api/stocks/${symbol}/quote`)
        .then(r => r.json())
        .then(res => {
          if (cancelled || !res.success || !res.data) return;
          setQuote(res.data);
        })
        .catch(() => {})
        .finally(() => {
          if (cancelled) return;
          timeoutId = setTimeout(poll, isUsMarketHours(new Date()) ? 10_000 : 5 * 60_000);
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

        // Merge new data with existing data
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
        if (expiryAtStart && !isStale()) {
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
                    sevenLevels: item.sevenLevels || [],
                    oi: item.oi,
                    ratios: item.ratios,
                  });
                });
                return newMap;
              });

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

  function handleOptChainSort(key: OptChainSortKey) {
    if (optChainSortKey === key) {
      setOptChainSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setOptChainSortKey(key);
      setOptChainSortDir('desc');
    }
  }

  const visibleOptChainRows = optChainRows
    .filter(r => {
      if (optChainTypeFilter !== 'all' && r.optType !== optChainTypeFilter) return false;
      const q = optChainSearch.trim().toLowerCase();
      if (q && !String(r.strike).includes(q) && !r.optType.includes(q)) return false;
      if (optChainColFilters.strike && !String(r.strike).includes(optChainColFilters.strike)) return false;
      return true;
    })
    // Notional $ value of the OI change: contracts changed * premium * 100 shares/contract.
    .map(r => ({ ...r, chgOpenIntPrice: r.oiChg * r.ltp * 100 }))
    .sort((a, b) => {
      const dir = optChainSortDir === 'asc' ? 1 : -1;
      let av: number | string;
      let bv: number | string;
      switch (optChainSortKey) {
        case 'absOiChg':
          av = Math.abs(a.oiChg); bv = Math.abs(b.oiChg); break;
        case 'absChgOpenIntPrice':
          av = Math.abs(a.chgOpenIntPrice); bv = Math.abs(b.chgOpenIntPrice); break;
        default:
          av = a[optChainSortKey]; bv = b[optChainSortKey];
      }
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });

  // Quick jump to the two data-heavy sections below the chart. Sits under the
  // stock quote while the chart stack is open, and in the toggle row once it
  // collapses (the quote block is gone then).
  const jumpButtons = (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => jumpToSection(priceLevelsSectionRef, () => setPriceHistoryCollapsed(false))}
        className="px-3 py-1.5 rounded-full text-xs font-bold border-2 border-green-600 bg-green-50 text-green-700 hover:bg-green-600 hover:text-white transition-colors"
      >
        📊 Price Levels
      </button>
      <button
        onClick={() => jumpToSection(optChainSectionRef, () => setOptChainCollapsed(false))}
        className="px-3 py-1.5 rounded-full text-xs font-bold border-2 border-orange-600 bg-orange-50 text-orange-700 hover:bg-orange-600 hover:text-white transition-colors"
      >
        📈 Open Interest
      </button>
      {earningsLocked === false && (
        <button
          onClick={() => jumpToSection(earningsSectionRef, () => {})}
          className="px-3 py-1.5 rounded-full text-xs font-bold border-2 border-amber-600 bg-amber-50 text-amber-700 hover:bg-amber-600 hover:text-white transition-colors"
        >
          📣 Earnings
        </button>
      )}
    </div>
  );

  // One expiry pill — shared by the current and historical ladders.
  function renderExpiryButton(date: string) {
    const isActive = date === selectedExpiry;
    const alertCount = scanAlerts.filter(a => a.expiryDate === date).length;
    // Expiries on/after the next report carry the earnings event inside them.
    const spansEarnings = !!earnings?.next && date >= earnings.next.date;
    return (
      <button
        key={date}
        onClick={() => setSelectedExpiry(date)}
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
        The {basisPrice !== undefined ? 'live' : 'closing'} price of{' '}
        {formatCurrency(basisPrice ?? stockData?.close)} is closest to the{' '}
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

  // Dates and jump buttons, tucked under the quote in the chart header
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
      {!embedded && jumpButtons}
    </div>
  );

  const intervalSelector = (
    <div className="flex items-center gap-1">
      {INTERVAL_ORDER.map((iv) => (
        <button
          key={iv}
          onClick={() => setChartInterval(iv)}
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

          {/* The whole block (header, expiry selector, chart) collapses behind
              one icon button in the chart toolbar. Collapsed, it shrinks to a
              slim bar that keeps the quote, the section jumps and the expiry
              selector — the tables below still depend on the selected expiry. */}
          {chartStackCollapsed && (
            <div className="mb-8 space-y-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-white rounded-lg shadow-md px-3 py-2">
                <span className="text-xl font-bold">{symbol.toUpperCase()}</span>
                {(basisPrice ?? stockData?.close) !== undefined && (
                  <span className="text-base text-gray-600">{formatCurrency(basisPrice ?? stockData?.close)}</span>
                )}
                {basisPrice !== undefined && quote?.change != null && (
                  <span className={`text-xs font-bold ${quote.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {quote.change >= 0 ? '+' : '−'}{formatCurrency(Math.abs(quote.change))}
                    {quote.changePercent != null && ` (${quote.changePercent >= 0 ? '+' : '−'}${Math.abs(quote.changePercent).toFixed(2)}%)`}
                  </span>
                )}
                {!embedded && <div className="ml-2">{jumpButtons}</div>}
                {collapseButton}
              </div>
              {expiryPanel}
            </div>
          )}

          {/* Main Chart + side panel */}
          {!chartStackCollapsed && (
            <div className={embedded ? 'relative' : 'relative mb-8'}>
              <TVChart
                symbol={symbol.toUpperCase()}
                candleData={candleData}
                volumeData={volumeData}
                oiData={chartOiData}
                levels={displayLevels}
                closestLevel={closestLevelName}
                historicalLevels={historicalLevels}
                scanAlerts={scanAlerts}
                earningsEvents={earningsHistory ?? undefined}
                selectedExpiry={selectedExpiry}
                isIntraday={isIntradayInterval(chartInterval)}
                livePrice={basisPrice}
                currentPrice={stockData?.close}
                dayChange={basisPrice !== undefined ? quote?.change : undefined}
                dayChangePercent={basisPrice !== undefined ? quote?.changePercent : undefined}
                dayHigh={basisPrice !== undefined ? quote?.dayHigh : undefined}
                dayLow={basisPrice !== undefined ? quote?.dayLow : undefined}
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
                toolbarEnd={collapseButton}
                height={embedded ? 520 : 600}
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

          {!embedded && (<>
          {/* Price Levels History — close price, all 7 raw DB levels, OI, and the UPC/UCPR ratio columns.
              Independently rangeable (10D default, or 7D/30D/90D/Custom) rather than tied to the chart. */}
          <div ref={priceLevelsSectionRef} className="mt-6 bg-white rounded-lg shadow-md p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
              <button
                onClick={() => setPriceHistoryCollapsed(v => !v)}
                className="flex items-center gap-1.5 text-base font-bold hover:text-gray-700"
              >
                <span className={`inline-block transition-transform text-gray-400 ${priceHistoryCollapsed ? '' : 'rotate-90'}`}>▶</span>
                Price Levels History
              </button>

              {!priceHistoryCollapsed && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                    {(['10d', '30d', '90d', 'custom'] as RangePreset[]).map(p => (
                      <button
                        key={p}
                        onClick={() => setPriceHistoryPreset(p)}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                          priceHistoryPreset === p ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'
                        }`}
                      >
                        {RANGE_PRESET_LABELS[p]}
                      </button>
                    ))}
                  </div>
                  {priceHistoryPreset === 'custom' && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <input
                        type="date"
                        value={customFrom}
                        onChange={e => setCustomFrom(e.target.value)}
                        className="px-2 py-1 border border-gray-200 rounded text-xs"
                      />
                      <span className="text-gray-400">to</span>
                      <input
                        type="date"
                        value={customTo}
                        onChange={e => setCustomTo(e.target.value)}
                        className="px-2 py-1 border border-gray-200 rounded text-xs"
                      />
                    </div>
                  )}
                  {priceHistoryLoading && <Spinner />}
                </div>
              )}
            </div>

            {!priceHistoryCollapsed && (
              priceHistoryRows.length === 0 ? (
                <div className="text-center py-4 text-gray-500 text-sm">
                  {priceHistoryLoading
                    ? 'Loading…'
                    : `No historical level data available${selectedExpiry ? ` for expiry ${selectedExpiry}` : ''} in this range.`}
                </div>
              ) : (
                // Bounded height + internal scroll, so the panel's own header
                // (range presets, custom dates) stays on screen while paging
                // through rows, and the column headers stick to the top of
                // this box rather than scrolling away with them.
                <div className="overflow-auto max-h-[65vh]">
                  <table className="w-full text-xs whitespace-nowrap">
                    {/* bg-white on the th, not just the thead — a transparent
                        cell would let rows show through as they scroll under.
                        The divider is an inset shadow rather than the tr's
                        border-b: preflight sets border-collapse:collapse, and
                        collapsed borders don't travel with a sticky cell. */}
                    <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-white [&_th]:shadow-[inset_0_-1px_0_0_#e5e7eb]">
                      <tr className="text-gray-500">
                        <th className="text-left py-1.5 pr-3 font-medium">Date</th>
                        <th className="text-right py-1.5 px-2 font-medium">Close</th>
                        {SEVEN_LEVEL_ORDER.map((name) => (
                          <th key={name} className="text-right py-1.5 px-2 font-medium">
                            {getLevelDisplayName(name)}
                          </th>
                        ))}
                        <th className="text-right py-1.5 px-2 font-medium">Call OI</th>
                        <th className="text-right py-1.5 px-2 font-medium">Put OI</th>
                        <th className="text-right py-1.5 px-2 font-medium">OI Diff</th>
                        <th className="text-right py-1.5 pl-2 font-medium">UPC</th>
                        <th className="text-right py-1.5 pl-2 font-medium">UCPR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {priceHistoryRows.map((row) => {
                        const closest = row.sevenLevels.length > 0
                          ? row.sevenLevels.reduce((c, l) => Math.abs(l.value) < Math.abs(c.value) ? l : c)
                          : null;
                        const levelsByName = new Map(row.sevenLevels.map(l => [l.name, l]));

                        return (
                          <tr key={row.date} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                            <td className="py-1.5 pr-3 text-gray-600">{row.date}</td>
                            <td className="text-right py-1.5 px-2 font-semibold">{formatCurrency(row.close)}</td>
                            {SEVEN_LEVEL_ORDER.map((name) => {
                              const lvl = levelsByName.get(name);
                              const isClosest = !!closest && lvl && closest.name === lvl.name;
                              return (
                                <td
                                  key={name}
                                  className={`text-right py-1.5 px-2 font-mono ${
                                    isClosest ? 'bg-blue-50 text-blue-700 font-bold rounded' : ''
                                  }`}
                                >
                                  {lvl ? formatCurrency(lvl.price) : '—'}
                                  {lvl && (
                                    <span className={`ml-1 ${isClosest ? 'text-blue-500' : 'text-gray-400'}`}>
                                      ({formatPercentage(lvl.value)})
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="text-right py-1.5 px-2 text-gray-600">{row.oi?.callOi?.toLocaleString() ?? '—'}</td>
                            <td className="text-right py-1.5 px-2 text-gray-600">{row.oi?.putOi?.toLocaleString() ?? '—'}</td>
                            <td className="text-right py-1.5 px-2 text-gray-600">{row.oi?.oiDiff?.toLocaleString() ?? '—'}</td>
                            <td className="text-right py-1.5 pl-2 text-gray-600">{row.ratios?.upc ?? '—'}</td>
                            <td className="text-right py-1.5 pl-2 text-gray-600">{row.ratios?.ucpr ?? '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>

          {/* Option Chain OI (public.us_opt_chg_rpt) — per-strike put/call OI
              snapshot for the selected expiry (latest available load_dt),
              with per-column filters plus a strike/type search. */}
          <div ref={optChainSectionRef} className="mt-6 bg-white rounded-lg shadow-md p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
              <button
                onClick={() => setOptChainCollapsed(v => !v)}
                className="flex items-center gap-1.5 text-base font-bold hover:text-gray-700"
              >
                <span className={`inline-block transition-transform text-gray-400 ${optChainCollapsed ? '' : 'rotate-90'}`}>▶</span>
                Open Interest — Option Chain
                {optChainRange && <span className="text-xs font-normal text-gray-400">{optChainRange.from} to {optChainRange.to}</span>}
              </button>

              {!optChainCollapsed && (
                <div className="flex items-center gap-2">
                  <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                    {(['10d', '30d', '90d', 'all'] as OptChainPreset[]).map(p => (
                      <button
                        key={p}
                        onClick={() => setOptChainPreset(p)}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                          optChainPreset === p ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'
                        }`}
                      >
                        {OPT_CHAIN_PRESET_LABELS[p]}
                      </button>
                    ))}
                  </div>
                  {optChainLoading && <Spinner />}
                </div>
              )}
            </div>

            {!optChainCollapsed && (
              <>
                <div className="flex flex-wrap items-end gap-3 mb-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Search</label>
                    <input
                      value={optChainSearch}
                      onChange={e => setOptChainSearch(e.target.value)}
                      placeholder="Strike or type…"
                      className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white w-40"
                    />
                  </div>
                  {visibleOptChainRows.length !== optChainRows.length && (
                    <span className="text-[11px] text-gray-400 pb-1.5">{visibleOptChainRows.length} of {optChainRows.length} rows</span>
                  )}
                </div>

                {optChainRows.length === 0 ? (
                  <div className="text-center py-4 text-gray-500 text-sm">
                    {optChainLoading ? 'Loading…' : `No option chain data available${selectedExpiry ? ` for expiry ${selectedExpiry}` : ''}.`}
                  </div>
                ) : (
                  // Same bounded scroll box as the Price Levels History table
                  // above, so the range presets and search stay reachable and
                  // the sort/filter row sticks while scrolling strikes.
                  <div className="overflow-auto max-h-[65vh]">
                    <table className="w-full text-xs whitespace-nowrap">
                      <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-white [&_th]:shadow-[inset_0_-1px_0_0_#e5e7eb]">
                        <tr className="text-gray-500 align-bottom">
                          <th className="text-left py-1.5 pr-3 font-medium">Symbol</th>
                          <th className="text-left py-1.5 px-2 font-medium">Expiry</th>
                          <th className="text-left py-1.5 px-2 font-medium">
                            <OptChainSortLabel label="Trade Date" align="left" active={optChainSortKey === 'loadDate'} dir={optChainSortDir} onClick={() => handleOptChainSort('loadDate')} />
                          </th>
                          <th className="text-right py-1.5 px-2 font-medium">
                            <OptChainSortLabel label="CMP" active={optChainSortKey === 'close'} dir={optChainSortDir} onClick={() => handleOptChainSort('close')} />
                          </th>
                          <th className="text-right py-1.5 px-2 font-medium">
                            <OptChainSortLabel label="Strike Price" active={optChainSortKey === 'strike'} dir={optChainSortDir} onClick={() => handleOptChainSort('strike')} />
                            <input
                              value={optChainColFilters.strike}
                              onChange={e => setOptChainColFilters(prev => ({ ...prev, strike: e.target.value }))}
                              placeholder="Filter…"
                              className="mt-1 w-full px-1.5 py-0.5 border border-gray-200 rounded text-[11px] text-right font-normal focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                            />
                          </th>
                          <th className="text-left py-1.5 px-2 font-medium">
                            <OptChainSortLabel label="Opt Typ" align="left" active={optChainSortKey === 'optType'} dir={optChainSortDir} onClick={() => handleOptChainSort('optType')} />
                            <select
                              value={optChainTypeFilter}
                              onChange={e => setOptChainTypeFilter(e.target.value as 'all' | 'call' | 'put')}
                              className="mt-1 px-1 py-0.5 border border-gray-200 rounded text-[11px] font-normal capitalize focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                            >
                              <option value="all">All</option>
                              <option value="call">Call</option>
                              <option value="put">Put</option>
                            </select>
                          </th>
                          <th className="text-right py-1.5 px-2 font-medium">
                            <OptChainSortLabel label="Opt LTP" active={optChainSortKey === 'ltp'} dir={optChainSortDir} onClick={() => handleOptChainSort('ltp')} />
                          </th>
                          <th className="text-right py-1.5 px-2 font-medium">
                            <OptChainSortLabel label="Open Int" active={optChainSortKey === 'oi'} dir={optChainSortDir} onClick={() => handleOptChainSort('oi')} />
                          </th>
                          <th className="text-right py-1.5 px-2 font-medium">
                            <OptChainSortLabel label="Chg Open Int" active={optChainSortKey === 'oiChg'} dir={optChainSortDir} onClick={() => handleOptChainSort('oiChg')} />
                          </th>
                          <th className="text-right py-1.5 px-2 font-medium">
                            <OptChainSortLabel label="ABS Chg Open Int" active={optChainSortKey === 'absOiChg'} dir={optChainSortDir} onClick={() => handleOptChainSort('absOiChg')} />
                          </th>
                          <th className="text-right py-1.5 px-2 font-medium">
                            <OptChainSortLabel label="Chg Open Int Price" active={optChainSortKey === 'chgOpenIntPrice'} dir={optChainSortDir} onClick={() => handleOptChainSort('chgOpenIntPrice')} />
                          </th>
                          <th className="text-right py-1.5 pl-2 font-medium">
                            <OptChainSortLabel label="ABS Chg Open Int Price" active={optChainSortKey === 'absChgOpenIntPrice'} dir={optChainSortDir} onClick={() => handleOptChainSort('absChgOpenIntPrice')} />
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleOptChainRows.map((r, i) => {
                          const chgOpenIntPrice = r.chgOpenIntPrice;
                          return (
                            <tr
                              key={`${r.loadDate}-${r.optType}-${r.strike}-${i}`}
                              onClick={() => setSelectedOptContract({ strike: r.strike, optType: r.optType })}
                              title="View option contract chart"
                              className="border-b border-gray-100 last:border-0 hover:bg-blue-50 cursor-pointer"
                            >
                              <td className="py-1.5 pr-3 text-gray-600">{symbol.toUpperCase()}</td>
                              <td className="py-1.5 px-2 text-gray-600">{selectedExpiry}</td>
                              <td className="py-1.5 px-2 text-gray-600">{r.loadDate}</td>
                              <td className="text-right py-1.5 px-2 text-gray-600">{r.close}</td>
                              <td className="text-right py-1.5 px-2 font-mono">{r.strike}</td>
                              <td className={`py-1.5 px-2 font-semibold capitalize ${r.optType === 'call' ? 'text-green-600' : 'text-red-600'}`}>{r.optType}</td>
                              <td className="text-right py-1.5 px-2 text-gray-600">{r.ltp}</td>
                              <td className="text-right py-1.5 px-2 text-gray-600">{r.oi.toLocaleString()}</td>
                              <td className={`text-right py-1.5 px-2 font-semibold ${r.oiChg > 0 ? 'text-green-600' : r.oiChg < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                                {r.oiChg > 0 ? '+' : ''}{r.oiChg.toLocaleString()}
                              </td>
                              <td className="text-right py-1.5 px-2 text-gray-600">{Math.abs(r.oiChg).toLocaleString()}</td>
                              <td className={`text-right py-1.5 px-2 font-semibold ${chgOpenIntPrice > 0 ? 'text-green-600' : chgOpenIntPrice < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                                {chgOpenIntPrice > 0 ? '+' : ''}{chgOpenIntPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </td>
                              <td className="text-right py-1.5 pl-2 text-gray-600">{Math.abs(chgOpenIntPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                            </tr>
                          );
                        })}
                        {visibleOptChainRows.length === 0 && (
                          <tr><td colSpan={12} className="text-center py-4 text-gray-400">No rows match your filters.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>

          {earningsLocked === false && (
            <div ref={earningsSectionRef}>
              <EarningsHistoryTable history={earningsHistory} loading={earningsHistory === null} />
            </div>
          )}
          </>)}
        </div>
      </div>

      {selectedOptContract && selectedExpiry && (
        <OptionContractModal
          symbol={symbol}
          expiry={selectedExpiry}
          strike={selectedOptContract.strike}
          optType={selectedOptContract.optType}
          onClose={() => setSelectedOptContract(null)}
        />
      )}
    </>
  );
}
