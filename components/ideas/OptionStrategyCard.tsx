'use client';

import type { IdeaView } from '@/lib/ideas';
import type { OptionTrack } from '@/lib/ideaOptions';
import type { OptMarkView } from '@/lib/ideaOptionMath';
import { fmtDay, fmtPrice, fmtWhen, rTone, Pill } from '@/components/ideas/ideaUi';

const BASIS: Record<string, string> = {
  quote_mid: 'live bid/ask mid',
  quote_mid_late: 'bid/ask mid read later the same day',
  replay_last_trade: 'last trade (past day, can be stale)',
  last_trade: 'last trade (no usable bid/ask)',
  expiry_intrinsic: 'intrinsic value at expiry',
  mixed: 'mixed sources',
};
const basisText = (b: string) => BASIS[b] ?? b;

const fmtUsd = (n: number | null | undefined) => (n == null ? '—' : `${n < 0 ? '-' : n > 0 ? '+' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`);
const fmtCash = (n: number) => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-[10px] uppercase text-gray-400 font-semibold">{label}</div><div className="text-sm font-semibold text-gray-900">{children}</div></div>;
}

/** The published option legs, and (once the stock has entered) their estimated P&L. Separate from the idea's R. */
export default function OptionStrategyCard({ idea, track }: { idea: IdeaView; track: OptionTrack | null }) {
  const os = idea.optionStrategy;
  if (!os) return null;
  const s = track?.summary;
  const closed = s?.status === 'closed';
  const cur: OptMarkView | null = s?.current ?? null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h3 className="text-sm font-bold text-gray-900">Option strategy: {os.name}</h3>
        {s?.kind && <Pill meta={{ label: s.kind === 'credit' ? 'Net credit' : 'Net debit', tone: s.kind === 'credit' ? 'green' : 'blue' }} />}
        {s && (s.status === 'open' || s.status === 'closed') && <Pill meta={{ label: closed ? 'Closed' : 'Open', tone: closed ? 'gray' : 'violet' }} />}
      </div>
      {os.expiry && <p className="text-xs text-gray-600 mb-1">Expiry {fmtDay(os.expiry)}</p>}
      <ul className="text-sm text-gray-800 space-y-0.5">
        {os.legs.map((l, i) => <li key={i}><span className={l.side === 'buy' ? 'text-green-700 font-semibold' : 'text-red-700 font-semibold'}>{l.side === 'buy' ? 'Buy' : 'Sell'}</span> {l.qty} × {idea.symbol} {l.strike} {l.type}</li>)}
      </ul>
      {os.note && <p className="text-xs text-gray-600 mt-1.5">{os.note}</p>}

      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="text-xs font-bold text-gray-700 mb-1">Estimated option P&amp;L <span className="font-normal text-gray-400">(estimates, not fills; separate from the idea&apos;s R)</span></div>

        {!track || !track.trackable ? (
          <p className="text-xs text-gray-500">{track?.reason ?? 'Option prices are not being tracked for this idea yet.'}</p>
        ) : s!.status === 'pending' ? (
          <p className="text-xs text-gray-500">Not open yet. The option position opens at the moment the stock enters (a completed 15-minute candle closing inside the entry zone).</p>
        ) : s!.status === 'unpriced' || !s!.entry ? (
          <p className="text-xs text-gray-500">The stock has entered. The option prices for that moment have not been captured yet; this fills in within a few minutes.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <Stat label={s!.kind === 'credit' ? 'Credit at entry' : 'Debit at entry'}>{s!.v0 != null ? fmtCash(s!.v0) : '—'}</Stat>
              <Stat label={closed ? 'P&L at close' : 'P&L now'}><span className={rTone(cur?.pnl)}>{fmtUsd(cur?.pnl)}</span></Stat>
              <Stat label="Return on est. capital"><span className={rTone(cur?.returnPct)}>{cur?.returnPct == null ? '—' : `${cur.returnPct > 0 ? '+' : ''}${cur.returnPct.toFixed(1)}%`}</span></Stat>
              <Stat label="Est. capital">{s!.profile ? `${s!.profile.capital.floor ? '≥ ' : ''}${fmtCash(s!.profile.capital.value)}` : '—'}</Stat>
              <Stat label="Max profit / loss">{s!.profile ? `${s!.profile.unboundedProfit ? 'unlimited' : fmtCash(s!.profile.maxProfit)} / ${s!.profile.unboundedLoss ? 'unlimited' : fmtCash(s!.profile.maxLoss)}` : '—'}</Stat>
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              Entry {fmtWhen(s!.entry.at)} ({basisText(s!.entry.basis)}){cur && cur.key !== 'entry' ? `; ${closed ? 'closed' : 'latest'} ${fmtWhen(cur.at)} (${basisText(cur.basis)})` : ''}. Per spread; one contract is 100 shares.
            </p>

            {s!.targets.length > 0 && (
              <div className="mt-2">
                <div className="text-[11px] font-semibold text-gray-600">At each target (information only, not part of the result)</div>
                <ul className="text-xs text-gray-700 space-y-0.5 mt-0.5">
                  {s!.targets.map(t => (
                    <li key={t.key}>
                      {t.key.replace('target:', '')} · {fmtWhen(t.at)}: <span className={`font-semibold ${rTone(t.pnl)}`}>{fmtUsd(t.pnl)}</span>
                      {t.returnPct != null && <span className="text-gray-400"> ({t.returnPct > 0 ? '+' : ''}{t.returnPct.toFixed(1)}%)</span>}
                      <span className="text-gray-400"> · {basisText(t.basis)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <details className="mt-2">
              <summary className="text-[11px] text-indigo-600 cursor-pointer">Leg prices used (per share)</summary>
              <table className="text-xs mt-1 w-full max-w-md">
                <thead><tr className="text-gray-400 text-left"><th className="font-semibold pr-3">Leg</th><th className="font-semibold pr-3">Entry</th><th className="font-semibold">{closed ? 'Close' : 'Now'}</th></tr></thead>
                <tbody>
                  {os.legs.map((l, i) => (
                    <tr key={i} className="text-gray-700">
                      <td className="pr-3">{l.side === 'buy' ? 'Buy' : 'Sell'} {l.strike} {l.type}</td>
                      <td className="pr-3">{fmtPrice(s!.entry!.prices[i])}</td>
                      <td>{cur && cur.key !== 'entry' ? fmtPrice(cur.prices[i]) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
        {track && <ul className="mt-2 text-[11px] text-gray-400 list-disc pl-4 space-y-0.5">{track.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      </div>
    </div>
  );
}
