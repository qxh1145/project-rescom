import { ApiError } from "./api-error.ts";
import { apiUrl } from "./config.ts";

/** Minimal structural contract satisfied by any zod schema. */
export interface ResponseSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiRequestOptions<T> {
  method?: HttpMethod;
  /** Serialized as JSON. */
  body?: unknown;
  /** Validates the envelope `data`. Omit only for 204 endpoints. */
  schema?: ResponseSchema<T>;
  signal?: AbortSignal;
  /**
   * Send `X-CSRF-Token` (default: true for every non-GET request). Only
   * login/register and guest-callable routes opt out.
   */
  csrf?: boolean;
}

let csrfTokenPromise: Promise<string> | null = null;

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

/** Resolves like `promise`, but rejects with `AbortError` as soon as `signal` aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** VERIFIED: GET /auth/csrf → `{ csrfToken }`. Guests get 401 `AUTH_UNAUTHORIZED`. */
async function fetchCsrfToken(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/auth/csrf"), { credentials: "same-origin", cache: "no-store" });
  } catch (cause) {
    throw new ApiError({ kind: "network", message: "Network request failed", cause });
  }
  const payload = (await readJson(res)) as ({ data?: { csrfToken?: unknown } } & ErrorEnvelope) | null;
  if (!res.ok) {
    const error = payload?.error;
    throw new ApiError({
      kind: "http",
      status: res.status,
      code: typeof error?.code === "string" ? error.code : "AUTH_CSRF_UNAVAILABLE",
      message: typeof error?.message === "string" ? error.message : "CSRF token unavailable",
      details: error?.details,
    });
  }
  const token = payload?.data?.csrfToken;
  if (typeof token !== "string") {
    throw new ApiError({ kind: "malformed", status: res.status, message: "CSRF token unavailable" });
  }
  return token;
}

/**
 * The one CSRF token cache of the app (also used by `app/forms/forms-api.ts`):
 * fetched once, shared by concurrent requests, forgotten when the fetch fails.
 * Callers keep the returned promise so a later 403 can discard exactly the
 * token they sent (`discardCsrfToken`).
 */
export function csrfTokenRequest(): Promise<string> {
  if (!csrfTokenPromise) {
    const request = fetchCsrfToken();
    csrfTokenPromise = request;
    request.catch(() => {
      if (csrfTokenPromise === request) csrfTokenPromise = null;
    });
  }
  return csrfTokenPromise;
}

/**
 * The token that `used` resolved to was rejected (`AUTH_INVALID_CSRF_TOKEN`):
 * forget it, unless a concurrent request already replaced it with a newer one.
 */
export function discardCsrfToken(used: Promise<string>): void {
  if (csrfTokenPromise === used) csrfTokenPromise = null;
}

/** `POST /auth/refresh` rotates the token and returns the new one. */
export function setCsrfToken(token: string): void {
  csrfTokenPromise = Promise.resolve(token);
}

/** Forget the cached token (after logout or a rejected token). */
export function resetCsrfToken(): void {
  csrfTokenPromise = null;
}

interface ErrorEnvelope {
  error?: { code?: unknown; message?: unknown; details?: unknown } | null;
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/** Parsed JSON body, or null when it is not JSON. An abort while reading is rethrown. */
async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    return null;
  }
}

/**
 * Typed JSON request against the RESCOM API envelope
 * (`{ data, error, meta }`). The same code path talks to MSW or the real
 * backend — only `NEXT_PUBLIC_API_MOCKING` decides who answers.
 *
 * Non-GET requests carry `X-CSRF-Token` (fetched once from `/auth/csrf`) and
 * retry once on `AUTH_INVALID_CSRF_TOKEN`; pass `csrf: false` for
 * login/register, which run before a session exists.
 */
export async function apiRequest<T>(
  path: `/${string}`,
  options: ApiRequestOptions<T> = {},
): Promise<T> {
  const { method = "GET", body, schema, signal } = options;
  const useCsrf = options.csrf ?? method !== "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  // The token promise the last attempt used: a 403 only discards that one.
  // `signal` only stops this request from waiting for it; the shared
  // `/auth/csrf` fetch keeps running for concurrent callers.
  let tokenRequest: Promise<string> | null = null;
  const send = async (): Promise<Response> => {
    if (useCsrf) {
      tokenRequest = csrfTokenRequest();
      headers["X-CSRF-Token"] = await untilAborted(tokenRequest, signal);
    }
    try {
      return await fetch(apiUrl(path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "same-origin",
        signal,
      });
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      throw new ApiError({ kind: "network", message: "Network request failed", cause });
    }
  };

  let res = await send();
  if (useCsrf && res.status === 403) {
    const payload = (await readJson(res.clone())) as ErrorEnvelope | null;
    if (payload?.error?.code === "AUTH_INVALID_CSRF_TOKEN") {
      if (tokenRequest) discardCsrfToken(tokenRequest);
      res = await send();
    }
  }

  if (!res.ok) {
    const payload = (await readJson(res)) as ErrorEnvelope | null;
    const error = payload?.error;
    throw new ApiError({
      kind: "http",
      status: res.status,
      code: typeof error?.code === "string" ? error.code : null,
      message:
        typeof error?.message === "string" ? error.message : `Request failed with ${res.status}`,
      details: error?.details,
      retryAfterSeconds: parseRetryAfter(res.headers.get("Retry-After")),
    });
  }

  if (res.status === 204 || !schema) {
    return undefined as T;
  }

  const payload = (await readJson(res)) as { data?: unknown } | null;
  const parsed = schema.safeParse(payload?.data);
  if (!parsed.success) {
    throw new ApiError({
      kind: "malformed",
      status: res.status,
      message: "Received a malformed response from the server",
    });
  }
  return parsed.data;
}
