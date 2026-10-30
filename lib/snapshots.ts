/**
 * Snapshots for a mixed symbol list: stocks and ETFs come from the primary feed, SPX / NDX (which it has
 * no snapshot for) from the index quote. Every caller that turns snapshots into a quote (lib/quote.ts)
 * and may be handed an index uses this instead of getSnapshotsMulti. Server-only.
 */
import { getSnapshotsMulti, getIndexSnapshots, INDEX_QUOTE_SYMBOLS, type Snapshot } from '@/lib/marketdata';
import { getMarketState } from '@/lib/marketSession';

/** `fetchStocks` lets a bulk caller keep its chunked reader (getSnapshotsChunked). */
export async function getSnapshotsWithIndices(
  symbols: string[],
  fetchStocks: (symbols: string[]) => Promise<Record<string, Snapshot>> = getSnapshotsMulti,
): Promise<Record<string, Snapshot>> {
  const indices = symbols.filter(s => INDEX_QUOTE_SYMBOLS.has(s.toUpperCase()));
  if (indices.length === 0) return fetchStocks(symbols);
  const stocks = symbols.filter(s => !INDEX_QUOTE_SYMBOLS.has(s.toUpperCase()));
  const [stockSnaps, indexSnaps] = await Promise.all([
    stocks.length ? fetchStocks(stocks) : Promise.resolve({} as Record<string, Snapshot>),
    getMarketState().then(m => getIndexSnapshots(indices, m.lastSessionDate)),
  ]);
  return { ...stockSnaps, ...indexSnaps };
}
