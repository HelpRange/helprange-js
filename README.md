# HelpRange Node.js / TypeScript SDK

Official client for the [HelpRange API](https://www.helprange.com/developers): upload documents, create tracked share
links, see who viewed what (page by page, link by link), create and run data rooms (folders, NDA, guests, Q&A,
request lists), send documents for e-signature, create offers and manage your webhook endpoint.

- TypeScript types for every request and response, generated from the [OpenAPI spec](https://www.helprange.com/developers/openapi.json)
- ESM and CommonJS builds, **zero runtime dependencies** (uses the global `fetch` of Node 18+)
- Automatic `Idempotency-Key` on every POST / PATCH, so retries on 429 / 5xx / network errors are safe for writes too
- Typed errors, test-mode detection, webhook signature verification

## Install

```sh
npm install helprange
```

Node.js 18 or newer.

## Quickstart

```ts
import { readFile } from 'node:fs/promises';
import { HelpRange } from 'helprange';

const hr = new HelpRange({ apiKey: process.env.HELPRANGE_API_KEY });

// Upload a PDF and create a tracked share link in one call
const { document, link } = await hr.share({
  file: await readFile('proposal.pdf'),
  filename: 'proposal.pdf',
  link: { label: 'ACME - Anna', expires_on: '2026-12-31', allow_download: false, watermark: true },
});
console.log(link.url); // https://www.helprange.com/view/…/proposal.pdf

// Who opened it, when and for how long
const stats = await hr.documents.get(document.id, { recent_views: 20 });
for (const v of stats.recent_views) console.log(v.viewer, v.opened_at, v.seconds_read);
```

CommonJS works too: `const { HelpRange } = require('helprange');`

## Authentication

Create a team API key in HelpRange → **Settings → API keys**. It acts as the administrator who created it, limited to
its **scopes** (`documents:read`, `documents:write`, `links:read`, `links:write`, `rooms:read`, `rooms:write`,
`analytics:read`, `team:read`). Every method's JSDoc names the scope it needs.

```ts
const hr = new HelpRange({ apiKey: 'hr_live_…' }); // or set HELPRANGE_API_KEY and call new HelpRange()
```

The SDK sends `Authorization: Bearer <key>`. Keep keys on your server – never ship them to a browser.

The REST API is part of the Max and Unlimited plans, the Deal Room Pass and the trial; other plans get a
`PaymentRequiredError` (402).

## Sandbox (test mode)

Keys starting with `hr_test_` work on a separate sandbox of your team with sample data – never on live data:

- no e-mail is sent (only addresses at reserved test domains such as `example.com` are accepted; others fail with
  `BadRequestError` code `sandbox_email_domain`), nothing reaches Stripe, sandbox activity sends no webhooks;
- every JSON response carries `livemode: false`;
- sandbox data is deleted 30 days after the sandbox was created or reset (Settings → API keys → Reset sandbox).

```ts
const hr = new HelpRange({ apiKey: process.env.HELPRANGE_TEST_KEY });
hr.testMode;            // true for hr_test_ keys
await hr.account.me();
hr.rateLimit.livemode;  // false – from the X-HelpRange-Livemode header
```

## Resources

Resources follow the tags of the [API reference](https://www.helprange.com/developers/api):

| Property | What |
| --- | --- |
| `hr.account` | Who is connected, the plan and its limits |
| `hr.folders` | Folders and subfolders |
| `hr.documents` | Uploads, documents, statistics and share links |
| `hr.links` | Every share link of the team (filters, pagination) and the views of one link |
| `hr.triggers` | Newest views and uploads (polling, e.g. for Zapier / Make / n8n) |
| `hr.dataRooms` | Create, change and delete data rooms; the index. Sub-resources: `.guests`, `.documents`, `.folders`, `.questions`, `.requestItems`, `.accessRequests`, `.signatureRequests` |
| `hr.ndas` | The team's NDAs (for a data room's `nda_id`) and whether the plan has NDAs |
| `hr.signatureRequests` | E-signature requests and signed PDFs |
| `hr.offers` | Offers with their own link |
| `hr.store` | Store sales and buyer access |
| `hr.leadForms` | Lead-magnet / landing-page templates |
| `hr.activity` | The team activity feed |
| `hr.webhookEndpoints` | The team's webhook endpoint: create, change, delete, rotate the secret, test, delivery log, redeliver |

Request bodies and query parameters use the API's field names (`snake_case`), exactly as in the reference. Path
parameters are positional: `hr.documents.createLink(fileId, body)`.

Every method takes optional `RequestOptions` last: `{ signal, timeout, maxRetries, headers, idempotencyKey }`.
For an endpoint this version does not wrap yet, use `hr.request({ method: 'GET', path: '/api/v2/…' })`.

### All endpoints

<!-- BEGIN GENERATED ENDPOINTS -->
| Method | Endpoint | Scope |
| --- | --- | --- |
| `hr.account.me()` | `GET /api/v2/me` | `team:read` |
| `hr.account.plan()` | `GET /api/v2/plan` | `team:read` |
| `hr.folders.list()` | `GET /api/v2/folders` | `documents:read` |
| `hr.folders.get(folderId)` | `GET /api/v2/folders/{folder_id}` | `documents:read` |
| `hr.folders.setSubfoldersEnabled(folderId, body)` | `POST /api/v2/folders/{folder_id}` | `documents:write` |
| `hr.folders.listSubfolders(folderId)` | `GET /api/v2/folders/{folder_id}/subfolders` | `documents:read` |
| `hr.folders.createSubfolder(folderId, body)` | `POST /api/v2/folders/{folder_id}/subfolders` | `documents:write` |
| `hr.folders.moveDocuments(folderId, body)` | `POST /api/v2/folders/{folder_id}/subfolders/move` | `documents:write` |
| `hr.folders.renameSubfolder(subfolderId, body)` | `POST /api/v2/subfolders/{subfolder_id}` | `documents:write` |
| `hr.folders.deleteSubfolder(subfolderId)` | `POST /api/v2/subfolders/{subfolder_id}/delete` | `documents:write` |
| `hr.documents.list(query)` | `GET /api/v2/documents` | `documents:read` |
| `hr.documents.upload(body)` | `POST /api/v2/files` | `documents:write` |
| `hr.documents.createLink(fileId, body)` | `POST /api/v2/files/{file_id}/links` | `links:write` |
| `hr.documents.get(fileId, query)` | `GET /api/v2/documents/{file_id}` | `documents:read` |
| `hr.documents.listLinks(fileId)` | `GET /api/v2/documents/{file_id}/links` | `links:read` |
| `hr.links.list(query)` | `GET /api/v2/links` | `links:read` |
| `hr.links.views(linkId, query)` | `GET /api/v2/links/{link_id}/views` | `analytics:read` |
| `hr.triggers.recentViews()` | `GET /api/v2/views` | `analytics:read` |
| `hr.triggers.recentUploads()` | `GET /api/v2/uploads` | `documents:read` |
| `hr.store.grantBuyerAccess(folderId, body)` | `POST /api/v2/folders/{folder_id}/buyers` | `links:write` |
| `hr.store.revokeBuyerAccess(folderId, body)` | `POST /api/v2/folders/{folder_id}/buyers/remove` | `links:write` |
| `hr.store.listSales(query)` | `GET /api/v2/store/sales` | `analytics:read` |
| `hr.leadForms.listTemplates()` | `GET /api/v2/landing-templates` | `links:read` |
| `hr.activity.list(query)` | `GET /api/v2/activity` | `analytics:read` |
| `hr.signatureRequests.list(query)` | `GET /api/v2/signature-requests` | `documents:read` |
| `hr.signatureRequests.create(body)` | `POST /api/v2/signature-requests` | `documents:write` |
| `hr.signatureRequests.get(envelopeId)` | `GET /api/v2/signature-requests/{envelope_id}` | `documents:read` |
| `hr.signatureRequests.remind(envelopeId)` | `POST /api/v2/signature-requests/{envelope_id}/remind` | `documents:write` |
| `hr.signatureRequests.void(envelopeId, body)` | `POST /api/v2/signature-requests/{envelope_id}/void` | `documents:write` |
| `hr.signatureRequests.getSignedPdf(envelopeId)` | `GET /api/v2/signature-requests/{envelope_id}/signed-pdf` | `documents:read` |
| `hr.dataRooms.list()` | `GET /api/v2/data-rooms` | `rooms:read` |
| `hr.dataRooms.create(body)` | `POST /api/v2/data-rooms` | `rooms:write` |
| `hr.dataRooms.get(dataRoomId)` | `GET /api/v2/data-rooms/{data_room_id}` | `rooms:read` |
| `hr.dataRooms.update(dataRoomId, body)` | `POST /api/v2/data-rooms/{data_room_id}` | `rooms:write` |
| `hr.dataRooms.delete(dataRoomId, body)` | `POST /api/v2/data-rooms/{data_room_id}/delete` | `rooms:write` |
| `hr.ndas.list()` | `GET /api/v2/ndas` | `rooms:read` |
| `hr.dataRooms.getIndex(dataRoomId)` | `GET /api/v2/data-rooms/{data_room_id}/index` | `rooms:read` |
| `hr.dataRooms.guests.list(dataRoomId)` | `GET /api/v2/data-rooms/{data_room_id}/guests` | `rooms:read` |
| `hr.dataRooms.guests.invite(dataRoomId, body)` | `POST /api/v2/data-rooms/{data_room_id}/guests` | `rooms:write` |
| `hr.dataRooms.guests.remove(dataRoomId, body)` | `POST /api/v2/data-rooms/{data_room_id}/guests/remove` | `rooms:write` |
| `hr.dataRooms.accessRequests.list(dataRoomId, query)` | `GET /api/v2/data-rooms/{data_room_id}/access-requests` | `rooms:read` |
| `hr.dataRooms.signatureRequests.list(dataRoomId)` | `GET /api/v2/data-rooms/{data_room_id}/signature-requests` | `rooms:read` |
| `hr.dataRooms.questions.list(dataRoomId, query)` | `GET /api/v2/data-rooms/{data_room_id}/questions` | `rooms:read` |
| `hr.dataRooms.questions.add(dataRoomId, body)` | `POST /api/v2/data-rooms/{data_room_id}/questions` | `rooms:write` |
| `hr.dataRooms.requestItems.list(dataRoomId, query)` | `GET /api/v2/data-rooms/{data_room_id}/requests` | `rooms:read` |
| `hr.dataRooms.requestItems.add(dataRoomId, body)` | `POST /api/v2/data-rooms/{data_room_id}/requests` | `rooms:write` |
| `hr.dataRooms.folders.list(dataRoomId)` | `GET /api/v2/data-rooms/{data_room_id}/folders` | `rooms:read` |
| `hr.dataRooms.folders.create(dataRoomId, body)` | `POST /api/v2/data-rooms/{data_room_id}/folders` | `rooms:write` |
| `hr.dataRooms.documents.move(dataRoomId, body)` | `POST /api/v2/data-rooms/{data_room_id}/folders/move` | `rooms:write` |
| `hr.dataRooms.folders.rename(dataRoomId, folderId, body)` | `POST /api/v2/data-rooms/{data_room_id}/folders/{folder_id}` | `rooms:write` |
| `hr.dataRooms.folders.delete(dataRoomId, folderId)` | `POST /api/v2/data-rooms/{data_room_id}/folders/{folder_id}/delete` | `rooms:write` |
| `hr.dataRooms.documents.list(dataRoomId)` | `GET /api/v2/data-rooms/{data_room_id}/documents` | `rooms:read` |
| `hr.dataRooms.documents.add(dataRoomId, body)` | `POST /api/v2/data-rooms/{data_room_id}/documents` | `rooms:write` |
| `hr.dataRooms.documents.remove(dataRoomId, body)` | `POST /api/v2/data-rooms/{data_room_id}/documents/remove` | `rooms:write` |
| `hr.offers.list(query)` | `GET /api/v2/offers` | `links:read` |
| `hr.offers.create(body)` | `POST /api/v2/offers` | `links:write` |
| `hr.offers.get(offerId)` | `GET /api/v2/offers/{offer_id}` | `links:read` |
| `hr.offers.update(offerId, body)` | `PATCH /api/v2/offers/{offer_id}` | `links:write` |
| `hr.offers.addFiles(offerId, body)` | `POST /api/v2/offers/{offer_id}/files` | `links:write` |
| `hr.offers.removeFiles(offerId, body)` | `POST /api/v2/offers/{offer_id}/files/remove` | `links:write` |
| `hr.offers.listResponses(offerId, query)` | `GET /api/v2/offers/{offer_id}/responses` | `analytics:read` |
| `hr.offers.listAllResponses(query)` | `GET /api/v2/offer-responses` | `analytics:read` |
| `hr.webhookEndpoints.list()` | `GET /api/v2/webhook-endpoints` | `webhooks:manage` |
| `hr.webhookEndpoints.create(body)` | `POST /api/v2/webhook-endpoints` | `webhooks:manage` |
| `hr.webhookEndpoints.get(endpointId)` | `GET /api/v2/webhook-endpoints/{endpoint_id}` | `webhooks:manage` |
| `hr.webhookEndpoints.update(endpointId, body)` | `POST /api/v2/webhook-endpoints/{endpoint_id}` | `webhooks:manage` |
| `hr.webhookEndpoints.delete(endpointId)` | `POST /api/v2/webhook-endpoints/{endpoint_id}/delete` | `webhooks:manage` |
| `hr.webhookEndpoints.rotateSecret(endpointId)` | `POST /api/v2/webhook-endpoints/{endpoint_id}/rotate-secret` | `webhooks:manage` |
| `hr.webhookEndpoints.sendTest(endpointId)` | `POST /api/v2/webhook-endpoints/{endpoint_id}/test` | `webhooks:manage` |
| `hr.webhookEndpoints.deliveries(endpointId, query)` | `GET /api/v2/webhook-endpoints/{endpoint_id}/deliveries` | `webhooks:manage` |
| `hr.webhookEndpoints.redeliver(endpointId, deliveryId)` | `POST /api/v2/webhook-endpoints/{endpoint_id}/deliveries/{delivery_id}/redeliver` | `webhooks:manage` |
<!-- END GENERATED ENDPOINTS -->

## Data rooms

```ts
// NDAs need the Max plan (or the Deal Room Pass / trial)
const { nda_available, ndas } = await hr.ndas.list();

const room = await hr.dataRooms.create({
  name: 'Project Falcon',
  folders: ['1. Corporate', '2. Financials', '3. Legal'],
  settings: { download: false, watermark: true, nda: nda_available, nda_template: 'investor', nda_mode: 'click' },
});
console.log(room.links.guest_link); // the room's shareable link

await hr.dataRooms.documents.add(room.id, { document_ids: [250, 251], folder_id: room.folders[1]!.id });

const guest = await hr.dataRooms.guests.invite(room.id, { email: 'jane@example.com' });
console.log(guest.link); // Jane's own link – also e-mailed to her unless send_invite: false

await hr.dataRooms.guests.list(room.id);
await hr.dataRooms.guests.remove(room.id, { email: 'jane@example.com' });
await hr.dataRooms.update(room.id, { settings: { expires_on: '2026-12-31' } });

// Deleting a room (and its guest access) needs an explicit confirmation
await hr.dataRooms.delete(room.id, { confirm: true });
```

## Links and views

```ts
// Every share link of the team – filter by document_id, folder_id, room_id, label, status, created_after/_before
for (let page: number | null = 1; page !== null; ) {
  const res = await hr.links.list({ document_id: 250, status: 'active', page, limit: 200 });
  for (const link of res.links) console.log(link.id, link.label, link.views, link.url);
  page = res.next_page;
}

// Who opened one link, when, for how long
const { views } = await hr.links.views(264, { limit: 100 });
for (const v of views) console.log(v.viewer, v.opened_at, v.seconds_read, v.pages_read);
```

## Errors

Every error is a `HelpRangeError` with `status`, `code` (the API's machine-readable reason, when it sends one),
`message` and the parsed `body`:

| Class | When |
| --- | --- |
| `BadRequestError` | 400 – e.g. a duplicate link label, `sandbox_email_domain` |
| `AuthenticationError` | 401 – `invalid_key`, `key_revoked`, `key_expired`, `key_owner_removed` |
| `PaymentRequiredError` | 402 – the plan does not include the API / feature |
| `PermissionDeniedError` | 403 – `insufficient_scope` (see `err.requiredScope`) |
| `NotFoundError` | 404 |
| `ConflictError` | 409 – e.g. a frozen room, the team already has a webhook endpoint |
| `IdempotencyKeyInProgressError` | 409 `idempotency_key_in_progress` (a `ConflictError`) – still running after the in-progress retries |
| `UnprocessableEntityError` | 422 |
| `IdempotencyKeyReusedError` | 422 `idempotency_key_reused` (an `UnprocessableEntityError`) – the key was used for a different request |
| `PayloadTooLargeError` | 413 – `FILE_TOO_LARGE`, `REQUEST_TOO_LARGE` |
| `LockedError` | 423 – e.g. `ROOM_FROZEN` |
| `RateLimitError` | 429 – `RATE_LIMITED`, `DAILY_LIMIT`, `PAUSED`, `UPLOAD_LIMIT` (see `err.retryAfter`) |
| `InternalServerError` | 5xx |
| `APIConnectionError` / `APITimeoutError` | no HTTP answer / timed out |
| `WebhookVerificationError` | `verifyWebhook()` rejected a delivery |

```ts
import { PermissionDeniedError, RateLimitError } from 'helprange';

try {
  await hr.dataRooms.guests.invite(10, { email: 'jane@example.com' });
} catch (err) {
  if (err instanceof PermissionDeniedError && err.code === 'insufficient_scope') {
    console.error(`The key needs the ${err.requiredScope} scope`);
  } else if (err instanceof RateLimitError) {
    console.error(`Over a limit (${err.code}); retry in ${err.retryAfter}s`);
  } else throw err;
}
```

## Retries and limits

Every `POST` and `PATCH` carries an `Idempotency-Key` header – a new UUID v4 per call, **the same one for every retry
of that call**. The API runs a keyed request once and answers a repeat with the stored response (header
`Idempotent-Replayed: true`), so a retried write never creates a second data room, share link or invitation.

- **429** (any method) – the API did not carry out the request. The client waits `Retry-After` and retries, unless the
  wait is longer than `maxRetryAfter` (default 60 s – e.g. a daily cap or a paused API), in which case it throws
  `RateLimitError` at once.
- **408 / 5xx, connection errors and timeouts** – retried for `GET` and for keyed `POST` / `PATCH`, with exponential
  backoff (0.5 s, 1 s, 2 s … up to 8 s, with jitter; a short `Retry-After` is respected).
- **409 `idempotency_key_in_progress`** – the first attempt is still running on the server (typically after a timeout).
  The client waits with backoff (~1, 2, 4, 8, 8 s) and asks again, up to 5 times, without using up `maxRetries`; then
  it throws `IdempotencyKeyInProgressError`.
- **422 `idempotency_key_reused`** – never retried; throws `IdempotencyKeyReusedError`. It means the key was used in the
  last 24 hours for a different method, path or body.

Pass your own key to make a write safe to repeat across processes or restarts (e.g. a job id):

```ts
await hr.dataRooms.create({ name: 'Project Falcon' }, { idempotencyKey: `deal-${deal.id}-room` });
```

Keys are kept for 24 hours, per API key. `hr.share()` with an `idempotencyKey` uses it for the upload and
`<key>:link` for the share link.

`maxRetries` (default 2) and `timeout` (default 60 000 ms per attempt) can be set on the client or per request.
After each response `hr.rateLimit` holds `{ limit, remaining, reset, livemode }` from the `X-RateLimit-*` headers.
Team limits: 3,600 requests an hour, 120 a minute, 300 writes an hour, 2,000 share links and 1,000 guests a day.

## Webhooks

HelpRange POSTs signed JSON events (`document.opened`, `file_request.uploaded`, `room.access_requested`,
`nda.accepted`, `document.acknowledged`, `offer.accepted`, `offer.declined`, `offer.contact_requested`) to the endpoint
you set in Settings → Integrations or through `hr.webhookEndpoints`. Verify each delivery with the **raw** body:

```ts
import express from 'express';
import { verifyWebhook, WebhookVerificationError } from 'helprange';

const app = express();
app.post('/webhooks/helprange', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = verifyWebhook(req.body, req.headers, process.env.HELPRANGE_WEBHOOK_SECRET!);
    // deduplicate on event.id – retries carry the same id
    if (event.event === 'document.opened') console.log(event.data);
    res.sendStatus(200); // answer 2xx within 10 seconds
  } catch (err) {
    res.sendStatus(err instanceof WebhookVerificationError ? 400 : 500);
  }
});
```

The scheme: `HelpRange-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. `verifyWebhook` accepts a
timestamp within 5 minutes (`{ tolerance }` to change it) and any `v1` that matches – during the 24 hours after a
secret rotation HelpRange sends two. Pass an array of secrets if you rotate on your side. `signWebhookPayload()` builds
a valid header for your tests. Failed deliveries are retried for about 3 days; see the
[webhooks guide](https://www.helprange.com/developers/webhooks).

Manage the endpoint from code:

```ts
const ep = await hr.webhookEndpoints.create({ url: 'https://example.com/webhooks/helprange' });
console.log(ep.secret);                                    // shown once – store it
await hr.webhookEndpoints.sendTest(ep.id);                 // a test event, delivered right away
const { deliveries } = await hr.webhookEndpoints.deliveries(ep.id, { status: 'failed' });
if (deliveries[0]) await hr.webhookEndpoints.redeliver(ep.id, deliveries[0].id);
const { secret } = await hr.webhookEndpoints.rotateSecret(ep.id); // the old secret keeps signing for 24 hours
await hr.webhookEndpoints.update(ep.id, { enabled: true }); // turn it back on after 410 Gone / repeated failures
await hr.webhookEndpoints.delete(ep.id);
```

## Examples

Runnable scripts in [`examples/`](examples):

- [`share-pdf.ts`](examples/share-pdf.ts) – share a PDF and get a link
- [`who-viewed.ts`](examples/who-viewed.ts) – every link of a document and who viewed each one, plus time per page
- [`data-room.ts`](examples/data-room.ts) – create a data room with folders and an NDA, add documents, invite guests
  and print their links, read the index and Q&A
- [`webhook-endpoints.ts`](examples/webhook-endpoints.ts) – create / update the webhook endpoint, send a test event,
  redeliver a failure, rotate the secret
- [`webhook-server.ts`](examples/webhook-server.ts) – verify webhooks on plain `node:http`

## Development

```sh
# Node 22 (e.g. export PATH="$HOME/.nvm/versions/node/v22.23.4/bin:$PATH"); the package itself supports Node 18+
npm install
npm run typecheck   # src + examples
npm test            # builds ESM + CJS, runs node:test with a mocked fetch (no network)
```

`src/generated/` is generated from the OpenAPI spec – don't edit it by hand; see the generator in the
`helprange-sdks` workspace.

## License

MIT © HelpRange
