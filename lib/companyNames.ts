/**
 * Company / fund names for symbols, from our own tables (no vendor call): `nt_us_universe` first (the scanner universe,
 * ~1,900 names), then `public.securities`. A symbol in neither gets no entry, never an error. Server-only.
 */
import 'server-only';
import { sql } from '@/lib/db';

export async function companyNames(symbols: string[]): Promise<Map<string, string>> {
  const syms = [...new Set(symbols.map(s => String(s ?? '').trim().toUpperCase()).filter(s => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)))];
  const out = new Map<string, string>();
  if (!syms.length) return out;
  const read = async (query: string) => {
    try {
      for (const r of (await sql(query, [syms])) as Array<{ symbol: string; name: string | null }>) {
        const n = (r.name ?? '').trim();
        if (n && !out.has(r.symbol.toUpperCase())) out.set(r.symbol.toUpperCase(), n);
      }
    } catch (e) { console.warn('[ideas] company name lookup failed:', e instanceof Error ? e.message : e); }
  };
  await read(`SELECT symbol, name FROM public.nt_us_universe WHERE symbol = ANY($1::text[]) AND name IS NOT NULL`);
  if (out.size < syms.length) await read(`SELECT DISTINCT ON (symbol) symbol, name FROM public.securities WHERE symbol = ANY($1::text[]) AND name IS NOT NULL`);
  return out;
}

export async function companyName(symbol: string): Promise<string | null> {
  return (await companyNames([symbol])).get(String(symbol).trim().toUpperCase()) ?? null;
}
