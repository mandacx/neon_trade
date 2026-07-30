import { NextRequest, NextResponse } from 'next/server';
import { getLatestStockData, getHistoricalStockData, getStockDataByExpiry, sql } from '@/lib/db';
import { calculateLevels, findClosestLevel } from '@/lib/calculations';
import { formatPercentage } from '@/lib/utils';
import { format, subDays } from 'date-fns';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date');
    const range = searchParams.get('range') === 'true';
    const expiryDate = searchParams.get('expiry');

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: 'Symbol parameter is required' },
        { status: 400 }
      );
    }

    if (range) {
      // Return historical levels
      const now = new Date();
      const to = searchParams.get('to') || format(now, 'yyyy-MM-dd');
      const from = searchParams.get('from') || format(subDays(now, 30), 'yyyy-MM-dd');
      
      let historicalData;
      if (expiryDate) {
        // Fetch historical data for specific expiry
        const result = await sql`
          SELECT
            symbol as "SYMBOL",
            expiry_dt::text as "EXPIRY_DT",
            trade_date::text as "TRADE_DATE",
            COALESCE(close, 0) as "CLOSE",
            COALESCE(put_low, 0) as "put_LOW",
            COALESCE(put_int, 0) as "PUT_INT",
            COALESCE(comb_int, 0) as "PUT_CALL_INT",
            COALESCE(call_int, 0) as "CALL_INT",
            COALESCE(call_high, 0) as "call_HIGH",
            COALESCE(call_low, 0) as "call_low",
            COALESCE(put_high, 0) as "put_HIGH",
            COALESCE(unused_pc, 0) as "UNUSED_PC",
            COALESCE(unused_pc_rev, 0) as "UNUSED_PC_REV",
            COALESCE(put_oi, 0) as "PUT_OI",
            COALESCE(call_oi, 0) as "CALL_OI",
            COALESCE(put_oi - call_oi, 0) as "OI_DIFF"
          FROM public.eod_usmkts_price
          WHERE symbol = ${symbol.toUpperCase()}
            AND expiry_dt = ${expiryDate}::date
            AND trade_date >= ${from}
            AND trade_date <= ${to}
          ORDER BY trade_date ASC
        `;
        historicalData = result.map((row: any) => ({
          SYMBOL: row.SYMBOL,
          EXPIRY_DT: row.EXPIRY_DT,
          TRADE_DATE: row.TRADE_DATE,
          CLOSE: row.CLOSE,
          put_LOW: row.put_LOW,
          PUT_INT: row.PUT_INT,
          PUT_CALL_INT: row.PUT_CALL_INT,
          CALL_INT: row.CALL_INT,
          call_HIGH: row.call_HIGH,
          call_low: row.call_low,
          put_HIGH: row.put_HIGH,
          UNUSED_PC: row.UNUSED_PC,
          UNUSED_PC_REV: row.UNUSED_PC_REV,
          PUT_OI: row.PUT_OI,
          CALL_OI: row.CALL_OI,
          OI_DIFF: row.OI_DIFF,
          OPEN: 0,
          HIGH: 0,
          LOW: 0,
        }));
      } else {
        historicalData = await getHistoricalStockData(symbol, from, to);
      }

      const processedData = historicalData.map(data => {
        const levels = calculateLevels(data);
        const closest = findClosestLevel(levels);

        // All 7 raw price levels the DB stores (the 5-level calculateLevels()
        // above only covers the "official" closest-level business logic used
        // for the chart/scan alerts — this is a superset for the levels table).
        const sevenLevels = [
          { name: 'put_low', price: data.put_LOW },
          { name: 'call_low', price: data.call_low },
          { name: 'put_int', price: data.PUT_INT },
          { name: 'put_call_int', price: data.PUT_CALL_INT },
          { name: 'call_int', price: data.CALL_INT },
          { name: 'put_high', price: data.put_HIGH },
          { name: 'call_high', price: data.call_HIGH },
        ].map(l => ({
          ...l,
          value: data.CLOSE ? (data.CLOSE - l.price) / data.CLOSE : 0,
        }));

        return {
          date: data.TRADE_DATE,
          close: data.CLOSE,
          levels: {
            put_low: data.put_LOW,
            put_int: data.PUT_INT,
            put_call_int: data.PUT_CALL_INT,
            call_int: data.CALL_INT,
            call_high: data.call_HIGH,
          },
          calculated: levels.map(l => ({
            name: l.name,
            price: l.price,
            value: l.value,
            distance: l.distance,
            percentage: formatPercentage(l.value),
          })),
          closestLevel: closest.name,
          sevenLevels,
          ratios: {
            upc: data.UNUSED_PC,
            ucpr: data.UNUSED_PC_REV,
          },
          oi: {
            callOi: data.CALL_OI,
            putOi: data.PUT_OI,
            oiDiff: data.OI_DIFF,
          },
        };
      });

      return NextResponse.json({
        success: true,
        data: {
          symbol: symbol.toUpperCase(),
          from,
          to,
          history: processedData,
        },
      });
    } else {
      // Return single date levels
      let stockData;
      
      if (expiryDate) {
        // Fetch data for specific expiry date
        stockData = await getStockDataByExpiry(symbol, expiryDate);
      } else {
        // Fetch latest data
        stockData = await getLatestStockData(symbol);
      }

      if (!stockData) {
        // No database data - return success with null to indicate broker-only mode
        return NextResponse.json({
          success: true,
          data: null,
          message: 'Stock not found in database, using broker data only'
        });
      }

      const levels = calculateLevels(stockData);
      const closest = findClosestLevel(levels);

      return NextResponse.json({
        success: true,
        data: {
          symbol: stockData.SYMBOL,
          tradeDate: stockData.TRADE_DATE,
          expiryDate: stockData.EXPIRY_DT,
          close: stockData.CLOSE,
          levels: {
            put_low: stockData.put_LOW,
            put_int: stockData.PUT_INT,
            put_call_int: stockData.PUT_CALL_INT,
            call_int: stockData.CALL_INT,
            call_high: stockData.call_HIGH,
          },
          calculated: levels.map(level => ({
            name: level.name,
            price: level.price,
            percentage: formatPercentage(level.value),
            distance: level.distance,
            value: level.value,
          })),
          closestLevel: closest.name,
        },
      });
    }
  } catch (error) {
    console.error('Error fetching levels:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch levels',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
