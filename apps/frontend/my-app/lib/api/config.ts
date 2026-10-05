/**
 * API transport configuration. `NEXT_PUBLIC_*` must be referenced literally so
 * Next inlines them at build time.
 *
 * Keep `NEXT_PUBLIC_API_URL=/api`: `next.config.ts` rewrites `/api/*` to the
 * NestJS backend, so auth cookies and CSRF stay same-origin.
 */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");

/**
 * `NEXT_PUBLIC_API_MOCKING`:
 * - `enabled` → MSW answers every API call (tests, demo), mock-only features on (demo accounts, mock Google);
 * - `hybrid` → gate G of the mock-off plan: MSW answers only the `DEFERRED_KEEP_MOCK` routes of
 *   `mocks/route-allowlist.ts`, everything else (session included) is the real backend;
 * - anything else (`disabled`) → real backend, no MSW.
 */
export const isApiMockingEnabled = process.env.NEXT_PUBLIC_API_MOCKING === "enabled";
export const isHybridMocking = process.env.NEXT_PUBLIC_API_MOCKING === "hybrid";

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
