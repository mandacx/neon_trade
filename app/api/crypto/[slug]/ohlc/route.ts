import { NextRequest, NextResponse } from 'next/server';
import { getCryptoBars } from '@/lib/marketdata';
import { resolveCryptoInstrument } from '@/lib/crypto';
import { cryptoDayKey, isCryptoInterval, CRYPTO_INTERVALS } from '@/lib/cryptoInstruments';

export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;

/**
 * Candles for one crypto instrument (free, like stock prices). `from` / `to` are epoch ms; default is the
 * interval's initial window ending now. Each bar carries `date`: the 08:00-UTC crypto day it belongs to, the key levels join on.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const inst = await resolveCryptoInstrument(slug);
    if (!inst) return NextResponse.json({ success: false, error: 'Unknown instrument' }, { status: 404 });

    const sp = request.nextUrl.searchParams;
    const intervalParam = sp.get('interval') ?? 'daily';
    if (!isCryptoInterval(intervalParam)) return NextResponse.json({ success: false, error: 'Unsupported interval' }, { status: 400 });
    const interval = intervalParam;
    const now = Date.now();
    const to = Math.min(Number(sp.get('to')) || now, now);
    const from = Number(sp.get('from')) || to - CRYPTO_INTERVALS[interval].initialDays * DAY_MS;
    // A request is at most two chunks wide, so one call can't pull the whole archive at 5-minute bars.
    if (!(from < to) || to - from > 2 * CRYPTO_INTERVALS[interval].chunkDays * DAY_MS + DAY_MS) {
      return NextResponse.json({ success: false, error: 'Invalid range' }, { status: 400 });
    }

    const bars = await getCryptoBars(inst.coin, interval, from, to);
    const data = bars.map(b => {
      const timestamp = Math.floor(Date.parse(b.t) / 1000);
      return { timestamp, date: cryptoDayKey(timestamp), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v };
    });
    return NextResponse.json({ success: true, data: { slug: inst.slug, interval, from, to, data } });
  } catch (error) {
    console.error('crypto ohlc:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch candles' }, { status: 500 });
  }
}
