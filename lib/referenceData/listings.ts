/**
 * US exchange listings from the Nasdaq Trader symbol directory (public, no key, refreshed every
 * business day): nasdaqlisted.txt (Nasdaq) + otherlisted.txt (NYSE, NYSE American, NYSE Arca, Cboe
 * BZX). Each row carries an ETF Y/N flag and a test-issue flag, which the market-data feed's asset
 * list does not. Server-only; the parsing is pure so scripts/test-us-universe.mjs can check it.
 *
 * Kept: common stocks (incl. ADRs and share classes such as BRK.B) and ETFs/ETNs.
 * Always dropped: test issues, warrants, units, rights, preferreds, notes/debentures, and exchanges
 * outside the five above.
 */

export type ListingExchange = 'NYSE' | 'NASDAQ' | 'NYSE American' | 'NYSE Arca' | 'Cboe BZX';

export interface Listing {
  symbol: string;
  name: string;
  exchange: ListingExchange;
  kind: 'stock' | 'etf';
  isAdr: boolean;
}

const NASDAQ_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
const OTHER_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';

const OTHER_EXCHANGES: Record<string, ListingExchange> = { N: 'NYSE', A: 'NYSE American', P: 'NYSE Arca', Z: 'Cboe BZX' };

/** Words in a stock's security name that mark a non-common instrument. */
const NON_COMMON = /\b(warrants?|units?|rights?|preferred|preference|notes?|debentures?|subordinated|trust preferred)\b|\d%|%\s/i;

function table(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter(l => l && !l.startsWith('File Creation Time'));
  const header = (lines.shift() ?? '').split('|');
  return lines.map(l => {
    const cells = l.split('|');
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
}

/** Symbol shapes the stock page accepts: letters, optionally one class suffix (BRK.B). */
const SYMBOL_OK = /^[A-Z]{1,6}(\.[A-Z])?$/;

export function classify(symbolIn: string, name: string, etf: boolean): { keep: boolean; isAdr: boolean } {
  const symbol = symbolIn.toUpperCase();
  if (!SYMBOL_OK.test(symbol)) return { keep: false, isAdr: false }; // $ preferreds, .W/.U/.R/.WS suffixes, odd tickers
  if (etf) return { keep: true, isAdr: false };
  if (NON_COMMON.test(name)) return { keep: false, isAdr: false };
  const isAdr = /american depositary|\bADS\b|\bADR\b/i.test(name);
  return { keep: true, isAdr };
}

export function parseNasdaqListed(text: string): Listing[] {
  const out: Listing[] = [];
  for (const r of table(text)) {
    if (r['Test Issue'] !== 'N') continue;
    const etf = r['ETF'] === 'Y';
    const { keep, isAdr } = classify(r['Symbol'], r['Security Name'], etf);
    if (!keep) continue;
    out.push({ symbol: r['Symbol'].toUpperCase(), name: r['Security Name'], exchange: 'NASDAQ', kind: etf ? 'etf' : 'stock', isAdr });
  }
  return out;
}

export function parseOtherListed(text: string): Listing[] {
  const out: Listing[] = [];
  for (const r of table(text)) {
    if (r['Test Issue'] !== 'N') continue;
    const exchange = OTHER_EXCHANGES[r['Exchange']];
    if (!exchange) continue;
    const etf = r['ETF'] === 'Y';
    // ACT symbols use '.' for classes (BRK.B) and '$' for preferreds (dropped by classify).
    const { keep, isAdr } = classify(r['ACT Symbol'], r['Security Name'], etf);
    if (!keep) continue;
    out.push({ symbol: r['ACT Symbol'].toUpperCase(), name: r['Security Name'], exchange, kind: etf ? 'etf' : 'stock', isAdr });
  }
  return out;
}

/** Both files must look complete; a short or malformed file throws (the caller keeps what it has). */
export async function fetchListings(): Promise<Listing[]> {
  const get = async (url: string) => {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`listings HTTP ${res.status}`);
    return res.text();
  };
  const [nasdaq, other] = await Promise.all([get(NASDAQ_URL), get(OTHER_URL)]);
  const a = parseNasdaqListed(nasdaq);
  const b = parseOtherListed(other);
  if (a.length < 2000 || b.length < 2000) throw new Error(`listings look incomplete (${a.length} Nasdaq, ${b.length} other)`);
  const bySymbol = new Map<string, Listing>();
  for (const l of [...a, ...b]) if (!bySymbol.has(l.symbol)) bySymbol.set(l.symbol, l);
  return [...bySymbol.values()];
}
