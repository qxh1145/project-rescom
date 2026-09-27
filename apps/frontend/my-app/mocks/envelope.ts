import { HttpResponse } from "msw";

/** Same envelope as `apps/backend/src/common/http/response.envelope.ts`. */

export function ok<T>(data: T, status = 200) {
  return HttpResponse.json({ data, error: null, meta: {} }, { status });
}

export function fail(
  status: number,
  code: string,
  message: string,
  options: { details?: unknown; headers?: Record<string, string> } = {},
) {
  const error =
    options.details === undefined ? { code, message } : { code, message, details: options.details };
  return HttpResponse.json({ data: null, error, meta: {} }, { status, headers: options.headers });
}

/** Backend `CsrfGuard`: session routes that mutate need `X-CSRF-Token` (`apiRequest` sends it). */
export function missingCsrf(request: Request) {
  return request.headers.get("X-CSRF-Token")
    ? undefined
    : fail(403, "AUTH_INVALID_CSRF_TOKEN", "Invalid or missing CSRF token.");
}

export function unauthorized() {
  return fail(401, "AUTH_UNAUTHORIZED", "Authentication required or session invalid.");
}
