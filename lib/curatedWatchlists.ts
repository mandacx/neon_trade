import { sql } from '@/lib/db';
import { getSecuritiesFilterOptions } from '@/lib/securitiesFilters';

// Curated/system watchlists, as a live overlay over public.securities'
// sector/indices columns — NOT backed by any DB row (unlike custom
// watchlists in lib/watchlists.ts). Mirrors the neon_nifty pattern of a
// synthetic `sys:<...>` id scheme, but sourced from this app's own real
// sector/index-membership data instead of a static NSE-index JSON seed
// (sectors and index codes here are small catalogs — 11 sectors, a
// handful of index codes as of writing — so every catalog entry is shown,
// no curation-subset needed).

export type CuratedListKind = 'sector' | 'index';

export interface CuratedListDef {
  id: string;
  name: string;
  kind: CuratedListKind;
}

const SECTOR_PREFIX = 'sys:sector:';
const INDEX_PREFIX = 'sys:idx:';

export function isCuratedListId(id: string): boolean {
  return id.startsWith(SECTOR_PREFIX) || id.startsWith(INDEX_PREFIX);
}

export async function curatedListCatalog(): Promise<CuratedListDef[]> {
  const { sectors, indices } = await getSecuritiesFilterOptions();
  return [
    ...sectors.map(sector => ({ id: `${SECTOR_PREFIX}${encodeURIComponent(sector)}`, name: sector, kind: 'sector' as const })),
    ...indices.map(idx => ({ id: `${INDEX_PREFIX}${idx.code}`, name: idx.name, kind: 'index' as const })),
  ];
}

export async function curatedListDef(id: string): Promise<CuratedListDef | null> {
  if (id.startsWith(SECTOR_PREFIX)) {
    const sector = decodeURIComponent(id.slice(SECTOR_PREFIX.length));
    return { id, name: sector, kind: 'sector' };
  }
  if (id.startsWith(INDEX_PREFIX)) {
    const code = id.slice(INDEX_PREFIX.length);
    const { indices } = await getSecuritiesFilterOptions();
    const match = indices.find(i => i.code === code);
    return match ? { id, name: match.name, kind: 'index' } : { id, name: code, kind: 'index' };
  }
  return null;
}

export async function symbolsOfCuratedList(id: string): Promise<string[]> {
  if (id.startsWith(SECTOR_PREFIX)) {
    const sector = decodeURIComponent(id.slice(SECTOR_PREFIX.length));
    try {
      const rows = await sql`SELECT symbol FROM public.securities WHERE sector = ${sector} ORDER BY symbol`;
      return (rows as any[]).map(r => r.symbol);
    } catch {
      return [];
    }
  }
  if (id.startsWith(INDEX_PREFIX)) {
    const code = id.slice(INDEX_PREFIX.length);
    try {
      const rows = await sql`
        SELECT symbol FROM public.securities s
        WHERE EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN s.indices IS NOT NULL AND s.indices::text NOT IN ('null', '[]', '')
            THEN s.indices::jsonb ELSE '[]'::jsonb END
          ) elem
          WHERE elem->>'code' = ${code}
        )
        ORDER BY symbol
      `;
      return (rows as any[]).map(r => r.symbol);
    } catch {
      return [];
    }
  }
  return [];
}
