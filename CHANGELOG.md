# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] – unreleased

First release, generated from HelpRange API spec version 2026-11-15 (not published yet; this entry describes
everything that will ship in it).

### Added

- Client with every REST API v2 endpoint, grouped by tag: account, folders, documents, links, triggers, data rooms,
  NDAs, e-signature, offers, store, lead forms, activity, webhook endpoints.
- Data rooms end to end: `dataRooms.create` (with folders and NDA settings), `update`, `delete({ confirm: true })`;
  sub-resources `dataRooms.guests` (`list`, `invite`, `remove`), `dataRooms.documents` (`list`, `add`, `remove`,
  `move`), `dataRooms.folders`, `dataRooms.questions`, `dataRooms.requestItems`, `dataRooms.accessRequests`,
  `dataRooms.signatureRequests`; `ndas.list`.
- `links.list` (every share link of the team, with filters and pagination) and `links.views` (the views of one link).
- `webhookEndpoints`: `list`, `create`, `get`, `update`, `delete`, `rotateSecret`, `sendTest`, `deliveries`,
  `redeliver`.
- Typed request and response models for every endpoint.
- `share()` – upload a file and create a share link in one call.
- Automatic `Idempotency-Key` (UUID v4) on every POST / PATCH, reused across retries; `options.idempotencyKey` to set
  your own.
- Retries with backoff on 429 (any method, honouring Retry-After), on 408/5xx/connection errors/timeouts (GET and
  keyed POST / PATCH) and on 409 `idempotency_key_in_progress` (up to 5 extra attempts).
- Typed errors with status, code and body (incl. `IdempotencyKeyInProgressError`, `UnprocessableEntityError`,
  `IdempotencyKeyReusedError`); test-mode (`hr_test_`) detection; rate-limit headers after each response.
- Webhook signature verification (`HelpRange-Signature`, v1 scheme, rotation-aware) and a signing helper for tests.
