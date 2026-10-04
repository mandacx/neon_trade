import { NextRequest, NextResponse } from 'next/server';
import { searchLocal, searchRemote, type SymbolSearchResult } from '@/lib/symbolSearch';

/**
 * Stock search by ticker or company name (lib/symbolSearch.ts).
 *
 *   scope=local   our own symbols + names — in-memory, sub-millisecond
 *   scope=remote  Tradier name/ticker search for symbols we don't track
 *   (default)     both, merged — local first
 *
 * The search inputs call local and remote as two requests, so the dropdown
 * shows our results immediately and appends Tradier's when they arrive.
 * Results are the same for every visitor, so they're CDN-cached.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = (searchParams.get('q') ?? '').trim().slice(0, 64);
  const scope = searchParams.get('scope');

  if (!query) {
    return NextResponse.json({ success: false, error: 'Query parameter is required' }, { status: 400 });
  }

  try {
    const [local, remote] = await Promise.all([
      scope === 'remote' ? Promise.resolve([] as SymbolSearchResult[]) : searchLocal(query),
      scope === 'local' ? Promise.resolve([] as SymbolSearchResult[]) : searchRemote(query),
    ]);
    const seen = new Set(local.map(r => r.symbol));
    const results = [...local, ...remote.filter(r => !seen.has(r.symbol))].slice(0, 20);

    return NextResponse.json(
      { success: true, data: { results } },
      // Local results follow our daily data; Tradier's barely change.
      { headers: { 'Cache-Control': `public, s-maxage=${scope === 'local' ? 3600 : 86400}, stale-while-revalidate=86400` } }
    );
  } catch (error) {
    console.error('Error in stock search:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to search stocks', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
