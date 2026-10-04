'use client';

import Link from 'next/link';
import type { EarningsResult, EarningsSummary } from '@/types/earnings';
import {
  LastResultBadge, fmtExpiry, fmtShortDate, fmtEps, fmtSales, earningsTimeShort, earningsTimeLong,
} from '@/components/watchlists/watchlistShared';

/**
 * Stock-page earnings UI (Pro feature `earnings`; data from lib/earnings.ts).
 * Header lines sit in the chart header under Expiry/Trade date; the history
 * table sits below the Option Chain on the full (non-embedded) page.
 */

/** True when the next report falls on or before the selected expiry. */
export function earningsBeforeExpiry(earnings: EarningsSummary | null, expiry: string | null | undefined): boolean {
  return !!earnings?.next && !!expiry && earnings.next.date <= expiry;
}

export function EarningsExpiryChip({ earnings, expiry }: { earnings: EarningsSummary | null; expiry: string | null | undefined }) {
  if (!earningsBeforeExpiry(earnings, expiry)) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-px rounded border border-amber-300 bg-amber-50 text-[10px] font-semibold text-amber-800"
      title={`Earnings on ${fmtExpiry(earnings!.next!.date)} fall before this expiry — the report can move price through these levels.`}
    >
      ⚠ Earnings before this expiry
    </span>
  );
}

export function EarningsHeaderLines({ earnings, locked }: { earnings: EarningsSummary | null; locked: boolean | null }) {
  if (locked) {
    return (
      <div className="text-xs text-gray-500">
        Earnings:{' '}
        <Link href="/upgrade?feature=earnings" className="font-medium text-blue-600 hover:underline">Pro</Link>
      </div>
    );
  }
  if (!earnings || (!earnings.next && !earnings.last && !earnings.pending)) return null;
  const { next, last, pending } = earnings;
  const showPending = pending && (!last || last.date < pending.date);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-600">
      {next && (
        <span title={`Next earnings ${fmtExpiry(next.date)}, ${earningsTimeLong(next.time)}`}>
          Next earnings:{' '}
          <strong className="text-gray-800">
            {fmtShortDate(next.date)}{earningsTimeShort(next.time) && ` · ${earningsTimeShort(next.time)}`}
          </strong>{' '}
          <span className={next.daysUntil <= 7 ? 'text-amber-700 font-semibold' : 'text-gray-500'}>
            {next.daysUntil === 0 ? 'today' : `in ${next.daysUntil}d`}
          </span>
          {next.epsEstimate != null && <span className="text-gray-500"> · est {fmtEps(next.epsEstimate)}</span>}
        </span>
      )}
      {showPending ? (
        <span>Last: <strong className="text-gray-800">{fmtShortDate(pending!.date)}</strong> <span className="text-gray-400">· results pending</span></span>
      ) : last && (
        <span className="inline-flex items-center gap-1.5">
          Last: <strong className="text-gray-800">{fmtShortDate(last.date)}</strong>
          <span className="text-gray-500 tabular-nums">
            EPS {fmtEps(last.epsActual)}{last.epsEstimate != null && ` vs ${fmtEps(last.epsEstimate)}`}
          </span>
          <LastResultBadge earnings={earnings} />
        </span>
      )}
    </div>
  );
}

function OutcomeText({ outcome }: { outcome: EarningsResult['epsOutcome'] }) {
  if (!outcome) return <span className="text-gray-300">—</span>;
  const tone = outcome === 'beat' ? 'text-green-700' : outcome === 'miss' ? 'text-red-700' : 'text-gray-500';
  return <span className={`font-semibold ${tone}`}>{outcome === 'beat' ? 'Beat' : outcome === 'miss' ? 'Miss' : 'In-line'}</span>;
}

export function EarningsHistoryTable({ history, loading }: { history: EarningsResult[] | null; loading: boolean }) {
  return (
    <div className="mt-6 bg-white rounded-lg shadow-md p-4">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Earnings History</h2>
      <p className="text-[11px] text-gray-400 mb-3">
        Reported quarters, newest first. EPS and sales vs consensus as reported on the day; adjusted EPS where the company reports it.
      </p>
      {loading && history === null ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : !history || history.length === 0 ? (
        <p className="text-xs text-gray-400">No reported earnings stored for this symbol yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] font-semibold text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
                <th className="px-2 py-1.5">Reported</th>
                <th className="px-2 py-1.5">Time</th>
                <th className="px-2 py-1.5">Period</th>
                <th className="px-2 py-1.5 text-right">EPS est</th>
                <th className="px-2 py-1.5 text-right">EPS actual</th>
                <th className="px-2 py-1.5 text-right">Surprise</th>
                <th className="px-2 py-1.5">EPS</th>
                <th className="px-2 py-1.5 text-right">Sales est</th>
                <th className="px-2 py-1.5 text-right">Sales actual</th>
                <th className="px-2 py-1.5">Sales</th>
              </tr>
            </thead>
            <tbody>
              {history.map(q => (
                <tr key={q.date} className="border-b border-gray-50">
                  <td className="px-2 py-1.5 font-medium text-gray-800 whitespace-nowrap">{fmtExpiry(q.date)}</td>
                  <td className="px-2 py-1.5 text-gray-500">{earningsTimeShort(q.time) || '—'}</td>
                  <td className="px-2 py-1.5 text-gray-500">
                    {q.period ?? (q.fiscalDateEnding ? `FQ end ${fmtShortDate(q.fiscalDateEnding)}` : '—')}
                    {q.epsAdjusted && <span className="ml-1 text-[10px] text-gray-400">adj.</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{fmtEps(q.epsEstimate)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-gray-800">{fmtEps(q.epsActual)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">
                    {q.epsSurprisePct == null ? '—' : `${q.epsSurprisePct > 0 ? '+' : ''}${q.epsSurprisePct.toFixed(1)}%`}
                  </td>
                  <td className="px-2 py-1.5"><OutcomeText outcome={q.epsOutcome} /></td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{fmtSales(q.salesEstimate)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-800">{fmtSales(q.salesActual)}</td>
                  <td className="px-2 py-1.5"><OutcomeText outcome={q.salesOutcome} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
