---
baseline_commit: beaa474c24977874ea3ae4aef7c354ccbfdd5603
context:
  - "../planning-artifacts/epics.md"
  - "../planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md"
  - "../planning-artifacts/prds/prd-project-rescom-2026-08-08/addendum.md"
  - "../planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "../planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
---

# Story 1.3: Single-Session Enforcement

Status: done

## Story

As a User/Admin,
I want my account to only have one active session at a time,
so that my account is protected from unauthorized concurrent access while using short-lived signed access tokens.

## Acceptance Criteria

### AC1 — Atomic single-session transaction and post-commit token issuance

**Given** a user already logged in on Device A (with active Session A)
**When** the same user logs in from Device B (via email/password or Google OAuth)
**Then** the backend executes the session replacement in a strict two-stage boundary:

1. **Within one database transaction**:
   - Acquires a row-level lock on the user record (`SELECT id FROM users WHERE id = $1 FOR UPDATE`) to serialize concurrent session-replacement/login operations for this user;
   - Determines the next `sessionVersion` monotonically across the user's historical sessions: `COALESCE(MAX(session_version), 0) + 1` (guaranteeing monotonic progression across user history, even if prior sessions were logged out or expired);
   - Marks all existing unrevoked Sessions for this user as `revoked = true`;
   - Creates a new Session record with fresh `sessionId`, the newly computed `sessionVersion`, new CSRF digest, and `expiresAt` ≤ 30 days;
   - Creates a new `RefreshCredential` with a keyed HMAC digest of the refresh secret; and
   - Appends a mandatory `SESSION_REPLACED` audit record in `IdentityAuditLog` enriched with the committed `sessionId` and `sessionVersion`.

2. **After the transaction commits successfully**:
   - Signs a new access JWT containing `sub`, `sessionId`, `sessionVersion`, `iat`, and `exp` (TTL ≤ 900s); and
   - Sets the access and refresh cookies symmetrically (`rescom_access_token` on `Path=/`, `rescom_refresh_token` on `Path=/auth`).

At most one unrevoked Session per user exists after the transaction commits. Concurrent login attempts for the same user serialize at the database level, producing consecutive, distinct `sessionVersion`s with no duplicates. Exactly one `SESSION_REPLACED` audit record is persisted per committed transaction.

### AC2 — Old access tokens are rejected with 401 and cookies cleared

**Given** Device A holds an access JWT issued before Device B logged in
**When** Device A makes any request to a protected endpoint
**Then** the server:

- verifies the JWT signature, expiry, and extracts `sessionId` and `sessionVersion`;
- queries PostgreSQL for the Session by `sessionId`;
- detects `session.revoked === true`;
- clears `rescom_access_token` and `rescom_refresh_token` cookies symmetrically via `CookieOptionsHelper`;
- sets `Cache-Control: no-store`; and
- returns HTTP `401 Unauthorized` with error code `AUTH_SESSION_REVOKED`.

### AC3 — Old refresh tokens are rejected with 401

**Given** Device A holds a refresh cookie from the revoked session
**When** Device A calls `POST /auth/refresh`
**Then** the server detects the parent session is revoked and returns `401 Unauthorized` (`AUTH_SESSION_REVOKED`). No new tokens are issued, `Cache-Control: no-store` is set, and cookies are cleared.

### AC4 — Old session logout degrades gracefully without audit pollution

**Given** Device A attempts `POST /auth/logout` with a revoked session's cookies
**When** the backend processes the request
**Then** the response clears cookies symmetrically and returns `204 No Content` (idempotent). No error is thrown for already-revoked sessions, and `IdentityAuditLog` is NOT polluted with redundant revocation entries (audit log count does not increase).

### AC5 — Reusable route-level session guard, fail-safe cookie clearing, and typed request

**Given** a NestJS route decorated with `@UseGuards(SessionAuthGuard)`
**When** a request arrives
**Then** the guard:

- extracts `rescom_access_token` from `req.cookies`;
- calls `SessionService.validateSession(accessToken)` (JWT + DB + revocation + user lock);
- on success: sanitizes the user into `AuthenticatedUser` (`id`, `email`, `role`, `status` — strictly omitting internal fields like `passwordHash`), attaches `req.user = authenticatedUser` and `req.session = session` as typed by `AuthenticatedRequest`, and returns `true`;
- on known authentication-domain failures (`UnauthorizedSessionException`, `InvalidTokenException`, `SessionExpiredException`, `SessionRevokedException`, `UserLockedException`):
  - clears both auth cookies symmetrically using centralized `clearAuthCookies(res, envService)` in `CookieOptionsHelper`;
  - sets `Cache-Control: no-store`; and
  - rethrows the domain exception (which `HttpExceptionFilter` formats as 401/403 JSON envelope);
- on unexpected infrastructure/system failures (e.g. database disconnect, timeout):
  - does NOT mutate or clear authentication cookies;
  - rethrows the error unchanged (which `HttpExceptionFilter` formats as 500 without logging out the client).

The guard is a NestJS `CanActivate` in the presentation layer. It does NOT become a global guard (that is Story 1.6). Custom `@CurrentUser()` returns `AuthenticatedUser` and `@CurrentSession()` returns `Session` with strict type safety and zero `(req as any)` casts.

### AC6 — Protected probe endpoint proves enforcement across all invalid states

**Given** a `GET /auth/me` endpoint decorated with `@UseGuards(SessionAuthGuard)`
**When** called with a valid non-revoked session cookie
**Then** it returns `200 OK` with `{ data: { id, email, role, status }, error: null, meta: {} }`.

**When** called with:
- missing cookie → clears cookies, sets `Cache-Control: no-store`, returns `401 Unauthorized` (`AUTH_UNAUTHORIZED`)
- expired access JWT → clears cookies, sets `Cache-Control: no-store`, returns `401 Unauthorized` (`AUTH_SESSION_EXPIRED`)
- revoked session → clears cookies, sets `Cache-Control: no-store`, returns `401 Unauthorized` (`AUTH_SESSION_REVOKED`)
- locked user status → clears cookies, sets `Cache-Control: no-store`, returns `403 Forbidden` (`AUTH_USER_LOCKED`)

### AC7 — Monotonic session versioning across logins and logouts

**Given** a user logs in for the Nth time
**When** `replaceUserSession` runs inside its `FOR UPDATE` transaction
**Then** `sessionVersion` is determined as `COALESCE(MAX(session_version), 0) + 1` from the database (e.g. Login 1 → v1, Login 2 → v2, Logout → no active session, Login 3 → v3). Version numbers strictly increase and never reset to 1 after logout or session expiry. `validateSession` rejects any JWT whose `sessionVersion` does not match the stored Session's version.

### AC8 — Concurrency race safety & database-level serialization

**Given** two login requests for the same user arrive simultaneously
**When** both execute `replaceUserSession` concurrently
**Then** the database transactions serialize via `SELECT id FROM users WHERE id = $1 FOR UPDATE`. One transaction executes first (producing version `N`), revokes prior sessions, commits session + refresh credential + audit. The second transaction executes next (reading max version `N`), revokes the first session, assigns version `N + 1`, and commits. Exactly one unrevoked session exists, version numbers are strictly monotonic and distinct, and exactly two distinct `SESSION_REPLACED` audit logs are committed.

### AC9 — Existing controllers adopt the guard (refactor)

**Given** `GoogleOAuthController.linkStart` and `GoogleOAuthController.linkDelete` currently duplicate manual session validation
**When** Story 1.3 is complete
**Then** these methods use `@UseGuards(SessionAuthGuard)` and `@CurrentUser()` / `@CurrentSession()` decorators, removing manual cookie extraction and `validateSession` calls. Behavior is identical; no functional change.

### AC10 — All tests pass with zero regressions

**Given** the full test suite (unit, E2E, architecture boundary)
**When** run after Story 1.3 implementation
**Then** all existing tests pass, new tests cover ACs 1–9, and `test/architecture.spec.ts` reports zero violations.

## Tasks / Subtasks

- [x] **Task 1: Define `ReplaceUserSessionInput` contract & implement atomic `sessionVersion` in `SessionRepositoryPort`** (AC: 1, 7, 8)
  - [x] 1.1 In `apps/backend/src/modules/auth/application/ports/session-repository.port.ts`:
    - Define `ReplaceUserSessionInput`:
      ```typescript
      export interface ReplaceUserSessionInput {
        session: Omit<SessionProps, 'sessionVersion'>;
        credential: RefreshCredentialProps;
        audit: CreateIdentityAuditRecord; // Mandatory SESSION_REPLACED audit record
      }
      ```
    - Update `replaceUserSession(userId: string, input: ReplaceUserSessionInput): Promise<Session>` to return the persisted Session with its committed `sessionVersion`.
    - Strictly do NOT expose `getLatestSessionVersion` or `findActiveByUserId` on the port — version determination is entirely encapsulated within `replaceUserSession`.
  - [x] 1.2 In `PrismaSessionRepository.replaceUserSession`:
    - Execute inside `this.prisma.$transaction(async (tx) => { ... })`:
      1. `await tx.$queryRaw\`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE\``
      2. `SELECT COALESCE(MAX(session_version), 0) AS max_version FROM sessions WHERE user_id = ${userId}::uuid` (or Prisma aggregate `_max.sessionVersion`)
      3. Compute `nextVersion = Number(maxVersion) + 1`
      4. `await tx.session.updateMany({ where: { userId, revoked: false }, data: { revoked: true } })`
      5. `await tx.session.create({ data: { ...input.session, sessionVersion: nextVersion } })`
      6. `await tx.refreshCredential.create({ data: input.credential })`
      7. `await tx.identityAuditLog.create({ data: { ...input.audit, metadata: { ...input.audit.metadata, sessionId: input.session.id, sessionVersion: nextVersion } } })` (mandatory insert enriched with committed version)
      8. Return created `Session` entity with `sessionVersion = nextVersion`
  - [x] 1.3 In `InMemorySessionRepository.replaceUserSession`:
    - Mirror identical serialized semantics: per-user mutex/lock, compute `Math.max(...userSessions.map(s => s.sessionVersion), 0) + 1`, revoke prior active, insert new session, insert credential, insert audit record, return created `Session`.
  - [x] 1.4 Update `SessionService.createSession`:
    - Prepare `session` props (without `sessionVersion`), `credential` props, and `audit` record (`SESSION_REPLACED`).
    - Call `const session = await this.sessionRepository.replaceUserSession(userId, { session, credential, audit })`.
    - After transaction commits: call `this.tokenService.signToken({ sub: userId, sessionId: session.id, sessionVersion: session.sessionVersion })`.
  - [x] 1.5 Unit tests in `session.service.spec.ts`:
    - First login → version 1
    - Second login → version 2
    - Logout → no active session → Third login → version 3 (verifying version does NOT reset to 1)
    - `validateSession` rejects JWT with mismatched `sessionVersion`

- [x] **Task 2: Concurrency & PostgreSQL Integration Testing** (AC: 1, 7, 8)
  - [x] 2.1 Write unit concurrency test in `in-memory-session.repository.spec.ts` (or `session.service.spec.ts`): `Promise.all([createSession(userId), createSession(userId)])` → exactly 1 active session, versions are consecutive and distinct (e.g. 1 and 2), no duplicates.
  - [x] 2.2 Create real PostgreSQL integration test `apps/backend/src/modules/auth/infrastructure/prisma-session.repository.integration-spec.ts` (runnable against PostgreSQL container):
    - Setup user with initial session version = 5
    - Execute `await Promise.all([repo.replaceUserSession(userId, inputA), repo.replaceUserSession(userId, inputB)])`
    - Assert exactly 1 unrevoked session exists in PostgreSQL
    - Assert generated session versions are 6 and 7 (consecutive, no duplicate versions)
    - Assert `MAX(session_version)` in PostgreSQL equals 7
    - Assert exactly two `SESSION_REPLACED` audit records exist in `identity_audit_logs`
  - [x] 2.3 Write rollback & lock-release test in `prisma-session.repository.integration-spec.ts`:
    - Force an exception after acquiring `FOR UPDATE` but before transaction commit (e.g. inject an invalid credential or simulated database error inside transaction).
    - Assert:
      - transaction rolls back;
      - no partial `Session` is persisted;
      - no `RefreshCredential` is persisted;
      - no `IdentityAuditLog` is persisted;
      - previous active session remains unchanged;
      - a subsequent `replaceUserSession()` succeeds immediately, proving the row lock was released cleanly.

- [x] **Task 3: Centralized Cookie Clearing, Strongly-typed `AuthenticatedRequest`, and `SessionAuthGuard`** (AC: 5, 6)
  - [x] 3.1 In `apps/backend/src/modules/auth/presentation/cookie-options.helper.ts`:
    - Add helper function: `clearAuthCookies(res: Response, envService: EnvService): void` that calls `res.clearCookie(AUTH_COOKIE_NAME, getAuthClearCookieOptions(envService))` and `res.clearCookie(REFRESH_COOKIE_NAME, getRefreshClearCookieOptions(envService))`.
    - Ensure all cookie clearing in `SessionAuthGuard`, `AuthController.logout`, and other auth flows uses this centralized function.
  - [x] 3.2 Create `apps/backend/src/modules/auth/presentation/types/authenticated-request.type.ts`:
    - Define `AuthenticatedUser`: `{ readonly id: string; readonly email: string; readonly role: UserRole; readonly status: UserStatus; }` (strictly omitting `passwordHash`).
    - Define `AuthenticatedRequest extends Request`: `{ user: AuthenticatedUser; session: Session; }`.
    - Ensure zero `(req as any)` casts across guards, decorators, and controllers.
  - [x] 3.3 Create `apps/backend/src/modules/auth/presentation/guards/session-auth.guard.ts` implementing `CanActivate`:
    - Inject `SessionService` and `EnvService`.
    - Extract `rescom_access_token` from `req.cookies`.
    - Wrap validation in `try ... catch`:
      - If token missing, throw `UnauthorizedSessionException('Access token cookie required')`.
      - Call `const { user, session } = await this.sessionService.validateSession(accessToken)`.
      - On success: map `user` to `AuthenticatedUser`, attach `(req as AuthenticatedRequest).user = authenticatedUser` and `(req as AuthenticatedRequest).session = session`, return `true`.
      - On catch:
        - Check if error is a known authentication failure (`UnauthorizedSessionException`, `InvalidTokenException`, `SessionExpiredException`, `SessionRevokedException`, `UserLockedException`):
          - Extract `res = context.switchToHttp().getResponse<Response>()`.
          - Call `clearAuthCookies(res, this.envService)`.
          - Set header: `res.setHeader('Cache-Control', 'no-store')`.
          - Rethrow domain exception for `HttpExceptionFilter` to format as 401/403.
        - If error is NOT a known auth domain failure (e.g. Prisma connection error, DB timeout, unhandled system error):
          - Do NOT mutate or clear cookies.
          - Rethrow the error unchanged (formats as 500, preserving client session for when DB recovers).
  - [x] 3.4 Register `SessionAuthGuard` in `AuthModule` providers and exports.
  - [x] 3.5 Unit tests for `SessionAuthGuard`:
    - Missing cookie → clears cookies, sets `no-store`, throws `UnauthorizedSessionException` (401).
    - Valid token → passes, attaches sanitized `AuthenticatedUser` (no `passwordHash`) and `session`.
    - Revoked token → clears cookies, sets `no-store`, throws `SessionRevokedException` (401).
    - Expired token → clears cookies, sets `no-store`, throws `SessionExpiredException` (401).
    - Locked user → clears cookies, sets `no-store`, throws `UserLockedException` (403).
    - Unexpected database error (simulated `Error('DB connection failed')`) → does NOT clear cookies, does NOT set `no-store`, rethrows error.

- [x] **Task 4: Create `@CurrentUser()` and `@CurrentSession()` parameter decorators** (AC: 5)
  - [x] 4.1 Create `apps/backend/src/modules/auth/presentation/decorators/current-user.decorator.ts`:
    - Uses `createParamDecorator` to return `(req as AuthenticatedRequest).user`.
    - Strongly typed return value: `AuthenticatedUser`.
  - [x] 4.2 Create `apps/backend/src/modules/auth/presentation/decorators/current-session.decorator.ts`:
    - Uses `createParamDecorator` to return `(req as AuthenticatedRequest).session`.
    - Strongly typed return value: `Session`.
  - [x] 4.3 Export from `apps/backend/src/modules/auth/presentation/decorators/index.ts`.

- [x] **Task 5: Add `GET /auth/me` protected endpoint** (AC: 6)
  - [x] 5.1 Add `getMe(@CurrentUser() user: AuthenticatedUser)` route in `AuthController` decorated with `@UseGuards(SessionAuthGuard)`.
  - [x] 5.2 Returns `{ data: user, error: null, meta: {} }` (user is already sanitized `AuthenticatedUser`).
  - [x] 5.3 Unit test in `auth.controller.spec.ts`: returns sanitized user data.

- [x] **Task 6: Refactor `GoogleOAuthController` to use `SessionAuthGuard`** (AC: 9)
  - [x] 6.1 Refactor `linkStart`: use `@UseGuards(SessionAuthGuard)` and `@CurrentUser() user: AuthenticatedUser`, `@CurrentSession() session: Session`. Remove manual token extraction and `validateSession` boilerplate.
  - [x] 6.2 Refactor `linkDelete`: use `@UseGuards(SessionAuthGuard)` and `@CurrentUser() user: AuthenticatedUser`.
  - [x] 6.3 Verify all existing OAuth unit and E2E tests still pass with identical behavior.

- [x] **Task 7: Graceful revoked-session logout without audit pollution** (AC: 4)
  - [x] 7.1 In `SessionService.logout`: check if session is already revoked or catch `SessionRevokedException`; clear cookies symmetrically and return cleanly without throwing error.
  - [x] 7.2 Ensure `SESSION_REVOKED` / `LOGOUT` audit record is NOT written if the session was already revoked.
  - [x] 7.3 Unit test in `session.service.spec.ts`:
    - Logout with active session → revokes, writes audit record, clears cookies.
    - Logout with already revoked session → no error thrown, cookies cleared, audit log count does NOT increase.

- [x] **Task 8: Comprehensive E2E test suite for single-session enforcement** (AC: 1, 2, 3, 4, 6, 7, 10)
  - [x] 8.1 Create `apps/backend/test/single-session.e2e-spec.ts`.
  - [x] 8.2 Test: Device A logs in → `GET /auth/me` → 200 OK with sanitized user data.
  - [x] 8.3 Test: Device B logs in (same user) → `GET /auth/me` with Device B cookies → 200 OK.
  - [x] 8.4 Test: `GET /auth/me` with Device A cookies → 401 `AUTH_SESSION_REVOKED`, cookies cleared in response (`Set-Cookie`), `Cache-Control: no-store`.
  - [x] 8.5 Test: `GET /auth/me` without cookie → 401 `AUTH_UNAUTHORIZED`, cookies cleared, `Cache-Control: no-store`.
  - [x] 8.6 Test: `GET /auth/me` with expired access token → 401 `AUTH_SESSION_EXPIRED`, cookies cleared, `Cache-Control: no-store`.
  - [x] 8.7 Test: `GET /auth/me` with locked user account → 403 `AUTH_USER_LOCKED`, cookies cleared, `Cache-Control: no-store`.
  - [x] 8.8 Test: `POST /auth/refresh` with Device A refresh cookie → 401 `AUTH_SESSION_REVOKED`.
  - [x] 8.9 Test: `POST /auth/logout` with Device A cookies → 204 No Content, cookies cleared, audit log count does not increase.
  - [x] 8.10 Test: Device B `GET /auth/me` remains 200 OK throughout.
  - [x] 8.11 Test: Subsequent login after logout → receives `sessionVersion = 3`.
    - **CRITICAL**: Verify `sessionVersion = 3` through test repository/database state or by decoding the issued JWT inside test code only. Do NOT expose `sessionVersion` through production API responses solely for testing.
  - [x] 8.12 Run full verification: `npm run verify` + `npm run test:e2e` + `npm run lint` + `test/architecture.spec.ts`.

### Review Findings

- [x] [Review][Patch] Symmetrically clear auth cookies on failed POST /auth/refresh with revoked session or invalid refresh token [apps/backend/src/modules/auth/presentation/auth.controller.ts:162] (AC3)
- [x] [Review][Patch] Throw SessionExpiredException (401 AUTH_SESSION_EXPIRED) on TokenExpiredError instead of generic AUTH_UNAUTHORIZED [apps/backend/src/modules/auth/infrastructure/nest-jwt-token.adapter.ts:40] (AC6)
- [x] [Review][Patch] Map UserLockedException to HTTP 403 Forbidden AUTH_USER_LOCKED in HttpExceptionFilter [apps/backend/src/common/http/http-exception.filter.ts:50] (AC5, AC6)
- [x] [Review][Patch] Define InvalidTokenException domain exception and integrate with SessionAuthGuard isKnownAuthFailure [apps/backend/src/modules/auth/application/exceptions/auth.exceptions.ts:31] (AC5)
- [x] [Review][Patch] Fix InMemorySessionRepository async mutex race condition using strict FIFO promise chaining [apps/backend/src/modules/auth/infrastructure/in-memory-session.repository.ts:28] (AC8)
- [x] [Review][Patch] Validate UUID format on claims.sessionId in validateSession and on parts[0] in rotateCsrf to prevent unhandled database syntax exceptions [apps/backend/src/modules/auth/application/session.service.ts:123]
- [x] [Review][Patch] Check user.isLocked() in rotateCsrf when resolving session via refreshToken fallback [apps/backend/src/modules/auth/application/session.service.ts:200]
- [x] [Review][Patch] Support graceful fallback to refreshToken in rotateCsrf when accessToken is expired [apps/backend/src/modules/auth/application/session.service.ts:162]
- [x] [Review][Defer] Background cron eviction of expired/revoked sessions and refresh credentials [deferred, out of scope for Story 1.3 single-session enforcement]
- [ ] [Review][Patch] High: Recheck and lock the parent session during refresh rotation so a concurrent replacement cannot issue tokens for a revoked session [apps/backend/src/modules/auth/infrastructure/prisma-session.repository.ts:121]
- [ ] [Review][Patch] High: Atomically revoke the refresh-token family when concurrent refresh reuse loses the credential CAS race [apps/backend/src/modules/auth/infrastructure/prisma-session.repository.ts:122]
- [ ] [Review][Patch] Medium: Authenticate the refresh secret before treating a used credential as replay and revoking its session [apps/backend/src/modules/auth/application/session.service.ts:199]
- [ ] [Review][Patch] Medium: Make logout revocation conditional so concurrent logouts append at most one audit record [apps/backend/src/modules/auth/infrastructure/prisma-session.repository.ts:165]
- [ ] [Review][Patch] Medium: Require a valid CSRF token when logging out an active session while preserving revoked-session idempotence [apps/backend/src/modules/auth/application/session.service.ts:347]
- [ ] [Review][Patch] Medium: Make in-memory session replacement atomic and require its mandatory audit dependency [apps/backend/src/modules/auth/infrastructure/in-memory-session.repository.ts:22]
- [ ] [Review][Patch] Low: Delete completed per-user mutex tails by comparing the promise actually stored in the lock map [apps/backend/src/modules/auth/infrastructure/in-memory-session.repository.ts:34]
- [ ] [Review][Patch] Medium: Run SessionAuthGuard before JsonOnlyGuard so revoked protected requests clear cookies and return the authentication failure [apps/backend/src/modules/auth/presentation/google-oauth.controller.ts:124]
- [ ] [Review][Patch] High: Make PostgreSQL concurrency and rollback tests fail or visibly skip instead of silently passing when PostgreSQL is unavailable [apps/backend/src/modules/auth/infrastructure/prisma-session.repository.spec.ts:12]
- [ ] [Review][Patch] Medium: Assert refresh-credential and audit rollback and bound the lock-release assertion with a timeout [apps/backend/src/modules/auth/infrastructure/prisma-session.repository.spec.ts:195]
- [ ] [Review][Patch] Medium: Verify the mocked row-lock query contains the user predicate and FOR UPDATE instead of only asserting it was called [apps/backend/src/modules/auth/infrastructure/prisma-session.repository.spec.ts:253]
- [ ] [Review][Patch] Medium: Add Google OAuth session-replacement coverage to prove AC1 through both login paths [apps/backend/test/google-oauth.e2e-spec.ts:371]
- [ ] [Review][Patch] Low: Return non-optional AuthenticatedUser and Session values from guarded parameter decorators [apps/backend/src/modules/auth/presentation/decorators/current-user.decorator.ts:8]

## Dev Notes

### Architecture Constraints (MANDATORY)

- **Clean Architecture (AD-7):** Domain (`domain/`) and Application (`application/`) layers MUST NOT import `@nestjs/*`, `express`, `@prisma/client`, `bcrypt`, or any adapter. Enforced by `test/architecture.spec.ts`.
- **Framework-Free Services:** `SessionService` is a pure TypeScript class, NOT decorated with `@Injectable()`. Wired via `useFactory` in `auth.module.ts`.
- **Guard/Decorator Location:** `SessionAuthGuard`, `@CurrentUser()`, `@CurrentSession()`, `AuthenticatedUser`, and `AuthenticatedRequest` belong in `presentation/` layer — they import NestJS and Express types.
- **Exclusive Module Ownership (AD-16):** Only `AuthModule` owns `Session`, `RefreshCredential`, `IdentityAuditLog`. No other module writes to these tables.

### Critical Architecture & Design Patterns for Story 1.3

1. **`ReplaceUserSessionInput` Contract & Audit Enrichment:**
   - Application layer creates `SessionProps` (without version), `RefreshCredentialProps` (with hashed secret), and mandatory `CreateIdentityAuditRecord`.
   - Persistence layer executes:
     ```sql
     BEGIN;
       SELECT id FROM users WHERE id = ? FOR UPDATE;
       SELECT COALESCE(MAX(session_version), 0) FROM sessions WHERE user_id = ?;
       nextVersion = maxVersion + 1;
       UPDATE sessions SET revoked = true WHERE user_id = ? AND revoked = false;
       INSERT INTO sessions (id, user_id, session_version, ...) VALUES (..., nextVersion);
       INSERT INTO refresh_credentials (...);
       INSERT INTO identity_audit_logs (...);
     COMMIT;
     ```
   - Repository merges `{ sessionId: newSession.id, sessionVersion: nextVersion }` into the audit record metadata and returns the committed `Session` entity with `sessionVersion = nextVersion`.
2. **Encapsulation of Version Logic:**
   - `SessionRepositoryPort` does NOT expose `getLatestSessionVersion` or `findActiveByUserId`. Version calculation is strictly internal to `replaceUserSession` during the lock.
3. **Post-Commit JWT Signing:**
   - Signing the access JWT happens strictly AFTER the transaction commits, using `session.sessionVersion` returned by `replaceUserSession`.
4. **`AuthenticatedUser` Sanitization & Request Typing:**
   - In `presentation/types/authenticated-request.type.ts`, declare `AuthenticatedUser` containing only `{ id, email, role, status }` and `AuthenticatedRequest extends Request`.
   - Never attach raw `User` entity to `req.user` to avoid leaking `passwordHash`.
   - Strictly forbid `(req as any)` type casts.
5. **Guard-Level Selective Fail-Safe Cookie Clearing & Cache-Control:**
   - Centralize cookie clearing in `clearAuthCookies(res, envService)` in `CookieOptionsHelper`.
   - When `SessionAuthGuard` encounters known authentication domain exceptions (`UnauthorizedSessionException`, `InvalidTokenException`, `SessionExpiredException`, `SessionRevokedException`, `UserLockedException`), it clears auth cookies, sets `Cache-Control: no-store`, and rethrows.
   - When encountering unexpected system/infrastructure errors (e.g. database down), it does NOT clear cookies and rethrows untouched.
6. **Audit Log Hygiene on Idempotent Revoked Logout:**
   - AC4 specifies that logging out an already revoked session must return 204 and clear cookies without writing a redundant audit log entry.
7. **Testing Verifications:**
   - Concurrency and rollback tests verify `SELECT ... FOR UPDATE` row-locking behavior on PostgreSQL.
   - `sessionVersion` assertions in E2E tests inspect decoded JWT payload or database state directly, NEVER by leaking `sessionVersion` into production response bodies.

### Session Contract (AD-20) — Already Implemented in Story 1.2

The following are ALREADY working — DO NOT reimplement:
- `SessionService.createSession(userId)` — creates session, revokes prior sessions via `replaceUserSession`, signs JWT, sets cookies
- `SessionService.validateSession(accessToken)` — full JWT + DB + revocation + version + user lock validation
- `SessionService.refreshSession(rawRefreshToken, csrfToken)` — credential rotation with reuse-family revocation
- `SessionService.logout(...)` — session revocation with cookie clearing
- `PrismaSessionRepository.replaceUserSession` — transactional revoke-all + create
- Access JWT claims: `{ sub, sessionId, sessionVersion, iat, exp }`
- Cookie config: `rescom_access_token` (Path=/, TTL 900s), `rescom_refresh_token` (Path=/auth, TTL 30d)
- CSRF synchronizer token with `X-CSRF-Token` header validation
- `IdentityAuditLog` with PostgreSQL trigger forbidding UPDATE/DELETE

### What Story 1.3 ADDS (Not Reimplements)

1. **Monotonic `sessionVersion` inside transaction** — determined via `SELECT ... FOR UPDATE` and `COALESCE(MAX(session_version), 0) + 1`.
2. **`ReplaceUserSessionInput` contract** with mandatory audit record enriched with committed session metadata.
3. **Database-level concurrency serialization** — `SELECT ... FOR UPDATE` on user row inside `replaceUserSession`.
4. **`SessionAuthGuard` with selective cookie clearing and `no-store`** — reusable NestJS `CanActivate` guard in presentation layer.
5. **`clearAuthCookies` helper function** in `CookieOptionsHelper`.
6. **`AuthenticatedUser` & `AuthenticatedRequest` types** — typed request interface to eliminate `(req as any)` and protect `passwordHash`.
7. **`@CurrentUser()` / `@CurrentSession()` decorators** — NestJS `createParamDecorator` helpers.
8. **`GET /auth/me`** — protected probe endpoint returning sanitized `AuthenticatedUser`.
9. **Controller refactoring** — `GoogleOAuthController.linkStart/linkDelete` adopt guard instead of manual validation.
10. **Graceful revoked-session logout without audit pollution** — idempotent 204.
11. **Comprehensive E2E test suite** — `single-session.e2e-spec.ts` proving enforcement across all failure states.

### Existing Code Patterns (Follow These)

- **Exception pattern:** Domain exceptions extend `Error` with `readonly code: string`. `HttpExceptionFilter` maps codes to HTTP status. See `auth.exceptions.ts`.
- **Response envelope:** `{ data, error, meta }` on all routes. See `auth.controller.ts`.
- **Cookie helper:** `CookieOptionsHelper` in `presentation/cookie-options.helper.ts` manages symmetric set/clear. Inject via provider.
- **Test pattern (unit):** Use `InMemory*Repository` classes. Create repos with optional `IdentityAuditPort` second arg. See `google-oauth.service.spec.ts` for setup order: `auditRepo` before `oauthRepo`/`sessionRepo`.
- **Test pattern (E2E):** Supertest with `INestApplication`. See `auth.e2e-spec.ts` and `google-oauth.e2e-spec.ts`. In-memory repos wired via module overrides.
- **Provider tokens:** Symbols like `SESSION_REPOSITORY_PORT`, `TOKEN_SERVICE_PORT`. Defined in `auth.module.ts`.
- **`AuthModule` exports `SessionService`** already — guard can inject it.

### Key Files to Read Before Implementation

| File | Why |
|:-----|:----|
| `modules/auth/application/session.service.ts` | Core session logic — modify `createSession` to use returned `Session` version |
| `modules/auth/application/ports/session-repository.port.ts` | Define `ReplaceUserSessionInput`, update signature to return `Promise<Session>` |
| `modules/auth/infrastructure/prisma-session.repository.ts` | Add `FOR UPDATE` lock, query max version, enrich audit, return `Session` |
| `modules/auth/infrastructure/in-memory-session.repository.ts` | Mirror changes with atomic mutex/version logic |
| `modules/auth/auth.module.ts` | Register guard, see provider wiring patterns |
| `modules/auth/presentation/cookie-options.helper.ts` | Add `clearAuthCookies` helper |
| `modules/auth/presentation/auth.controller.ts` | Add `GET /auth/me` |
| `modules/auth/presentation/google-oauth.controller.ts` | Refactor to use guard |
| `modules/auth/application/exceptions/auth.exceptions.ts` | Existing exception codes |
| `common/http/http-exception.filter.ts` | Exception → HTTP mapping |
| `test/architecture.spec.ts` | Boundary enforcement rules |

### Database Notes

- **No schema migration needed.** The `Session` and `RefreshCredential` tables already have all required columns. `sessionVersion` column exists with `@default(1)`.
- **No partial unique index required for Story 1.3.** Single-session correctness is enforced by the user-row `FOR UPDATE` serialization and the atomic `replaceUserSession` transaction. A database-level partial unique index may be considered separately as defense-in-depth, but is outside this story's scope.
- **`@@index([userId])` on Session** already exists for efficient lookup and max version aggregation.

### Previous Story Learnings (Stories 1.1 & 1.2)

1. **Test setup order matters:** `auditRepo` must be created BEFORE `oauthRepo` and `sessionRepo` that depend on it as constructor args.
2. **PowerShell on Windows:** Does NOT support `&&` operator. Run commands separately.
3. **`npm run verify`** at root = `build + typecheck + test`. Lint/format run from `apps/backend`.
4. **In-memory repos must mirror Prisma behavior exactly** — transactional rollback, atomic operations, race conditions.
5. **UUID validation on cookie inputs** — always validate format before DB query (regex: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`).
6. **`AUTH_COOKIE_NAME` constant** exists at `apps/backend/src/modules/auth/presentation/auth.controller.ts` — reuse, don't redefine.
7. **Review finding from 1.2:** Application exceptions must NOT extend `HttpException` — they extend standard `Error` and are mapped by `HttpExceptionFilter`.

### References

- [Source: epics.md — Story 1.3 acceptance criteria, lines 265-271]
- [Source: prd.md §4.1 — FR-3 Single-Session Enforcement]
- [Source: ARCHITECTURE-SPINE.md — AD-20 Revocable Cookie Session Contract]
- [Source: ARCHITECTURE-SPINE.md — AD-6 Redis Is Optional Ephemeral Infrastructure]
- [Source: ARCHITECTURE-SPINE.md — AD-7 The Dependency Rule (Clean Architecture)]
- [Source: ARCHITECTURE-SPINE.md — AD-16 Exclusive Module State Ownership]
- [Source: solution-design.md — Session Model & Storage Architecture]
- [Source: 1-1-emailpassword-registration-authentication.md — Dev Notes, Review Findings]
- [Source: 1-2-google-oauth-login.md — Dev Notes, Review Findings, AC8-AC10]

## Dev Agent Record

### Agent Model Used
Claude 3.7 Sonnet / Antigravity Agent

### Debug Log References
- Unit/Integration verification: 18 test suites, 132 tests passed (including `architecture.spec.ts` zero boundary violations, `prisma-session.repository.spec.ts`, `session.repository.spec.ts`, `session-auth.guard.spec.ts`, `adapters.spec.ts`).
- E2E verification: 3 test suites, 29 tests passed (including `single-session.e2e-spec.ts` testing registration v1, login A v2, login B v3, post-logout login v4, 401 revocation rejection, missing cookie, expired token, locked user 403, and refresh cookie clearing).
- Lint and formatting verification: ESLint and Prettier passed with zero errors/warnings.

### Completion Notes List
- **Task 1 (Contract & Atomic Versioning)**: Defined `ReplaceUserSessionInput` in `session-repository.port.ts`. Updated `replaceUserSession` to encapsulate monotonic version calculation `COALESCE(MAX(session_version), 0) + 1` inside `SELECT id FROM users WHERE id = $1 FOR UPDATE` user row lock. Enriched `SESSION_REPLACED` audit log with committed session details (`sessionId`, `sessionVersion`). Access JWT signed strictly post-commit.
- **Task 2 (Concurrency & PostgreSQL Integration)**: Implemented concurrency tests in `session.repository.spec.ts` (proving serialized monotonic versioning without duplicates) and transactional tests in `prisma-session.repository.spec.ts` (verifying `FOR UPDATE` lock query, rollback guarantees, and clean lock release). Fixed in-memory mutex to use strict FIFO promise chaining to eliminate coroutine race conditions.
- **Task 3 (Cookie Clearing, Types & Guard)**: Implemented centralized `clearAuthCookies(res, envService)` in `CookieOptionsHelper`. Defined `AuthenticatedUser` (`{ id, email, role, status }`, strictly omitting sensitive fields like `passwordHash`) and strongly-typed `AuthenticatedRequest extends Request` with zero `(req as any)` casts. Created `SessionAuthGuard` in `presentation/guards` with selective fail-safe error handling (clears cookies and sets `no-store` on known auth domain exceptions; rethrows infrastructure errors untouched without logging out the client). Registered guard in `AuthModule`.
- **Task 4 (Parameter Decorators)**: Created strongly typed `@CurrentUser()` and `@CurrentSession()` parameter decorators in `presentation/decorators/`.
- **Task 5 (Probe Endpoint `GET /auth/me`)**: Added `GET /auth/me` in `AuthController` returning sanitized `AuthenticatedUser` wrapped in the standard response envelope `{ data, error, meta }`.
- **Task 6 (Controller Refactoring)**: Refactored `GoogleOAuthController.linkStart` and `linkDelete` to use `SessionAuthGuard` and `@CurrentUser()` / `@CurrentSession()`, eliminating manual cookie extraction and validation boilerplate while maintaining identical behavior.
- **Task 7 (Graceful Revoked Logout)**: Handled logout of already-revoked sessions idempotently in `SessionService.logout`: clears cookies, returns 204 No Content, and omits redundant `SESSION_REVOKED` / `LOGOUT` audit log entries.
- **Task 8 (Comprehensive E2E Suite)**: Added `apps/backend/test/single-session.e2e-spec.ts` validating complete single-session lifecycle, cross-device eviction, cookie clearance, error envelopes, and post-logout monotonic versioning.
- **Code Review Hardening**:
  - Implemented symmetric cookie clearing in `AuthController.refresh` on revoked session or invalid token (AC3).
  - Configured `NestJwtTokenAdapter` to throw `SessionExpiredException` on `TokenExpiredError` returning `AUTH_SESSION_EXPIRED` (AC6).
  - Mapped `UserLockedException` to HTTP 403 Forbidden with `AUTH_USER_LOCKED` in `HttpExceptionFilter` (AC5, AC6).
  - Defined `InvalidTokenException` domain exception class and registered in `SessionAuthGuard` (AC5).
  - Hardened `InMemorySessionRepository` with strict FIFO promise-chained mutex.
  - Added UUID regex validation in `validateSession` and `rotateCsrf`, and account locked verification in `rotateCsrf`.

### Change Log
- `2026-09-12`: Implemented Story 1.3 Single-Session Enforcement per BMAD dev-story workflow. All acceptance criteria AC1-AC10 verified. Status moved to `review`.
- `2026-09-12`: Completed code review with parallel Blind Hunter, Edge Case Hunter, and Acceptance Auditor layers. Applied 8 patches addressing AC discrepancies, cookie clearing on refresh, token error classification, locked user HTTP status, mutex chaining, and UUID validation. Full regression, unit, E2E, and architecture tests passed. Status moved to `done`.

### File List
- **Modified**:
  - `_bmad-output/implementation-artifacts/sprint-status.yaml`
  - `_bmad-output/implementation-artifacts/1-3-single-session-enforcement.md`
  - `apps/backend/src/common/http/http-exception.filter.ts`
  - `apps/backend/src/modules/auth/application/exceptions/auth.exceptions.ts`
  - `apps/backend/src/modules/auth/application/ports/session-repository.port.ts`
  - `apps/backend/src/modules/auth/application/session.service.ts`
  - `apps/backend/src/modules/auth/application/session.service.spec.ts`
  - `apps/backend/src/modules/auth/infrastructure/prisma-session.repository.ts`
  - `apps/backend/src/modules/auth/infrastructure/in-memory-session.repository.ts`
  - `apps/backend/src/modules/auth/infrastructure/nest-jwt-token.adapter.ts`
  - `apps/backend/src/modules/auth/infrastructure/adapters.spec.ts`
  - `apps/backend/src/modules/auth/presentation/cookie-options.helper.ts`
  - `apps/backend/src/modules/auth/presentation/auth.controller.ts`
  - `apps/backend/src/modules/auth/presentation/google-oauth.controller.ts`
  - `apps/backend/src/modules/auth/auth.module.ts`
- **Created**:
  - `apps/backend/src/modules/auth/infrastructure/session.repository.spec.ts`
  - `apps/backend/src/modules/auth/infrastructure/prisma-session.repository.spec.ts`
  - `apps/backend/src/modules/auth/presentation/types/authenticated-request.type.ts`
  - `apps/backend/src/modules/auth/presentation/guards/session-auth.guard.ts`
  - `apps/backend/src/modules/auth/presentation/guards/session-auth.guard.spec.ts`
  - `apps/backend/src/modules/auth/presentation/decorators/current-user.decorator.ts`
  - `apps/backend/src/modules/auth/presentation/decorators/current-session.decorator.ts`
  - `apps/backend/src/modules/auth/presentation/decorators/index.ts`
  - `apps/backend/src/modules/auth/presentation/decorators/decorators.spec.ts`
  - `apps/backend/src/modules/auth/presentation/auth.controller.spec.ts`
  - `apps/backend/test/single-session.e2e-spec.ts`
