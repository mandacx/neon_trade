/**
 * Stock search by ticker OR company name.
 *
 * Local first: an in-memory index of every symbol we have option levels for
 * (nt_market_expiries, traded in the last 30 days) plus every named
 * security in public.securities — ~750 entries, built from two small tables
 * on the first search per server instance and refreshed hourly. Matching it
 * is sub-millisecond, so the dropdown never waits on the database.
 *
 * Remote supplement (searchRemote): Tradier — /markets/search for company
 * names, /markets/lookup for tickers — for symbols we don't track. The client
 * requests it separately and appends it, so a slow Tradier call (it often
 * runs into its 2s timeout) never holds up the local results.
 */
import { sql } from '@/lib/db';
import { searchSymbols, searchCompanies } from '@/lib/tradier';

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  /** We have option levels for it (it's in our data, not just a Tradier hit). */
  hasLevels: boolean;
}

interface IndexEntry {
  symbol: string;
  name: string | null;
  nameLower: string;
  /** Lower-cased words of the name, for word-prefix matches ("int" → "Intel", "International"). */
  words: string[];
  /** Name with spaces/punctuation removed, so "jp morgan" finds "JPMorgan", "coca cola" finds "Coca-Cola". */
  compact: string;
  hasLevels: boolean;
}

const INDEX_TTL_MS = 60 * 60 * 1000;
let index: { builtAt: number; entries: IndexEntry[] } | null = null;
let building: Promise<IndexEntry[]> | null = null;

async function buildIndex(): Promise<IndexEntry[]> {
  const rows = (await sql`
    WITH tracked AS (
      SELECT DISTINCT symbol FROM public.nt_market_expiries
      WHERE source = 'eod' AND last_trade_date >= CURRENT_DATE - 30
    )
    SELECT COALESCE(t.symbol, s.symbol) AS symbol, s.name, (t.symbol IS NOT NULL) AS has_levels
    FROM tracked t
    FULL OUTER JOIN (SELECT DISTINCT ON (symbol) symbol, name FROM public.securities WHERE symbol IS NOT NULL) s
      ON s.symbol = t.symbol
  `) as Array<{ symbol: string; name: string | null; has_levels: boolean }>;
  return rows.map(r => {
    const nameLower = (r.name ?? '').toLowerCase();
    return {
      symbol: r.symbol.toUpperCase(),
      name: r.name,
      nameLower,
      words: nameLower.split(/[^a-z0-9&]+/).filter(Boolean),
      compact: nameLower.replace(/[^a-z0-9]+/g, ''),
      hasLevels: r.has_levels,
    };
  });
}

async function getIndex(): Promise<IndexEntry[]> {
  if (index && Date.now() - index.builtAt < INDEX_TTL_MS) return index.entries;
  if (!building) {
    building = buildIndex()
      .then(entries => { index = { builtAt: Date.now(), entries }; return entries; })
      .finally(() => { building = null; });
  }
  // Serve a stale index while a refresh is in flight rather than blocking.
  if (index) return index.entries;
  return building;
}

function score(e: IndexEntry, upper: string, lower: string, compact: string): number {
  if (e.symbol === upper) return 100;
  if (e.symbol.startsWith(upper)) return 80 - Math.min(e.symbol.length - upper.length, 10);
  if (lower.length >= 2) {
    if (e.nameLower.startsWith(lower)) return 70;
    if (e.words.some(w => w.startsWith(lower))) return 60;
    if (compact.length >= 3 && e.compact.startsWith(compact)) return 55;
    if (lower.length >= 3 && e.nameLower.includes(lower)) return 40;
    if (compact.length >= 4 && e.compact.includes(compact)) return 35;
  }
  return 0;
}

export async function searchLocal(query: string, limit = 12): Promise<SymbolSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const upper = q.toUpperCase();
  const lower = q.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]+/g, '');
  const entries = await getIndex();
  return entries
    .map(e => ({ e, s: score(e, upper, lower, compact) }))
    .filter(x => x.s > 0)
    .sort((a, b) =>
      b.s - a.s
      || Number(b.e.hasLevels) - Number(a.e.hasLevels)
      || a.e.symbol.length - b.e.symbol.length
      || a.e.symbol.localeCompare(b.e.symbol))
    .slice(0, limit)
    .map(({ e }) => ({ symbol: e.symbol, name: e.name ?? e.symbol, exchange: 'US', hasLevels: e.hasLevels }));
}

/** Tradier: company-name search, plus ticker lookup when the query could be a ticker. */
export async function searchRemote(query: string, limit = 12): Promise<SymbolSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const tickerLike = /^[A-Za-z.\-]{1,6}$/.test(q);
  const [byName, byTicker] = await Promise.all([
    q.length >= 2 ? searchCompanies(q) : Promise.resolve([]),
    tickerLike ? searchSymbols(q) : Promise.resolve([]),
  ]);
  const seen = new Set<string>();
  const out: SymbolSearchResult[] = [];
  // Ticker matches first when the query looks like one, names otherwise.
  for (const r of tickerLike ? [...byTicker, ...byName] : [...byName, ...byTicker]) {
    // Tradier writes class shares as BRK/B; the stock route and Alpaca use BRK.B.
    const symbol = r.symbol?.toUpperCase().replace(/\//g, '.');
    // Same shape the stock page accepts (app/stock/[symbol]/page.tsx); Tradier
    // also returns oddities like "JPM'C" that would open an "Invalid symbol" page.
    if (!symbol || !/^[A-Z0-9.\-]{1,10}$/.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({ symbol, name: r.description || symbol, exchange: 'US', hasLevels: false });
    if (out.length >= limit) break;
  }
  return out;
}
