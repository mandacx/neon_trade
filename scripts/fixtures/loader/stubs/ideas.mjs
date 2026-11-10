// Stand-in for the unsubscribe writes in lib/ideas.ts (test-only). Records calls; the test sets the answers.
export const state = { calls: [], turnOff: async () => 'done', turnOn: async () => {} };
export async function turnOffIdeaEmails(userId) {
  state.calls.push(['turnOff', userId]);
  return state.turnOff(userId);
}
export async function turnOnIdeaEmails(userId) {
  state.calls.push(['turnOn', userId]);
  return state.turnOn(userId);
}
