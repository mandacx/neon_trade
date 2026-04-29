import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { calculateLevels, findClosestLevel } from '@/lib/calculations';

const INDEX_SYMBOLS = ['SPY', 'QQQ', 'DIA', 'IWM'];
const ETF_SYMBOLS = [
  'SPY', 'QQQ', 'IWM', 'DIA', 'GLD', 'SLV', 'TLT', 'GDX',
  'EEM', 'EFA', 'XLF', 'XLE', 'XLK', 'XLV', 'XLU', 'XLI',
  'ARKK', 'VXX', 'IBIT', 'AVGO',
];

async function alpacaFetch(path: string, params: Record<string, string>) {
  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  const baseUrl = process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets';
  if (!apiKey || !secretKey) return null;
  const url = `${baseUrl}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: { 'APCA-API-KEY-ID': apiKey, 'APCA-API-SECRET-KEY': secretKey },
    next: { revalidate: 300 },
  });
  if (!res.ok) return null;
  return res.json();
}

async function getIndexData() {
  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    const data = await alpacaFetch('/v2/stocks/bars', {
      symbols: INDEX_SYMBOLS.join(','),
      timeframe: '1Day',
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
      adjustment: 'split',
      feed: 'iex',
      limit: '20',
    });
    if (!data) return [];
    const bars = data.bars || {};
    return INDEX_SYMBOLS.map(symbol => {
      const symbolBars: any[] = bars[symbol] || [];
      if (symbolBars.length === 0) return { symbol, price: null, change: null, changePercent: null };
      const latest = symbolBars[symbolBars.length - 1];
      const prev = symbolBars.length > 1 ? symbolBars[symbolBars.length - 2] : null;
      return {
        symbol,
        price: latest.c,
        open: latest.o,
        high: latest.h,
        low: latest.l,
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
    const rows = await sql`
      SELECT symbol, name FROM public.securities WHERE symbol = ANY(${symbols})
    `;
    const map: Record<string, string> = {};
    rows.forEach((r: any) => { if (r.name) map[r.symbol] = r.name; });
    return map;
  } catch { return {}; }
}

async function getTopByOI(etfMode: boolean, limit: number) {
  try {
    const latestDateRows = await sql`
      SELECT MAX(trade_date)::text as max_date FROM public.eod_usmkts_price
    `;
    const latestDate = latestDateRows[0]?.max_date;
    if (!latestDate) return { items: [], asOfDate: null };

    // DISTINCT ON symbol — pick row with highest total OI per symbol
    let rows;
    if (etfMode) {
      rows = await sql`
        SELECT DISTINCT ON (p.symbol)
          p.symbol,
          p.trade_date::text as trade_date,
          p.expiry_dt::text as expiry_dt,
          COALESCE(p.call_oi, 0) as call_oi,
          COALESCE(p.put_oi, 0) as put_oi,
          COALESCE(p.call_oi + p.put_oi, 0) as total_oi,
          COALESCE(p.close, 0) as close
        FROM public.eod_usmkts_price p
        WHERE p.trade_date = ${latestDate}
          AND p.symbol = ANY(${ETF_SYMBOLS})
          AND (p.call_oi + p.put_oi) > 0
        ORDER BY p.symbol, (p.call_oi + p.put_oi) DESC
        LIMIT ${limit * 3}
      `;
    } else {
      rows = await sql`
        SELECT DISTINCT ON (p.symbol)
          p.symbol,
          p.trade_date::text as trade_date,
          p.expiry_dt::text as expiry_dt,
          COALESCE(p.call_oi, 0) as call_oi,
          COALESCE(p.put_oi, 0) as put_oi,
          COALESCE(p.call_oi + p.put_oi, 0) as total_oi,
          COALESCE(p.close, 0) as close
        FROM public.eod_usmkts_price p
        WHERE p.trade_date = ${latestDate}
          AND p.symbol != ALL(${ETF_SYMBOLS})
          AND (p.call_oi + p.put_oi) > 0
        ORDER BY p.symbol, (p.call_oi + p.put_oi) DESC
        LIMIT ${limit * 3}
      `;
    }

    // Sort by total_oi DESC and take limit
    const sorted = [...rows].sort((a: any, b: any) => Number(b.total_oi) - Number(a.total_oi)).slice(0, limit);

    // Fetch names from securities
    const symbols = sorted.map((r: any) => r.symbol);
    const nameMap = await getSecuritiesNames(symbols);

    return {
      asOfDate: latestDate,
      items: sorted.map((r: any) => ({
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
  } catch { return { items: [], asOfDate: null }; }
}

async function getTopMovers() {
  try {
    // Get S&P 500 symbols from securities table
    const sp500Rows = await sql`
      SELECT symbol FROM public.securities
      WHERE indices IS NOT NULL
        AND indices::text LIKE '%"code":"SPY"%'
        AND market_cap IS NOT NULL
      ORDER BY market_cap DESC
      LIMIT 150
    `;
    if (sp500Rows.length === 0) return null;

    const symbols: string[] = sp500Rows.map((r: any) => r.symbol);

    // Batch snapshots from Alpaca (max ~100 per call)
    const batch1 = symbols.slice(0, 100);
    const batch2 = symbols.slice(100);

    const [snap1, snap2] = await Promise.all([
      alpacaFetch('/v2/stocks/snapshots', { symbols: batch1.join(','), feed: 'iex' }),
      batch2.length > 0
        ? alpacaFetch('/v2/stocks/snapshots', { symbols: batch2.join(','), feed: 'iex' })
        : Promise.resolve({}),
    ]);

    const snapshots: Record<string, any> = { ...(snap1 || {}), ...(snap2 || {}) };

    // Get names for all symbols
    const nameMap = await getSecuritiesNames(symbols);

    // Build enriched list
    const enriched = Object.entries(snapshots)
      .map(([sym, snap]: [string, any]) => {
        const daily = snap.dailyBar;
        const prev = snap.prevDailyBar;
        if (!daily || !prev) return null;
        const changePercent = ((daily.c - prev.c) / prev.c) * 100;
        return {
          symbol: sym,
          name: nameMap[sym] || null,
          price: daily.c,
          changePercent,
          change: daily.c - prev.c,
          volume: daily.v,
          vwap: daily.vw ?? null,
        };
      })
      .filter(Boolean) as any[];

    const byGain = [...enriched].sort((a, b) => b.changePercent - a.changePercent);
    const byVolume = [...enriched].sort((a, b) => b.volume - a.volume);

    // "Hot" = top volume with significant move (|change%| > 1%)
    const hot = [...enriched]
      .filter(s => Math.abs(s.changePercent) > 1)
      .sort((a, b) => b.volume - a.volume);

    return {
      gainers: byGain.slice(0, 10),
      losers: byGain.slice(-10).reverse(),
      volume: byVolume.slice(0, 10),
      hot: hot.slice(0, 10),
    };
  } catch { return null; }
}

async function getSectorBreakdown() {
  try {
    const dateRows = await sql`
      SELECT DISTINCT trade_date::text as td
      FROM public.eod_usmkts_price
      ORDER BY trade_date DESC LIMIT 2
    `;
    if (dateRows.length === 0) return [];
    const latestDate = dateRows[0].td;
    const prevDate = dateRows[1]?.td || latestDate;

    const rows = await sql`
      SELECT DISTINCT ON (p.symbol)
        s.sector,
        p.symbol,
        p.close,
        p2.close as prev_close,
        COALESCE(p.put_low, 0) as put_low,
        COALESCE(p.put_int, 0) as put_int,
        COALESCE(p.comb_int, 0) as put_call_int,
        COALESCE(p.call_int, 0) as call_int,
        COALESCE(p.call_high, 0) as call_high
      FROM public.eod_usmkts_price p
      JOIN public.securities s ON s.symbol = p.symbol
      LEFT JOIN public.eod_usmkts_price p2
        ON p2.symbol = p.symbol AND p2.trade_date = ${prevDate}
      WHERE p.trade_date = ${latestDate}
        AND s.sector IS NOT NULL
      ORDER BY p.symbol, (p.call_oi + p.put_oi) DESC
    `;

    const sectorMap: Record<string, any> = {};
    rows.forEach((r: any) => {
      const sector = r.sector;
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
        OPEN: 0, HIGH: 0, LOW: 0,
        CLOSE: Number(r.close),
        PUT_INT: Number(r.put_int), CALL_INT: Number(r.call_int),
        PUT_CALL_INT: Number(r.put_call_int),
        call_low: 0, put_HIGH: 0,
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
  } catch { return []; }
}

export async function GET() {
  try {
    const [indices, topStocksResult, topETFsResult, sectorBreakdown, topMovers] = await Promise.all([
      getIndexData(),
      getTopByOI(false, 12),
      getTopByOI(true, 10),
      getSectorBreakdown(),
      getTopMovers(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        indices,
        topStocks: topStocksResult.items,
        topStocksDate: topStocksResult.asOfDate,
        topETFs: topETFsResult.items,
        topETFsDate: topETFsResult.asOfDate,
        sectorBreakdown,
        topMovers,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch home data', message: String(error) },
      { status: 500 }
    );
  }
}
