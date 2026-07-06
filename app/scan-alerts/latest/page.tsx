'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import QuadrantChart from '@/components/charts/QuadrantChart';
import Header from '@/components/layout/Header';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import ScanAlertsTicker from '@/components/ui/ScanAlertsTicker';
import { ScanAlert } from '@/types/stock';
import { getLevelColor, getLevelDisplayName } from '@/lib/utils';

interface FilterOptions {
  sectors?: string[];
  industries?: string[];
  marketCapTiers?: string[];
  indices?: { code: string; name: string }[];
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ScanAlertsLatestInner() {
  const searchParams = useSearchParams();
  const [alerts, setAlerts] = useState<ScanAlert[]>([]);
  const [filteredAlerts, setFilteredAlerts] = useState<ScanAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tradeDate, setTradeDate] = useState<string>('');
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [tradeDates, setTradeDates] = useState<string[]>([]);
  const [expiryDates, setExpiryDates] = useState<string[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({});

  const [filtersOpen, setFiltersOpen] = useState(true);
  const [listOpen, setListOpen] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [threshold, setThreshold] = useState<number>(0.5);
  const [sector, setSector] = useState(searchParams.get('sector') || '');
  const [industry, setIndustry] = useState(searchParams.get('industry') || '');
  const [marketCapTier, setMarketCapTier] = useState(searchParams.get('marketCapTier') || '');
  const [indexCode, setIndexCode] = useState(searchParams.get('index') || '');

  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const response = await fetch('/api/scan-alerts/latest?metadata=true');
        if (!response.ok) throw new Error('Failed to fetch metadata');
        const result = await response.json();
        if (result.success) {
          setTradeDates(result.data.tradeDates);
          setExpiryDates(result.data.expiryDates);
          setFilterOptions(result.data.filterOptions || {});
          if (result.data.tradeDates.length > 0) setTradeDate(result.data.tradeDates[0]);
        }
      } catch (err) {
        console.error('Error fetching metadata:', err);
      }
    };
    fetchMetadata();
  }, []);

  useEffect(() => {
    if (!tradeDate) return;
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ tradeDate });
        if (expiryDate) params.set('expiry', expiryDate);
        if (sector) params.set('sector', sector);
        if (industry) params.set('industry', industry);
        if (marketCapTier) params.set('marketCapTier', marketCapTier);
        if (indexCode) params.set('index', indexCode);
        const response = await fetch(`/api/scan-alerts/latest?${params}`);
        if (!response.ok) throw new Error('Failed to fetch scan alerts');
        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'Unknown error');
        setAlerts(result.data.alerts);
        setFilteredAlerts(result.data.alerts);
        if (result.data.filterOptions) setFilterOptions(result.data.filterOptions);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load scan alerts');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [tradeDate, expiryDate, sector, industry, marketCapTier, indexCode]);

  useEffect(() => {
    let filtered = alerts;
    if (searchQuery) {
      const q = searchQuery.toUpperCase();
      filtered = filtered.filter(a => a.symbol.includes(q));
    }
    filtered = filtered.filter(a => Math.abs(a.closestValue) <= threshold);
    setFilteredAlerts(filtered);
  }, [searchQuery, threshold, alerts]);

  if (isLoading) return <><Header /><LoadingSpinner message="Loading scan alerts..." /></>;
  if (error) return <><Header /><ErrorDisplay error={error} onRetry={() => window.location.reload()} /></>;

  const hasSecurityFilters = (filterOptions.sectors?.length ?? 0) > 0
    || (filterOptions.industries?.length ?? 0) > 0
    || (filterOptions.marketCapTiers?.length ?? 0) > 0
    || (filterOptions.indices?.length ?? 0) > 0;

  const hasActiveFilters = !!(sector || industry || marketCapTier || indexCode);

  const selectClass = "px-2 py-1.5 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-purple-400 bg-white max-w-[180px]";
  const labelClass = "block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5";

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-4 space-y-3">

          <ScanAlertsTicker />

          {/* Collapsible Filters */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <button
              onClick={() => setFiltersOpen(v => !v)}
              className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="font-semibold text-gray-800 text-sm">Filters</span>
                <span className="text-xs text-gray-400">
                  Showing <strong className="text-gray-700">{filteredAlerts.length}</strong> of <strong className="text-gray-700">{alerts.length}</strong> alerts
                </span>
                {hasActiveFilters && (
                  <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">Active</span>
                )}
              </div>
              <ChevronIcon open={filtersOpen} />
            </button>

            {filtersOpen && (
              <div className="px-4 pb-3 border-t border-gray-100">
                <div className="flex flex-wrap items-end gap-3 pt-3">
                  <div>
                    <label className={labelClass}>Trade Date</label>
                    <select value={tradeDate} onChange={e => setTradeDate(e.target.value)} className={selectClass}>
                      {tradeDates.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Expiry Date (future only)</label>
                    <select value={expiryDate} onChange={e => setExpiryDate(e.target.value)} className={selectClass}>
                      <option value="">All Future Expiries</option>
                      {expiryDates.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Symbol</label>
                    <input
                      type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                      placeholder="e.g., AAPL"
                      className="w-24 px-2 py-1.5 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-purple-400 bg-white"
                    />
                  </div>
                  <div className="w-40">
                    <label className={labelClass}>Proximity: {(threshold * 100).toFixed(0)}%</label>
                    <input
                      type="range" min="0" max="1" step="0.02" value={threshold}
                      onChange={e => setThreshold(parseFloat(e.target.value))}
                      className="w-full mt-1 accent-purple-500"
                    />
                    <div className="flex justify-between text-[10px] text-gray-300">
                      <span>0%</span><span>50%</span><span>100%</span>
                    </div>
                  </div>
                  {hasSecurityFilters && (filterOptions.sectors?.length ?? 0) > 0 && (
                    <div>
                      <label className={labelClass}>Sector</label>
                      <select value={sector} onChange={e => setSector(e.target.value)} className={selectClass}>
                        <option value="">All Sectors</option>
                        {filterOptions.sectors!.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  )}
                  {hasSecurityFilters && (filterOptions.industries?.length ?? 0) > 0 && (
                    <div>
                      <label className={labelClass}>Industry</label>
                      <select value={industry} onChange={e => setIndustry(e.target.value)} className={selectClass}>
                        <option value="">All Industries</option>
                        {filterOptions.industries!.map(i => <option key={i} value={i}>{i}</option>)}
                      </select>
                    </div>
                  )}
                  {hasSecurityFilters && (filterOptions.marketCapTiers?.length ?? 0) > 0 && (
                    <div>
                      <label className={labelClass}>Cap Tier</label>
                      <select value={marketCapTier} onChange={e => setMarketCapTier(e.target.value)} className={selectClass}>
                        <option value="">All</option>
                        {filterOptions.marketCapTiers!.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
                  {hasSecurityFilters && (filterOptions.indices?.length ?? 0) > 0 && (
                    <div>
                      <label className={labelClass}>Index</label>
                      <select value={indexCode} onChange={e => setIndexCode(e.target.value)} className={selectClass}>
                        <option value="">All Indices</option>
                        {filterOptions.indices!.map(i => <option key={i.code} value={i.code}>{i.name}</option>)}
                      </select>
                    </div>
                  )}
                  {hasActiveFilters && (
                    <div className="flex items-end pb-0.5">
                      <button
                        onClick={() => { setSector(''); setIndustry(''); setMarketCapTier(''); setIndexCode(''); }}
                        className="px-2.5 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Chart */}
          <QuadrantChart
            data={filteredAlerts}
            onStockClick={(symbol) => window.open(`/stock/${symbol}`, '_blank')}
            height={560}
            title="Scan Alerts Ladder"
            subtitle="alerts · positioned by price across each stock's own levels · colored by triggered level"
          />

          {/* Collapsible Alerts List */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <button
              onClick={() => setListOpen(v => !v)}
              className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <span className="font-semibold text-gray-800 text-sm">
                Alerts List <span className="font-normal text-gray-400 text-xs ml-1">({filteredAlerts.length})</span>
              </span>
              <ChevronIcon open={listOpen} />
            </button>

            {listOpen && (
              <div className="border-t border-gray-100">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Symbol</th>
                        <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Name</th>
                        <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Last Price</th>
                        <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Chg</th>
                        <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Alert</th>
                        <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Expiry</th>
                        <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Loaded</th>
                        {hasSecurityFilters && (
                          <>
                            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Sector</th>
                            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Cap Tier</th>
                          </>
                        )}
                        <th className="px-4 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredAlerts.slice(0, 50).map((a) => (
                        <tr key={`${a.symbol}-${a.expiryDate}-${a.loadDateTime}`} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm font-bold">{a.symbol}</td>
                          <td className="px-4 py-2 text-xs text-gray-600 max-w-[160px] truncate" title={(a as any).name || ''}>
                            {(a as any).name || '—'}
                          </td>
                          <td className="px-4 py-2 text-xs text-right font-mono">${a.close.toFixed(2)}</td>
                          <td className={`px-4 py-2 text-xs text-right font-mono font-semibold ${a.chg >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {a.chg >= 0 ? '+' : ''}{a.chg.toFixed(2)}
                          </td>
                          <td className="px-4 py-2 text-xs">
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold text-white"
                              style={{ backgroundColor: getLevelColor(a.closestLevel) }}>
                              {getLevelDisplayName(a.closestLevel).toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-500">{a.expiryDate}</td>
                          <td className="px-4 py-2 text-xs text-gray-400">{a.loadDateTime}</td>
                          {hasSecurityFilters && (
                            <>
                              <td className="px-4 py-2 text-xs text-gray-500">{(a as any).sector || '—'}</td>
                              <td className="px-4 py-2 text-xs text-gray-500">{(a as any).marketCapTier || '—'}</td>
                            </>
                          )}
                          <td className="px-4 py-2 text-center">
                            <button
                              onClick={() => window.open(`/stock/${a.symbol}`, '_blank')}
                              className="text-purple-600 hover:text-purple-800 text-xs font-medium"
                            >
                              View →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {filteredAlerts.length > 50 && (
                  <p className="px-4 py-2 text-xs text-gray-400 text-center border-t border-gray-100">
                    Showing first 50 of {filteredAlerts.length} alerts. Use filters to narrow results.
                  </p>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}

export default function ScanAlertsLatestPage() {
  return (
    <Suspense fallback={null}>
      <ScanAlertsLatestInner />
    </Suspense>
  );
}
