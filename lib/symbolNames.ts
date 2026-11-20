/**
 * Keeps a company name on every level symbol (`public.us_symbols.company_name`), so pages show names
 * without a request-time lookup. Server-only; runs inside /api/cron/market-catalog.
 *
 *  1. Blank names are copied from the scanner universe (`nt_us_universe`, refreshed weekly): SQL only.
 *  2. Symbols still unnamed everywhere (also not in `public.securities`) get one market-data search each,
 *     at most MAX_LOOKUPS per run, exact ticker match only. A symbol the search can't name stays blank
 *     and is retried on the next run.
 * Existing names are never overwritten, and `updated_at` is left alone (the loader reads that table).
 */
import 'server-only';
import { sql } from '@/lib/db';
import { searchSymbols } from '@/lib/marketdata';
import { pickName } from '@/lib/liveName';

const MAX_LOOKUPS = 10;

export async function syncSymbolNames(opts: { deadline: number }) {
  const copied = (await sql`
    UPDATE public.us_symbols y SET company_name = btrim(u.name)
    FROM public.nt_us_universe u
    WHERE u.symbol = y.symbol AND y.active = true AND y.deleted_at IS NULL
      AND COALESCE(btrim(y.company_name), '') = '' AND COALESCE(btrim(u.name), '') <> ''
    RETURNING y.symbol
  `) as Array<{ symbol: string }>;

  const missing = (await sql`
    SELECT y.symbol FROM public.us_symbols y
    WHERE y.active = true AND y.deleted_at IS NULL AND COALESCE(btrim(y.company_name), '') = ''
      AND NOT EXISTS (SELECT 1 FROM public.securities s WHERE s.symbol = y.symbol AND COALESCE(btrim(s.name), '') <> '')
    ORDER BY y.symbol LIMIT ${MAX_LOOKUPS}
  `) as Array<{ symbol: string }>;

  let looked = 0;
  let named = 0;
  for (const { symbol } of missing) {
    if (Date.now() > opts.deadline) break;
    looked++;
    const name = pickName(symbol, await searchSymbols(symbol.replace('.', '/')));
    if (!name) continue;
    await sql`
      UPDATE public.us_symbols SET company_name = ${name}
      WHERE symbol = ${symbol} AND COALESCE(btrim(company_name), '') = ''
    `;
    named++;
  }
  return { copiedFromUniverse: copied.length, stillMissing: missing.length, looked, named };
}
