// Create the Premium plan (PREMIUM): both Trade Ideas terms, no expiry restriction, plus charts, levels,
// watchlists and Telegram alerts. Insert-only: never updates or deletes an existing row, safe to re-run.
// Edit the feature mix afterwards at /admin/plans, assign users from /admin/users.
//
//   node --env-file=.env.local scripts/add-premium-plan.mjs [--dry-run] [--active]
//
// Created inactive (not on the public /upgrade page; admins can still assign it) unless --active.
// docs/trade-ideas.md, "Plans and gates".

import { neon } from '@neondatabase/serverless';
import { PREMIUM_PLAN as plan } from './premium-plan-def.mjs';

const DRY = process.argv.includes('--dry-run');
const ACTIVE = process.argv.includes('--active');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — run with --env-file=.env.local');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const existing = await sql`SELECT code, name, features, sort_order, is_active FROM public.nt_plans ORDER BY sort_order, id`;
for (const p of existing) console.log(`  ${p.code} (${p.name}) active=${p.is_active} order=${p.sort_order}: ${p.features.join(', ')}`);

console.log(`\n${plan.code} would get: ${plan.features.join(', ')} (sort ${plan.sort}, active=${ACTIVE})`);
if (existing.some(p => p.code === plan.code)) {
  console.log(`${plan.code} already exists — left unchanged.`);
} else if (DRY) {
  console.log('[dry-run] nothing written');
} else {
  const rows = await sql`
    INSERT INTO public.nt_plans (code, name, features, sort_order, is_active)
    VALUES (${plan.code}, ${plan.name}, ${JSON.stringify(plan.features)}::jsonb, ${plan.sort}, ${ACTIVE})
    ON CONFLICT (code) DO NOTHING
    RETURNING code, name, features, sort_order, is_active
  `;
  console.log('created:', rows[0] ?? 'nothing (already existed)');
}
