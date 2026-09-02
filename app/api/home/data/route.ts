import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { calculateLevels, findClosestLevel } from '@/lib/calculations';

// The DISTINCT / window-function / GROUP BY queries below scan a large slice
// of eod_usmkts_price rather than filtering to one symbol, so they're the
// heaviest reads in the app. That was fatal while eod_usmkts_price was a
// postgres_fdw foreign table pointing at the old project — none of these
// push down, so each one dragged the whole remote table across a
// cross-region link and blew Vercel's function timeout. The table is local
// again as of the 2026-09-02 cutover off the FDW bridge, so they're plain
// local scans now; keep that history in mind before reintroducing any
// cross-project indirection here.

const INDEX_SYMBOLS = ['SPY', 'QQQ', 'DIA', 'IWM'];
const ETF_SYMBOLS = [
  'SPY', 'QQQ', 'IWM', 'DIA', 'GLD', 'SLV', 'TLT', 'GDX',
  'EEM', 'EFA', 'XLF', 'XLE', 'XLK', 'XLV', 'XLU', 'XLI',
  'ARKK', 'VXX', 'IBIT', 'AVGO',
];

async function alpacaFetch(path: string, params: Record<string, string>): Promise<any> {
  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  const baseUrl = process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets';
  if (!apiKey || !secretKey) return null;
  try {
    const res = await fetch(`${baseUrl}${path}?${new URLSearchParams(params)}`, {
      headers: { 'APCA-API-KEY-ID': apiKey, 'APCA-API-SECRET-KEY': secretKey },
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      console.error('Alpaca error', path, res.status, await res.text().catch(() => ''));
      return null;
    }
    return res.json();
  } catch (e) {
    console.error('Alpaca fetch error', path, e);
    return null;
  }
}

// Fetch multi-symbol daily bars for last N days
async function alpacaBars(symbols: string[], days = 5): Promise<Record<string, any[]>> {
  if (symbols.length === 0) return {};
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const params = {
    symbols: symbols.join(','),
    timeframe: '1Day',
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
    adjustment: 'split',
    feed: 'iex',
    limit: '1000',
  };
  const data = await alpacaFetch('/v2/stocks/bars', params);
  return data?.bars ?? {};
}

async function getIndexData() {
  try {
    const bars = await alpacaBars(INDEX_SYMBOLS, 7);
    return INDEX_SYMBOLS.map(symbol => {
      const b: any[] = bars[symbol] || [];
      if (b.length === 0) return { symbol, price: null, change: null, changePercent: null };
      const latest = b[b.length - 1];
      const prev = b.length > 1 ? b[b.length - 2] : null;
      return {
        symbol,
        price: latest.c,
        open: latest.o, high: latest.h, low: latest.l,
        volume: latest.v,
        change: prev ? latest.c - prev.c : null,
        changePercent: prev ? ((latest.c - prev.c) / prev.c) * 100 : null,
        date: latest.t?.split('T')[0] ?? null,
      };
    });
  } catch { return []; }
}

async function getSecuritiesNames(symbols: string[]): Promise<Record<string, string>> {
  if (symbols.length === 0) return {};
  try {
    const rows = await sql`SELECT symbol, name FROM public.securities WHERE symbol = ANY(${symbols})`;
    const map: Record<string, string> = {};
    rows.forEach((r: any) => { if (r.name) map[r.symbol] = r.name; });
    return map;
  } catch { return {}; }
}

async function getTopByOI(etfMode: boolean, limit: number) {
  try {
    const latestDateRows = await sql`SELECT MAX(trade_date)::text as max_date FROM public.eod_usmkts_price`;
    const latestDate = latestDateRows[0]?.max_date;
    if (!latestDate) return { items: [], asOfDate: null };

    // Subquery to pick best expiry per symbol (highest total OI), then sort
    let rows: any[];
    if (etfMode) {
      rows = await sql`
        SELECT symbol, trade_date::text, expiry_dt::text as expiry_dt, call_oi, put_oi,
               (COALESCE(call_oi,0)+COALESCE(put_oi,0)) as total_oi, close
        FROM (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY symbol ORDER BY (COALESCE(call_oi,0)+COALESCE(put_oi,0)) DESC
          ) rn
          FROM public.eod_usmkts_price
          WHERE trade_date = ${latestDate}
            AND symbol = ANY(${ETF_SYMBOLS})
            AND (COALESCE(call_oi,0)+COALESCE(put_oi,0)) > 0
        ) sub WHERE rn = 1
        ORDER BY total_oi DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT symbol, trade_date::text, expiry_dt::text as expiry_dt, call_oi, put_oi,
               (COALESCE(call_oi,0)+COALESCE(put_oi,0)) as total_oi, close
        FROM (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY symbol ORDER BY (COALESCE(call_oi,0)+COALESCE(put_oi,0)) DESC
          ) rn
          FROM public.eod_usmkts_price
          WHERE trade_date = ${latestDate}
            AND symbol != ALL(${ETF_SYMBOLS})
            AND (COALESCE(call_oi,0)+COALESCE(put_oi,0)) > 0
        ) sub WHERE rn = 1
        ORDER BY total_oi DESC
        LIMIT ${limit}
      `;
    }

    const nameMap = await getSecuritiesNames(rows.map((r: any) => r.symbol));
    return {
      asOfDate: latestDate,
      items: rows.map((r: any) => ({
        symbol: r.symbol,
        name: nameMap[r.symbol] || null,
        callOi: Number(r.call_oi),
        putOi: Number(r.put_oi),
        totalOi: Number(r.total_oi),
        close: Number(r.close),
        tradeDate: r.trade_date,
        expiryDate: r.expiry_dt,
      })),
    };
  } catch (e) {
    console.error('getTopByOI error', e);
    return { items: [], asOfDate: null };
  }
}

async function getTopMovers() {
  try {
    // Get S&P 500 symbols from securities (top by market cap)
    const sp500Rows = await sql`
      SELECT symbol FROM public.securities
      WHERE (
        indices::text LIKE ${'%"code":"SPY"%'}
        OR indices::text LIKE ${'%"code": "SPY"%'}
      )
        AND symbol IS NOT NULL
      ORDER BY COALESCE(market_cap, 0) DESC
      LIMIT 100
    `;
    if (sp500Rows.length === 0) {
      console.error('getTopMovers: no S&P 500 symbols found in securities');
      return null;
    }

    const symbols: string[] = sp500Rows.map((r: any) => r.symbol as string);
    console.log(`getTopMovers: fetching bars for ${symbols.length} symbols`);

    // Use bars endpoint (works on free IEX tier) — 5 days to ensure 2 trading days
    const barsMap = await alpacaBars(symbols, 7);

    const nameMap = await getSecuritiesNames(symbols);

    const enriched: any[] = [];
    for (const sym of symbols) {
      const b: any[] = barsMap[sym] || [];
      if (b.length < 2) continue;
      const latest = b[b.length - 1];
      const prev = b[b.length - 2];
      const changePercent = ((latest.c - prev.c) / prev.c) * 100;
      enriched.push({
        symbol: sym,
        name: nameMap[sym] || null,
        price: latest.c,
        changePercent,
        change: latest.c - prev.c,
        volume: latest.v,
      });
    }

    if (enriched.length === 0) {
      console.error('getTopMovers: no enriched bars data returned from Alpaca');
      return null;
    }

    const byGain = [...enriched].sort((a, b) => b.changePercent - a.changePercent);
    const byVol = [...enriched].sort((a, b) => b.volume - a.volume);
    const hot = [...enriched]
      .filter(s => Math.abs(s.changePercent) > 1)
      .sort((a, b) => b.volume - a.volume);

    return {
      gainers: byGain.slice(0, 10),
      losers: byGain.slice(-10).reverse(),
      volume: byVol.slice(0, 10),
      hot: hot.slice(0, 10),
    };
  } catch (e) {
    console.error('getTopMovers error', e);
    return null;
  }
}

async function getSectorBreakdown() {
  try {
    // Get latest 2 distinct trade dates
    const dateRows = await sql`
      SELECT DISTINCT trade_date::text as td FROM public.eod_usmkts_price
      ORDER BY td DESC LIMIT 2
    `;
    if (dateRows.length === 0) return [];
    const latestDate = dateRows[0].td as string;
    const prevDate = (dateRows[1]?.td ?? latestDate) as string;

    // Step 1: get deduplicated price rows for latest date
    const priceRows = await sql`
      SELECT
        symbol,
        MAX(close) as close,
        MAX(COALESCE(put_low, 0)) as put_low,
        MAX(COALESCE(put_int, 0)) as put_int,
        MAX(COALESCE(comb_int, 0)) as put_call_int,
        MAX(COALESCE(call_int, 0)) as call_int,
        MAX(COALESCE(call_high, 0)) as call_high
      FROM public.eod_usmkts_price
      WHERE trade_date = ${latestDate}
      GROUP BY symbol
    `;

    // Step 2: get prev close for each symbol
    const prevRows = await sql`
      SELECT symbol, MAX(close) as close
      FROM public.eod_usmkts_price
      WHERE trade_date = ${prevDate}
      GROUP BY symbol
    `;
    const prevMap: Record<string, number> = {};
    prevRows.forEach((r: any) => { prevMap[r.symbol] = Number(r.close); });

    // Step 3: get sector for each symbol from securities
    const symbols = priceRows.map((r: any) => r.symbol);
    let sectorMapRaw: Record<string, string> = {};
    if (symbols.length > 0) {
      const secRows = await sql`
        SELECT symbol, sector FROM public.securities
        WHERE symbol = ANY(${symbols}) AND sector IS NOT NULL
      `;
      secRows.forEach((r: any) => { if (r.sector) sectorMapRaw[r.symbol] = r.sector; });
    }

    console.log(`getSectorBreakdown: ${priceRows.length} price rows, ${Object.keys(sectorMapRaw).length} with sector, latestDate=${latestDate}`);

    const rows = priceRows
      .filter((r: any) => sectorMapRaw[r.symbol])
      .map((r: any) => ({ ...r, sector: sectorMapRaw[r.symbol], prev_close: prevMap[r.symbol] ?? 0 }));

    const sectorMap: Record<string, any> = {};
    rows.forEach((r: any) => {
      const sector = r.sector as string;
      if (!sectorMap[sector]) {
        sectorMap[sector] = {
          sector, count: 0,
          closestLevels: { put_low: 0, put_int: 0, put_call_int: 0, call_int: 0, call_high: 0 },
          gainers: 0, losers: 0, unchanged: 0,
        };
      }
      sectorMap[sector].count++;

      const mockData = {
        SYMBOL: r.symbol, EXPIRY_DT: '', TRADE_DATE: '',
        OPEN: 0, HIGH: 0, LOW: 0, CLOSE: Number(r.close),
        PUT_INT: Number(r.put_int), CALL_INT: Number(r.call_int),
        PUT_CALL_INT: Number(r.put_call_int), call_low: 0, put_HIGH: 0,
        call_HIGH: Number(r.call_high), put_LOW: Number(r.put_low),
        UNUSED_PC: 0, UNUSED_PC_REV: 0, CALL_OI: 0, PUT_OI: 0, OI_DIFF: 0,
      };
      const levels = calculateLevels(mockData);
      if (levels.length > 0) {
        const closest = findClosestLevel(levels);
        sectorMap[sector].closestLevels[closest.name]++;
      }

      const close = Number(r.close);
      const prev = Number(r.prev_close);
      if (prev > 0) {
        if (close > prev) sectorMap[sector].gainers++;
        else if (close < prev) sectorMap[sector].losers++;
        else sectorMap[sector].unchanged++;
      }
    });

    return Object.values(sectorMap).sort((a, b) => b.count - a.count);
  } catch (e) {
    console.error('getSectorBreakdown error', e);
    return [];
  }
}

export async function GET() {
  try {
    const [topStocksResult, topETFsResult, sectorBreakdown, topMovers] = await Promise.all([
      getTopByOI(false, 12),
      getTopByOI(true, 10),
      getSectorBreakdown(),
      getTopMovers(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        topStocks: topStocksResult.items,
        topStocksDate: topStocksResult.asOfDate,
        topETFs: topETFsResult.items,
        topETFsDate: topETFsResult.asOfDate,
        sectorBreakdown,
        topMovers,
      },
    });
  } catch (error) {
    console.error('home data error', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch home data', message: String(error) },
      { status: 500 }
    );
  }
}
