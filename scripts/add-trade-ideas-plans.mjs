// Create the Trade Ideas plans: Short term (SHORT_TERM), Long term (LONG_TERM) and Platinum (PLATINUM).
// Insert-only: never touches an existing row, so it is safe to re-run. Edit the feature mix afterwards at
// /admin/plans (every gate is a checkbox there), assign users from /admin/users.
//
//   node --env-file=.env.local scripts/add-trade-ideas-plans.mjs [--dry-run] [--active]
//
// Plans are created inactive (not on the public /upgrade page; admins can still assign them) unless --active.
// Options are deliberately NOT part of these definitions (no option_chain / strategy_builder / options-ideas
// feature): they are added later from /admin/plans. Option strategies can still be attached to ideas.
// docs/trade-ideas.md, "Plans".

import { neon } from '@neondatabase/serverless';

const DRY = process.argv.includes('--dry-run');
const ACTIVE = process.argv.includes('--active');

// Shared analysis tools. The mix per plan is a starting point (my choice, not a spec): see docs/trade-ideas.md.
const SHORT_TOOLS = [
  'stock_analysis', 'levels', 'scan_alerts_latest', 'scan_alerts_history', 'quadrant', 'watchlists',
  'telegram_alerts', 'us_market_scanner', 'earnings',
];
const LONG_TOOLS = [
  'stock_analysis', 'levels', 'quadrant', 'watchlists', 'oi_tracker', 'us_market_scanner', 'earnings',
];
const unique = (a) => [...new Set(a)];

const PLANS = [
  // Long-term holders only need quarterly + January expiries (same restriction as "Self learners").
  { code: 'SHORT_TERM', name: 'Short term', sort: 30, features: unique([...SHORT_TOOLS, 'ideas_short_term']) },
  { code: 'LONG_TERM', name: 'Long term', sort: 40, features: unique([...LONG_TOOLS, 'ideas_long_term', 'quarterly_expiry_only']) },
  // Platinum = both idea terms and the union of both tool sets, with no expiry restriction.
  { code: 'PLATINUM', name: 'Platinum', sort: 50, features: unique([...SHORT_TOOLS, ...LONG_TOOLS, 'ideas_short_term', 'ideas_long_term']) },
];

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — run with --env-file=.env.local');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const existing = await sql`SELECT code, name, features, sort_order, is_active FROM public.nt_plans ORDER BY sort_order, id`;
for (const p of existing) console.log(`  ${p.code} (${p.name}) active=${p.is_active} order=${p.sort_order}: ${p.features.join(', ')}`);

for (const plan of PLANS) {
  console.log(`\n${plan.code} would get: ${plan.features.join(', ')}`);
  if (existing.some(p => p.code === plan.code)) { console.log(`${plan.code} already exists — left unchanged.`); continue; }
  if (DRY) { console.log('[dry-run] nothing written'); continue; }
  const rows = await sql`
    INSERT INTO public.nt_plans (code, name, features, sort_order, is_active)
    VALUES (${plan.code}, ${plan.name}, ${JSON.stringify(plan.features)}::jsonb, ${plan.sort}, ${ACTIVE})
    ON CONFLICT (code) DO NOTHING
    RETURNING code, name, features, sort_order, is_active
  `;
  console.log('created:', rows[0] ?? 'nothing (already existed)');
}
