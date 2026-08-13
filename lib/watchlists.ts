import { sql, symbolExists } from '@/lib/db';
import { isCuratedListId, curatedListDef, symbolsOfCuratedList, curatedListCatalog } from '@/lib/curatedWatchlists';

export interface WatchlistSummary {
  id: string; // 'sys:sector:<...>' | 'sys:idx:<code>' for curated lists, numeric string for custom
  name: string;
  isSystem: boolean;
  symbolCount: number;
}

/** The user's own lists first (most relevant), then the curated sector/index lists. */
export async function getWatchlistsForUser(userId: string | null): Promise<WatchlistSummary[]> {
  const catalog = await curatedListCatalog();
  const system: WatchlistSummary[] = await Promise.all(
    catalog.map(async c => ({ id: c.id, name: c.name, isSystem: true, symbolCount: (await symbolsOfCuratedList(c.id)).length }))
  );
  if (!userId) return system;

  const rows = await sql`
    SELECT w.id, w.name, count(wi.symbol) AS symbol_count
    FROM public.watchlists w
    LEFT JOIN public.watchlist_items wi ON wi.watchlist_id = w.id
    WHERE w.user_id = ${userId}
    GROUP BY w.id, w.name, w.created_at
    ORDER BY w.created_at DESC
  `;
  const custom: WatchlistSummary[] = (rows as unknown as Array<{ id: number; name: string; symbol_count: string }>)
    .map(r => ({ id: String(r.id), name: r.name, isSystem: false, symbolCount: Number(r.symbol_count) }));

  return [...custom, ...system];
}

/**
 * Resolves a watchlist id (curated or custom) to its symbol list. Custom
 * lookups check ownership inline in the WHERE clause (not fetch-then-check)
 * — a watchlist id that doesn't belong to `userId` simply resolves empty.
 */
export async function getWatchlistSymbols(watchlistId: string, userId: string | null): Promise<string[]> {
  if (isCuratedListId(watchlistId)) {
    return symbolsOfCuratedList(watchlistId);
  }
  const id = Number(watchlistId);
  if (!userId || !Number.isFinite(id)) return [];

  const rows = await sql`
    SELECT wi.symbol
    FROM public.watchlist_items wi
    JOIN public.watchlists w ON w.id = wi.watchlist_id
    WHERE wi.watchlist_id = ${id} AND w.user_id = ${userId}
    ORDER BY wi.symbol
  `;
  return (rows as unknown as Array<{ symbol: string }>).map(r => r.symbol);
}

export interface WatchlistDetail extends WatchlistSummary {
  symbols: string[];
}

/** Single-watchlist detail (for the management page and the /api/watchlists/[id] route). */
export async function getWatchlistDetail(watchlistId: string, userId: string | null): Promise<WatchlistDetail | null> {
  if (isCuratedListId(watchlistId)) {
    const def = await curatedListDef(watchlistId);
    if (!def) return null;
    const symbols = await symbolsOfCuratedList(watchlistId);
    return { id: watchlistId, name: def.name, isSystem: true, symbolCount: symbols.length, symbols };
  }
  const id = Number(watchlistId);
  if (!userId || !Number.isFinite(id)) return null;

  const rows = await sql`SELECT id, name FROM public.watchlists WHERE id = ${id} AND user_id = ${userId}`;
  const row = rows[0] as { id: number; name: string } | undefined;
  if (!row) return null;

  const symbols = await getWatchlistSymbols(watchlistId, userId);
  return { id: String(row.id), name: row.name, isSystem: false, symbolCount: symbols.length, symbols };
}

export async function createWatchlist(userId: string, name: string): Promise<{ id: string; name: string }> {
  const rows = await sql`INSERT INTO public.watchlists (user_id, name) VALUES (${userId}, ${name}) RETURNING id, name`;
  const row = rows[0] as { id: number; name: string };
  return { id: String(row.id), name: row.name };
}

export async function renameWatchlist(userId: string, watchlistId: number, name: string): Promise<void> {
  await sql`UPDATE public.watchlists SET name = ${name} WHERE id = ${watchlistId} AND user_id = ${userId}`;
}

export async function deleteWatchlist(userId: string, watchlistId: number): Promise<void> {
  await sql`DELETE FROM public.watchlists WHERE id = ${watchlistId} AND user_id = ${userId}`;
}

/** Returns false (and adds nothing) if `symbol` isn't in this app's own options-levels data. */
export async function addSymbolToWatchlist(userId: string, watchlistId: number, symbol: string): Promise<boolean> {
  const upper = symbol.toUpperCase();
  if (!(await symbolExists(upper))) return false;

  await sql`
    INSERT INTO public.watchlist_items (watchlist_id, symbol)
    SELECT ${watchlistId}, ${upper}
    WHERE EXISTS (SELECT 1 FROM public.watchlists WHERE id = ${watchlistId} AND user_id = ${userId})
    ON CONFLICT (watchlist_id, symbol) DO NOTHING
  `;
  return true;
}

export async function removeSymbolFromWatchlist(userId: string, watchlistId: number, symbol: string): Promise<void> {
  await sql`
    DELETE FROM public.watchlist_items
    WHERE watchlist_id = ${watchlistId} AND symbol = ${symbol.toUpperCase()}
      AND EXISTS (SELECT 1 FROM public.watchlists WHERE id = ${watchlistId} AND user_id = ${userId})
  `;
}
