// One-time DDL + seed for the auth-adjacent app tables (plans, per-user app
// profile, watchlists, Telegram linking/delivery). Run once:
//
//   node --env-file=.env.local scripts/bootstrap-app-tables.mjs
//
// Safe to re-run: every statement is idempotent (IF NOT EXISTS / ON CONFLICT).
//
// Neon Auth (managed Better Auth) owns its own user/session tables in this
// same Neon project — this script never touches those, only tables this app
// owns. `plans.features` is the actual source of truth for plan gating;
// re-run this script (or hand-edit the row via /admin/plans) to change
// entitlements — no redeploy needed. Feature codes here must stay in sync
// with lib/features.ts.

import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Run with: node --env-file=.env.local scripts/bootstrap-app-tables.mjs');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// `plans.features` is edited live from /admin/plans, so this seed only INSERTs
// by default and never overwrites an existing row's features. Pass
// --force-reseed to deliberately reset them.
const FORCE_RESEED = process.argv.includes('--force-reseed');

// Single asset class (US stocks) — just two tiers, unlike neon_nifty's
// Index/Stocks-sold-separately model.
const FREE_FEATURES = ['stock_analysis'];
const PRO_FEATURES = [
  'stock_analysis', 'levels', 'scan_alerts_latest', 'scan_alerts_history',
  'quadrant', 'watchlists', 'performance', 'telegram_alerts',
];

async function main() {
  console.log('Creating tables...');

  await sql`
    CREATE TABLE IF NOT EXISTS public.plans (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      features JSONB NOT NULL DEFAULT '[]',
      sort_order INT NOT NULL DEFAULT 100,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS public.app_user_profiles (
      user_id TEXT PRIMARY KEY,
      plan_id INTEGER NOT NULL REFERENCES public.plans(id),
      plan_expires_at TIMESTAMPTZ,
      billing_provider TEXT,
      billing_customer_id TEXT,
      billing_subscription_id TEXT,
      telegram_chat_id TEXT,
      telegram_linked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Admin status is NOT tracked here — Neon Auth's own neon_auth.user.role
  // ('user' | 'admin') is the single source of truth.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS app_user_profiles_telegram_chat_id_uq
      ON public.app_user_profiles (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL
  `;

  // Per-user feature overrides — grant or revoke an individual feature code
  // beyond what the user's plan would otherwise give them.
  await sql`
    CREATE TABLE IF NOT EXISTS public.user_feature_overrides (
      user_id TEXT NOT NULL,
      feature TEXT NOT NULL,
      granted BOOLEAN NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by TEXT,
      PRIMARY KEY (user_id, feature)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
      bucket TEXT NOT NULL,
      window_start TIMESTAMPTZ NOT NULL,
      hits INT NOT NULL DEFAULT 0,
      PRIMARY KEY (bucket, window_start)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS public.watchlists (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, name)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS public.watchlist_items (
      watchlist_id BIGINT NOT NULL REFERENCES public.watchlists(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (watchlist_id, symbol)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS public.telegram_alert_subscriptions (
      user_id TEXT PRIMARY KEY,
      watchlist_id TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS public.telegram_alert_cursors (
      user_id TEXT PRIMARY KEY,
      last_alert_time TIMESTAMPTZ,
      consecutive_failures INT NOT NULL DEFAULT 0,
      disabled_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  console.log(FORCE_RESEED ? 'Seeding plans (--force-reseed: OVERWRITING features)...' : 'Seeding plans (insert-only)...');
  for (const [code, name, features, sortOrder] of [
    ['FREE', 'Free', FREE_FEATURES, 0],
    ['PRO', 'Pro', PRO_FEATURES, 10],
  ]) {
    const featuresJson = JSON.stringify(features);
    if (FORCE_RESEED) {
      await sql`
        INSERT INTO public.plans (code, name, features, sort_order)
        VALUES (${code}, ${name}, ${featuresJson}::jsonb, ${sortOrder})
        ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name, features = EXCLUDED.features, sort_order = EXCLUDED.sort_order
      `;
    } else {
      // Keep the live features (admin-editable) but let name/ordering catch up.
      await sql`
        INSERT INTO public.plans (code, name, features, sort_order)
        VALUES (${code}, ${name}, ${featuresJson}::jsonb, ${sortOrder})
        ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name, sort_order = EXCLUDED.sort_order
      `;
    }
    console.log(`  ${code}: ${features.join(', ')}`);
  }

  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
