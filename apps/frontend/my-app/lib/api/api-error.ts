export type ApiErrorKind = "http" | "network" | "malformed";

export interface ApiErrorInit {
  kind: ApiErrorKind;
  message: string;
  status?: number | null;
  code?: string | null;
  details?: unknown;
  retryAfterSeconds?: number | null;
  cause?: unknown;
}

/**
 * Every failure from `apiRequest` is an `ApiError`:
 * - `http`: the server answered non-2xx (`code`/`details` come from the envelope);
 * - `network`: no response (offline, DNS, CORS, MSW `HttpResponse.error()`);
 * - `malformed`: 2xx whose `data` failed schema validation, or a non-JSON body.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly details: unknown;
  readonly retryAfterSeconds: number | null;

  constructor(init: ApiErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ApiError";
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.details = init.details;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
