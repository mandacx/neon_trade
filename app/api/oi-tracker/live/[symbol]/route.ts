import { NextRequest, NextResponse } from 'next/server';
import { guardOi, serverError } from '@/lib/oiTrackerApi';
import { isStandardExpiry, standardExpiryOnly } from '@/lib/expiryAccess';
import { getOptionChainSnapshots } from '@/lib/marketdata';
import { etDateOf } from '@/lib/marketSession';
import { parseOcc } from '@/lib/occ';
import { toLive, topBySessionVolume, type LiveOption } from '@/lib/oiLive';

export const dynamic = 'force-dynamic';

const TOP = 200;
// One load is 1–6 upstream requests of ≤1,000 contracts (measured 2026-10-28: KO 2, AAPL 4,
// TSLA/SPY 6 with SPY at the 6-page cap; 0.3–1.6 s, 0.5–3.2 MB). Shared per symbol for 30 s.
const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; all: LiveOption[] }>();

/**
 * Live option volume for one underlying: the contracts with the most volume in the latest
 * session (bars from older sessions are not ranked), from the live chain (every unexpired expiry). The stock page's Open Interest tab
 * reads it only when its "Live volume" view is opened, and again only on Refresh. Same gate
 * and rate limit as the rest of the OI tracker (feature `oi_tracker`); weekly expiries are
 * dropped for plans limited to monthly/quarterly ones. Vendor-neutral response.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { ctx, blocked } = await guardOi(true);
  if (blocked) return blocked;
  const symbol = (await params).symbol.toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return NextResponse.json({ success: false, error: 'Invalid symbol' }, { status: 400 });

  try {
    let hit = cache.get(symbol);
    if (!hit || Date.now() - hit.at > CACHE_MS) {
      const chain = await getOptionChainSnapshots(symbol, { expiryFrom: etDateOf(Date.now()), maxPages: 6 });
      hit = { at: Date.now(), all: Object.keys(chain).map(k => toLive(k, chain[k])) };
      if (cache.size > 200) cache.clear();
      if (hit.all.length) cache.set(symbol, hit);
    }
    const stdOnly = standardExpiryOnly(ctx.features);
    const all = hit.all.filter(o => { const p = parseOcc(o.contract); return !!p && (!stdOnly || isStandardExpiry(p.expiry)); });
    const { top, session, stale } = topBySessionVolume(all, TOP);
    return NextResponse.json({
      success: true,
      data: { symbol, asOf: new Date(hit.at).toISOString(), count: all.length, session, stale, top },
    });
  } catch (error) {
    return serverError('live', error);
  }
}
