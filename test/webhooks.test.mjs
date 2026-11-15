import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyWebhook, signWebhookPayload, computeSignature, WebhookVerificationError } from '../dist/esm/index.js';

// Vector computed with HelpRange's server code (plus/webhooks.sign): HMAC-SHA256("whsec_test_secret", "<t>.<body>").
const BODY = '{"id":"evt_1","event":"document.opened","api_version":"2026-11-15","created_at":"2026-11-15T09:12:03Z","data":{"file_id":123}}';
const T = 1763197923;
const SIG = 'b27214711a29d4f299074d7cb70ccd777783a9cec2bf0da880a4cf8f8d5f3867';
const SECRET = 'whsec_test_secret';

test('matches the server signature', () => {
  assert.equal(computeSignature(BODY, SECRET, T), SIG);
  const event = verifyWebhook(BODY, { 'HelpRange-Signature': `t=${T},v1=${SIG}` }, SECRET, { now: T + 10 });
  assert.equal(event.id, 'evt_1');
  assert.equal(event.data.file_id, 123);
});

test('accepts Buffers, Headers objects and rotated secrets', () => {
  const header = `t=${T},v1=${computeSignature(BODY, 'whsec_new', T)},v1=${SIG}`;
  const ev = verifyWebhook(Buffer.from(BODY), new Headers({ 'helprange-signature': header }), SECRET, { now: T });
  assert.equal(ev.event, 'document.opened');
  verifyWebhook(BODY, { 'helprange-signature': header }, ['whsec_other', 'whsec_new'], { now: T });
});

test('rejects bad signatures, stale timestamps and missing headers', () => {
  const now = { now: T };
  assert.throws(() => verifyWebhook(BODY, {}, SECRET, now), WebhookVerificationError);
  assert.throws(() => verifyWebhook(BODY, { 'helprange-signature': `v1=${SIG}` }, SECRET, now), WebhookVerificationError);
  assert.throws(() => verifyWebhook(BODY, { 'helprange-signature': `t=${T},v1=${SIG}` }, 'whsec_wrong', now), WebhookVerificationError);
  assert.throws(() => verifyWebhook(BODY + ' ', { 'helprange-signature': `t=${T},v1=${SIG}` }, SECRET, now), WebhookVerificationError);
  assert.throws(() => verifyWebhook(BODY, { 'helprange-signature': `t=${T},v1=${SIG}` }, SECRET, { now: T + 301 }), /tolerance/);
  verifyWebhook(BODY, { 'helprange-signature': `t=${T},v1=${SIG}` }, SECRET, { now: T + 301, tolerance: 600 });
});

test('signWebhookPayload round-trips', () => {
  const header = signWebhookPayload(BODY, SECRET);
  assert.equal(verifyWebhook(BODY, { 'HelpRange-Signature': header }, SECRET).id, 'evt_1');
});
