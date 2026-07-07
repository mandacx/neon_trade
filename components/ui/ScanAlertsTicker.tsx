'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getLevelColor, getLevelDisplayName, SCAN_CODE_TO_LEVEL, isUsMarketHours } from '@/lib/utils';
import { ScanAlert } from '@/types/stock';

interface ScanAlertsTickerProps {
  limit?: number;
}

// Alerts only fire while the scanner runs intraday, so there's nothing new to
// find off-hours — poll fast during the session and much less often outside it
// to cut DB reads/cost without missing anything.
const MARKET_HOURS_POLL_MS = 15 * 60 * 1000;
const OFF_HOURS_POLL_MS = 60 * 60 * 1000;
// Bound on the accumulated/deduped list so the ticker can't grow unbounded.
const DISPLAY_CAP = 60;
// Keeps per-item dwell time roughly constant as the list grows, instead of a
// fixed-duration scroll rushing past a big batch unreadably.
const SECONDS_PER_ITEM = 2.2;
const MIN_SCROLL_SECONDS = 20;

function alertKey(a: ScanAlert): string {
  return `${a.symbol}|${a.expiryDate}|${a.loadDateTime}|${a.scanCode}`;
}

export default function ScanAlertsTicker({ limit = 40 }: ScanAlertsTickerProps) {
  const router = useRouter();
  const [alerts, setAlerts] = useState<ScanAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const seenRef = useRef<Map<string, ScanAlert>>(new Map());

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    function load() {
      fetch(`/api/scan-alerts/recent?limit=${limit}`)
        .then(r => r.json())
        .then(res => {
          if (cancelled || !res.success) return;
          const fresh: ScanAlert[] = res.data.alerts;
          fresh.forEach(a => seenRef.current.set(alertKey(a), a));
          const merged = [...seenRef.current.values()]
            .sort((a, b) => b.loadDateTime.localeCompare(a.loadDateTime))
            .slice(0, DISPLAY_CAP);
          seenRef.current = new Map(merged.map(a => [alertKey(a), a]));
          setAlerts(merged);
        })
        .catch(() => {})
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
          timeoutId = setTimeout(load, isUsMarketHours(new Date()) ? MARKET_HOURS_POLL_MS : OFF_HOURS_POLL_MS);
        });
    }

    load();
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [limit]);

  if (loading) {
    return <div className="bg-white border border-gray-200 rounded-xl h-11 animate-pulse" />;
  }
  if (alerts.length === 0) return null;

  const scrollSeconds = Math.max(alerts.length * SECONDS_PER_ITEM, MIN_SCROLL_SECONDS);

  const level = (a: ScanAlert) => SCAN_CODE_TO_LEVEL[a.scanCode] ?? a.closestLevel;

  const Item = ({ a, idx }: { a: ScanAlert; idx: number }) => {
    const color = getLevelColor(level(a));
    const up = a.chg >= 0;
    return (
      <button
        key={`${a.symbol}-${a.expiryDate}-${idx}`}
        onClick={() => router.push(`/stock/${a.symbol}`)}
        className="flex items-center gap-2 px-3 py-1.5 shrink-0 hover:bg-gray-50 rounded-lg transition-colors"
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="font-bold text-sm text-gray-800">{a.symbol}</span>
        <span className="text-xs font-mono text-gray-600">${a.close.toFixed(2)}</span>
        <span className={`text-xs font-semibold ${up ? 'text-green-600' : 'text-red-600'}`}>
          {up ? '+' : ''}{a.chg.toFixed(2)}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold text-white whitespace-nowrap" style={{ backgroundColor: color }}>
          {getLevelDisplayName(level(a))}
        </span>
        <span className="text-[10px] text-gray-400 whitespace-nowrap">exp {a.expiryDate}</span>
      </button>
    );
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden flex items-center">
      <span className="shrink-0 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-purple-700 bg-purple-50 border-r border-gray-200 flex items-center gap-1">
        🔔 New Alerts
      </span>
      <div className="overflow-hidden flex-1">
        <div className="flex scan-ticker-track whitespace-nowrap" style={{ animationDuration: `${scrollSeconds}s` }}>
          {alerts.map((a, i) => <Item key={`a-${i}`} a={a} idx={i} />)}
          {alerts.map((a, i) => <Item key={`b-${i}`} a={a} idx={i} />)}
        </div>
      </div>
    </div>
  );
}
