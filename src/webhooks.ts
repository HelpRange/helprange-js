import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookVerificationError } from './errors.js';
import type { WebhookEvent, WebhookEventType } from './generated/types.js';

/** Default tolerance for the signature timestamp, in seconds (the same as HelpRange's own check). */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** Headers as a Headers object, a Node `IncomingHttpHeaders` or any plain object. */
export type HeadersLike = Headers | Record<string, string | string[] | undefined>;

export interface VerifyWebhookOptions {
  /** Maximum age (and clock skew) of the signature timestamp in seconds. Default 300. */
  tolerance?: number;
  /** Current time in Unix seconds (for tests). */
  now?: number;
}

/** A verified webhook event. */
export interface HelpRangeWebhookEvent extends WebhookEvent {
  event: WebhookEventType | (string & {});
}

function header(headers: HeadersLike, name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  const wanted = name.toLowerCase();
  for (const [k, v] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (k.toLowerCase() === wanted) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

function toBuffer(payload: string | Uint8Array | ArrayBuffer): Buffer {
  if (typeof payload === 'string') return Buffer.from(payload, 'utf8');
  if (payload instanceof ArrayBuffer) return Buffer.from(payload);
  return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
}

/**
 * Hex HMAC-SHA256 of `"<timestamp>.<raw body>"` – the `v1` signature HelpRange sends in `HelpRange-Signature`.
 * Exposed so you can sign test payloads.
 */
export function computeSignature(payload: string | Uint8Array | ArrayBuffer, secret: string, timestamp: number): string {
  return createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${Math.trunc(timestamp)}.`, 'utf8'), toBuffer(payload)]))
    .digest('hex');
}

/** Builds a `HelpRange-Signature` header value (`t=<unix>,v1=<hex>`) – handy in tests of your webhook handler. */
export function signWebhookPayload(payload: string | Uint8Array | ArrayBuffer, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${Math.trunc(timestamp)},v1=${computeSignature(payload, secret, timestamp)}`;
}

/**
 * Verifies a HelpRange webhook and returns the parsed event.
 *
 * HelpRange signs every delivery with `HelpRange-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
 * For 24 hours after a secret rotation the header carries a second `v1=` signed with the previous secret; any match is
 * accepted. The timestamp must be within `tolerance` seconds (default 300) of now.
 *
 * Pass the **raw** request body (string or bytes) exactly as received – not a re-serialised JSON object.
 *
 * @param payload  raw request body
 * @param headers  request headers (Headers, Node IncomingHttpHeaders or a plain object; names are case-insensitive)
 * @param secret   the endpoint's signing secret (`whsec_…`), or several secrets during your own rotation
 * @throws WebhookVerificationError when the header is missing or malformed, the timestamp is too old, or no signature matches
 */
export function verifyWebhook(
  payload: string | Uint8Array | ArrayBuffer,
  headers: HeadersLike,
  secret: string | string[],
  options: VerifyWebhookOptions = {},
): HelpRangeWebhookEvent {
  const sig = header(headers, 'helprange-signature');
  if (!sig) throw new WebhookVerificationError('Missing HelpRange-Signature header.');
  const parts = sig
    .split(',')
    .filter((p) => p.includes('='))
    .map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
    });
  const ts = parts.find(([k]) => k === 't')?.[1];
  if (!ts || !/^\d+$/.test(ts)) throw new WebhookVerificationError('HelpRange-Signature has no valid timestamp.');
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options.now ?? Date.now() / 1000;
  if (Math.abs(now - Number(ts)) > tolerance) {
    throw new WebhookVerificationError(`Webhook timestamp is outside the tolerance of ${tolerance} seconds.`);
  }
  const candidates = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  const secrets = (Array.isArray(secret) ? secret : [secret]).filter(Boolean);
  if (!secrets.length) throw new WebhookVerificationError('No webhook secret given.');
  const ok = secrets.some((s) => {
    const expected = Buffer.from(computeSignature(payload, s, Number(ts)), 'utf8');
    return candidates.some((c) => {
      const got = Buffer.from(c, 'utf8');
      return got.length === expected.length && timingSafeEqual(got, expected);
    });
  });
  if (!ok) throw new WebhookVerificationError('No HelpRange-Signature v1 signature matches the payload.');
  try {
    return JSON.parse(toBuffer(payload).toString('utf8')) as HelpRangeWebhookEvent;
  } catch (cause) {
    throw new WebhookVerificationError('Webhook payload is not valid JSON.', { cause });
  }
}
