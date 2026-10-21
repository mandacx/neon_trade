// Refresh public.securities market caps and tiers, and add symbols that have
// price data but no securities row (they are invisible to every cap/sector filter).
//
//   node --env-file=.env.local scripts/refresh-securities.mjs           # dry run
//   node --env-file=.env.local scripts/refresh-securities.mjs --apply   # write
//
// Needs Python with yfinance (pip install yfinance). Market caps come from
// Yahoo via scripts/fetch-market-caps.py.
//
// What it does:
//   - symbols = every securities row + every symbol on the latest EOD load
//   - existing rows: update market_cap and market_cap_tier when Yahoo has a cap
//   - missing rows: insert (name, sector, industry, exchange, currency, cap, tier)
//   - ETFs/indices without a cap keep a NULL tier
// public.securities is shared with neon_nifty (the loader there owns it), so
// this never deletes and never touches indices / weights / earnings columns.
//
// Tier cutoffs (USD). Checked against the existing data (mega min $202B, large
// $10B-$197B, mid $2.1B-$10B, small min $0.5B, micro $0.25B) but the loader's
// own rule was not seen: small/micro/nano boundaries are the usual convention.

import { neon } from '@neondatabase/serverless';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — run with --env-file=.env.local');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sql = neon(process.env.DATABASE_URL);

const TIERS = [
  ['mega', 200e9],
  ['large', 10e9],
  ['mid', 2e9],
  ['small', 300e6],
  ['micro', 50e6],
];
const tierOf = (cap) => (cap > 0 ? (TIERS.find(([, min]) => cap >= min)?.[0] ?? 'nano') : null);

const existing = await sql`SELECT symbol, market_cap, market_cap_tier FROM public.securities`;
const missing = await sql`
  SELECT DISTINCT symbol FROM public.eod_usmkts_price
  WHERE trade_date = (SELECT max(trade_date) FROM public.eod_usmkts_price)
    AND symbol NOT IN (SELECT symbol FROM public.securities)`;
const have = new Map(existing.map((r) => [r.symbol, r]));
const symbols = [...have.keys(), ...missing.map((r) => r.symbol)];
console.log(`${have.size} existing + ${missing.length} missing symbols`);

const dir = mkdtempSync(join(tmpdir(), 'secrefresh-'));
writeFileSync(join(dir, 'symbols.txt'), symbols.join('\n'));
const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
execFileSync('python', ['-I', join(here, 'fetch-market-caps.py'), join(dir, 'symbols.txt'), join(dir, 'out.json')], { stdio: 'inherit' });
const fetched = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));

const changes = { tierChanged: [], capOnly: 0, inserted: [], noCap: [], failed: [] };
for (const sym of symbols) {
  const y = fetched[sym];
  const cap = y && !y.error && y.marketCap > 0 ? Math.round(y.marketCap) : null;
  const old = have.get(sym);
  if (y?.error) changes.failed.push(sym);
  if (old) {
    if (!cap) { if (!old.market_cap_tier) changes.noCap.push(sym); continue; }
    const tier = tierOf(cap);
    if (tier !== old.market_cap_tier) changes.tierChanged.push(`${sym} ${old.market_cap_tier ?? 'null'} -> ${tier} ($${(cap / 1e9).toFixed(1)}B)`);
    else changes.capOnly++;
    if (apply) await sql`UPDATE public.securities SET market_cap = ${cap}, market_cap_tier = ${tier}, last_refreshed = now() WHERE symbol = ${sym}`;
  } else {
    if (!y || y.error) continue;
    const tier = cap ? tierOf(cap) : null;
    changes.inserted.push(`${sym} ${y.name ?? '?'} ${tier ?? 'no tier'}${cap ? ` ($${(cap / 1e9).toFixed(1)}B)` : ''}`);
    if (apply) {
      await sql`
        INSERT INTO public.securities (id, market_id, symbol, name, sector, industry, market_cap, market_cap_tier, exchange, currency, source, last_refreshed)
        VALUES (${randomUUID()}, 1, ${sym}, ${y.name}, ${y.sector}, ${y.industry}, ${cap}, ${tier}, ${y.exchange}, ${y.currency}, 'yfinance', now())`;
    }
  }
}

console.log(`\n${apply ? 'APPLIED' : 'DRY RUN (no writes)'}`);
console.log(`tier changes (${changes.tierChanged.length}):`); changes.tierChanged.forEach((l) => console.log('  ' + l));
console.log(`cap refreshed, tier unchanged: ${changes.capOnly}`);
console.log(`new rows (${changes.inserted.length}):`); changes.inserted.forEach((l) => console.log('  ' + l));
console.log(`existing rows still without a cap/tier (${changes.noCap.length}): ${changes.noCap.join(', ')}`);
console.log(`Yahoo errors (${changes.failed.length}): ${changes.failed.join(', ')}`);
