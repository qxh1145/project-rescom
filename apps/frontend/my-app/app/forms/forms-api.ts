import type { FormInProgressAttemptsDto } from "@rescom/schemas";

let csrfTokenPromise: Promise<string> | null = null;

async function loadCsrfToken(): Promise<string> {
  const response = await fetch("/api/auth/csrf", {
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  const token = payload?.data?.csrfToken;
  if (!response.ok || typeof token !== "string") {
    throw new Error(
      payload?.error?.message || "Unable to establish a secure form session",
    );
  }
  return token;
}

function getCsrfToken(): Promise<string> {
  csrfTokenPromise ??= loadCsrfToken().catch((error) => {
    csrfTokenPromise = null;
    throw error;
  });
  return csrfTokenPromise;
}

export async function formMutationFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  async function send(token: string) {
    const headers = new Headers(init.headers);
    headers.set("X-CSRF-Token", token);
    return fetch(input, {
      ...init,
      headers,
      credentials: init.credentials ?? "same-origin",
    });
  }

  const tokenRequest = getCsrfToken();
  let response = await send(await tokenRequest);
  if (response.status === 403) {
    const payload = await response.clone().json().catch(() => ({}));
    if (payload?.error?.code === "AUTH_INVALID_CSRF_TOKEN") {
      if (csrfTokenPromise === tokenRequest) csrfTokenPromise = null;
      response = await send(await getCsrfToken());
    }
  }
  return response;
}

/**
 * AD-20 / Epic 5 review P12: CSRF handling for `@Public()` mutations that
 * guests may also call (survey attachment uploads, internal submissions).
 * With a session, `X-CSRF-Token` is attached exactly like
 * `formMutationFetch` (including the one-time `AUTH_INVALID_CSRF_TOKEN`
 * retry). A guest cannot obtain a token (`GET /api/auth/csrf` returns 401),
 * so the request is sent without it and relies on the browser's same-origin
 * `Origin` header.
 */
export async function optionalCsrfMutationFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  async function send(token: string | null) {
    const headers = new Headers(init.headers);
    if (token) headers.set("X-CSRF-Token", token);
    return fetch(input, {
      ...init,
      headers,
      credentials: init.credentials ?? "same-origin",
    });
  }

  const tokenRequest = getCsrfToken();
  let response = await send(await tokenRequest.catch(() => null));
  if (response.status === 403) {
    const payload = await response.clone().json().catch(() => ({}));
    if (payload?.error?.code === "AUTH_INVALID_CSRF_TOKEN") {
      if (csrfTokenPromise === tokenRequest) csrfTokenPromise = null;
      const freshToken = await getCsrfToken().catch(() => null);
      if (freshToken) response = await send(freshToken);
    }
  }
  return response;
}

/**
 * Code-review decision E5-D4: how many respondents are currently taking the
 * survey — "Create New Version" cuts them off (strict), so the builder warns
 * the Publisher before confirming. Owner or Admin only.
 */
export async function fetchInProgressAttempts(
  formId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FormInProgressAttemptsDto> {
  const response = await fetchImpl(
    `/api/forms/${encodeURIComponent(formId)}/in-progress-attempts`,
    { credentials: "same-origin", cache: "no-store" },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.data) {
    throw new Error(
      payload?.error?.message || "Không tải được số lượt làm bài đang dở.",
    );
  }
  return payload.data as FormInProgressAttemptsDto;
}
