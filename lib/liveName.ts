/**
 * Company name straight from the market-data search, for a symbol none of our tables names. Server-only.
 * One request per symbol per 24 h per server instance (a miss is remembered for 1 h), and a 1.5 s cap so a
 * slow lookup never delays the page. Pure lookup: it writes nothing.
 */
import 'server-only';
import { searchSymbols } from '@/lib/marketdata';

const HIT_MS = 24 * 3_600_000;
const MISS_MS = 3_600_000;
const TIMEOUT_MS = 1_500;
const cache = new Map<string, { name: string | null; until: number }>();

/** Exact-ticker match from a search result list; the vendor writes class shares as BRK/B. */
export function pickName(symbol: string, rows: Array<{ symbol?: string; description?: string }>): string | null {
  const want = symbol.toUpperCase().replace('/', '.');
  for (const r of rows) {
    if (String(r.symbol ?? '').toUpperCase().replace('/', '.') === want) {
      const d = String(r.description ?? '').trim();
      if (d) return d;
    }
  }
  return null;
}

export async function liveCompanyName(symbol: string): Promise<string | null> {
  const sym = String(symbol ?? '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) return null;
  const hit = cache.get(sym);
  if (hit && hit.until > Date.now()) return hit.name;
  const name = await Promise.race([
    searchSymbols(sym.replace('.', '/')).then(rows => pickName(sym, rows)).catch(() => null),
    new Promise<null>(res => setTimeout(() => res(null), TIMEOUT_MS)),
  ]);
  cache.set(sym, { name, until: Date.now() + (name ? HIT_MS : MISS_MS) });
  return name;
}
