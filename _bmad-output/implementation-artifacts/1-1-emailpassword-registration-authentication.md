# Story 1.1: Email/Password Registration & Authentication

Status: ready-for-dev

## Story

As a User,
I want to register, log in, and log out using my email and password,
so that I can securely access the RESCOM platform.

## Acceptance Criteria

### AC1 — Registration succeeds for a new email

**Given** an email that does not belong to an existing account  
**When** the client sends `POST /auth/register` with a policy-valid password  
**Then** the backend:

- trims and lowercases the email before lookup and persistence;
- creates exactly one `User` with role `RESPONDENT` and status `ACTIVE`;
- stores only a bcrypt hash of the password, using a work factor of at least 12;
- signs a JWT containing only the minimum identity claim (`sub`), plus standard `iat` and `exp` claims;
- returns HTTP `201` with the standard response envelope and a sanitized user projection;
- sends the JWT only in the `rescom_access_token` HTTP-only cookie, never in the JSON body; and
- includes `Cache-Control: no-store` on the authentication response.

The success envelope is:

```json
{
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "role": "RESPONDENT",
      "status": "ACTIVE"
    }
  },
  "error": null,
  "meta": {}
}
```

`passwordHash` and the JWT must never appear in the response body or logs.

### AC2 — Registration validation is deterministic

**Given** a registration request  
**When** its email or password violates the input policy  
**Then** the backend returns HTTP `400` with error code `AUTH_INVALID_REGISTRATION_INPUT`, creates no user, and sends no authentication cookie.

Input policy:

- `email`: syntactically valid after trimming and lowercasing; maximum 254 characters;
- `password`: preserved exactly as supplied, 12 or more characters, and no more than 72 UTF-8 bytes because bcrypt truncates longer inputs;
- unknown request fields are rejected; and
- passwords are never trimmed, normalized, or logged.

### AC3 — Duplicate and concurrent registration is race-safe

**Given** an email already assigned to an account  
**When** one or more clients attempt to register that normalized email  
**Then** the database uniqueness constraint remains authoritative, no second user is created, and every losing request returns HTTP `409` with:

```json
{
  "data": null,
  "error": {
    "code": "AUTH_EMAIL_ALREADY_REGISTERED",
    "message": "An account with this email already exists."
  },
  "meta": {}
}
```

The response must not disclose any other account data. The implementation must map Prisma unique-conflict error `P2002`; an application pre-check alone is insufficient.

### AC4 — Login succeeds with valid credentials

**Given** an `ACTIVE` local account  
**When** the client sends `POST /auth/login` with the normalized account email and correct password  
**Then** the backend returns HTTP `200`, the same sanitized user envelope defined in AC1, `Cache-Control: no-store`, and a newly issued `rescom_access_token` cookie. The JWT is not returned in the body.

### AC5 — Invalid login does not enumerate accounts

**Given** an unknown email, incorrect password, an account without a local password, or a `LOCKED` account  
**When** login is attempted  
**Then** the backend returns HTTP `401` with the same error code and message for every case, sends no authentication cookie, and exposes no reason-specific timing shortcut where practical:

```json
{
  "data": null,
  "error": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "Invalid email or password."
  },
  "meta": {}
}
```

### AC6 — Cookie and JWT configuration is explicit

The authentication cookie must use these symmetric set/clear options:

| Property | Required value |
| --- | --- |
| Name | `rescom_access_token` |
| `httpOnly` | `true` |
| `secure` | `true` in production; `false` only for local non-HTTPS development/test |
| `sameSite` | `lax` |
| `path` | `/` |
| `domain` | unset (host-only) |
| lifetime | equal to `JWT_ACCESS_TTL_SECONDS`, default `900` seconds |

JWT signing uses `HS256`. `JWT_SECRET` is required, must contain at least 32 characters, and has no checked-in or production fallback. Configuration validation must fail application startup when required values are missing or invalid.

Cookie-bearing browser requests use an explicit `FRONTEND_ORIGINS` allowlist with CORS credentials enabled; wildcard origins are forbidden. Auth endpoints accept JSON payloads only. Full CSRF controls, Helmet, distributed throttling, and global guards remain owned by Story 1.6.

### AC7 — Logout expires the HTTP-only cookie

**Given** a browser with an authentication cookie  
**When** the client sends `POST /auth/logout`  
**Then** the backend returns HTTP `204`, `Cache-Control: no-store`, and a `Set-Cookie` header that expires `rescom_access_token` using the same path, domain, `sameSite`, and `secure` options used when setting it.

Logout clears the browser cookie but does not revoke a previously copied stateless JWT. Server-side invalidation and single-session enforcement belong to Story 1.3.

### AC8 — Architecture and quality gates pass

- Auth and Users follow the adopted Clean Architecture dependency rule.
- Application code depends on ports, not Prisma, bcrypt, JWT, NestJS HTTP types, or Express response objects.
- REST JSON responses use `{ data, error, meta }`, except the bodyless `204` logout response.
- API-boundary validation uses Zod, not `class-validator`.
- Unit, integration, and HTTP e2e tests cover all criteria above.
- Build, typecheck, lint/format checks, Prisma validation/client generation, unit tests, and e2e tests pass.
- Authentication remains operational without AI, Redis, or other optional feature modules being available.

## Tasks / Subtasks

- [ ] Task 1: Establish the backend and test foundation (AC: 8)
  - [ ] Align the backend on one Prisma 6-compatible package family; remove the incompatible `@prisma/config` 7.x dependency/config path rather than upgrading Prisma Client and CLI independently.
  - [ ] Add the minimal NestJS, TypeScript, Jest, and Supertest scaffold inside `apps/backend` without restructuring the repository root, frontend, or introducing Turborepo work.
  - [ ] Add build, typecheck, unit-test, e2e-test, lint/format-check, Prisma validate, and Prisma generate scripts.
  - [ ] Add `.env.example` containing names only or safe examples for `DATABASE_URL`, `JWT_SECRET`, `JWT_ACCESS_TTL_SECONDS`, `BCRYPT_ROUNDS`, `FRONTEND_ORIGINS`, `PORT`, and `NODE_ENV`; never edit or commit the real `.env` secrets.
  - [ ] Write failing startup/config tests first, then implement validated configuration with no insecure production fallback.

- [ ] Task 2: Define authentication contracts and boundary validation (AC: 1, 2, 3, 4, 5, 8)
  - [ ] Create shared Zod schemas for registration and login under `packages/schemas`, including email normalization, the exact password policy, and strict unknown-field rejection.
  - [ ] Define sanitized user and standard success/error envelope contracts; exclude `passwordHash` and token material by construction.
  - [ ] Add failing schema/contract tests for malformed and oversized emails, whitespace/case normalization, passwords below 12 characters, passwords above 72 UTF-8 bytes, Unicode byte-length boundaries, and unknown fields.
  - [ ] Implement the Zod HTTP validation adapter/pipe and response mapping required to pass those tests.

- [ ] Task 3: Create Users persistence ports and Prisma adapter (AC: 1, 3, 5, 8)
  - [ ] Define an application-owned user repository port for normalized-email lookup and creation; application/domain layers must not import Prisma types.
  - [ ] Add a shared Prisma module/service and a Users infrastructure adapter inside `apps/backend`.
  - [ ] Update `User.role` to default to `RESPONDENT` at the database schema level while also assigning it explicitly in the registration use case.
  - [ ] Make `passwordHash` nullable to permit a future Google-only identity, while requiring it for email/password registration and treating a missing hash as generic invalid credentials.
  - [ ] Create and review the Prisma migration; do not add OAuth tables, session-version state, wallets, or starter-point records in this story.
  - [ ] Write failing repository/integration tests first, including normalized lookup and two concurrent registrations; verify one user is created and the losing operation maps to the duplicate-domain error.

- [ ] Task 4: Implement password and token infrastructure adapters (AC: 1, 4, 5, 6, 8)
  - [ ] Define application ports for password hashing/comparison and access-token signing.
  - [ ] Write failing adapter tests first for bcrypt hashing/comparison, minimum work factor, minimal JWT claims, HS256 signing, expiration, and secret/config failures.
  - [ ] Implement bcrypt and `@nestjs/jwt` adapters; do not expose concrete libraries to application/domain layers.
  - [ ] Do not install Passport strategies or global JWT guards solely for token issuance; protected-route infrastructure belongs to Story 1.6 unless required by an existing in-scope test.

- [ ] Task 5: Implement registration and login application services (AC: 1, 2, 3, 4, 5, 8)
  - [ ] Write failing application tests first using mocked ports for registration success, explicit default role, hash-before-persist, sanitized result, JWT issuance, and dependency failures.
  - [ ] Implement registration with normalized email and race-safe `P2002` conflict mapping; a pre-check may improve UX but cannot be the correctness mechanism.
  - [ ] Write failing login tests first for success, unknown email, wrong password, nullable password hash, and `LOCKED` status; all failure cases must map to the same 401 result.
  - [ ] Implement login, including a dummy bcrypt comparison for unknown accounts where practical to reduce account-enumeration timing differences.
  - [ ] Confirm plaintext passwords, password hashes, and JWTs are absent from application return values and logs.

- [ ] Task 6: Implement HTTP endpoints and cookie handling (AC: 1–8)
  - [ ] Write failing Supertest e2e tests first for `POST /auth/register`, `POST /auth/login`, and `POST /auth/logout`.
  - [ ] Implement the Auth presentation controller and a single cookie-options provider/helper used by both set and clear operations.
  - [ ] Assert registration/login statuses, envelopes, sanitized bodies, `Cache-Control: no-store`, and all required `Set-Cookie` attributes, including production/test `Secure` behavior.
  - [ ] Assert logout returns `204` and expires the exact cookie with symmetric attributes.
  - [ ] Assert duplicate registration returns `409`; invalid registration returns `400`; unknown-email, wrong-password, missing-local-password, and locked-user login return identical `401` bodies.
  - [ ] Configure credentialed CORS with an explicit parsed origin allowlist and test accepted/rejected origins; never combine credentials with `*`.

- [ ] Task 7: Complete regression and architecture validation (AC: 8)
  - [ ] Add an import-boundary test or lint rule proving domain/application layers do not import NestJS, Express, Prisma, bcrypt, or JWT adapters.
  - [ ] Run the full unit, integration, and e2e suites against an isolated test database or deterministic repository override; never destructively clean the developer database.
  - [ ] Run lint/format check, typecheck, build, `prisma validate`, and `prisma generate`.
  - [ ] Verify auth startup and tests do not require AI or Redis availability.
  - [ ] Recheck every acceptance criterion and confirm no adjacent-story functionality was introduced.

## Dev Notes

### Authoritative implementation decisions

- Use NestJS inside the existing `apps/backend` directory. Do not rename it to the architecture document's illustrative `apps/api` path during this story.
- Follow Clean Architecture: presentation and infrastructure depend inward; application/domain code does not depend on framework or persistence implementations.
- Use Zod at HTTP boundaries. The earlier `class-validator` guidance conflicts with the binding Architecture Spine and must not be followed.
- Use `@nestjs/jwt` for access-token signing. Passport Local/JWT strategies and global guards are not required to satisfy register/login/logout and remain deferred to the security foundation unless an existing in-scope dependency requires them.
- Use the existing PostgreSQL 15 and Prisma 6 baseline. Align the Prisma package family before generating a migration or client.
- Normalize identity emails with `trim().toLowerCase()` in the shared schema and preserve the normalized form in storage. Database uniqueness remains the final concurrency guard.
- Bcrypt is selected by the epic. Use a configurable work factor with a minimum of 12 and reject passwords over 72 UTF-8 bytes.
- Keep JWT payloads minimal. Do not add `sessionVersion` or revocation behavior before Story 1.3.
- A nullable `passwordHash` is only a forward-compatible data-model seam for Story 1.2; this story does not implement Google OAuth or account linking.

### Current repository state and preservation requirements

- `apps/backend` currently contains only the package manifest/lockfile and Prisma scaffold; there is no NestJS source tree, TypeScript config, test runner, migration history, or lint setup.
- Preserve the existing Prisma models and relations unrelated to the two explicit `User` field changes in Task 3.
- Preserve user-owned/unrelated working-tree changes, including `apps/backend/README.md` and planning artifacts.
- Do not restructure the root package, initialize Turborepo, or modify the frontend as part of this backend story.
- Do not depend on a running development database in unit/e2e tests. Repository integration tests must use an isolated test database with a separately validated URL.

### Scope boundaries and sequencing

- **Story 1.2:** Google OAuth and account-linking policy. Only nullable local password storage is prepared here.
- **Story 1.3:** Single-session enforcement, token revocation/versioning, and invalidating copied JWTs.
- **Story 1.4:** User role/status management and RBAC administration. This story only assigns/respects existing role/status values.
- **Story 1.5:** Immutable administrative audit logging.
- **Story 1.6:** Helmet, Redis-backed throttling, complete CSRF posture, Passport JWT extraction, global authentication/authorization guards, and cross-cutting API hardening. Story 1.1 only adds the cookie/CORS/config behavior necessary for its own endpoints.
- **Story 6.5:** Atomic grant, unlock, and expiry of 100 Frozen starter points. Story 1.1 must not write balances or ledger records. The PRD's 30-day expiry remains authoritative over stale seven-day wording elsewhere.
- Password reset, email verification, refresh tokens, remember-me, MFA, frontend auth pages, and onboarding redirects are out of scope.

### Expected source layout

```text
apps/backend/
  .env.example
  nest-cli.json
  tsconfig.json
  tsconfig.build.json
  src/
    main.ts
    app.module.ts
    common/
      config/
      database/
      http/
    modules/
      auth/
        domain/
        application/
          ports/
        infrastructure/
        presentation/
      users/
        domain/
        application/
          ports/
        infrastructure/
  test/
packages/schemas/
  src/auth/
```

Exact filenames may follow established NestJS naming conventions, but the layer boundaries and ownership above are mandatory.

### Testing standards

- Follow red-green-refactor for every task and preserve evidence that each new test failed before its implementation was added.
- Unit-test application behavior through ports/fakes.
- Integration-test Prisma uniqueness and concurrent registration against an isolated PostgreSQL database.
- E2e-test the Nest HTTP surface with Supertest and deterministic infrastructure overrides where database behavior is not the subject.
- Cookie assertions must check attributes, not merely the presence of a `Set-Cookie` header.
- Error tests must compare the complete response envelope so invalid-login cases remain indistinguishable.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` — Epic 1, Story 1.1 and Stories 1.2–1.6]
- [Source: `_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md` — §4.1 Authentication & Account Management, FR-1, NFR-1, NFR-6, NFR-7, NFR-15]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md` — AD-3, AD-7, Consistency Conventions, Stack, Structural Seed]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md` — §17 Current Code Reality and §19 Open Gates]
- [Source: `_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-16.md` — Architecture Alignment and Resolved Conflicts]
- [Source: `apps/backend/prisma/schema.prisma` — `Role`, `UserStatus`, and `User`]
- [Source: `apps/backend/package.json` and `apps/backend/package-lock.json` — current Prisma package versions]
- [NestJS Cookies](https://docs.nestjs.com/techniques/cookies)
- [NestJS Configuration](https://docs.nestjs.com/techniques/configuration)
- [NestJS CORS](https://docs.nestjs.com/security/cors)
- [NestJS Authentication](https://docs.nestjs.com/security/authentication)
- [Prisma with NestJS](https://docs.prisma.io/docs/guides/frameworks/nestjs)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-08-16: Created an implementation-ready story contract with explicit acceptance criteria, Clean Architecture tasks, API/cookie/security behavior, scope boundaries, and comprehensive test gates.
