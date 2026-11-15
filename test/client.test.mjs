import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HelpRange, HelpRangeError, AuthenticationError, PermissionDeniedError, NotFoundError, RateLimitError,
  InternalServerError, APIConnectionError, APITimeoutError, BadRequestError, parseRetryAfter,
} from '../dist/esm/index.js';
import { mockFetch } from './helpers.mjs';

const KEY = 'hr_live_' + 'x'.repeat(40);

test('sends the bearer key, user agent and query; parses JSON', async () => {
  const fetch = mockFetch({ body: { documents: [{ id: 250, name: 'proposal.pdf' }], livemode: true } });
  const hr = new HelpRange({ apiKey: KEY, fetch });
  const res = await hr.documents.list({ folder_id: 31, subfolder: 'none' });
  assert.equal(res.documents[0].id, 250);
  const c = fetch.calls[0];
  assert.equal(c.init.method, 'GET');
  assert.equal(c.url.origin + c.url.pathname, 'https://www.helprange.com/api/v2/documents');
  assert.equal(c.url.searchParams.get('folder_id'), '31');
  assert.equal(c.url.searchParams.get('subfolder'), 'none');
  assert.equal(c.headers.get('authorization'), `Bearer ${KEY}`);
  assert.match(c.headers.get('user-agent'), /^helprange-node\//);
  assert.equal(c.init.body, undefined);
});

test('POST sends a JSON body and encodes path parameters', async () => {
  const fetch = mockFetch({ status: 201, body: { id: 264, url: 'https://www.helprange.com/view/x/p.pdf' } });
  const hr = new HelpRange({ apiKey: KEY, fetch, baseUrl: 'https://example.test/' });
  const link = await hr.documents.createLink(250, { label: 'ACME - Anna', expires_on: '2026-12-31', watermark: true });
  assert.equal(link.id, 264);
  const c = fetch.calls[0];
  assert.equal(c.url.toString(), 'https://example.test/api/v2/files/250/links');
  assert.equal(c.headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(c.init.body), { label: 'ACME - Anna', expires_on: '2026-12-31', watermark: true });
  await new HelpRange({ apiKey: KEY, fetch: mockFetch({ body: {} }) }).signatureRequests.get('a/b');
});

test('every tag of the spec is a resource', () => {
  const hr = new HelpRange({ apiKey: KEY, fetch: mockFetch() });
  for (const r of ['account', 'folders', 'documents', 'links', 'triggers', 'dataRooms', 'ndas', 'signatureRequests', 'offers', 'store', 'leadForms', 'activity', 'webhookEndpoints']) {
    assert.ok(hr[r], r);
  }
  assert.equal(typeof hr.dataRooms.guests.invite, 'function');
  assert.equal(typeof hr.offers.update, 'function');
});

test('test mode follows the key prefix', () => {
  assert.equal(new HelpRange({ apiKey: KEY, fetch: mockFetch() }).testMode, false);
  assert.equal(new HelpRange({ apiKey: 'hr_test_abc', fetch: mockFetch() }).testMode, true);
});

test('missing key throws; HELPRANGE_API_KEY is used', () => {
  const old = process.env.HELPRANGE_API_KEY;
  delete process.env.HELPRANGE_API_KEY;
  assert.throws(() => new HelpRange({ fetch: mockFetch() }), HelpRangeError);
  process.env.HELPRANGE_API_KEY = 'hr_test_env';
  assert.equal(new HelpRange({ fetch: mockFetch() }).testMode, true);
  if (old === undefined) delete process.env.HELPRANGE_API_KEY; else process.env.HELPRANGE_API_KEY = old;
});

test('typed errors carry status, code and body', async () => {
  const hr = new HelpRange({
    apiKey: KEY, maxRetries: 0,
    fetch: mockFetch(
      { status: 403, body: { error: 'This API key does not have the "rooms:write" scope', code: 'insufficient_scope', required_scope: 'rooms:write' } },
      { status: 401, body: { error: 'Unknown key.', code: 'invalid_key' } },
      { status: 404, body: { error: 'Not found.' } },
      { status: 400, body: { error: 'Test mode only accepts reserved test domains.', code: 'sandbox_email_domain' } },
      { status: 404, body: { status: 'Not Found Error', message: 'Directory not found' } },
    ),
  });
  const e1 = await hr.dataRooms.guests.invite(10, { email: 'a@b.com' }).catch((e) => e);
  assert.ok(e1 instanceof PermissionDeniedError && e1 instanceof HelpRangeError);
  assert.equal(e1.status, 403);
  assert.equal(e1.code, 'insufficient_scope');
  assert.equal(e1.requiredScope, 'rooms:write');
  assert.match(e1.message, /rooms:write/);
  const e2 = await hr.account.me().catch((e) => e);
  assert.ok(e2 instanceof AuthenticationError);
  assert.equal(e2.code, 'invalid_key');
  assert.ok((await hr.documents.get(1).catch((e) => e)) instanceof NotFoundError);
  const e4 = await hr.dataRooms.guests.invite(10, { email: 'a@b.com' }).catch((e) => e);
  assert.ok(e4 instanceof BadRequestError);
  assert.equal(e4.code, 'sandbox_email_domain');
  const e5 = await hr.request({ method: 'GET', path: '/public-api/directory/1/file' }).catch((e) => e);
  assert.equal(e5.message, 'Directory not found');
});

test('429 is retried after Retry-After, for POST too', async () => {
  const fetch = mockFetch(
    { status: 429, body: { error: 'Slow down', code: 'RATE_LIMITED', retry_after: 1 }, headers: { 'retry-after': '0' } },
    { status: 201, body: { id: 1 } },
  );
  const hr = new HelpRange({ apiKey: KEY, fetch });
  const res = await hr.documents.createLink(1, {});
  assert.equal(res.id, 1);
  assert.equal(fetch.calls.length, 2);
});

test('a long Retry-After (daily cap) is not waited for', async () => {
  const fetch = mockFetch({ status: 429, body: { error: 'Daily cap', code: 'DAILY_LIMIT', retry_after: 3600 }, headers: { 'retry-after': '3600' } });
  const hr = new HelpRange({ apiKey: KEY, fetch });
  const e = await hr.documents.list().catch((x) => x);
  assert.ok(e instanceof RateLimitError);
  assert.equal(e.retryAfter, 3600);
  assert.equal(e.code, 'DAILY_LIMIT');
  assert.equal(fetch.calls.length, 1);
});

test('5xx is retried for GET', async () => {
  const get = mockFetch({ status: 503, body: 'down', headers: { 'retry-after': '0', 'content-type': 'text/plain' } }, { body: { ok: true } });
  assert.deepEqual(await new HelpRange({ apiKey: KEY, fetch: get }).account.plan(), { ok: true });
  assert.equal(get.calls.length, 2);
  assert.equal(get.calls[0].headers.get('idempotency-key'), null); // GET never carries a key
});

test('retries stop at maxRetries', async () => {
  const fetch = mockFetch(...Array.from({ length: 3 }, () => ({ status: 500, body: { error: 'boom' }, headers: { 'retry-after': '0' } })));
  const e = await new HelpRange({ apiKey: KEY, fetch, maxRetries: 2 }).folders.list().catch((x) => x);
  assert.ok(e instanceof InternalServerError);
  assert.equal(fetch.calls.length, 3);
});

test('connection errors become APIConnectionError (GET retried)', async () => {
  const fetch = mockFetch(new TypeError('fetch failed'), { body: { folders: [] } });
  assert.deepEqual(await new HelpRange({ apiKey: KEY, fetch }).folders.list(), { folders: [] });
  const e = await new HelpRange({ apiKey: KEY, maxRetries: 0, fetch: mockFetch(new TypeError('fetch failed')) }).documents.upload({ file_url: 'https://example.com/a.pdf' }).catch((x) => x);
  assert.ok(e instanceof APIConnectionError);
});

test('timeouts become APITimeoutError', async () => {
  const hanging = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const e = await new HelpRange({ apiKey: KEY, fetch: mockFetch(hanging), timeout: 20, maxRetries: 0 }).account.me().catch((x) => x);
  assert.ok(e instanceof APITimeoutError, String(e));
});

test('upload with a file sends multipart/form-data', async () => {
  const fetch = mockFetch({ status: 201, body: { id: 250, name: 'deck.pdf', folder_id: 31, type: 'document', pages: 3, default_link: null } });
  const hr = new HelpRange({ apiKey: KEY, fetch });
  await hr.documents.upload({ file: new TextEncoder().encode('%PDF-1.4'), filename: 'deck.pdf', folder_id: 31 });
  const { init, headers } = fetch.calls[0];
  assert.ok(init.body instanceof FormData);
  assert.equal(headers.get('content-type'), null); // fetch sets the multipart boundary itself
  const file = init.body.get('file');
  assert.equal(file.name, 'deck.pdf');
  assert.equal(await file.text(), '%PDF-1.4');
  assert.equal(init.body.get('folder_id'), '31');
});

test('upload by URL sends JSON', async () => {
  const fetch = mockFetch({ status: 201, body: { id: 1 } });
  await new HelpRange({ apiKey: KEY, fetch }).documents.upload({ file_url: 'https://example.com/proposal.pdf', folder_id: 31 });
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body), { file_url: 'https://example.com/proposal.pdf', folder_id: 31 });
});

test('share() uploads then creates a link', async () => {
  const fetch = mockFetch(
    { status: 201, body: { id: 250, name: 'deck.pdf' } },
    { status: 201, body: { id: 264, url: 'https://www.helprange.com/view/abc/deck.pdf', label: 'ACME' } },
  );
  const { document, link } = await new HelpRange({ apiKey: KEY, fetch }).share({
    file: new Uint8Array([1, 2, 3]), filename: 'deck.pdf', link: { label: 'ACME', allow_download: false },
  });
  assert.equal(document.id, 250);
  assert.equal(link.url, 'https://www.helprange.com/view/abc/deck.pdf');
  assert.equal(fetch.calls[1].url.pathname, '/api/v2/files/250/links');
  assert.deepEqual(JSON.parse(fetch.calls[1].init.body), { label: 'ACME', allow_download: false });
});

test('rate-limit headers are tracked', async () => {
  const fetch = mockFetch({ body: {}, headers: { 'x-ratelimit-limit': '3600', 'x-ratelimit-remaining': '3599', 'x-ratelimit-reset': '1763200800', 'x-helprange-livemode': 'false' } });
  const hr = new HelpRange({ apiKey: 'hr_test_x', fetch });
  await hr.account.me();
  assert.deepEqual(hr.rateLimit, { limit: 3600, remaining: 3599, reset: 1763200800, livemode: false });
});

test('parseRetryAfter handles seconds and dates', () => {
  assert.equal(parseRetryAfter('7'), 7);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 0), 10);
  assert.equal(parseRetryAfter('soon'), undefined);
});

test('VERSION matches package.json', async () => {
  const { VERSION } = await import('../dist/esm/index.js');
  const pkg = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
});
