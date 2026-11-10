// Offline check of the web-push plumbing used by lib/ideaChannels.ts: generates a throwaway VAPID pair and a throwaway
// browser subscription key pair, then builds the encrypted push request. Nothing is sent over the network.
//
//   node scripts/test-idea-push.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { generateRequestDetails, generateVAPIDKeys, setVapidDetails } from 'web-push';
import { buildPush, pushUrgency } from '../lib/ideaMessages.ts';

const vapid = generateVAPIDKeys();
setVapidDetails('mailto:test@example.com', vapid.publicKey, vapid.privateKey);

const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const sub = {
  endpoint: 'https://push.example.test/send/abc123',
  keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
};
const payload = JSON.stringify(buildPush({ eventId: 9, ideaId: 7, eventType: 'published', eventKey: 'published', summary: 'New idea: AAPL long, breakout.', idea: null, facts: null, today: '2026-11-10' }));
const req = generateRequestDetails(sub, payload, { TTL: 3600, urgency: 'normal' });

assert.equal(req.method, 'POST');
assert.equal(req.endpoint, sub.endpoint);
assert.equal(req.headers['Content-Encoding'], 'aes128gcm');
assert.match(req.headers.Authorization, /^vapid t=.+, k=.+$/);
assert.ok(Buffer.isBuffer(req.body) && req.body.length > payload.length, 'body is encrypted and padded');
assert.ok(!req.body.toString('utf8').includes('AAPL'), 'payload is not in clear text');
const hi = generateRequestDetails(sub, payload, { TTL: 3600, urgency: pushUrgency('stopped') });
assert.equal(hi.headers.Urgency, 'high');
const lo = generateRequestDetails(sub, payload, { TTL: 3600, urgency: pushUrgency('note') });
assert.equal(lo.headers.Urgency, 'normal');
console.log('push: request building ok (aes128gcm, VAPID header, encrypted body)');
