import { NextResponse } from 'next/server';
import { getCryptoTickers } from '@/lib/marketdata';
import { listCryptoInstruments } from '@/lib/crypto';
import { getOrSet } from '@/lib/ttlCache';

export const dynamic = 'force-dynamic';

/** Live quotes for every crypto coin, keyed by coin (free; polled by the crypto pages). No DB read per call. */
export async function GET() {
  try {
    const instruments = await getOrSet('crypto:instruments', 60_000, listCryptoInstruments);
    const tickers = await getCryptoTickers([...new Set(instruments.map(i => i.coin))]);
    return NextResponse.json({ success: true, data: tickers });
  } catch (error) {
    console.error('crypto tickers:', error);
    return NextResponse.json({ success: false, error: 'Quotes unavailable' }, { status: 502 });
  }
}
