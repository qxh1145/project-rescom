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

## Participation endpoints in use (Phase 3 — respondent flow)

Services: `lib/participation/*-service.ts`, `lib/marketplace/marketplace-service.ts`.
Mocks: `mocks/handlers/participation*.ts`, `mocks/handlers/marketplace.ts`.

| Endpoint | Label | Notes |
|---|---|---|
| `GET /marketplace/feed` | VERIFIED | 403 `DEMOGRAPHIC_PROFILE_REQUIRED`; `topic` per card is an ASSUMED extension |
| `GET /surveys/:id` | ASSUMED API CONTRACT | The one survey summary (consent card 14 + public 18.7 "đã đủ người"): `id, title, type, status, rewardPerResponse, estimatedEffortSeconds, expectedCompletions, completedCompletions, publisherName?`. **Public** (no session), 404 `SURVEY_NOT_FOUND` |
| `POST /surveys/:id/attempts` | VERIFIED | 201 `surveyAttemptResponseSchema`. 409 `CONFLICTING_ACTIVE_ATTEMPT` (details = own attempt → resume), 409 `SURVEY_QUOTA_FULL` (completions + active reservations), 409 `SURVEY_ALREADY_COMPLETED`, 409 `COMPLETION_CODE_LIMIT_REACHED` (External, 6 wrong codes on the version → info + "Báo Admin"), **404** `SURVEY_NOT_AVAILABLE`, 403 `DEMOGRAPHIC_PROFILE_REQUIRED`, 429 `PARTICIPATION_RATE_LIMITED` (`details.scope === "COMPLETIONS"` → copy with limit / window / `retryAfterSeconds`) |
| `GET /attempts/:attemptId` | ASSUMED API CONTRACT | No backend read route. `status` = backend `AttemptStatus` (`IN_PROGRESS \| COMPLETED \| ABANDONED \| LOCKED`; expiry derived from `expiresAt`); ASSUMED extras: `rewardStatus` (reward state of a COMPLETED attempt: `PENDING` 48h / `HELD_IN_INTEGRITY` / `SETTLED`), `closedReason` (`EXPIRED \| CANCELLED`), `versionNumber` (pinned FormVersion), `accountWrongCodeCount` (E5-D1 total), `timeBarrier` |
| `POST /attempts/:attemptId/cancel` | ASSUMED API CONTRACT | "Huỷ lượt làm" and the in-Rescom restart after a form update → `{ attemptId, status: "ABANDONED" }`; 409 `ATTEMPT_NOT_IN_PROGRESS` |
| `GET /public/forms/:id` | VERIFIED | `publicFormDetailsSchema` (+ ASSUMED `sections`); `versionNumber` is compared with the attempt's |
| `POST /responses/:responseId/submit` | VERIFIED | 200 `internalFormSubmissionResponseSchema`; a resubmission replays the original result (200, decision E5-D3); 400 `INVALID_FORM_SUBMISSION` (details by block id — only the form's block ids are marked), 409 `ATTEMPT_EXPIRED`, 422 `SUBMISSION_TOO_FAST`, 429 |
| `POST /responses/:responseId/integrity-events` | VERIFIED | Telemetry batches; `consentNoticeVersion` = the accepted notice version |
| `GET /attempts/:attemptId/outcome` | ASSUMED API CONTRACT | Reward of a finished attempt + `accountActivated` (only claimed for a confirmed reward) |
| `GET` / `POST /attempts/:attemptId/feedback` | VERIFIED | Rating form (Figma 6) |
| `POST /attempts/:attemptId/verify-code` | VERIFIED | 400 `INVALID_COMPLETION_CODE` (`details.remainingAttempts`; 0 while the attempt still had tries = account limit), 409 `ATTEMPT_LOCKED` / `COMPLETION_CODE_LIMIT_REACHED` / `ATTEMPT_EXPIRED`, 422 `SUBMISSION_TOO_FAST` |
| `POST /attempts/:attemptId/report-missing-code` | VERIFIED | Backend refuses a LOCKED attempt (409 `ATTEMPT_LOCKED`; the mock accepts it for Figma 5c) |
| `GET` / `POST /integrity/consent` | ASSUMED API CONTRACT | Notice version accepted per user |
| `GET /integrity/reliability/me` | ASSUMED API CONTRACT | Trust screen |
| `GET /economy/starter-points/status` | VERIFIED | `PENDING_CONFIRMATION` while a Google Forms reward is in its 48h review |

Session loss: a 401 / `AUTH_USER_LOCKED` on any of these calls triggers
`useSession().refresh()` (`useSessionLossRedirect`, `lib/session/use-session-loss.ts`) so
`SessionGate` redirects; local drafts are kept (logout clears them).

### Contract gap: pinned form version

An attempt is pinned to `formVersionId`, but the only respondent read route for questions,
`GET /public/forms/:id`, returns the **current** published version and no `formVersionId`.
Until the backend serves the pinned version (e.g. `GET /attempts/:id/form`) or exposes the
version id, the frontend compares the ASSUMED `versionNumber` of `GET /attempts/:id` with
the form's `versionNumber`; on a mismatch the runner shows "Khảo sát vừa được cập nhật — bắt
đầu lại" (cancel via the ASSUMED cancel route, drop the draft, back to the consent screen).
Without `versionNumber` no check is made.

### Contract gap: complaints about an in-Rescom response

The complaint flow only exists for a Google Forms (`EXTERNAL`) attempt pending its 48h
review: `app/(signed-in)/(app)/forms/[id]/complaints/[attemptId]/page.tsx`. There is no
backend route to complain about one answer of an in-Rescom (`INTERNAL`) response, so the
"Khiếu nại về câu trả lời này" link was removed from the responses screen
(`ResponseAnswers.tsx`, `ResponsesScreen.tsx`, `ResponsesMobile.tsx`) rather than pointing
at a 404. Restore it once a backend complaint route for in-Rescom responses exists.

## Publisher results endpoints in use (Phase 5C — Câu trả lời)

Services: `lib/forms/results-service.ts`, `lib/forms/results-analytics-service.ts`.
Mocks: `mocks/handlers/forms-results.ts`, `mocks/handlers/forms-analytics.ts`.

| Endpoint | Label | Notes |
|---|---|---|
| `GET /forms/:id/responses[?versionNumber=]` | ASSUMED API CONTRACT | Questions + anonymous rows of one version (Từng câu trả lời) |
| `GET /forms/:id/analytics[?versionNumber=]` | ASSUMED API CONTRACT | Per-question aggregation of one version (Tóm tắt / Theo câu hỏi): totals, `startedCount`, and per question `answeredCount`/`skippedCount` + a `choice` / `scale` / `number` / `text` / `file` summary. `percentage` = count / answeredCount × 100 (1 decimal, server-side; multiple choice may exceed 100). Owner or ADMIN; 404 `FORM_NOT_FOUND` / `FORM_VERSION_NOT_FOUND`, 403 `FORM_FORBIDDEN`. Reference aggregation: `mocks/data/form-analytics.ts` |
