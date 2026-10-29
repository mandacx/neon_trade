// Live option volume per contract from the option-chain snapshots: shared by the OI
// tracker's stock modal (/api/oi-tracker/stock/[symbol]) and the stock page's
// Open Interest tab (/api/oi-tracker/live/[symbol]). Server-only (market data types).
import type { OptionSnapshot } from '@/lib/marketdata';
import { etDateOf } from '@/lib/marketSession';

export interface LiveOption {
  contract: string;
  /** Volume of the snapshot's daily bar and the ET date of that bar. */
  vol: number | null;
  barDate: string | null;
  prevVol: number | null;
  last: number | null;
  bid: number | null;
  ask: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
}

export function toLive(contract: string, s: OptionSnapshot): LiveOption {
  return {
    contract,
    vol: s.dailyBar?.v ?? null,
    barDate: s.dailyBar?.t ? etDateOf(Date.parse(s.dailyBar.t) + 6 * 3_600_000) : null,
    prevVol: s.prevDailyBar?.v ?? null,
    last: s.latestTrade?.p ?? s.dailyBar?.c ?? null,
    bid: s.latestQuote?.bp ?? null,
    ask: s.latestQuote?.ap ?? null,
    iv: s.impliedVolatility ?? null,
    delta: s.greeks?.delta ?? null,
    gamma: s.greeks?.gamma ?? null,
    theta: s.greeks?.theta ?? null,
  };
}


/**
 * Contracts ranked by volume in the latest session only. A snapshot's daily bar is the contract's
 * last *traded* session, so a quiet contract still carries an old bar (seen 2026-10-28: an AAPL
 * put whose 10-23 volume of 18,505 ranked among 10-28's). The latest session is the newest bar
 * date among contracts with volume; older bars are left out of the ranking.
 */
export function topBySessionVolume(all: LiveOption[], n: number): { top: LiveOption[]; session: string | null; stale: number } {
  const traded = all.filter(o => (o.vol ?? 0) > 0 && o.barDate);
  const session = traded.reduce<string | null>((m, o) => (m === null || o.barDate! > m ? o.barDate! : m), null);
  const inSession = traded.filter(o => o.barDate === session);
  return {
    top: inSession.sort((a, b) => (b.vol ?? 0) - (a.vol ?? 0)).slice(0, n),
    session,
    stale: traded.length - inSession.length,
  };
}
