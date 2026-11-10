// Stand-in for lib/appSettings.ts (test-only): no saved settings, so the rate-limit defaults apply.
// A test can set globalThis.__TEST_SETTING = { value, updatedAt, updatedBy } to simulate a saved row.
export async function getSetting() { return globalThis.__TEST_SETTING ?? null; }
export async function setSetting() {}
export async function deleteSetting() {}
