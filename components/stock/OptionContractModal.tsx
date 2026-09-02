'use client';

import { useEffect, useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import Modal from '@/components/ui/Modal';
import OptionContractChart, { OptionBarPoint, UnderlyingPoint, OiHistoryPoint } from '@/components/charts/OptionContractChart';
import { isIntradayInterval } from '@/lib/alpaca';

type ModalInterval = '1min' | '5min' | '15min' | '30min' | '1hour' | 'daily';
const INTERVAL_LABELS: Record<ModalInterval, string> = {
  '1min': '1m', '5min': '5m', '15min': '15m', '30min': '30m', '1hour': '1H', daily: '1D',
};
const INTERVAL_ORDER: ModalInterval[] = ['1min', '5min', '15min', '30min', '1hour', 'daily'];

type RangePreset = '10d' | '30d' | '90d' | 'all';
const RANGE_PRESET_DAYS: Record<Exclude<RangePreset, 'all'>, number> = { '10d': 10, '30d': 30, '90d': 90 };
const RANGE_PRESET_LABELS: Record<RangePreset, string> = { '10d': '10D', '30d': '30D', '90d': '90D', all: 'All' };
// Matches app/stock/[symbol]/page.tsx's OPT_CHAIN_ALL_FROM — far enough back to
// stand in for "the beginning" of available us_opt_chg_rpt/option-bar history.
const ALL_FROM = '2000-01-01';

function Spinner() {
  return <div className="inline-block animate-spin h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent rounded-full" />;
}

interface OptionContractModalProps {
  symbol: string;
  expiry: string;
  strike: number;
  optType: 'call' | 'put';
  onClose: () => void;
}

export default function OptionContractModal({ symbol, expiry, strike, optType, onClose }: OptionContractModalProps) {
  const [interval, setInterval_] = useState<ModalInterval>('daily');
  // 30 days by default rather than "All". "All" starts at ALL_FROM, and
  // getOptionBars pages the Alpaca options endpoint up to 20 times to cover
  // whatever span it's given — so opening this modal used to fire a burst of
  // upstream requests to draw a chart nobody had asked to see in full yet.
  // "All" is still one click away for anyone who wants it.
  const [rangePreset, setRangePreset] = useState<RangePreset>('30d');

  const [optionBars, setOptionBars] = useState<OptionBarPoint[]>([]);
  const [underlyingBars, setUnderlyingBars] = useState<UnderlyingPoint[]>([]);
  const [historyPoints, setHistoryPoints] = useState<OiHistoryPoint[]>([]);
  const [barsLoading, setBarsLoading] = useState(false);
  const [barsError, setBarsError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const today = format(new Date(), 'yyyy-MM-dd');

  // A contract stops trading at expiry, so for an already-expired one the last
  // N days *from today* is a window in which nothing exists — an empty chart,
  // paid for with the same upstream fetches. Anchor the range to the earlier of
  // today and expiry, so an expired contract shows its final N days of real
  // data and a live one shows the most recent N.
  const windowEnd = expiry < today ? expiry : today;

  // Full OI/LTP history for this exact strike+type — independent of the
  // chart's own interval/range controls, so "from the beginning" always holds
  // regardless of what the user picks for the bars themselves.
  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    fetch(`/api/stocks/${symbol}/opt-chain?expiry=${expiry}&from=${ALL_FROM}&to=${today}&strike=${strike}&optType=${optType}`)
      .then(res => res.json())
      .then(json => {
        if (cancelled) return;
        if (json.success && json.data?.rows) {
          setHistoryPoints(json.data.rows.map((r: any) => ({ loadDate: r.loadDate, ltp: r.ltp, oi: r.oi, oiChg: r.oiChg })));
        } else {
          setHistoryPoints([]);
        }
      })
      .catch(() => { if (!cancelled) setHistoryPoints([]); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, expiry, strike, optType, today]);

  // Option contract OHLCV + underlying stock OHLC, same range/interval so the
  // two series line up on the same time axis for direct comparison.
  useEffect(() => {
    let cancelled = false;
    // parseISO (not new Date) so 'yyyy-MM-dd' is read as local midnight —
    // new Date() would treat it as UTC and shift the day back in US timezones.
    const from = rangePreset === 'all'
      ? ALL_FROM
      : format(subDays(parseISO(windowEnd), RANGE_PRESET_DAYS[rangePreset]), 'yyyy-MM-dd');

    setBarsLoading(true);
    setBarsError(null);

    Promise.all([
      fetch(`/api/stocks/${symbol}/option-bars?expiry=${expiry}&strike=${strike}&optType=${optType}&interval=${interval}&from=${from}&to=${windowEnd}`).then(res => res.json()),
      fetch(`/api/stocks/${symbol}/ohlc?interval=${interval}&from=${from}&to=${windowEnd}`).then(res => res.json()),
    ])
      .then(([optionJson, underlyingJson]) => {
        if (cancelled) return;
        if (optionJson.success && optionJson.data?.data) {
          setOptionBars(optionJson.data.data.map((b: any) => ({
            time: b.timestamp, dayKey: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
          })));
        } else {
          setOptionBars([]);
          setBarsError(optionJson.message || optionJson.error || 'Failed to load option bar data.');
        }
        if (underlyingJson.success && underlyingJson.data?.data) {
          setUnderlyingBars(underlyingJson.data.data.map((b: any) => ({ time: b.timestamp, close: b.close })));
        } else {
          setUnderlyingBars([]);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setOptionBars([]);
        setUnderlyingBars([]);
        setBarsError('Failed to load chart data.');
      })
      .finally(() => { if (!cancelled) setBarsLoading(false); });

    return () => { cancelled = true; };
  }, [symbol, expiry, strike, optType, interval, rangePreset, windowEnd]);

  const occLabel = `${symbol.toUpperCase()} ${expiry} ${strike} ${optType === 'call' ? 'Call' : 'Put'}`;

  return (
    <Modal
      title={
        <span>
          {occLabel}
          <span className={`ml-2 text-xs font-semibold px-1.5 py-0.5 rounded ${optType === 'call' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {optType.toUpperCase()}
          </span>
        </span>
      }
      onClose={onClose}
      widthClassName="max-w-5xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {INTERVAL_ORDER.map(iv => (
              <button
                key={iv}
                onClick={() => setInterval_(iv)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  interval === iv ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'
                }`}
              >
                {INTERVAL_LABELS[iv]}
              </button>
            ))}
          </div>
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {(['10d', '30d', '90d', 'all'] as RangePreset[]).map(p => (
              <button
                key={p}
                onClick={() => setRangePreset(p)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  rangePreset === p ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'
                }`}
              >
                {RANGE_PRESET_LABELS[p]}
              </button>
            ))}
          </div>
          {(barsLoading || historyLoading) && <Spinner />}
        </div>
        <div className="text-[11px] text-gray-400">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1" />{symbol.toUpperCase()} price
          <span className="inline-block w-2 h-2 rounded-full bg-green-500 ml-3 mr-1" />OI ↑
          <span className="inline-block w-2 h-2 rounded-full bg-red-500 ml-3 mr-1" />OI ↓
        </div>
      </div>

      {barsError && (
        <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
          {barsError}
        </div>
      )}

      <OptionContractChart
        optionBars={optionBars}
        underlyingBars={underlyingBars}
        underlyingSymbol={symbol.toUpperCase()}
        historyPoints={historyPoints}
        isIntraday={isIntradayInterval(interval)}
        height={420}
      />

      <div className="mt-2 text-[11px] text-gray-400">
        {historyPoints.length} OI/LTP snapshot{historyPoints.length === 1 ? '' : 's'} on record for this contract.
      </div>
    </Modal>
  );
}
