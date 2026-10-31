import { NextResponse } from 'next/server';
import { getCryptoTickers, type CryptoTicker } from '@/lib/marketdata';
import { ensureCryptoFresh, listCryptoInstruments, getLatestCryptoLevels } from '@/lib/crypto';
import { getCurrentUserContext } from '@/lib/appUsers';
import { FEATURE_CRYPTO_LEVELS, hasFeature } from '@/lib/features';

export const dynamic = 'force-dynamic';

/**
 * The crypto overview: every instrument with stored levels and its live quote (free), plus, for viewers
 * with the crypto_levels feature, the nearest expiry's levels from the latest snapshot. The page loads
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
      // Nearest expiry in the latest snapshot that has data.
      const row = entitled ? latest.find(r => r.coin === inst.coin && r.settlement === inst.settlement && r.levels) : undefined;
      return {
        ...inst,
        ticker: tickers[inst.coin] ?? null,
        nearest: row ? { expiry: row.expiry, tradeDate: row.tradeDate, cmp: row.cmp, levels: row.levels, callOi: row.callOi, putOi: row.putOi } : null,
      };
    });

    return NextResponse.json({ success: true, data: { instruments: data, entitled } });
  } catch (error) {
    console.error('crypto instruments:', error);
    return NextResponse.json({ success: false, error: 'Failed to load crypto instruments' }, { status: 500 });
  }
}
