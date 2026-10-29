import Term from '@/components/ui/Term';
import type { GlossaryKey } from '@/lib/payoff/glossary';
import type { Analysis } from '@/lib/payoff/evaluate';
import { fmtMoney, fmtPct } from './format';

function Stat({ k, label, children, tone }: { k: GlossaryKey; label: string; children: React.ReactNode; tone?: 'pos' | 'neg' }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5 min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500"><Term k={k}>{label}</Term></div>
      <div className={`text-sm font-bold tabular-nums truncate ${tone === 'pos' ? 'text-green-700' : tone === 'neg' ? 'text-red-700' : 'text-gray-900'}`}>{children}</div>
    </div>
  );
}

/** Position metrics at the nearest expiry, plus net greeks today. */
export default function MetricsPanel({ a }: { a: Analysis }) {
  const debit = a.netPremium >= 0;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
      <Stat k={debit ? 'netDebit' : 'netCredit'} label={debit ? 'Net debit' : 'Net credit'}>{fmtMoney(Math.abs(a.netPremium))}</Stat>
      <Stat k="maxProfit" label="Max profit" tone="pos">{a.unboundedProfit ? <Term k="unbounded">∞</Term> : fmtMoney(a.maxProfit)}</Stat>
      <Stat k="maxLoss" label="Max loss" tone="neg">{a.unboundedLoss ? <Term k="unbounded">∞</Term> : fmtMoney(a.maxLoss)}</Stat>
      <Stat k="pop" label="POP">{a.pop != null ? fmtPct(a.pop) : '—'}</Stat>
      <Stat k="breakeven" label="Breakeven">{a.breakevens.length ? a.breakevens.map(b => b.toFixed(2)).join(' · ') : '—'}</Stat>
      <Stat k="rewardRisk" label="R/R">{a.rewardRisk != null ? `${a.rewardRisk.toFixed(2)}×` : '—'}</Stat>
      <Stat k="margin" label="Est. capital">{a.margin.floor ? '≥ ' : ''}{fmtMoney(a.margin.value)}</Stat>
      <Stat k="dte" label="DTE">{a.dte < 1 ? '<1' : Math.floor(a.dte)}</Stat>
      <div className="col-span-2 sm:col-span-4 lg:col-span-8 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600 px-1">
        <span>Position greeks:</span>
        <span><Term k="delta">Δ</Term> <b className="tabular-nums">{a.greeks.delta.toFixed(1)}</b></span>
        <span><Term k="gamma">Γ</Term> <b className="tabular-nums">{a.greeks.gamma.toFixed(3)}</b></span>
        <span><Term k="theta">Θ</Term> <b className="tabular-nums">{fmtMoney(a.greeks.theta)}</b>/day</span>
        <span><Term k="vega">V</Term> <b className="tabular-nums">{fmtMoney(a.greeks.vega)}</b>/vol pt</span>
      </div>
    </div>
  );
}
