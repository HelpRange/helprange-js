import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HelpRange, ConflictError, IdempotencyKeyInProgressError, IdempotencyKeyReusedError, UnprocessableEntityError,
  InternalServerError, APIConnectionError, IN_PROGRESS_MAX_RETRIES, uuid4,
} from '../dist/esm/index.js';
import { mockFetch } from './helpers.mjs';

const KEY = 'hr_live_' + 'x'.repeat(40);
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NOW = { 'retry-after': '0' };

test('uuid4 makes RFC 4122 v4 ids', () => {
  const ids = new Set(Array.from({ length: 50 }, () => uuid4()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, UUID4);
});

test('every POST / PATCH gets a fresh UUID v4 Idempotency-Key; GET none', async () => {
  const fetch = mockFetch({ status: 201, body: { id: 1 } }, { status: 201, body: { id: 2 } }, { body: {} }, { body: {} });
  const hr = new HelpRange({ apiKey: KEY, fetch });
  await hr.dataRooms.create({ name: 'A' });
  await hr.dataRooms.create({ name: 'B' });
  await hr.offers.update('o1', { title: 'x' });
  await hr.dataRooms.list();
  const [a, b, patch, get] = fetch.calls.map((c) => c.headers.get('idempotency-key'));
  assert.match(a, UUID4);
  assert.match(b, UUID4);
  assert.notEqual(a, b);
  assert.equal(fetch.calls[2].init.method, 'PATCH');
  assert.match(patch, UUID4);
  assert.equal(get, null);
});

test('options.idempotencyKey (or an Idempotency-Key header) overrides the generated key', async () => {
  const fetch = mockFetch({ status: 201, body: {} }, { status: 201, body: {} });
  const hr = new HelpRange({ apiKey: KEY, fetch });
  await hr.dataRooms.guests.invite(10, { email: 'jane@example.com' }, { idempotencyKey: 'invite-10-jane' });
  await hr.dataRooms.guests.invite(10, { email: 'jane@example.com' }, { headers: { 'idempotency-key': 'mine' } });
  assert.equal(fetch.calls[0].headers.get('idempotency-key'), 'invite-10-jane');
  assert.equal(fetch.calls[1].headers.get('idempotency-key'), 'mine');
});

test('POST is retried on 5xx with the same key', async () => {
  const fetch = mockFetch(
    { status: 502, body: { error: 'Bad gateway' }, headers: NOW },
    { status: 503, body: 'down', headers: { ...NOW, 'content-type': 'text/plain' } },
    { status: 201, body: { id: 42, name: 'Falcon' }, headers: { 'idempotent-replayed': 'true' } },
  );
  const room = await new HelpRange({ apiKey: KEY, fetch }).dataRooms.create({ name: 'Falcon' });
  assert.equal(room.id, 42);
  assert.equal(fetch.calls.length, 3);
  const keys = fetch.calls.map((c) => c.headers.get('idempotency-key'));
  assert.match(keys[0], UUID4);
  assert.deepEqual(new Set(keys).size, 1);
  for (const c of fetch.calls) assert.deepEqual(JSON.parse(c.init.body), { name: 'Falcon' });
});

test('POST is retried on connection errors with the same key, until maxRetries', async () => {
  const ok = mockFetch(new TypeError('fetch failed'), { status: 201, body: { id: 7 } });
  assert.equal((await new HelpRange({ apiKey: KEY, fetch: ok }).webhookEndpoints.create({ url: 'https://example.com/h' })).id, 7);
  assert.equal(ok.calls[0].headers.get('idempotency-key'), ok.calls[1].headers.get('idempotency-key'));

  const down = mockFetch(new TypeError('a'), new TypeError('b'));
  const e = await new HelpRange({ apiKey: KEY, fetch: down, maxRetries: 1 }).webhookEndpoints.create({ url: 'https://example.com/h' }).catch((x) => x);
  assert.ok(e instanceof APIConnectionError);
  assert.equal(down.calls.length, 2);
});

test('a 5xx on POST is thrown after maxRetries', async () => {
  const fetch = mockFetch(...Array.from({ length: 2 }, () => ({ status: 500, body: { error: 'boom' }, headers: NOW })));
  const e = await new HelpRange({ apiKey: KEY, fetch, maxRetries: 1 }).documents.createLink(1).catch((x) => x);
  assert.ok(e instanceof InternalServerError);
  assert.equal(fetch.calls.length, 2);
});

test('409 idempotency_key_in_progress is retried with backoff (not counted in maxRetries)', async () => {
  const busy = { status: 409, body: { error: 'A request with this Idempotency-Key is still running.', code: 'idempotency_key_in_progress' }, headers: NOW };
  const fetch = mockFetch(new TypeError('reset'), busy, busy, { status: 201, body: { id: 3 } });
  const res = await new HelpRange({ apiKey: KEY, fetch, maxRetries: 1 }).dataRooms.create({ name: 'Slow' });
  assert.equal(res.id, 3);
  assert.equal(fetch.calls.length, 4);
  assert.equal(new Set(fetch.calls.map((c) => c.headers.get('idempotency-key'))).size, 1);
});

test('409 in progress gives up after IN_PROGRESS_MAX_RETRIES with a typed error', async () => {
  const busy = { status: 409, body: { error: 'still running', code: 'idempotency_key_in_progress' }, headers: NOW };
  const fetch = mockFetch(...Array.from({ length: IN_PROGRESS_MAX_RETRIES + 1 }, () => busy));
  const e = await new HelpRange({ apiKey: KEY, fetch }).dataRooms.create({ name: 'Slow' }).catch((x) => x);
  assert.ok(e instanceof IdempotencyKeyInProgressError && e instanceof ConflictError);
  assert.equal(e.code, 'idempotency_key_in_progress');
  assert.equal(fetch.calls.length, IN_PROGRESS_MAX_RETRIES + 1);
});

test('other 409s are not retried', async () => {
  const fetch = mockFetch({ status: 409, body: { error: 'The team already has a webhook endpoint.' } });
  const e = await new HelpRange({ apiKey: KEY, fetch }).webhookEndpoints.create({ url: 'https://example.com/h' }).catch((x) => x);
  assert.ok(e instanceof ConflictError && !(e instanceof IdempotencyKeyInProgressError));
  assert.equal(fetch.calls.length, 1);
});

test('422 idempotency_key_reused is a typed error and never retried', async () => {
  const fetch = mockFetch({ status: 422, body: { error: 'This Idempotency-Key was already used with a different request.', code: 'idempotency_key_reused' } });
  const e = await new HelpRange({ apiKey: KEY, fetch }).dataRooms.create({ name: 'X' }, { idempotencyKey: 'k1' }).catch((x) => x);
  assert.ok(e instanceof IdempotencyKeyReusedError && e instanceof UnprocessableEntityError);
  assert.equal(e.status, 422);
  assert.equal(e.code, 'idempotency_key_reused');
  assert.equal(fetch.calls.length, 1);
});

test('share() with an idempotencyKey derives a second key for the link', async () => {
  const fetch = mockFetch({ status: 201, body: { id: 250 } }, { status: 201, body: { id: 1, url: 'u' } });
  await new HelpRange({ apiKey: KEY, fetch }).share({ file_url: 'https://example.com/a.pdf', link: {} }, { idempotencyKey: 'deal-7' });
  assert.equal(fetch.calls[0].headers.get('idempotency-key'), 'deal-7');
  assert.equal(fetch.calls[1].headers.get('idempotency-key'), 'deal-7:link');
});
