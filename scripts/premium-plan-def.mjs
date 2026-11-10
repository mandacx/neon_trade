// Definition of the Premium plan (pure data, no imports, no DB) so scripts/test-premium-plan.mjs can import it.
// Both Trade Ideas terms plus a minimal "useful with ideas" tool set. docs/trade-ideas.md, "Plans and gates".
export const PREMIUM_PLAN = {
  code: 'PREMIUM',
  name: 'Premium',
  sort: 60,
  features: ['ideas_short_term', 'ideas_long_term', 'stock_analysis', 'levels', 'watchlists', 'telegram_alerts'],
};
