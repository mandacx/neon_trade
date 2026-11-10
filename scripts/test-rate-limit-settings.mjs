// Offline fixture: the admin rate-limit view keeps saved values when a limiter was added after the save.
// Settings store stubbed (scripts/fixtures/loader); no database.
//   node scripts/test-rate-limit-settings.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';
register(new URL('./fixtures/loader/hooks.mjs', import.meta.url));
const cfg = await import('../lib/rateLimitConfig.ts');
const { LIMITERS, defaultRateLimits, validateRateLimits } = cfg;

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; };
const row = value => { globalThis.__TEST_SETTING = { value, updatedAt: '2026-11-01T00:00:00Z', updatedBy: 'admin' }; };
const NEW = 'email_unsubscribe';
const oldSaved = () => {
  const v = defaultRateLimits();
  delete v[NEW];
  const first = LIMITERS.find(l => l.name !== NEW);
  v[first.name] = { standard: first.standard + 1, entitled: first.entitled === null ? null : first.entitled + 1 };
  return { v, first };
};

await t('saved config lacking the new limiter keeps saved values and defaults the new one', async () => {
  const { v, first } = oldSaved();
  row(v);
  const view = await cfg.getRateLimitSettings();
  const f = view.limiters.find(l => l.name === first.name);
  assert.equal(f.current.standard, v[first.name].standard);
  assert.equal(f.isCustom, true);
  const n = view.limiters.find(l => l.name === NEW);
  const def = LIMITERS.find(l => l.name === NEW);
  assert.deepEqual(n.current, { standard: def.standard, entitled: def.entitled });
  assert.equal(n.isCustom, false);
  assert.equal(view.updatedBy, 'admin');
});

await t('invalid saved values are still rejected (defaults shown)', async () => {
  const { v, first } = oldSaved();
  v[first.name] = { standard: -5, entitled: null };
  row(v);
  const view = await cfg.getRateLimitSettings();
  assert.ok(view.limiters.every(l => !l.isCustom));
  assert.equal(view.updatedAt, null);
});

await t('a limiter removed from code is ignored, as at runtime (saved values kept)', async () => {
  const { v } = oldSaved();
  v.bogus = { standard: 5, entitled: null };
  row(v);
  const view = await cfg.getRateLimitSettings();
  assert.equal(view.limiters.some(l => l.name === 'bogus'), false);
  assert.equal(view.limiters.find(l => l.isCustom)?.name, oldSaved().first.name);
});

await t('no saved row gives defaults; strict validation of the admin save path is unchanged', async () => {
  globalThis.__TEST_SETTING = null;
  const view = await cfg.getRateLimitSettings();
  assert.ok(view.limiters.every(l => !l.isCustom));
  const { v } = oldSaved();
  assert.equal(validateRateLimits(v).ok, false, 'direct save without the new limiter is still invalid');
});

await t('runtime loadRateLimits result is unchanged: saved values kept, new limiter default', async () => {
  const { v, first } = oldSaved();
  row(v);
  cfg.clearRateLimitCache();
  const vals = await cfg.loadRateLimits();
  assert.equal(vals[first.name].standard, v[first.name].standard);
  const def = LIMITERS.find(l => l.name === NEW);
  assert.equal(vals[NEW].standard, def.standard);
});

console.log(`rate-limit settings: ${passed} tests passed (offline; settings store stubbed)`);
