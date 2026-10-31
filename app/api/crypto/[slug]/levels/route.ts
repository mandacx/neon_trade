import { NextRequest, NextResponse } from 'next/server';
import { ensureCryptoFresh, getCryptoExpiries, getCryptoLevelHistory, resolveCryptoInstrument } from '@/lib/crypto';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_CRYPTO_LEVELS } from '@/lib/features';

export const dynamic = 'force-dynamic';

/**
 * Levels for one crypto instrument (feature crypto_levels): the expiry list (current = in the latest
 * snapshot, the rest historical) and every stored trade date of the chosen expiry. With no `expiry`,
 * the nearest current expiry that has data is chosen.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { blocked } = await requireFeatureApi(FEATURE_CRYPTO_LEVELS);
  if (blocked) return blocked;
  try {
    const { slug } = await params;
    const inst = await resolveCryptoInstrument(slug);
    if (!inst) return NextResponse.json({ success: false, error: 'Unknown instrument' }, { status: 404 });
    await ensureCryptoFresh();

    const { latestTradeDate, expiries } = await getCryptoExpiries(inst.coin, inst.settlement);
    const asked = request.nextUrl.searchParams.get('expiry');
    if (asked && !expiries.some(e => e.expiry === asked)) {
      return NextResponse.json({ success: false, error: 'Unknown expiry' }, { status: 404 });
    }

    let expiry = asked;
    let history = expiry ? await getCryptoLevelHistory(inst.coin, inst.settlement, expiry) : [];
    if (!expiry) {
      // Walk the current expiries nearest first until one has levels on its latest day.
      for (const e of expiries.filter(x => x.current)) {
        const h = await getCryptoLevelHistory(inst.coin, inst.settlement, e.expiry);
        if (h.length && h[h.length - 1].levels) { expiry = e.expiry; history = h; break; }
      }
      if (!expiry && expiries.length) {
        expiry = expiries.find(x => x.current)?.expiry ?? expiries[expiries.length - 1].expiry;
        history = await getCryptoLevelHistory(inst.coin, inst.settlement, expiry);
      }
    }

    return NextResponse.json({
      success: true,
      data: { slug: inst.slug, label: inst.label, coin: inst.coin, settlement: inst.settlement, latestTradeDate, expiries, expiry, history },
    });
  } catch (error) {
    console.error('crypto levels:', error);
    return NextResponse.json({ success: false, error: 'Failed to load levels' }, { status: 500 });
  }
}
