import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HelpRange } from '../dist/esm/index.js';
import { mockFetch } from './helpers.mjs';

const KEY = 'hr_live_' + 'x'.repeat(40);

function client(...responses) {
  const fetch = mockFetch(...responses);
  return { hr: new HelpRange({ apiKey: KEY, fetch }), calls: fetch.calls };
}
const sent = (c) => ({ method: c.init.method, path: c.url.pathname, query: Object.fromEntries(c.url.searchParams), body: c.init.body ? JSON.parse(c.init.body) : undefined });

test('data rooms: create / update / delete (confirm) and ndas', async () => {
  const { hr, calls } = client({ status: 201, body: { id: 12, name: 'Falcon', links: { guest_link: 'https://www.helprange.com/r/abc' } } }, {}, {}, {});
  const room = await hr.dataRooms.create({ name: 'Falcon', folders: ['Legal', 'Financials'], settings: { nda: true, nda_template: 'investor', download: false } });
  assert.equal(room.links.guest_link, 'https://www.helprange.com/r/abc');
  await hr.dataRooms.update(12, { name: 'Falcon II', settings: { watermark: true } });
  await hr.dataRooms.delete(12, { confirm: true });
  await hr.ndas.list();
  assert.deepEqual(calls.map(sent), [
    { method: 'POST', path: '/api/v2/data-rooms', query: {}, body: { name: 'Falcon', folders: ['Legal', 'Financials'], settings: { nda: true, nda_template: 'investor', download: false } } },
    { method: 'POST', path: '/api/v2/data-rooms/12', query: {}, body: { name: 'Falcon II', settings: { watermark: true } } },
    { method: 'POST', path: '/api/v2/data-rooms/12/delete', query: {}, body: { confirm: true } },
    { method: 'GET', path: '/api/v2/ndas', query: {}, body: undefined },
  ]);
});

test('data room sub-resources: guests and documents', async () => {
  const { hr, calls } = client({}, { status: 201, body: {} }, {}, {}, { status: 201, body: {} }, {}, {}, {});
  await hr.dataRooms.guests.list(12);
  await hr.dataRooms.guests.invite(12, { email: 'jane@example.com', send_invite: false });
  await hr.dataRooms.guests.remove(12, { guest_id: 5 });
  await hr.dataRooms.documents.list(12);
  await hr.dataRooms.documents.add(12, { document_ids: [1, 2] });
  await hr.dataRooms.documents.remove(12, { document_ids: [2] });
  await hr.dataRooms.folders.list(12);
  await hr.dataRooms.questions.list(12, { status: 'open' });
  assert.deepEqual(calls.map((c) => `${c.init.method} ${c.url.pathname}${c.url.search}`), [
    'GET /api/v2/data-rooms/12/guests',
    'POST /api/v2/data-rooms/12/guests',
    'POST /api/v2/data-rooms/12/guests/remove',
    'GET /api/v2/data-rooms/12/documents',
    'POST /api/v2/data-rooms/12/documents',
    'POST /api/v2/data-rooms/12/documents/remove',
    'GET /api/v2/data-rooms/12/folders',
    'GET /api/v2/data-rooms/12/questions?status=open',
  ]);
  assert.deepEqual(sent(calls[2]).body, { guest_id: 5 });
});

test('links: list with filters + pagination, and the views of one link', async () => {
  const { hr, calls } = client(
    { body: { links: [{ id: 264, label: 'ACME' }], page: 2, limit: 50, total: 51, next_page: null } },
    { body: { link: { id: 264 }, views: [{ id: 1, viewer: 'anna@acme.com' }], page: 1, limit: 100, total: 1, next_page: null } },
  );
  const res = await hr.links.list({ document_id: 250, room_id: 12, status: 'active', label: 'ACME', page: 2, limit: 50 });
  assert.equal(res.links[0].id, 264);
  const views = await hr.links.views(264, { limit: 100 });
  assert.equal(views.views[0].viewer, 'anna@acme.com');
  assert.deepEqual(sent(calls[0]), { method: 'GET', path: '/api/v2/links', body: undefined,
    query: { document_id: '250', room_id: '12', status: 'active', label: 'ACME', page: '2', limit: '50' } });
  assert.equal(calls[1].url.pathname + calls[1].url.search, '/api/v2/links/264/views?limit=100');
});

test('webhook endpoints: CRUD, rotate, test, deliveries, redeliver', async () => {
  const { hr, calls } = client({}, { status: 201, body: { id: 3, secret: 'whsec_x' } }, {}, {}, {}, {}, {}, {}, {});
  await hr.webhookEndpoints.list();
  const ep = await hr.webhookEndpoints.create({ url: 'https://example.com/h' });
  assert.equal(ep.secret, 'whsec_x');
  await hr.webhookEndpoints.get(3);
  await hr.webhookEndpoints.update(3, { enabled: true });
  await hr.webhookEndpoints.rotateSecret(3);
  await hr.webhookEndpoints.sendTest(3);
  await hr.webhookEndpoints.deliveries(3, { status: 'failed', limit: 10 });
  await hr.webhookEndpoints.redeliver(3, 99);
  await hr.webhookEndpoints.delete(3);
  assert.deepEqual(calls.map((c) => `${c.init.method} ${c.url.pathname}${c.url.search}`), [
    'GET /api/v2/webhook-endpoints',
    'POST /api/v2/webhook-endpoints',
    'GET /api/v2/webhook-endpoints/3',
    'POST /api/v2/webhook-endpoints/3',
    'POST /api/v2/webhook-endpoints/3/rotate-secret',
    'POST /api/v2/webhook-endpoints/3/test',
    'GET /api/v2/webhook-endpoints/3/deliveries?status=failed&limit=10',
    'POST /api/v2/webhook-endpoints/3/deliveries/99/redeliver',
    'POST /api/v2/webhook-endpoints/3/delete',
  ]);
  // POSTs without a body still carry an Idempotency-Key
  assert.ok(calls[4].headers.get('idempotency-key'));
  assert.equal(calls[4].init.body, undefined);
});
