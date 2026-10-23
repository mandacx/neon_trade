/**
 * Option volume capture for the OI tracker (docs/oi-tracker.md).
 *
 * us_opt_chg_rpt has OI and OI change but no volume. The OI change on load
 * date D reflects the trading of the session before D (verified on WMT and
 * SPXW contracts: OI change ≈ the previous session's volume), so for every
 * contract in load D this stores that previous session's daily bar from
 * the market-data feed in nt_opt_daily_bars. Contracts it has no bar for get a
 * `no_trade` row so they are not asked for again.
 *
 * Runs from /api/cron/market-catalog (weekday mornings, after the load lands)
 * and from scripts/backfill-option-volume.mjs for history. Resumable: each
 * run only fetches contracts that have no row yet, and stops at `deadline`.
 */
import { sql } from '@/lib/db';
import { catalogTradeDates } from '@/lib/marketCatalog';
import { previousTradingDay } from '@/lib/marketSession';
import { getOptionBarsMulti } from '@/lib/marketdata';
import { acquireLease, releaseLease } from '@/lib/jobLease';
import { occSql } from '@/lib/oiTracker';

const LEASE = 'oi_volume';
const BATCH = 1200;

export interface OptionVolumeCaptureResult {
  loadDate: string | null;
  session: string | null;
  pendingBefore?: number;
  stored?: number;
  noTrade?: number;
  failed?: number;
  done?: boolean;
  skipped?: string;
}

async function latestLoadDate(): Promise<string | null> {
  const [d] = await catalogTradeDates('opt_chg', 1, async () => {
    const rows = await sql`SELECT MAX(load_dt)::text AS d FROM public.us_opt_chg_rpt`;
    return rows[0]?.d ? [rows[0].d as string] : [];
  });
  return d ?? null;
}

// Contract key: the OCC symbol, derived when the report row has none (see occSql).
const PENDING_SQL = (select: string, limit: string) => `
  SELECT ${select}
  FROM public.us_opt_chg_rpt r
  WHERE r.load_dt = $1::date
    AND NOT EXISTS (
      SELECT 1 FROM public.nt_opt_daily_bars b WHERE b.contract = ${occSql('r')} AND b.bar_date = $2::date
    )
  ${limit}`;

async function pendingContracts(loadDate: string, session: string, limit: number): Promise<string[]> {
  const rows = await sql(PENDING_SQL(`DISTINCT ${occSql('r')} AS contract`, `LIMIT ${Math.floor(limit)}`), [loadDate, session]);
  return rows.map((r: any) => r.contract as string);
}

async function countPending(loadDate: string, session: string): Promise<number> {
  const rows = await sql(PENDING_SQL(`COUNT(DISTINCT ${occSql('r')})::int AS n`, ''), [loadDate, session]);
  return rows[0]?.n ?? 0;
}

/** Capture the pre-load session's bars for one load date (the latest by default). */
export async function captureOptionBars(opts: { deadline: number; loadDate?: string; useLease?: boolean }): Promise<OptionVolumeCaptureResult> {
  const useLease = opts.useLease ?? true;
  if (useLease && !(await acquireLease(LEASE, Math.max(10, Math.ceil((opts.deadline - Date.now()) / 1000) + 5)))) {
    return { loadDate: null, session: null, skipped: 'another run holds the lease' };
  }
  try {
    const loadDate = opts.loadDate ?? (await latestLoadDate());
    if (!loadDate) return { loadDate: null, session: null, skipped: 'no option load found' };
    const session = await previousTradingDay(loadDate);
    if (!session) return { loadDate, session: null, skipped: 'no previous trading day' };

    const pendingBefore = await countPending(loadDate, session);
    let stored = 0;
    let noTrade = 0;
    let failed = 0;
    let done = pendingBefore === 0;

    while (!done && Date.now() < opts.deadline - 8_000) {
      const contracts = await pendingContracts(loadDate, session, BATCH);
      if (contracts.length === 0) { done = true; break; }
      const { bars, failed: failedSyms } = await getOptionBarsMulti(contracts, session, session, '1Day', 6);
      const failedSet = new Set(failedSyms);
      failed += failedSet.size;

      const rows: Array<{ contract: string; o: number | null; h: number | null; l: number | null; c: number | null; v: number; vw: number | null; n: number | null; noTrade: boolean }> = [];
      for (const contract of contracts) {
        if (failedSet.has(contract)) continue;
        const bar = (bars[contract] ?? []).find(b => b.t.slice(0, 10) === session);
        if (bar) rows.push({ contract, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v, vw: bar.vw ?? null, n: bar.n ?? null, noTrade: false });
        else rows.push({ contract, o: null, h: null, l: null, c: null, v: 0, vw: null, n: null, noTrade: true });
      }
      if (rows.length > 0) {
        await sql`
          INSERT INTO public.nt_opt_daily_bars (contract, bar_date, o, h, l, c, v, vw, n, no_trade)
          SELECT u.contract, ${session}::date, u.o, u.h, u.l, u.c, u.v, u.vw, u.n, u.no_trade
          FROM unnest(
            ${rows.map(r => r.contract)}::text[], ${rows.map(r => r.o)}::numeric[], ${rows.map(r => r.h)}::numeric[],
            ${rows.map(r => r.l)}::numeric[], ${rows.map(r => r.c)}::numeric[], ${rows.map(r => r.v)}::bigint[],
            ${rows.map(r => r.vw)}::numeric[], ${rows.map(r => r.n)}::int[], ${rows.map(r => r.noTrade)}::boolean[]
          ) AS u(contract, o, h, l, c, v, vw, n, no_trade)
          ON CONFLICT (contract, bar_date) DO UPDATE SET
            o = EXCLUDED.o, h = EXCLUDED.h, l = EXCLUDED.l, c = EXCLUDED.c, v = EXCLUDED.v,
            vw = EXCLUDED.vw, n = EXCLUDED.n, no_trade = EXCLUDED.no_trade, fetched_at = now()
        `;
      }
      stored += rows.filter(r => !r.noTrade).length;
      noTrade += rows.filter(r => r.noTrade).length;
      // Every contract in the batch failed: the feed is down or refusing; stop rather than spin.
      if (rows.length === 0) break;
    }
    return { loadDate, session, pendingBefore, stored, noTrade, failed, done };
  } finally {
    if (useLease) await releaseLease(LEASE);
  }
}
