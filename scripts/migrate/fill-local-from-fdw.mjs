// One-time backfill of the market-data tables into the new project's OWN
// storage, so the app can stop reading across the postgres_fdw bridge to the
// old project.
//
// Why this exists (the state it's cleaning up):
//
//   setup-fdw-market-tables.mjs renamed the copied local tables to
//   `<table>_local_snapshot` and put postgres_fdw foreign tables pointing at
//   the OLD project under the canonical names. Queries that filter tightly
//   (by symbol, or by a specific date) push down through the bridge and stay
//   fast, so they kept using the canonical names. Queries that DISTINCT or
//   GROUP BY across the whole table do NOT push down — postgres_fdw would
//   drag the entire remote table over the wire — so those were pointed at the
//   local snapshots instead (see 11168fc, lib/db.ts and lib/scanAlerts.ts).
//
//   The snapshots were one-time cutover copies that nothing refreshes, and
//   copy-public-data.mjs did not finish for the larger tables. Result: the
//   quadrant and scan-alerts date pickers read a frozen, partial table, so
//   both pages default to a stale trade_date and look days behind while the
//   live data sits right there in the foreign table.
//
// Why it fills via the FDW rather than re-running copy-public-data.mjs:
// that script streams every row SOURCE -> Node -> TARGET, which is how it
// came to stop partway through 4.7M rows. Here the INSERT..SELECT runs
// entirely inside the target database with the bridge as the transport, so no
// row data passes through this process. Measured end-to-end on 133k rows of
// eod_usmkts_price: 20.4s in-DB (6,514 rows/s) against 26.4s for the
// download+upload route (5,044 rows/s), where the upload half alone was 23.8s
// across 134 HTTP round trips.
//
// Chunking by date range keeps each remote read pushdown-able instead of one
// unbounded scan, while staying large enough that per-chunk overhead doesn't
// dominate — see CHUNK_DAYS.
//
// Safe to re-run: every insert carries ON CONFLICT DO NOTHING against the
// table's existing unique key, so an interrupted run just needs running again.
//
// It decides what to move by comparing row COUNTS per chunk, not by checking
// which dates exist locally: the partial copies have gaps *inside* dates as
// well as whole dates missing — intra_us_scanner_eod_local_snapshot spans the
// full 2023-11-08..2026-08-31 range but holds only half the rows, so a
// date-presence check would call those chunks complete and leave the holes.
// count(*) with a range predicate pushes down to the remote (~0.2s), so the
// check is far cheaper than re-transferring a finished chunk, and it makes an
// interrupted run resume nearly for free.
//
// This does NOT flip the app over. Once the external ingestion pipeline
// writes into neon_us directly, run `finalize` (below) and revert the
// `_local_snapshot` reads in lib/db.ts + lib/scanAlerts.ts.
//
// Usage:
//   TARGET_DATABASE_URL='...neon_us...' node scripts/migrate/fill-local-from-fdw.mjs status
//   TARGET_DATABASE_URL='...neon_us...' node scripts/migrate/fill-local-from-fdw.mjs fill
//   TARGET_DATABASE_URL='...neon_us...' node scripts/migrate/fill-local-from-fdw.mjs fill eod_usmkts_price
//   TARGET_DATABASE_URL='...neon_us...' node scripts/migrate/fill-local-from-fdw.mjs finalize   # only after direct ingestion is live

import { neon } from '@neondatabase/serverless';

// Each table's date column — what we chunk the backfill by. All three are
// loaded per-day by the ingestion pipeline, so a date is the natural unit.
const TABLES = [
  { name: 'eod_usmkts_price', dateCol: 'trade_date' },
  { name: 'intra_us_scanner_eod', dateCol: 'trade_date' },
  { name: 'us_opt_chg_rpt', dateCol: 'load_dt' },
];

const subcommand = process.argv[2];
const only = process.argv[3];

if (!['status', 'fill', 'finalize'].includes(subcommand)) {
  console.error('Usage: node fill-local-from-fdw.mjs <status|fill|finalize> [table]');
  process.exit(1);
}
if (!process.env.TARGET_DATABASE_URL) {
  console.error('Set TARGET_DATABASE_URL to the new project (neon_us) connection string.');
  process.exit(1);
}

const sql = neon(process.env.TARGET_DATABASE_URL);
// Separate client for the INSERTs: the default client resolves to a bare rows
// array, so an INSERT without RETURNING would report no rowCount at all and
// the progress output would read 0 forever. fullResults gives us rowCount
// without paying for a RETURNING clause on a multi-thousand-row insert.
const sqlFull = neon(process.env.TARGET_DATABASE_URL, { fullResults: true });

const selected = only ? TABLES.filter(t => t.name === only) : TABLES;
if (selected.length === 0) {
  console.error(`Unknown table "${only}". Known: ${TABLES.map(t => t.name).join(', ')}`);
  process.exit(1);
}

const snap = name => `${name}_local_snapshot`;

// Guard against running any of this against a project where the canonical
// name is already a real table — that means finalize has happened (or the
// bridge was never set up), and "filling the snapshot" would be meaningless.
async function assertForeign(name) {
  const rows = await sql(
    `SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = $1`,
    [name]
  );
  if (rows.length === 0) throw new Error(`public.${name} does not exist`);
  if (rows[0].relkind !== 'f') {
    throw new Error(
      `public.${name} is not a foreign table (relkind=${rows[0].relkind}) — the FDW bridge is already gone, nothing to fill from`
    );
  }
}

async function span(name, dateCol) {
  const [r] = await sql(`SELECT MIN(${dateCol})::text AS min, MAX(${dateCol})::text AS max, count(*)::bigint AS n FROM public."${name}"`);
  return r;
}

async function cmdStatus() {
  for (const { name, dateCol } of selected) {
    const remote = await span(name, dateCol);
    const local = await span(snap(name), dateCol);
    console.log(`\n${name}`);
    console.log(`  remote (fdw): ${remote.min} .. ${remote.max}  ${Number(remote.n).toLocaleString()} rows`);
    console.log(`  local  (snap): ${local.min} .. ${local.max}  ${Number(local.n).toLocaleString()} rows`);
  }
}

// Half-open [from, to) windows, newest first.
//
// Newest first because the stale date pickers that motivated this only read
// the most recent ~30 trade_dates: filling backwards clears the visible
// symptom in the first chunk instead of after the whole multi-year backfill,
// and an interrupted run still leaves the app correct for recent data.
//
// CHUNK_DAYS defaults to a month because the per-chunk overhead dominates at
// day granularity — measured on eod_usmkts_price, a month moves ~7,900 rows/s
// against ~4,300 for single days. Bigger chunks mean a longer single
// statement, so drop this if a chunk ever times out; ON CONFLICT makes the
// retry free.
const CHUNK_DAYS = Number(process.env.CHUNK_DAYS || 31);

function chunksNewestFirst(minISO, maxISO) {
  const out = [];
  const minT = Date.parse(`${minISO}T00:00:00Z`);
  // +1 day so the final (newest) chunk's half-open end includes maxISO itself.
  let end = Date.parse(`${maxISO}T00:00:00Z`) + 864e5;
  while (end > minT) {
    const start = Math.max(minT, end - CHUNK_DAYS * 864e5);
    out.push([new Date(start).toISOString().slice(0, 10), new Date(end).toISOString().slice(0, 10)]);
    end = start;
  }
  return out;
}

async function cmdFill() {
  for (const { name, dateCol } of selected) {
    await assertForeign(name);

    const remote = await span(name, dateCol);

    // Chunk by date range rather than asking the foreign table for its
    // DISTINCT dates — that query is the unbounded scan this exists to avoid.
    // A range predicate pushes down to the remote just as a point lookup does.
    const chunks = chunksNewestFirst(remote.min, remote.max);

    console.log(
      `\n${name}: ${chunks.length} chunks of ${CHUNK_DAYS}d ` +
        `(${remote.min} .. ${remote.max}, newest first)`
    );

    let inserted = 0;
    let skipped = 0;
    const started = Date.now();

    for (let i = 0; i < chunks.length; i++) {
      const [from, to] = chunks[i];
      const label = `[${String(i + 1).padStart(3)}/${chunks.length}] ${from}..${to}`;

      // Compare row counts on both sides before moving anything. count(*) with
      // a range predicate is an aggregate postgres_fdw pushes down (~0.2s), so
      // this is far cheaper than re-transferring a chunk that's already
      // complete — which makes an interrupted run resume nearly for free.
      //
      // Counting beats comparing date lists: the partial copies have holes
      // *inside* dates, and a date-presence check would call those complete.
      const [[rc], [lc]] = await Promise.all([
        sql(`SELECT count(*)::int AS n FROM public."${name}" WHERE ${dateCol} >= $1 AND ${dateCol} < $2`, [from, to]),
        sql(`SELECT count(*)::int AS n FROM public."${snap(name)}" WHERE ${dateCol} >= $1 AND ${dateCol} < $2`, [from, to]),
      ]);

      if (lc.n >= rc.n) {
        skipped++;
        if (skipped % 10 === 0 || i === chunks.length - 1) {
          console.log(`  ${label}  already complete (${lc.n.toLocaleString()} rows) — ${skipped} chunks skipped so far`);
        }
        continue;
      }

      // ON CONFLICT DO NOTHING against the table's own unique key, so a
      // partially-filled chunk tops up rather than failing on duplicates.
      // Column lists match exactly (verified: identical shape), so SELECT * is
      // safe here.
      const res = await sqlFull(
        `INSERT INTO public."${snap(name)}"
         SELECT * FROM public."${name}" WHERE ${dateCol} >= $1 AND ${dateCol} < $2
         ON CONFLICT DO NOTHING`,
        [from, to]
      );
      inserted += res?.rowCount ?? 0;

      const secs = (Date.now() - started) / 1000;
      const rate = inserted > 0 ? `${Math.round(inserted / secs).toLocaleString()} rows/s` : '-';
      console.log(
        `  ${label}  local ${lc.n.toLocaleString()} -> remote ${rc.n.toLocaleString()}, ` +
          `+${(res?.rowCount ?? 0).toLocaleString()} — ${inserted.toLocaleString()} total, ${secs.toFixed(0)}s, ${rate}`
      );
    }

    const after = await span(snap(name), dateCol);
    console.log(`  done: local now ${after.min} .. ${after.max}  ${Number(after.n).toLocaleString()} rows`);
  }

  console.log('\nBackfill complete. The app still reads *_local_snapshot — run `finalize` only');
  console.log('once the ingestion pipeline writes into neon_us directly.');
}

// Swap the local copy into the canonical name and remove the bridge. Only
// valid once the external pipeline is writing into neon_us: from this point
// the old project is no longer consulted, so anything it receives afterwards
// is invisible to the app.
async function cmdFinalize() {
  console.log('This will DROP the foreign tables and rename the local copies into their place.');
  console.log('Only run it once the ingestion pipeline writes into neon_us directly.\n');

  for (const { name, dateCol } of selected) {
    await assertForeign(name);
    const remote = await span(name, dateCol);
    const local = await span(snap(name), dateCol);
    if (local.max < remote.max) {
      throw new Error(
        `${name}: local copy ends ${local.max} but the remote has data through ${remote.max} — run \`fill\` first, refusing to drop the bridge and lose those rows`
      );
    }
    // Matching end dates aren't enough: the partial copies had holes inside
    // dates too, so compare totals as well before throwing the bridge away.
    if (BigInt(local.n) < BigInt(remote.n)) {
      throw new Error(
        `${name}: local copy has ${Number(local.n).toLocaleString()} rows vs the remote's ${Number(remote.n).toLocaleString()} — ` +
          `run \`fill\` first, refusing to drop the bridge with rows still missing`
      );
    }
  }

  for (const { name } of selected) {
    // Foreign table and local copy can't both hold the canonical name, so the
    // drop and the rename have to be one transaction — a failure between them
    // would leave the app with no table at all under that name.
    await sql(`BEGIN`);
    try {
      await sql(`DROP FOREIGN TABLE public."${name}"`);
      await sql(`ALTER TABLE public."${snap(name)}" RENAME TO "${name}"`);
      await sql(`COMMIT`);
      console.log(`  ${name}: bridge dropped, local copy renamed into place`);
    } catch (err) {
      await sql(`ROLLBACK`);
      throw err;
    }
  }

  console.log('\nStill to do by hand:');
  console.log('  1. Revert the *_local_snapshot reads in lib/db.ts and lib/scanAlerts.ts to the canonical names.');
  console.log('  2. Drop the now-unused FDW plumbing: DROP SERVER ... CASCADE, and the user mapping.');
  console.log('  3. Re-check the index list on the renamed tables — index NAMES survive a rename, so they');
  console.log('     still read *_local_snapshot even though the table no longer does.');
}

const handlers = { status: cmdStatus, fill: cmdFill, finalize: cmdFinalize };
handlers[subcommand]().catch(err => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
