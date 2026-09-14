---
baseline_commit: 0be7a93983bede87701702a5823f7de5a87b574c
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/implementation-artifacts/1-5-system-audit-logging.md"
---

# Story 1.6: Security & API Foundation

Status: done

## Story

As a System Architect,
I want the core API infrastructure to include baseline security measures (rate limiting, Helmet security headers, production CORS, and standardized guard/validation architecture),
So that all subsequent features across the platform are built on a secure, robust, and standardized foundation.

## Acceptance Criteria

### AC1 — API-Level Rate Limiting
**Given** the backend NestJS application
**When** incoming HTTP requests exceed defined request rate thresholds
**Then**:
1. Global rate limiting is enforced per client IP using `@nestjs/throttler` (or Redis/in-memory sliding window).
2. Default rate limits are configured via `EnvService` (e.g. `RATE_LIMIT_TTL_SECONDS` default 60s, `RATE_LIMIT_MAX_REQUESTS` default 100).
3. Auth-sensitive endpoints (e.g. login, register, password attempts) support stricter throttling tiers (e.g. 10 requests per minute).
4. When the threshold is exceeded, the API responds with HTTP `429 Too Many Requests` formatted with the standard RESCOM error envelope:
   ```json
   {
     "data": null,
     "error": {
       "code": "RATE_LIMIT_EXCEEDED",
       "message": "Too many requests. Please try again later."
     },
     "meta": {}
   }
   ```
5. Standard rate limit headers are included in HTTP responses (`Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`).

### AC2 — Production Helmet Security Headers
**Given** any HTTP response from the backend
**When** the client inspects response headers
**Then** the following baseline security headers are present:
1. `X-Content-Type-Options: nosniff` (MIME-type sniffing prevention)
2. `X-Frame-Options: SAMEORIGIN` or `DENY` (clickjacking prevention)
3. `Strict-Transport-Security` (HSTS) enabled with `includeSubDomains` and a minimum max-age of 1 year (when not in local non-SSL dev mode or properly configured)
4. `Content-Security-Policy` configured with a robust default policy
5. `X-XSS-Protection: 0` (modern standard per OWASP)
6. `X-DNS-Prefetch-Control: off`
7. `X-Download-Options: noopen`
8. `X-Permitted-Cross-Domain-Policies: none`
9. Server identity header (`X-Powered-By`) is removed / stripped.

### AC3 — Production CORS Hardening
**Given** cross-origin requests from web browsers
**When** preflight (`OPTIONS`) or actual HTTP requests are received
**Then**:
1. Cross-Origin Resource Sharing (CORS) strictly validates the `Origin` header against `FRONTEND_ORIGINS` from `EnvService`.
2. Requests from unauthorized origins receive no CORS access headers, causing browser preflight / request rejection.
3. Requests from authorized origins receive `Access-Control-Allow-Origin` set to the exact matching origin (not wildcard `*`), with `Access-Control-Allow-Credentials: true`.
4. Allowed methods (`GET, POST, PUT, PATCH, DELETE, OPTIONS`) and allowed headers (`Content-Type, Authorization, x-csrf-token, Cookie`) are explicitly restricted.

### AC4 — Standardized Guards, Decorators & Public Route Opt-Out
**Given** protected and public endpoints across NestJS modules
**When** controllers and route handlers are declared
**Then**:
1. An explicit `@Public()` decorator is provided to mark endpoints exempt from default authentication requirements.
2. Global or module-level guards allow clean decoration with `@UseGuards(SessionAuthGuard, RolesGuard)` and `@Roles(...)`.
3. Standardized metadata reflection (`SetMetadata` / `Reflector`) is used across auth and security guards.

### AC5 — Centralized Payload Validation with Shared Zod Schemas
**Given** incoming request payloads (query params, route params, request bodies)
**When** requests are processed by NestJS controllers
**Then**:
1. All input validations utilize `ZodValidationPipe` backed by `.strict()` schemas defined in `@rescom/schemas`.
2. Unrecognized extra fields are rejected with HTTP `400 Bad Request` and error code `VALIDATION_ERROR`.

### AC6 — Comprehensive Test Coverage
**Given** the complete test suite
**When** executed via `npm test` and `npm run test:e2e`
**Then**:
1. Unit tests verify `ThrottlerGuard` custom error formatting and rate-limit exception handling in `HttpExceptionFilter`.
2. E2E tests verify that Helmet security headers are present on all HTTP responses.
3. E2E tests verify CORS behavior: valid origin succeeds, unauthorized origin is rejected, credentials allowed.
4. E2E tests verify rate limiting: rapid requests exceeding limit return HTTP 429 with `RATE_LIMIT_EXCEEDED` envelope.
5. All existing 28 unit test suites (208 tests) and 8 E2E suites (75 tests) continue to pass 100%.

---

## Tasks / Subtasks

- [x] **Task 1: Install & Configure Helmet Security Headers** (AC: 2)
  - [x] 1.1 Install `helmet` in `apps/backend`.
  - [x] 1.2 Configure Helmet middleware in `apps/backend/src/common/security/helmet.config.ts` and attach in `main.ts` with production security settings (HSTS, CSP, nosniff, frameguard, xssFilter: 0, noopen, cross-domain none, hidePoweredBy).
  - [x] 1.3 Add E2E tests in `security.e2e-spec.ts` asserting Helmet headers are returned on all API responses.

- [x] **Task 2: Production CORS Configuration & Origin Validation** (AC: 3)
  - [x] 2.1 Refactor CORS configuration in `apps/backend/src/common/security/cors.config.ts` with explicit origin function validating against `EnvService.frontendOrigins`, method whitelisting, and header whitelisting.
  - [x] 2.2 Add E2E tests in `security.e2e-spec.ts` verifying CORS headers for allowed origins (204, credentials, matching origin) and disallowed origins (no allow-origin header).

- [x] **Task 3: Rate Limiting Infrastructure (`@nestjs/throttler`)** (AC: 1, 5)
  - [x] 3.1 Install `@nestjs/throttler` in `apps/backend`.
  - [x] 3.2 Update `apps/backend/src/common/config/env.schema.ts` and `env.service.ts` with `RATE_LIMIT_TTL_SECONDS` (default 60), `RATE_LIMIT_MAX_REQUESTS` (default 100), `AUTH_RATE_LIMIT_TTL_SECONDS` (default 60), `AUTH_RATE_LIMIT_MAX_REQUESTS` (default 10).
  - [x] 3.3 Create custom `AppThrottlerGuard` extending `ThrottlerGuard` to attach standard rate limit headers (`Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining: 0`) and throw `ThrottlerException`.
  - [x] 3.4 Create `SecurityModule` registering `ThrottlerModule.forRootAsync` and register global `APP_GUARD: AppThrottlerGuard` in `AppModule`.
  - [x] 3.5 Update `HttpExceptionFilter` to map `ThrottlerException` and status 429 to HTTP 429 with standard `{ data: null, error: { code: 'RATE_LIMIT_EXCEEDED', message: '...' }, meta: {} }`.

- [x] **Task 4: Public Route Opt-Out & Guard Architecture** (AC: 4)
  - [x] 4.1 Define `@Public()` decorator in `apps/backend/src/common/security/public.decorator.ts` using `SetMetadata(IS_PUBLIC_KEY, true)`.
  - [x] 4.2 Update `SessionAuthGuard` to check `Reflector` for `IS_PUBLIC_KEY` and bypass session token extraction / validation for public routes.
  - [x] 4.3 Update unit tests in `session-auth.guard.spec.ts` to verify `@Public()` route bypass.

- [x] **Task 5: Comprehensive Security Integration & E2E Testing** (AC: 6)
  - [x] 5.1 Create `apps/backend/test/security.e2e-spec.ts` testing Helmet headers, CORS behavior, rate limit headers on normal requests, and Rate Limiting 429 response envelope.
  - [x] 5.2 Verify 100% test pass rate across all unit and E2E suites (`npm test`: 28 suites, 208 tests; `npm run test:e2e`: 8 suites, 75 tests).
  - [x] 5.3 Verify clean build (`npm run build`).

### Review Findings

- [x] [Review][Decision] Global Default-Deny SessionAuthGuard vs Controller-Level Explicit Guards — Resolved: Option A selected, keeping controller-level `@UseGuards(SessionAuthGuard)` as designed in Story 1.3/1.4.
- [x] [Review][Patch] Make Helmet HSTS conditional on isProduction and fix ESLint unused variable [apps/backend/src/common/security/helmet.config.ts:23]
- [x] [Review][Patch] Implement Auth Rate Limiting Tier in SecurityModule and apply @Throttle to auth endpoints per AC1.3 [apps/backend/src/common/security/security.module.ts:17]
- [x] [Review][Patch] Add unit tests for AppThrottlerGuard and HttpExceptionFilter per AC6.1 [apps/backend/src/common/security/app-throttler.guard.spec.ts:1]
- [x] [Review][Patch] Set X-RateLimit-Reset header in AppThrottlerGuard on throttled 429 responses [apps/backend/src/common/security/app-throttler.guard.ts:20]
- [x] [Review][Patch] Exempt health check endpoint from rate limiting via @SkipThrottle() [apps/backend/src/common/system/system.controller.ts:20]
- [x] [Review][Patch] Add response.headersSent guard to HttpExceptionFilter [apps/backend/src/common/http/http-exception.filter.ts:48]
- [x] [Review][Patch] Normalize FRONTEND_ORIGINS trailing slashes and cap TTL to 86400s in env schema [apps/backend/src/common/config/env.schema.ts:49]
- [x] [Review][Patch] Fix Prettier formatting errors and unused imports [apps/backend/src/app.module.ts:30]
- [x] [Review][Defer] Redis distributed storage for multi-replica rate limiting [apps/backend/src/common/security/security.module.ts:9] — deferred, in-memory sufficient for single-instance MVP
- [x] [Review][Defer] IPv6 /64 CIDR subnet clustering for edge WAF [apps/backend/src/common/security/app-throttler.guard.ts:9] — deferred, handled by edge reverse proxy/WAF
- [x] [Review][Defer] SessionAuthGuard clearing refresh cookie on expired access token [apps/backend/src/modules/auth/presentation/guards/session-auth.guard.ts:54] — deferred, pre-existing from Story 1.3

---

## Dev Notes

### Architecture Compliance & Guardrails
- **Clean Architecture:** Rate limiting and security middleware belong strictly to presentation and infrastructure layers (`main.ts`, `common/security`, `common/http`, `common/guards`).
- **Standard Envelope:** HTTP 429 responses return standard RESCOM envelope `{ data: null, error: { code: 'RATE_LIMIT_EXCEEDED', message: '...' }, meta: {} }`.
- **Throttler v6 Compatibility:** Configured default and auth named throttlers with test mode awareness so high-velocity automated test suites are not throttled while retaining custom thresholds in dedicated rate limit test fixtures.
- **Express Proxy Trust:** Main bootstrap registers `trust proxy` hops from `EnvService` ensuring accurate IP resolution via `req.ip` for rate limiting behind reverse proxies.

---

## Dev Agent Record

### Implementation Plan
1. Add environment configuration options for rate limiting in `env.schema.ts` and `env.service.ts`.
2. Configure production Helmet security headers in `helmet.config.ts`.
3. Configure strict CORS origin check and exposed headers in `cors.config.ts`.
4. Implement custom `AppThrottlerGuard` and `SecurityModule` with `@nestjs/throttler`.
5. Update `HttpExceptionFilter` for `RATE_LIMIT_EXCEEDED`.
6. Implement `@Public()` decorator and integrate into `SessionAuthGuard`.
7. Author comprehensive E2E tests in `security.e2e-spec.ts` and verify with all unit and E2E suites.
8. Complete adversarial code review, apply 8 patches (Helmet HSTS dev switch, Auth throttler tier, Reset headers, health SkipThrottle, headersSent guard, origin normalization, dedicated unit tests, ESLint & Prettier cleanup).

### Completion Notes
- Helmet security headers verified: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` (conditional on `isProduction: true`), `X-DNS-Prefetch-Control: off`, `X-Download-Options: noopen`, `X-Permitted-Cross-Domain-Policies: none`, `X-XSS-Protection: 0`, and `X-Powered-By` stripped.
- CORS options verified: allowed origins receive 204 preflight with matching origin, credentials, and allowed methods/headers; unauthorized origins receive no allow-origin header. Trailing slashes normalized automatically.
- Rate limiting verified: normal requests return `X-RateLimit-Limit` and `X-RateLimit-Remaining`; exceeded requests return HTTP 429 with standard `RATE_LIMIT_EXCEEDED` envelope and `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining: 0`, `X-RateLimit-Reset`.
- Health check `/system/health` decorated with `@SkipThrottle()`.
- Auth tier throttling implemented and verified in E2E tests (`/auth/login`).
- All 30 unit test suites (211 tests) and 8 E2E test suites (79 tests) pass cleanly.
- Zero ESLint warnings/errors and 100% Prettier compliant.

---

## File List

### New Files
- `apps/backend/src/common/security/public.decorator.ts`
- `apps/backend/src/common/security/helmet.config.ts`
- `apps/backend/src/common/security/cors.config.ts`
- `apps/backend/src/common/security/app-throttler.guard.ts`
- `apps/backend/src/common/security/app-throttler.guard.spec.ts`
- `apps/backend/src/common/security/security.module.ts`
- `apps/backend/src/common/http/http-exception.filter.spec.ts`
- `apps/backend/test/security.e2e-spec.ts`

### Modified Files
- `apps/backend/package.json`
- `apps/backend/src/common/config/env.schema.ts`
- `apps/backend/src/common/config/env.service.ts`
- `apps/backend/src/common/config/env.service.spec.ts`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/common/system/system.controller.ts`
- `apps/backend/src/modules/auth/presentation/guards/session-auth.guard.ts`
- `apps/backend/src/modules/auth/presentation/guards/session-auth.guard.spec.ts`
- `apps/backend/src/modules/admin/infrastructure/in-memory-audit-log.repository.ts`
- `apps/backend/src/modules/admin/infrastructure/prisma-audit-log.repository.ts`
- `apps/backend/src/app.module.ts`
- `apps/backend/src/main.ts`

---

## Change Log
- 2026-09-14: Created Story 1.6 specification for Security & API Foundation.
- 2026-09-14: Implemented Helmet headers, CORS hardening, Throttler rate limiting, `@Public()` decorator, and comprehensive E2E tests. Status transitioned to `review`.
- 2026-09-14: Adversarial code review completed (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Resolved 1 decision-needed item, applied 8 patches (HSTS dev/prod switch, Auth throttler tier, Reset headers, health check SkipThrottle, headersSent guard, schema normalization, unit tests, ESLint & Prettier cleanup), deferred 3 items. All 30 unit suites (211 tests) and 8 E2E suites (79 tests) 100% green. Status transitioned to `done`.
