import type { FinalRequest, RequestOptions, Requester } from './core.js';
import { uuid4 } from './core.js';
import { APIConnectionError, APITimeoutError, HelpRangeError, IdempotencyKeyInProgressError, errorFromResponse } from './errors.js';
import { createResources, type Resources } from './generated/resources.js';
import type { CreateLinkBody, CreateLinkResponse, UploadFileBody, UploadFileResponse } from './generated/types.js';
import { API_VERSION } from './generated/spec-version.js';
import { VERSION } from './version.js';

export const DEFAULT_BASE_URL = 'https://www.helprange.com';
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_RETRIES = 2;
/** Longer Retry-After waits (a daily cap, a paused API) are not slept through; the RateLimitError is thrown. */
export const DEFAULT_MAX_RETRY_AFTER_S = 60;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface HelpRangeOptions {
  /** Team API key (`hr_live_…` or `hr_test_…`). Default: the HELPRANGE_API_KEY environment variable. */
  apiKey?: string;
  /** API origin. Default `https://www.helprange.com` (or HELPRANGE_BASE_URL). */
  baseUrl?: string;
  /** Timeout of each attempt in milliseconds. Default 60000. */
  timeout?: number;
  /** How many times to retry a failed request (see README → Retries). Default 2. */
  maxRetries?: number;
  /** Longest Retry-After (seconds) the client waits for on a 429 before giving up. Default 60. */
  maxRetryAfter?: number;
  /** A fetch implementation (default: the global fetch of Node 18+). Handy for tests and proxies. */
  fetch?: FetchLike;
  /** Headers sent with every request. */
  defaultHeaders?: Record<string, string>;
}

/** Usage-limit headers of the latest response (`X-RateLimit-*`, `X-HelpRange-Livemode`). */
export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  /** Unix time when the current hour ends. */
  reset?: number;
  livemode?: boolean;
}

/** Arguments of {@link HelpRange.share}: an upload plus the settings of the new share link. */
export interface ShareParams extends UploadFileBody {
  /** Settings of the share link (label, passcode, expires_on, watermark, …). */
  link?: CreateLinkBody;
}

export interface ShareResult {
  document: UploadFileResponse;
  link: CreateLinkResponse;
}

const RETRYABLE_STATUS = new Set([408, 500, 502, 503, 504]);
/** Methods that get an Idempotency-Key (and with it, retries on network errors and 5xx). */
const KEYED_METHODS = new Set(['POST', 'PATCH']);
/** How often a 409 idempotency_key_in_progress is retried (on top of maxRetries, with backoff of ~1-8 s). */
export const IN_PROGRESS_MAX_RETRIES = 5;

function env(name: string): string | undefined {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return p?.env?.[name] || undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Seconds from a Retry-After header (delta-seconds or an HTTP date). */
export function parseRetryAfter(value: string | null | undefined, nowMs = Date.now()): number | undefined {
  if (!value) return undefined;
  if (/^\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, (at - nowMs) / 1000);
}

/**
 * The HelpRange API client.
 *
 * ```ts
 * import { HelpRange } from 'helprange';
 * const hr = new HelpRange({ apiKey: process.env.HELPRANGE_API_KEY });
 * const { documents } = await hr.documents.list();
 * ```
 *
 * Resources mirror the tags of the API reference: `account`, `folders`, `documents`, `links`, `triggers`, `dataRooms`
 * (with `guests`, `documents`, `folders`, … sub-resources), `ndas`, `signatureRequests`, `offers`, `store`,
 * `leadForms`, `activity`, `webhookEndpoints`.
 */
export class HelpRange implements Requester {
  readonly baseUrl: string;
  readonly timeout: number;
  readonly maxRetries: number;
  readonly maxRetryAfter: number;
  /** Usage-limit headers of the latest response. */
  rateLimit: RateLimitInfo = {};
  /** Spec version this SDK was generated from. */
  static readonly API_VERSION = API_VERSION;
  static readonly VERSION = VERSION;

  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #headers: Record<string, string>;

  constructor(options: HelpRangeOptions = {}) {
    const apiKey = options.apiKey ?? env('HELPRANGE_API_KEY');
    if (!apiKey) {
      throw new HelpRangeError('No API key: pass { apiKey } or set HELPRANGE_API_KEY. Create one in Settings → API keys.');
    }
    this.#apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? env('HELPRANGE_BASE_URL') ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxRetryAfter = options.maxRetryAfter ?? DEFAULT_MAX_RETRY_AFTER_S;
    const f = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) throw new HelpRangeError('No global fetch – use Node 18+ or pass { fetch }.');
    this.#fetch = f;
    this.#headers = { ...(options.defaultHeaders ?? {}) };
    Object.assign(this, createResources(this));
  }

  /** True for a test-mode key (`hr_test_…`): every call works on your team's sandbox, never on live data. */
  get testMode(): boolean {
    return this.#apiKey.startsWith('hr_test_');
  }

  /** The visible prefix of the key, e.g. `hr_live_Ab3x…` (never the whole key). */
  get keyHint(): string {
    return this.#apiKey.slice(0, 12) + '…';
  }

  /**
   * Uploads a file and creates a share link for it in one call.
   *
   * ```ts
   * const { link } = await hr.share({ file: await readFile('deck.pdf'), filename: 'deck.pdf',
   *   link: { label: 'ACME - Anna', expires_on: '2026-12-31', allow_download: false } });
   * console.log(link.url);
   * ```
   */
  async share(params: ShareParams, options?: RequestOptions): Promise<ShareResult> {
    const { link, ...upload } = params;
    // With options.idempotencyKey both calls stay idempotent: the upload uses the key, the link `${key}:link`.
    const document = await this.documents.upload(upload, options);
    const linkOptions = options?.idempotencyKey ? { ...options, idempotencyKey: `${options.idempotencyKey}:link` } : options;
    const created = await this.documents.createLink(document.id, link ?? {}, linkOptions);
    return { document, link: created };
  }

  /**
   * Sends a request and returns the parsed JSON. The resource methods call this; use it directly for endpoints
   * this SDK version does not wrap yet.
   */
  async request<T>(req: FinalRequest): Promise<T> {
    const url = this.#url(req.path, req.query);
    const maxRetries = req.maxRetries ?? this.maxRetries;
    const timeout = req.timeout ?? this.timeout;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.#apiKey}`,
      'User-Agent': `helprange-node/${VERSION}`,
      ...this.#headers,
      ...(req.headers ?? {}),
    };
    // One Idempotency-Key per call, the same for every retry: the API runs the request once and replays the answer.
    const keyHeader = Object.keys(headers).find((h) => h.toLowerCase() === 'idempotency-key');
    if (req.idempotencyKey) {
      if (keyHeader) delete headers[keyHeader];
      headers['Idempotency-Key'] = req.idempotencyKey;
    } else if (!keyHeader && KEYED_METHODS.has(req.method)) {
      headers['Idempotency-Key'] = uuid4();
    }
    const retrySafe = req.method === 'GET' || Object.keys(headers).some((h) => h.toLowerCase() === 'idempotency-key');
    let inProgressRetries = 0;
    let body: BodyInit | undefined;
    if (req.body !== undefined && req.method !== 'GET') {
      const file = req.fileField ? (req.body as Record<string, unknown>)[req.fileField] : undefined;
      if (file !== undefined && file !== null) {
        body = this.#multipart(req.body as Record<string, unknown>, req.fileField!);
      } else {
        body = JSON.stringify(req.body);
        headers['Content-Type'] = 'application/json';
      }
    }

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const onAbort = () => controller.abort(req.signal?.reason);
      req.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new APITimeoutError(`Request timed out after ${timeout} ms.`)), timeout);
      let res: Response;
      try {
        res = await this.#fetch(url, { method: req.method, headers, body, signal: controller.signal });
      } catch (err) {
        clearTimeout(timer);
        req.signal?.removeEventListener('abort', onAbort);
        if (req.signal?.aborted) throw err;
        const timedOut = controller.signal.reason instanceof APITimeoutError;
        const error = timedOut
          ? new APITimeoutError(`Request timed out after ${timeout} ms.`, { cause: err })
          : new APIConnectionError(`Connection error: ${(err as Error)?.message ?? err}`, { cause: err });
        if (retrySafe && attempt < maxRetries) {
          await sleep(this.#backoff(attempt), req.signal);
          continue;
        }
        throw error;
      }
      let parsed: unknown;
      try {
        parsed = await this.#parse(res);
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener('abort', onAbort);
      }
      this.#trackRateLimit(res.headers);
      if (res.ok) return parsed as T;

      const error = errorFromResponse(res.status, parsed, res.headers);
      if (error instanceof IdempotencyKeyInProgressError && maxRetries > 0 && inProgressRetries < IN_PROGRESS_MAX_RETRIES) {
        // The first request with this key is still running; once it finishes the API replays its answer.
        inProgressRetries++;
        const wait = parseRetryAfter(res.headers.get('retry-after'));
        await sleep(wait !== undefined && wait <= this.maxRetryAfter ? wait * 1000 : this.#backoff(inProgressRetries), req.signal);
        attempt--; // does not use up maxRetries
        continue;
      }
      if (attempt < maxRetries) {
        if (res.status === 429) {
          // The API did not carry out the request, so a retry is safe for any method.
          const wait = parseRetryAfter(res.headers.get('retry-after')) ??
            (typeof (parsed as { retry_after?: unknown })?.retry_after === 'number' ? (parsed as { retry_after: number }).retry_after : undefined);
          if (wait === undefined || wait <= this.maxRetryAfter) {
            await sleep(wait !== undefined ? wait * 1000 : this.#backoff(attempt), req.signal);
            continue;
          }
        } else if (retrySafe && RETRYABLE_STATUS.has(res.status)) {
          const wait = parseRetryAfter(res.headers.get('retry-after'));
          await sleep(wait !== undefined && wait <= this.maxRetryAfter ? wait * 1000 : this.#backoff(attempt), req.signal);
          continue;
        }
      }
      throw error;
    }
  }

  #url(path: string, query?: object): string {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null) continue;
      for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, String(item));
    }
    return url.toString();
  }

  #multipart(body: Record<string, unknown>, fileField: string): FormData {
    const form = new FormData();
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined || v === null || k === fileField) continue;
      form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    const file = body[fileField];
    const blob = file instanceof Blob ? file : new Blob([file as BlobPart]);
    const name = (typeof body.filename === 'string' && body.filename) || (file as { name?: string }).name || 'upload';
    form.append(fileField, blob, name);
    return form;
  }

  async #parse(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return {};
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('json') || /^[\[{]/.test(text.trim())) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text;
  }

  #trackRateLimit(h: Headers): void {
    const num = (name: string) => {
      const v = h.get(name);
      return v !== null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined;
    };
    const live = h.get('x-helprange-livemode');
    this.rateLimit = {
      limit: num('x-ratelimit-limit'),
      remaining: num('x-ratelimit-remaining'),
      reset: num('x-ratelimit-reset'),
      livemode: live === null ? undefined : live === 'true',
    };
  }

  #backoff(attempt: number): number {
    const base = Math.min(8000, 500 * 2 ** attempt);
    return base * (0.75 + Math.random() * 0.25);
  }
}

// Every resource (documents, dataRooms, …) is a property of the client.
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface HelpRange extends Resources {}
