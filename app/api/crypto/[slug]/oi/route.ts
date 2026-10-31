import { NextRequest, NextResponse } from 'next/server';
import { getCryptoOiByStrike, resolveCryptoInstrument } from '@/lib/crypto';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_CRYPTO_LEVELS } from '@/lib/features';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Open interest by strike for one expiry and trade date, with the change from the previous date (feature crypto_levels). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { blocked } = await requireFeatureApi(FEATURE_CRYPTO_LEVELS);
  if (blocked) return blocked;
  try {
    const { slug } = await params;
    const inst = await resolveCryptoInstrument(slug);
    if (!inst) return NextResponse.json({ success: false, error: 'Unknown instrument' }, { status: 404 });
    const sp = request.nextUrl.searchParams;
    const expiry = sp.get('expiry');
    const date = sp.get('date');
    if (!expiry || !DATE.test(expiry) || (date && !DATE.test(date))) {
      return NextResponse.json({ success: false, error: 'expiry (YYYY-MM-DD) is required' }, { status: 400 });
    }
    const data = await getCryptoOiByStrike(inst.coin, inst.settlement, expiry, date);
    return NextResponse.json({ success: true, data: { slug: inst.slug, expiry, ...data } });
  } catch (error) {
    console.error('crypto oi:', error);
    return NextResponse.json({ success: false, error: 'Failed to load open interest' }, { status: 500 });
  }
}
