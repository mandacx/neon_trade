import { sql } from '@/lib/db';

export async function safeQuery<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try { return await fn(); } catch { return []; }
}

// fixed-threshold tiers in one ordered list (thresholds/order live in one place).
const CAP_TIER_ORDER = ['Mega', 'Large', 'Mid', 'Small', 'Micro', 'Nano'];
export function orderCapTiers(tiers: string[]): string[] {
  return [...tiers].sort((a, b) => {
    const ia = CAP_TIER_ORDER.findIndex(t => a.toLowerCase().startsWith(t.toLowerCase()));
    const ib = CAP_TIER_ORDER.findIndex(t => b.toLowerCase().startsWith(t.toLowerCase()));
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
}

// Derive filter options ONLY from items actually present, so we never offer an empty bucket.
export function deriveFilterOptions(secMeta: Record<string, any>) {
  const sectors = new Set<string>();
  const industries = new Set<string>();
  const tiers = new Set<string>();
  const indices = new Map<string, string>(); // code -> name
  Object.values(secMeta).forEach((m: any) => {
    if (m?.sector) sectors.add(m.sector);
    if (m?.industry) industries.add(m.industry);
    if (m?.market_cap_tier) tiers.add(m.market_cap_tier);
    if (m?.indices) {
      try {
        const arr = typeof m.indices === 'string' ? JSON.parse(m.indices) : m.indices;
        if (Array.isArray(arr)) arr.forEach((i: any) => { if (i?.code) indices.set(i.code, i.name ?? i.code); });
      } catch { /* ignore */ }
    }
  });
  return {
    sectors: [...sectors].sort(),
    industries: [...industries].sort(),
    marketCapTiers: orderCapTiers([...tiers]),
    indices: [...indices.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function getSecuritiesFilterOptions() {
  const [sectors, industries, marketCapTiers, indices] = await Promise.all([
    safeQuery(() => sql`SELECT DISTINCT sector FROM public.securities WHERE sector IS NOT NULL ORDER BY sector`),
    safeQuery(() => sql`SELECT DISTINCT industry FROM public.securities WHERE industry IS NOT NULL ORDER BY industry`),
    safeQuery(() => sql`SELECT DISTINCT market_cap_tier FROM public.securities WHERE market_cap_tier IS NOT NULL ORDER BY market_cap_tier`),
    safeQuery(() => sql`
      SELECT DISTINCT elem->>'code' as code, elem->>'name' as name
      FROM public.securities,
           jsonb_array_elements(
             CASE WHEN indices IS NOT NULL AND indices::text NOT IN ('null', '[]', '')
             THEN indices::jsonb ELSE '[]'::jsonb END
           ) as elem
      WHERE elem->>'code' IS NOT NULL
      ORDER BY elem->>'name'
    `),
  ]);

  return {
    sectors: sectors.map((r: any) => r.sector as string),
    industries: industries.map((r: any) => r.industry as string),
    marketCapTiers: orderCapTiers(marketCapTiers.map((r: any) => r.market_cap_tier as string)),
    indices: indices.map((r: any) => ({ code: r.code as string, name: r.name as string })),
  };
}

export async function getSecuritiesMeta(symbols: string[]) {
  if (symbols.length === 0) return {};
  try {
    // The name falls back, in one statement (no extra request), from public.securities (a separate app's
    // table that lacks some symbols, e.g. PNR) to the scanner universe, then the level symbols list. Every
    // other field still comes from securities only.
    const rows = await sql`
      SELECT q.symbol,
        COALESCE(NULLIF(btrim(s.name), ''),
          NULLIF(btrim((SELECT u.name FROM public.nt_us_universe u WHERE u.symbol = q.symbol)), ''),
          NULLIF(btrim((SELECT y.company_name FROM public.us_symbols y WHERE y.symbol = q.symbol LIMIT 1)), '')) AS name,
        s.sector, s.industry, s.market_cap_tier, s.market_cap, s.exchange, s.indices
      FROM unnest(${symbols}::text[]) AS q(symbol)
      LEFT JOIN LATERAL (
        SELECT * FROM public.securities WHERE symbol = q.symbol ORDER BY last_refreshed DESC LIMIT 1
      ) s ON true
    `;
    const map: Record<string, any> = {};
    rows.forEach((r: any) => {
      // A symbol found in none of the tables stays absent, as before.
      if (r.name != null || r.sector != null || r.industry != null || r.market_cap != null || r.exchange != null) map[r.symbol] = r;
    });
    return map;
  } catch {
    return {};
  }
}

export interface SecuritiesFilters {
  sector?: string | null;
  industry?: string | null;
  marketCapTier?: string | null;
  indexCode?: string | null;
}

// Apply sector/industry/marketCapTier/index filters against a list of items that expose `.symbol`.
export function applySecuritiesFilters<T extends { symbol: string }>(
  items: T[],
  secMeta: Record<string, any>,
  filters: SecuritiesFilters,
): T[] {
  let result = items;
  if (filters.sector) {
    result = result.filter(s => secMeta[s.symbol]?.sector === filters.sector);
  }
  if (filters.industry) {
    result = result.filter(s => secMeta[s.symbol]?.industry === filters.industry);
  }
  if (filters.marketCapTier) {
    result = result.filter(s => secMeta[s.symbol]?.market_cap_tier === filters.marketCapTier);
  }
  if (filters.indexCode) {
    result = result.filter(s => {
      const meta = secMeta[s.symbol];
      if (!meta?.indices) return false;
      try {
        const arr: { code: string }[] = typeof meta.indices === 'string' ? JSON.parse(meta.indices) : meta.indices;
        return Array.isArray(arr) && arr.some(i => i.code === filters.indexCode);
      } catch { return false; }
    });
  }
  return result;
}

// Attach name/sector/industry/marketCapTier/marketCap/exchange/indices from securities metadata onto an item.
export function attachSecuritiesMeta<T extends { symbol: string }>(item: T, secMeta: Record<string, any>) {
  const m = secMeta[item.symbol];
  let indicesList: string[] = [];
  if (m?.indices) {
    try {
      const arr: { code: string; name: string }[] = typeof m.indices === 'string' ? JSON.parse(m.indices) : m.indices;
      indicesList = Array.isArray(arr) ? arr.map(i => i.name) : [];
    } catch { /* ignore */ }
  }
  return {
    ...item,
    name: m?.name ?? null,
    sector: m?.sector ?? null,
    industry: m?.industry ?? null,
    marketCapTier: m?.market_cap_tier ?? null,
    marketCap: m?.market_cap ? Number(m.market_cap) : null,
    exchange: m?.exchange ?? null,
    indices: indicesList,
  };
}
