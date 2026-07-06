'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getLevelColor, getLevelDisplayName, SCAN_CODE_TO_LEVEL } from '@/lib/utils';
import { ScanAlert } from '@/types/stock';

interface ScanAlertsTickerProps {
  limit?: number;
}

export default function ScanAlertsTicker({ limit = 20 }: ScanAlertsTickerProps) {
  const router = useRouter();
  const [alerts, setAlerts] = useState<ScanAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch(`/api/scan-alerts/recent?limit=${limit}`)
        .then(r => r.json())
        .then(res => { if (!cancelled && res.success) setAlerts(res.data.alerts); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    }
    load();
    const interval = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [limit]);

  if (loading) {
    return <div className="bg-white border border-gray-200 rounded-xl h-11 animate-pulse" />;
  }
  if (alerts.length === 0) return null;

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
        <div className="flex scan-ticker-track whitespace-nowrap">
          {alerts.map((a, i) => <Item key={`a-${i}`} a={a} idx={i} />)}
          {alerts.map((a, i) => <Item key={`b-${i}`} a={a} idx={i} />)}
        </div>
      </div>
    </div>
  );
}
