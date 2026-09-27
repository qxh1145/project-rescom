/**
 * API transport configuration. `NEXT_PUBLIC_*` must be referenced literally so
 * Next inlines them at build time.
 *
 * Keep `NEXT_PUBLIC_API_URL=/api`: `next.config.ts` rewrites `/api/*` to the
 * NestJS backend, so auth cookies and CSRF stay same-origin.
 */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");

/** `enabled` → MSW intercepts API calls in the browser; anything else → real backend. */
export const isApiMockingEnabled = process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

export function apiUrl(path: `/${string}`): string {
  return `${API_BASE_URL}${path}`;
}

/**
 * Google sign-in is a full-page navigation, which MSW cannot intercept. In mock
 * mode the button goes straight to the callback page, which completes a
 * MOCK-ONLY sign-in through `POST /auth/google/mock-complete`.
 */
export const MOCK_GOOGLE_PROVIDER = "mock-google";

/**
 * The real flow cannot carry `returnTo` (the backend keeps its own OAuth
 * intent and always lands on `/auth/callback`), so it is only kept in mock mode.
 */
export function getGoogleSignInUrl(returnTo?: string | null): string {
  if (!isApiMockingEnabled) return apiUrl("/auth/google");
  const params = new URLSearchParams({ provider: MOCK_GOOGLE_PROVIDER });
  if (returnTo) params.set("returnTo", returnTo);
  return `/auth/callback?${params.toString()}`;
}
