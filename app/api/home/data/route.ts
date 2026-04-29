import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { calculateLevels, findClosestLevel } from '@/lib/calculations';

const INDEX_SYMBOLS = ['SPY', 'QQQ', 'DIA', 'IWM'];
const ETF_SYMBOLS = [
  'SPY', 'QQQ', 'IWM', 'DIA', 'GLD', 'SLV', 'TLT', 'GDX',
  'EEM', 'EFA', 'XLF', 'XLE', 'XLK', 'XLV', 'XLU', 'XLI',
  'ARKK', 'VXX', 'IBIT', 'AVGO',
];

async function getIndexData() {
  try {
    const apiKey = process.env.ALPACA_API_KEY;
    const secretKey = process.env.ALPACA_SECRET_KEY;
    const baseUrl = process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets';

    if (!apiKey || !secretKey) return [];

    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 5); // 5 days back to ensure 2 trading days

    const params = new URLSearchParams({
      symbols: INDEX_SYMBOLS.join(','),
      timeframe: '1Day',
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
      adjustment: 'split',
      feed: 'iex',
      limit: '10',
    });

    const res = await fetch(`${baseUrl}/v2/stocks/bars?${params}`, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': secretKey,
      },
      next: { revalidate: 300 }, // cache 5 min
    });

    if (!res.ok) return [];

    const data = await res.json();
    const bars = data.bars || {};

    return INDEX_SYMBOLS.map(symbol => {
      const symbolBars: any[] = bars[symbol] || [];
      if (symbolBars.length === 0) return { symbol, price: null, change: null, changePercent: null };
      const latest = symbolBars[symbolBars.length - 1];
      const prev = symbolBars.length > 1 ? symbolBars[symbolBars.length - 2] : null;
      const change = prev ? latest.c - prev.c : null;
      const changePercent = prev ? ((latest.c - prev.c) / prev.c) * 100 : null;
      return {
        symbol,
        price: latest.c,
        open: latest.o,
        high: latest.h,
        low: latest.l,
        volume: latest.v,
        change,
        changePercent,
      };
    });
  } catch {
    return [];
  }
}

async function getTopByOI(symbols: string[] | null, limit: number) {
  try {
    const latestDateRows = await sql`
      SELECT MAX(trade_date)::text as max_date FROM public.eod_usmkts_price
    `;
    const latestDate = latestDateRows[0]?.max_date;
    if (!latestDate) return [];

    let rows;
    if (symbols && symbols.length > 0) {
      rows = await sql`
        SELECT
          p.symbol,
          COALESCE(p.call_oi, 0) as call_oi,
          COALESCE(p.put_oi, 0) as put_oi,
          COALESCE(p.call_oi + p.put_oi, 0) as total_oi,
          COALESCE(p.close, 0) as close,
          COALESCE(p.call_oi - p.put_oi, 0) as oi_diff,
          s.name,
          s.sector,
          s.market_cap_tier
        FROM public.eod_usmkts_price p
        LEFT JOIN public.securities s ON s.symbol = p.symbol
        WHERE p.trade_date = ${latestDate}
          AND p.symbol = ANY(${symbols})
          AND (p.call_oi + p.put_oi) > 0
        ORDER BY total_oi DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT
          p.symbol,
          COALESCE(p.call_oi, 0) as call_oi,
          COALESCE(p.put_oi, 0) as put_oi,
          COALESCE(p.call_oi + p.put_oi, 0) as total_oi,
          COALESCE(p.close, 0) as close,
          COALESCE(p.call_oi - p.put_oi, 0) as oi_diff,
          s.name,
          s.sector,
          s.market_cap_tier
        FROM public.eod_usmkts_price p
        LEFT JOIN public.securities s ON s.symbol = p.symbol
        WHERE p.trade_date = ${latestDate}
          AND (p.call_oi + p.put_oi) > 0
          AND p.symbol NOT IN (${ETF_SYMBOLS})
        ORDER BY total_oi DESC
        LIMIT ${limit}
      `;
    }

    return rows.map((r: any) => ({
      symbol: r.symbol,
      name: r.name || r.symbol,
      callOi: Number(r.call_oi),
      putOi: Number(r.put_oi),
      totalOi: Number(r.total_oi),
      close: Number(r.close),
      oiDiff: Number(r.oi_diff),
      sector: r.sector || null,
      marketCapTier: r.market_cap_tier || null,
    }));
  } catch {
    return [];
  }
}

async function getSectorBreakdown() {
  try {
    const latestDateRows = await sql`
      SELECT trade_date::text, MAX(trade_date)::text as max_date
      FROM public.eod_usmkts_price
      GROUP BY trade_date
      ORDER BY trade_date DESC
      LIMIT 2
    `;

    if (latestDateRows.length === 0) return [];
    const latestDate = latestDateRows[0].max_date || latestDateRows[0].trade_date;
    const prevDate = latestDateRows.length > 1
      ? (latestDateRows[1].max_date || latestDateRows[1].trade_date)
      : null;

    const rows = await sql`
      SELECT
        s.sector,
        COUNT(DISTINCT p.symbol) as count,
        AVG(p.close) as avg_close,
        p2.close as prev_close,
        p.symbol,
        p.close,
        COALESCE(p.put_low, 0) as put_low,
        COALESCE(p.put_int, 0) as put_int,
        COALESCE(p.comb_int, 0) as put_call_int,
        COALESCE(p.call_int, 0) as call_int,
        COALESCE(p.call_high, 0) as call_high
      FROM public.eod_usmkts_price p
      JOIN public.securities s ON s.symbol = p.symbol
      LEFT JOIN public.eod_usmkts_price p2
        ON p2.symbol = p.symbol AND p2.trade_date = ${prevDate || latestDate}
      WHERE p.trade_date = ${latestDate}
        AND s.sector IS NOT NULL
      GROUP BY s.sector, p.symbol, p.close, p2.close,
               p.put_low, p.put_int, p.comb_int, p.call_int, p.call_high
    `;

    // Aggregate by sector
    const sectorMap: Record<string, {
      sector: string;
      symbols: string[];
      closestLevels: Record<string, number>;
      gainers: number;
      losers: number;
      unchanged: number;
    }> = {};

    rows.forEach((r: any) => {
      const sector = r.sector;
      if (!sectorMap[sector]) {
        sectorMap[sector] = {
          sector,
          symbols: [],
          closestLevels: { put_low: 0, put_int: 0, put_call_int: 0, call_int: 0, call_high: 0 },
          gainers: 0,
          losers: 0,
          unchanged: 0,
        };
      }

      sectorMap[sector].symbols.push(r.symbol);

      // Calculate closest level for this stock
      const mockData = {
        SYMBOL: r.symbol, EXPIRY_DT: '', TRADE_DATE: '',
        OPEN: 0, HIGH: 0, LOW: 0,
        CLOSE: Number(r.close),
        PUT_INT: Number(r.put_int), CALL_INT: Number(r.call_int),
        PUT_CALL_INT: Number(r.put_call_int),
        call_low: 0, put_HIGH: 0,
        call_HIGH: Number(r.call_high),
        put_LOW: Number(r.put_low),
        UNUSED_PC: 0, UNUSED_PC_REV: 0,
        CALL_OI: 0, PUT_OI: 0, OI_DIFF: 0,
      };
      const levels = calculateLevels(mockData);
      if (levels.length > 0) {
        const closest = findClosestLevel(levels);
        sectorMap[sector].closestLevels[closest.name] =
          (sectorMap[sector].closestLevels[closest.name] || 0) + 1;
      }

      // Gainers/losers
      const close = Number(r.close);
      const prev = Number(r.prev_close);
      if (prev && prev > 0) {
        if (close > prev) sectorMap[sector].gainers++;
        else if (close < prev) sectorMap[sector].losers++;
        else sectorMap[sector].unchanged++;
      }
    });

    return Object.values(sectorMap)
      .map(s => ({ ...s, count: s.symbols.length }))
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const [indices, topStocks, topETFs, sectorBreakdown] = await Promise.all([
      getIndexData(),
      getTopByOI(null, 15),
      getTopByOI(ETF_SYMBOLS, 10),
      getSectorBreakdown(),
    ]);

    return NextResponse.json({
      success: true,
      data: { indices, topStocks, topETFs, sectorBreakdown },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch home data', message: String(error) },
      { status: 500 }
    );
  }
}
