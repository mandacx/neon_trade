import { NextResponse } from 'next/server';
import { getCryptoTickers, type CryptoTicker } from '@/lib/marketdata';
import { ensureCryptoFresh, listCryptoInstruments, getLatestCryptoLevels } from '@/lib/crypto';
import { getCurrentUserContext } from '@/lib/appUsers';
import { FEATURE_CRYPTO_LEVELS, hasFeature } from '@/lib/features';

export const dynamic = 'force-dynamic';

/**
 * The crypto overview: every instrument with stored levels and its live quote (free), plus, for viewers
 * with the crypto_levels feature, every current expiry's levels from the latest snapshot (`expiries`, nearest
 * first; `nearest` is the first one), so the page can show any expiry for all markets. The page loads
 * this once and polls /api/crypto/tickers for prices; the closest level is worked out in the browser.
 */
export async function GET() {
  try {
    await ensureCryptoFresh();
    const [ctx, instruments] = await Promise.all([getCurrentUserContext(), listCryptoInstruments()]);
    const entitled = hasFeature(ctx.features, FEATURE_CRYPTO_LEVELS);
    const coins = [...new Set(instruments.map(i => i.coin))];
    const [tickers, latest] = await Promise.all([
      getCryptoTickers(coins).catch((err): Record<string, CryptoTicker> => { console.error('crypto tickers:', err); return {}; }),
      entitled ? getLatestCryptoLevels() : Promise.resolve([]),
    ]);

    const data = instruments.map(inst => {
      // Expiries of the latest snapshot that have data, nearest first (rows come ordered by expiry).
      const expiries = entitled
        ? latest.filter(r => r.coin === inst.coin && r.settlement === inst.settlement && r.levels)
            .map(r => ({ expiry: r.expiry, tradeDate: r.tradeDate, cmp: r.cmp, levels: r.levels, callOi: r.callOi, putOi: r.putOi }))
        : [];
      return { ...inst, ticker: tickers[inst.coin] ?? null, nearest: expiries[0] ?? null, expiries };
    });

    return NextResponse.json({ success: true, data: { instruments: data, entitled } });
  } catch (error) {
    console.error('crypto instruments:', error);
    return NextResponse.json({ success: false, error: 'Failed to load crypto instruments' }, { status: 500 });
  }
}
