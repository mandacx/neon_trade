'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import Modal from '@/components/ui/Modal';
import Term from '@/components/ui/Term';
import OiTrendChart, { type OiTrendPoint } from '@/components/charts/OiTrendChart';
import { shiftDateString, Spinner } from './shared';

// Total call / put OI per day for one expiry, opened from the Open Interest tab's button. It reads
// /levels?range=true only when opened (and per window change), so the tab itself costs no request
// for it. That route is rate limited and clamps the range for delayed plans, same as the chart.

// Calendar days back from today (or from the expiry, for an expired one); 'all' = the expiry's whole history.
const WINDOWS = [
  { id: '7d', label: '7D', days: 7 },
  { id: '14d', label: '14D', days: 14 },
  { id: '1m', label: '1M', days: 30 },
  { id: '3m', label: '3M', days: 91 },
  { id: '6m', label: '6M', days: 182 },
  { id: '1y', label: '1Y', days: 365 },
  { id: 'all', label: 'All', days: null },
] as const;
type WindowId = (typeof WINDOWS)[number]['id'];

export default function OiTrendModal({ symbol, expiry, expiryMode, onClose }: {
  symbol: string;
  expiry: string;
  expiryMode: 'current' | 'historical';
  onClose: () => void;
}) {
  const [win, setWin] = useState<WindowId>('7d');
  const [points, setPoints] = useState<OiTrendPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // For an already-expired expiry, the window ends at the expiry, not today.
    const to = expiryMode === 'historical' ? expiry : format(new Date(), 'yyyy-MM-dd');
    const days = WINDOWS.find(w => w.id === win)!.days;
    const from = days === null ? '2000-01-01' : shiftDateString(to, -days);
    let cancelled = false;
    setPoints(null);
    setError(null);
    fetch(`/api/stocks/${symbol}/levels?expiry=${expiry}&range=true&from=${from}&to=${to}`)
      .then(async res => {
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !json?.success) {
          setError(json?.message ?? json?.error ?? 'Could not load the OI trend.');
          setPoints([]);
          return;
        }
        // OI can arrive as numeric strings; a day with both at 0 is "no data" (stored as zeros).
        const out: OiTrendPoint[] = [];
        for (const item of json.data?.history ?? []) {
          const callOi = Number(item.oi?.callOi ?? 0), putOi = Number(item.oi?.putOi ?? 0);
          if (callOi > 0 || putOi > 0) out.push({ date: item.date, callOi, putOi });
        }
        setPoints(out);
      })
      .catch(() => { if (!cancelled) { setError('Could not load the OI trend.'); setPoints([]); } });
    return () => { cancelled = true; };
  }, [symbol, expiry, expiryMode, win]);

  return (
    <Modal title={<span>{symbol} open interest trend <span className="text-sm font-normal text-gray-500">expiry {expiry}</span></span>} onClose={onClose} widthClassName="max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {WINDOWS.map(w => (
              <button key={w.id} onClick={() => setWin(w.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${win === w.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                {w.label}
              </button>
            ))}
          </div>
          {points === null && <Spinner />}
        </div>
        <span className="text-[11px] text-gray-400">
          Total <Term k="oi">OI</Term> across strikes, per day · <Term k="pcr">PCR</Term> on the left scale
        </span>
      </div>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      {points !== null && points.length === 0 && !error
        ? <p className="text-center py-10 text-sm text-gray-500">No open interest reported for this expiry in this window.</p>
        : <OiTrendChart points={points ?? []} height={360} />}
    </Modal>
  );
}
