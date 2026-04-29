import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const INDICES = [
  { symbol: 'SPY', label: 'S&P 500' },
  { symbol: 'DIA', label: 'Dow Jones' },
  { symbol: 'QQQ', label: 'Nasdaq' },
  { symbol: 'GLD', label: 'Gold' },
  { symbol: 'SLV', label: 'Silver' },
  { symbol: 'USO', label: 'US Oil' },
];

async function alpacaBars(symbols: string[]): Promise<Record<string, any[]>> {
  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  const baseUrl = process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets';
  if (!apiKey || !secretKey) return {};

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);

  try {
    const res = await fetch(
      `${baseUrl}/v2/stocks/bars?${new URLSearchParams({
        symbols: symbols.join(','),
        timeframe: '1Day',
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
        adjustment: 'split',
        feed: 'iex',
        limit: '1000',
      })}`,
      {
        headers: { 'APCA-API-KEY-ID': apiKey, 'APCA-API-SECRET-KEY': secretKey },
        cache: 'no-store',
      }
    );
    if (!res.ok) return {};
    const data = await res.json();
    return data?.bars ?? {};
  } catch {
    return {};
  }
}

export async function GET() {
  const symbols = INDICES.map(i => i.symbol);
  const bars = await alpacaBars(symbols);

  const result = INDICES.map(({ symbol, label }) => {
    const b: any[] = bars[symbol] || [];
    if (b.length === 0) return { symbol, label, price: null, change: null, changePercent: null, volume: null, date: null };
    const latest = b[b.length - 1];
    const prev = b.length > 1 ? b[b.length - 2] : null;
    return {
      symbol, label,
      price: latest.c,
      open: latest.o, high: latest.h, low: latest.l,
      volume: latest.v,
      change: prev ? latest.c - prev.c : null,
      changePercent: prev ? ((latest.c - prev.c) / prev.c) * 100 : null,
      date: latest.t?.split('T')[0] ?? null,
    };
  });

  return NextResponse.json(
    { success: true, data: result },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}
