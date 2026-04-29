import { NextRequest, NextResponse } from 'next/server';
import { getAllStocksLatest, getAllStocksByDate, getAllStocksByDateAndExpiry, getAvailableDates, getAvailableExpiryDates, sql } from '@/lib/db';
import { calculateLevels, findClosestLevel } from '@/lib/calculations';
import { format } from 'date-fns';

async function getSecuritiesFilterOptions() {
  try {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'securities'
    `;
    const colNames = cols.map((c: any) => c.column_name as string);

    const result: Record<string, string[]> = {};

    if (colNames.includes('sector')) {
      const rows = await sql`SELECT DISTINCT sector FROM public.securities WHERE sector IS NOT NULL ORDER BY sector`;
      result.sectors = rows.map((r: any) => r.sector);
    }
    if (colNames.includes('industry')) {
      const rows = await sql`SELECT DISTINCT industry FROM public.securities WHERE industry IS NOT NULL ORDER BY industry`;
      result.industries = rows.map((r: any) => r.industry);
    }
    if (colNames.includes('market_cap_tier')) {
      const rows = await sql`SELECT DISTINCT market_cap_tier FROM public.securities WHERE market_cap_tier IS NOT NULL ORDER BY market_cap_tier`;
      result.marketCapTiers = rows.map((r: any) => r.market_cap_tier);
    }
    if (colNames.includes('index_membership') || colNames.includes('indices')) {
      const col = colNames.includes('index_membership') ? 'index_membership' : 'indices';
      const rows = await sql`SELECT DISTINCT ${sql(col)} as val FROM public.securities WHERE ${sql(col)} IS NOT NULL ORDER BY ${sql(col)}`;
      result.indices = rows.map((r: any) => r.val);
    }

    return { options: result, columns: colNames };
  } catch {
    return { options: {}, columns: [] };
  }
}

async function getSecuritiesMeta(symbols: string[], columns: string[]) {
  if (symbols.length === 0 || columns.length === 0) return {};
  try {
    const selectCols = ['symbol'];
    if (columns.includes('sector')) selectCols.push('sector');
    if (columns.includes('industry')) selectCols.push('industry');
    if (columns.includes('market_cap_tier')) selectCols.push('market_cap_tier');
    if (columns.includes('market_cap')) selectCols.push('market_cap');

    const rows = await sql`
      SELECT ${sql(selectCols.join(', '))}
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

    // If requesting metadata only (dates + filter options)
    if (metadataOnly) {
      const [tradeDates, expiryDates, { options }] = await Promise.all([
        getAvailableDates(30),
        getAvailableExpiryDates(),
        getSecuritiesFilterOptions(),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          tradeDates,
          expiryDates,
          filterOptions: options,
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

    // Enrich with securities metadata if any security filters requested
    const { options: _opts, columns: secCols } = await getSecuritiesFilterOptions();
    const symbols = filteredStocks.map(s => s.symbol);
    const secMeta = await getSecuritiesMeta(symbols, secCols);

    // Apply securities-based filters
    if (sector && secCols.includes('sector')) {
      filteredStocks = filteredStocks.filter(s => secMeta[s.symbol]?.sector === sector);
    }
    if (industry && secCols.includes('industry')) {
      filteredStocks = filteredStocks.filter(s => secMeta[s.symbol]?.industry === industry);
    }
    if (marketCapTier && secCols.includes('market_cap_tier')) {
      filteredStocks = filteredStocks.filter(s => secMeta[s.symbol]?.market_cap_tier === marketCapTier);
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
    const enriched = filteredStocks.map(s => ({
      ...s,
      sector: secMeta[s.symbol]?.sector ?? null,
      industry: secMeta[s.symbol]?.industry ?? null,
      marketCapTier: secMeta[s.symbol]?.market_cap_tier ?? null,
      marketCap: secMeta[s.symbol]?.market_cap ? Number(secMeta[s.symbol].market_cap) : null,
    }));

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
        hasSecurities: secCols.length > 0,
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
