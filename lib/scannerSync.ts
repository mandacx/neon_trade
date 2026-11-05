/**
 * Scan-alert feed: copies new rows from the crypto project's `us_scanner` (linked as the foreign table
 * crypto.us_scanner, postgres_fdw, read-only role; scripts/bootstrap-crypto-fdw.mjs) into
 * public.intra_us_scanner_eod, the table every scan-alert reader already uses (lib/scanAlerts.ts).
 *
 * The alerts are computed once, in the crypto project's `us_alerts_intraday` job (every ~15 min); this
 * app only copies them, it never recomputes. Readers never touch the foreign table (a separate compute
 * can be cold): they call ensureScannerFresh(), which syncs at most every SYNC_EVERY_MIN minutes,
 * claimed by one conditional UPDATE on nt_scanner_sync so concurrent requests don't all sync.
 *
 * Column mapping: change -> chg; quote_time (timestamptz) -> load_dt_tm (zone-less, America/Chicago clock,
 * which is how the older rows read: loads at 08:45-14:45); scan_code is trimmed (older rows carry
 * trailing '\r\r'). trade_date is copied unchanged.
 *
 * Insert-only (ON CONFLICT DO NOTHING on the table's key): an existing row is never overwritten, so any
 * other writer to the table can't clash with this one. Whether the source updates a key in place after
 * its first insert is unverified; such later changes would not be picked up here.
 */
import { sql } from '@/lib/db';

const SYNC_EVERY_MIN = 5;

/** Copies source rows from (last copied quote_time - 1 day) on. Returns the number of new rows, or null if no sync ran. */
export async function syncScannerAlerts(force = false): Promise<number | null> {
  const claimed = force
    ? await sql`UPDATE public.nt_scanner_sync SET synced_at = now() WHERE id = 1 RETURNING 1`
    : await sql`
        UPDATE public.nt_scanner_sync SET synced_at = now()
        WHERE id = 1 AND synced_at < now() - make_interval(mins => ${SYNC_EVERY_MIN})
        RETURNING 1
      `;
  if (claimed.length === 0) return null;
  try {
    const [{ since }] = await sql`
      SELECT COALESCE((SELECT last_quote - interval '1 day' FROM public.nt_scanner_sync WHERE id = 1),
                      timestamptz '2000-01-01')::text AS since
    `;
    const [{ mx }] = await sql`
      SELECT max(quote_time)::text AS mx FROM crypto.us_scanner WHERE quote_time >= ${since}::timestamptz
    `;
    const [ins] = await sql`
      WITH up AS (
        INSERT INTO public.intra_us_scanner_eod
          (symbol, open, high, low, last_price, prvs_close, chg, expiry_dt, trade_date,
           unused_pc, unused_pc_rev, put_int, call_int, cmb_int, call_high, put_low, load_dt_tm, scan_code)
        SELECT symbol, open, high, low, last_price, prvs_close, change, expiry_dt, trade_date,
               unused_pc, unused_pc_rev, put_int, call_int, cmb_int, call_high, put_low,
               quote_time AT TIME ZONE 'America/Chicago',
               btrim(scan_code, chr(13) || chr(10) || chr(32) || chr(9))
        FROM crypto.us_scanner
        WHERE quote_time >= ${since}::timestamptz
        ON CONFLICT (symbol, expiry_dt, trade_date, scan_code) DO NOTHING
        RETURNING 1
      ) SELECT count(*)::int AS n FROM up
    `;
    await sql`
      UPDATE public.nt_scanner_sync SET
        last_quote = COALESCE(${mx}::timestamptz, last_quote), new_rows = ${ins.n}
      WHERE id = 1
    `;
    return ins.n as number;
  } catch (err) {
    console.error('scanner sync failed (serving stored rows):', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Kick a sync if one is due. A failure never reaches the reader. */
export async function ensureScannerFresh(): Promise<void> {
  await syncScannerAlerts().catch(err => console.error('scanner sync claim failed:', err));
}
