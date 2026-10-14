import { NextRequest, NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_EARNINGS } from '@/lib/features';
import { getTrackedSymbols } from '@/lib/earnings';
import { getAvailableExpiryDates, getNearestExpiryLatestForSymbols, getStockDataForSymbolsAtExpiry } from '@/lib/db';
import { calculateLevels, findClosestLevel } from '@/lib/calculations';
import { levelGate } from '@/lib/levelAccess';
import { isThirdFridayOfMonth } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Levels for every tracked symbol at one monthly (3rd-Friday) expiry, the same
 * data the watchlist page's expiry toggle uses (/api/watchlists/[id]/levels),
 * for the whole levels universe instead of one list. The client rebases them
 * onto each row's live price (rebaseToLtp). `?expiry=` must be one of the
 * returned `expiries`; otherwise the earliest upcoming monthly expiry is used.
 * With no monthly expiry in the data it falls back to each symbol's own nearest.
 */
export async function GET(request: NextRequest) {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_EARNINGS);
  if (blocked) return blocked;

  const expiries = (await getAvailableExpiryDates()).filter(isThirdFridayOfMonth).sort();
  const requested = request.nextUrl.searchParams.get('expiry');
  const expiry = requested && expiries.includes(requested) ? requested : expiries[0] ?? '';

  const symbols = await getTrackedSymbols();
  const stockRows = expiry
    ? await getStockDataForSymbolsAtExpiry(symbols, expiry)
    : await getNearestExpiryLatestForSymbols(symbols);
  const gate = levelGate(ctx.features);

  const rows = stockRows.map(data => {
    const withheld = gate.withheld(data.TRADE_DATE);
    const levels = withheld ? [] : calculateLevels(data);
    const closest = withheld || levels.length === 0 ? null : findClosestLevel(levels);
    return {
      symbol: data.SYMBOL,
      expiryDate: data.EXPIRY_DT,
      tradeDate: data.TRADE_DATE,
      levels: levels.map(l => ({ name: l.name, price: l.price })),
      closestLevel: closest?.name ?? null,
      closestPrice: closest?.price ?? null,
      distance: closest?.distance ?? null,
      distancePercent: closest ? closest.value * 100 : null,
      levelAccess: gate.meta.levelAccess,
      requiredFeature: gate.meta.requiredFeature,
    };
  });

  return NextResponse.json({ success: true, data: { rows, expiries, expiry } });
}
