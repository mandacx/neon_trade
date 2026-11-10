// In-memory stand-in for lib/db.ts (test-only). Every query is recorded; the test decides the rows.
export const state = { calls: [], handler: () => [] };
export async function sql(...args) {
  state.calls.push(args);
  return state.handler(...args);
}
