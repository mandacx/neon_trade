/**
 * Server side of the provisional live mark (docs/trade-ideas.md, "Live mark"). Server-only: it reads the market
 * data facade. The maths is in lib/ideaLiveMath.ts (pure). Nothing here writes to the database.
 *
 * Callers must already have read the idea through the gated SQL (getIdeaForLive), so a gated idea never gets here.
 * One snapshot request and one market-state read serve the whole batch.
 */
import { getSnapshotsMulti } from '@/lib/marketdata';
import { getMarketState, type MarketSession } from '@/lib/marketSession';
import { buildQuote } from '@/lib/quote';
import { liveMark, type LiveMark, type LiveOfficial, type LivePlan } from '@/lib/ideaLiveMath';

export interface LiveInput { id: string; symbol: string; plan: LivePlan; official: LiveOfficial | null }

export interface LiveBlock {
  mark: LiveMark;
  /** Regular session = 'live'; otherwise the last regular close; null when no price. */
  basis: 'live' | 'last_close' | null;
  session: MarketSession;
  /** ISO server read time (the feed can lag a few seconds; cached up to 5 s, up to 120 s after a rate-limit pause). */
  asOf: string;
  /** The regular-session day change at `price` (display only, never used in R); null when unknown. */
  day: { change: number | null; changePercent: number | null };
  /** Pre-market / after-hours move, display only, never used in R. */
  ext: { label: string; price: number; changePercent: number | null } | null;
}

export async function liveBlocksFor(
  ideas: LiveInput[],
): Promise<{ blocks: Map<string, LiveBlock>; market: { session: MarketSession; nextChangeAt: string | null } }> {
  const symbols = [...new Set(ideas.map(i => i.symbol.toUpperCase()))];
  const [snapsRes, state] = await Promise.all([
    symbols.length ? getSnapshotsMulti(symbols).catch(() => null) : Promise.resolve(null),
    getMarketState(),
  ]);
  const snaps: Record<string, any> = {};
  if (snapsRes) for (const [sym, s] of Object.entries(snapsRes)) snaps[sym.toUpperCase()] = s;

  const asOf = new Date().toISOString();
  const blocks = new Map<string, LiveBlock>();
  for (const idea of ideas) {
    const q = buildQuote(snaps[idea.symbol.toUpperCase()], state);
    const price = typeof q.price === 'number' && q.price > 0 ? q.price : null;
    const mark = liveMark(idea.plan, idea.official, price, { high: q.dayHigh, low: q.dayLow, date: state.lastSessionDate });
    blocks.set(idea.id, {
      mark,
      basis: price == null ? null : state.session === 'regular' ? 'live' : 'last_close',
      session: state.session,
      asOf,
      day: { change: q.change, changePercent: q.changePercent },
      ext: q.ext ? { label: q.ext.label, price: q.ext.price, changePercent: q.ext.changePercent } : null,
    });
  }
  return { blocks, market: { session: state.session, nextChangeAt: state.nextChangeAt } };
}
