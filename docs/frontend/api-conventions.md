# API conventions

## Transport

- Base URL: `NEXT_PUBLIC_API_URL` (default `/api`). Keep it relative: `next.config.ts`
  rewrites `/api/*` to `RESCOM_API_URL` (default `http://localhost:4000`), so auth cookies
  and CSRF stay same-origin. An absolute cross-origin URL breaks the httpOnly-cookie session.
- Call `apiRequest(path, { method, body, schema, signal })` from `lib/api/client.ts`.
  Never hardcode hosts; paths are relative to the base (`"/auth/login"`).
- Requests send `Accept: application/json`, JSON bodies with `Content-Type`, and
  `credentials: "same-origin"`.

## Envelope (backend `common/http/response.envelope.ts`)

```json
{ "data": <T>,  "error": null, "meta": {} }
{ "data": null, "error": { "code": "AUTH_INVALID_CREDENTIALS", "message": "…", "details": … }, "meta": {} }
```

`apiRequest` validates `data` with the given schema and throws `ApiError`:

| `kind` | When | Useful fields |
|---|---|---|
| `http` | non-2xx | `status`, `code`, `details` (zod `format()` on 400), `retryAfterSeconds` (429) |
| `network` | no response | — |
| `malformed` | 2xx with invalid `data` | `status` |

Aborts (`AbortError`) are rethrown untouched.

## Error copy

Map codes to Vietnamese text in the domain layer, never in components. Auth:
`lib/auth/auth-error-messages.ts` (`getAuthErrorMessage`, `getOAuthErrorMessage`).

## CSRF

Login, register and `GET /auth/me` need none. `apiRequest` sends `X-CSRF-Token` on every
non-GET request. Legacy fetch helpers in `app/forms/forms-api.ts` (`formMutationFetch`,
`optionalCsrfMutationFetch`) use the same token cache (`csrfTokenRequest()` in
`lib/api/client.ts`) — there is one cache per tab. On `AUTH_INVALID_CSRF_TOKEN` a request
discards only the token it sent (a concurrent request may already have fetched a newer
one) and retries once. `/auth/csrf` failures surface as `ApiError` (`network`, or `http`
with the backend `code`).

## Session refresh

The access cookie lives `JWT_ACCESS_TTL_SECONDS` (ASSUMED 900 s, the backend default and
maximum; not exposed by the API). Once it is gone `SessionAuthGuard` answers 401 **and
clears the refresh cookie**, so `SessionProvider` refreshes proactively
(`lib/auth/session-refresh.ts`): single-flight `POST /auth/refresh` at 80 % of the TTL,
again when the tab becomes visible and the last refresh is older than that, and before
the first `GET /auth/me` of a page load when the last refresh (localStorage, shared by
tabs) is stale. The refresh rotates the CSRF token; the new one replaces the cached one.

## Contract labels

Mark every endpoint in code comments/docs as one of:

- **VERIFIED** — checked against `apps/backend/src/**/presentation/*.controller.ts` and
  `packages/schemas`.
- **ASSUMED API CONTRACT** — backend route does not exist yet; frontend-designed shape.
- **MOCK-ONLY** — exists only in MSW (e.g. `POST /auth/google/mock-complete`,
  `GET /mock/demo-accounts`); must be unreachable when mocking is disabled.

## Auth endpoints in use

| Endpoint | Label | Notes |
|---|---|---|
| `POST /auth/login` | VERIFIED | 200 `{ user }`; 400/401/403/429 |
| `POST /auth/register` | VERIFIED | 201 `{ user }`; password ≥ 12 chars; 409 if taken |
| `GET /auth/me` | VERIFIED | `data` is the user itself (not `{ user }`) |
| `GET /auth/csrf` | VERIFIED | Session or refresh cookie → `{ csrfToken }` (rotates the token); guests 401 |
| `POST /auth/refresh` | VERIFIED | Refresh cookie + `X-CSRF-Token` + `Origin` → 200 `{ csrfToken }`, rotates cookies and CSRF; 401 `AUTH_INVALID_REFRESH_TOKEN`/`AUTH_SESSION_*`, 403 `AUTH_INVALID_CSRF_TOKEN`/`AUTH_USER_LOCKED` |
| `POST /auth/logout` | VERIFIED | CSRF → 204 |
| `GET /auth/google` | VERIFIED | Full-page navigation → `/auth/callback` or `/auth/error?error=CODE` |
| `GET /demographics` | VERIFIED | `isComplete` drives the post-login redirect |
| `POST /auth/google/link/start` | VERIFIED | Session + CSRF, `{ currentPassword }` → 200 `{ authorizationUrl }` for JSON clients; 401 wrong password, 409 already linked. 15d calls `POST /auth/login` first |
| `GET /auth/error?error=AUTH_GOOGLE_LINK_REQUIRED` | VERIFIED | Backend redirect; the frontend sends it to `/auth/link-google` (15d). No email is passed |
| `POST /auth/password/forgot` | ASSUMED API CONTRACT | `{ email }` → 202, same answer whether the account exists; guest route (no CSRF). 404/501 (route missing) → "feature not available yet" copy |
| `POST /auth/google/mock-complete` | MOCK-ONLY | Replaces the Google round-trip in mock mode |
| `GET /mock/demo-accounts` | MOCK-ONLY | Demo credentials shown on `/login` in mock mode |

Session replaced on another device (15e): the backend keeps one session per user; the
old token then gets a generic 401 `AUTH_UNAUTHORIZED` (no dedicated code). The dialog is
driven by the ASSUMED signal `/login?reason=session-replaced[&at=<ISO>]`
(`lib/auth/session-notice.ts`).
