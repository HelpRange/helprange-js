/**
 * Every error the SDK throws is a HelpRangeError. HTTP errors carry the status, the API's machine-readable
 * `code` (when the API sends one) and the parsed response body.
 */
export class HelpRangeError extends Error {
  /** HTTP status, or undefined for connection errors and webhook verification errors. */
  readonly status: number | undefined;
  /** Machine-readable reason from the API, e.g. `insufficient_scope`, `RATE_LIMITED`, `FILE_TOO_LARGE`. */
  readonly code: string | undefined;
  /** The parsed JSON error body (or the raw text). */
  readonly body: unknown;
  /** Response headers. */
  readonly headers: Headers | undefined;

  constructor(message: string, init: { status?: number; code?: string; body?: unknown; headers?: Headers; cause?: unknown } = {}) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = new.target.name;
    this.status = init.status;
    this.code = init.code;
    this.body = init.body;
    this.headers = init.headers;
  }
}

/** The request never got an HTTP answer (DNS, TCP, TLS, reset…). */
export class APIConnectionError extends HelpRangeError {}
/** An attempt took longer than the timeout. */
export class APITimeoutError extends APIConnectionError {}
/** 400 – the request was refused, e.g. a missing field, a duplicate link label, `sandbox_email_domain`. */
export class BadRequestError extends HelpRangeError {}
/** 401 – missing, unknown, revoked or expired API key (`invalid_key`, `key_revoked`, `key_expired`, `key_owner_removed`). */
export class AuthenticationError extends HelpRangeError {}
/** 402 – the team's plan does not include the REST API or this feature. */
export class PaymentRequiredError extends HelpRangeError {}
/** 403 – no permission; with `code: "insufficient_scope"` the key lacks `requiredScope`. */
export class PermissionDeniedError extends HelpRangeError {
  /** The scope the endpoint needs (insufficient_scope errors). */
  get requiredScope(): string | undefined {
    const b = this.body as { required_scope?: string } | undefined;
    return b && typeof b === 'object' ? b.required_scope : undefined;
  }
}
/** 404 – no such object, or not visible to this key. */
export class NotFoundError extends HelpRangeError {}
/** 409 – conflict (a frozen data room, a signed PDF that is not ready, an endpoint that already exists…). */
export class ConflictError extends HelpRangeError {}
/**
 * 409 `idempotency_key_in_progress` – a request with the same Idempotency-Key is still running. The client retries
 * these with backoff; you only see this error when the first request keeps running past the retries.
 */
export class IdempotencyKeyInProgressError extends ConflictError {}
/** 413 – file or request too large (`FILE_TOO_LARGE`, `REQUEST_TOO_LARGE`). */
export class PayloadTooLargeError extends HelpRangeError {}
/** 422 – the request was understood but cannot be processed. */
export class UnprocessableEntityError extends HelpRangeError {}
/**
 * 422 `idempotency_key_reused` – this Idempotency-Key was already used in the last 24 hours for a different request
 * (method, path or body). Use a new key for a new request; never retried.
 */
export class IdempotencyKeyReusedError extends UnprocessableEntityError {}
/** 423 – the object is locked, e.g. a frozen data room (`ROOM_FROZEN`). */
export class LockedError extends HelpRangeError {}
/** 429 – a usage limit was reached (`RATE_LIMITED`, `DAILY_LIMIT`, `PAUSED`, `UPLOAD_LIMIT`). */
export class RateLimitError extends HelpRangeError {
  /** Seconds to wait before retrying (from Retry-After / retry_after). */
  get retryAfter(): number | undefined {
    const b = this.body as { retry_after?: number } | undefined;
    if (b && typeof b === 'object' && typeof b.retry_after === 'number') return b.retry_after;
    const h = this.headers?.get('retry-after');
    return h && /^\d+$/.test(h) ? Number(h) : undefined;
  }
}
/** 5xx – HelpRange had a problem. */
export class InternalServerError extends HelpRangeError {}
/** verifyWebhook() rejected the payload: bad or missing signature, or a timestamp outside the tolerance. */
export class WebhookVerificationError extends HelpRangeError {}

const BY_STATUS: Record<number, typeof HelpRangeError> = {
  400: BadRequestError,
  401: AuthenticationError,
  402: PaymentRequiredError,
  403: PermissionDeniedError,
  404: NotFoundError,
  409: ConflictError,
  413: PayloadTooLargeError,
  422: UnprocessableEntityError,
  423: LockedError,
  429: RateLimitError,
};

/** Builds the right error for an HTTP error response (v2 `{error, code}` and the v1 shapes). */
export function errorFromResponse(status: number, body: unknown, headers: Headers): HelpRangeError {
  let message = `HTTP ${status}`;
  let code: string | undefined;
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const text = b.error ?? b.message ?? b.reason ?? b.detail;
    if (typeof text === 'string' && text) message = text;
    if (typeof b.code === 'string') code = b.code;
  } else if (typeof body === 'string' && body.trim()) {
    message = body.trim().slice(0, 500);
  }
  let Cls = BY_STATUS[status] ?? (status >= 500 ? InternalServerError : HelpRangeError);
  if (status === 409 && code === 'idempotency_key_in_progress') Cls = IdempotencyKeyInProgressError;
  if (status === 422 && code === 'idempotency_key_reused') Cls = IdempotencyKeyReusedError;
  return new Cls(message, { status, code, body, headers });
}
