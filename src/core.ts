/** Per-request options accepted as the last argument of every resource method. */
export interface RequestOptions {
  /** Abort the request (and any retries) with this signal. */
  signal?: AbortSignal;
  /** Timeout of each attempt in milliseconds (default: the client's `timeout`). */
  timeout?: number;
  /** Retries for this request (default: the client's `maxRetries`). */
  maxRetries?: number;
  /** Extra HTTP headers. */
  headers?: Record<string, string>;
  /**
   * Idempotency-Key of a POST / PATCH. Default: a new UUID v4 per call, reused by every retry of that call. Pass your
   * own (e.g. an order id) to make a call safe to repeat across processes or restarts.
   */
  idempotencyKey?: string;
}

/** A request as the resource classes describe it to the client. */
export interface FinalRequest extends RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: object;
  body?: object;
  /** Name of the body field that holds a file; when it is set the body is sent as multipart/form-data. */
  fileField?: string;
}

/** What the generated resource classes need from the client. */
export interface Requester {
  request<T>(req: FinalRequest): Promise<T>;
}

/** Encodes one path parameter. */
export function encodePath(value: string | number): string {
  return encodeURIComponent(String(value));
}

/** A random UUID v4 (Web Crypto when available – Node 18+, browsers, edge runtimes). */
export function uuid4(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: <T extends Uint8Array>(a: T) => T } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
