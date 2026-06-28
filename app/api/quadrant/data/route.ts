import { NextRequest, NextResponse } from 'next/server';
import { getAllStocksLatest, getAllStocksByDate, getAllStocksByDateAndExpiry, getAvailableDates, getAvailableExpiryDates, sql } from '@/lib/db';
import { calculateLevels, findClosestLevel } from '@/lib/calculations';
import { format } from 'date-fns';

async function safeQuery<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try { return await fn(); } catch { return []; }
}

// §4 — fixed-threshold tiers in one ordered list (thresholds/order live in one place).
const CAP_TIER_ORDER = ['Mega', 'Large', 'Mid', 'Small', 'Micro', 'Nano'];
function orderCapTiers(tiers: string[]): string[] {
  return [...tiers].sort((a, b) => {
    const ia = CAP_TIER_ORDER.findIndex(t => a.toLowerCase().startsWith(t.toLowerCase()));
    const ib = CAP_TIER_ORDER.findIndex(t => b.toLowerCase().startsWith(t.toLowerCase()));
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
}

// §4 — derive filter options ONLY from items actually present, so we never offer
// an empty bucket. Options are computed before sector/industry filters are applied
// (i.e. from the full universe for the selected date) so dropdowns don't collapse mid-filter.
function deriveFilterOptions(secMeta: Record<string, any>) {
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

async function getSecuritiesFilterOptions() {
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

async function getSecuritiesMeta(symbols: string[]) {
  if (symbols.length === 0) return {};
  try {
    const rows = await sql`
      SELECT symbol, name, sector, industry, market_cap_tier, market_cap, exchange, indices
      FROM public.securities
      WHERE symbol = ANY(${symbols})
    `;
    const map: Record<string, any> = {};
    rows.forEach((r: any) => { map[r.symbol] = r; });
    return map;
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date');
    const expiryDate = searchParams.get('expiry');
    const threshold = searchParams.get('threshold') ? parseFloat(searchParams.get('threshold')!) : undefined;
    const search = searchParams.get('search');
    const metadataOnly = searchParams.get('metadata') === 'true';
    const sector = searchParams.get('sector');
    const industry = searchParams.get('industry');
    const marketCapTier = searchParams.get('marketCapTier');
    const indexCode = searchParams.get('index');

    // If requesting metadata only (dates + filter options)
    if (metadataOnly) {
      const [tradeDates, expiryDates, filterOptions] = await Promise.all([
        getAvailableDates(30),
        getAvailableExpiryDates(),
        getSecuritiesFilterOptions(),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          tradeDates,
          expiryDates,
          filterOptions,
        },
      });
    }

    // Get all stocks for the specified filters
    let stocksData;

    if (date && expiryDate) {
      stocksData = await getAllStocksByDateAndExpiry(date, expiryDate);
    } else if (date) {
      stocksData = await getAllStocksByDate(date);
    } else {
      stocksData = await getAllStocksLatest();
    }

    // Process each stock to calculate levels
    const processedStocks = stocksData.map(data => {
      const levels = calculateLevels(data);
      const closest = findClosestLevel(levels);

      return {
        symbol: data.SYMBOL,
        close: data.CLOSE,
        tradeDate: data.TRADE_DATE,
        expiryDate: data.EXPIRY_DT,
        levels: levels.map(l => ({
          name: l.name,
          value: l.value,
          price: l.price,
        })),
        closestLevel: closest.name,
        closestValue: closest.value,
      };
    });

    // Filter out stocks where all levels are 100%
    let filteredStocks = processedStocks.filter(stock =>
      !stock.levels.every(level => level.value === 1)
    );

    // Enrich with securities metadata
    const symbols = filteredStocks.map(s => s.symbol);
    const secMeta = await getSecuritiesMeta(symbols);

    // §4 — derive filter options from the present universe (pre sector/industry filtering).
    const derivedFilterOptions = deriveFilterOptions(secMeta);

    // Apply securities-based filters
    if (sector) {
      filteredStocks = filteredStocks.filter(s => secMeta[s.symbol]?.sector === sector);
    }
    if (industry) {
      filteredStocks = filteredStocks.filter(s => secMeta[s.symbol]?.industry === industry);
    }
    if (marketCapTier) {
      filteredStocks = filteredStocks.filter(s => secMeta[s.symbol]?.market_cap_tier === marketCapTier);
    }
    if (indexCode) {
      filteredStocks = filteredStocks.filter(s => {
        const meta = secMeta[s.symbol];
        if (!meta?.indices) return false;
        try {
          const arr: { code: string }[] = typeof meta.indices === 'string'
            ? JSON.parse(meta.indices)
            : meta.indices;
          return Array.isArray(arr) && arr.some(i => i.code === indexCode);
        } catch { return false; }
      });
    }

    // Filter by threshold
    if (threshold !== undefined) {
      filteredStocks = filteredStocks.filter(stock =>
        Math.abs(stock.closestValue) <= threshold
      );
    }

    // Filter by search
    if (search) {
      const searchUpper = search.toUpperCase();
      filteredStocks = filteredStocks.filter(stock =>
        stock.symbol.includes(searchUpper)
      );
    }

    // Attach securities metadata to output
    const enriched = filteredStocks.map(s => {
      const m = secMeta[s.symbol];
      let indicesList: string[] = [];
      if (m?.indices) {
        try {
          const arr: { code: string; name: string }[] = typeof m.indices === 'string'
            ? JSON.parse(m.indices) : m.indices;
          indicesList = Array.isArray(arr) ? arr.map(i => i.name) : [];
        } catch { /* ignore */ }
      }
      return {
        ...s,
        name: m?.name ?? null,
        sector: m?.sector ?? null,
        industry: m?.industry ?? null,
        marketCapTier: m?.market_cap_tier ?? null,
        marketCap: m?.market_cap ? Number(m.market_cap) : null,
        exchange: m?.exchange ?? null,
        indices: indicesList,
      };
    });

    const tradeDate = processedStocks.length > 0
      ? processedStocks[0].tradeDate
      : format(new Date(), 'yyyy-MM-dd');

    return NextResponse.json({
      success: true,
      data: {
        date: tradeDate,
        count: enriched.length,
        total: processedStocks.length,
        stocks: enriched,
        filterOptions: derivedFilterOptions,
        hasSecurities: Object.keys(secMeta).length > 0,
      },
    });
  } catch (error) {
    console.error('Error fetching quadrant data:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch quadrant data',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
