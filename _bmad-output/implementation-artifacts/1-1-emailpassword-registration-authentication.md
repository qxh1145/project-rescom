---
baseline_commit: beaa474c24977874ea3ae4aef7c354ccbfdd5603
---

# Story 1.1: Email/Password Registration & Authentication

Status: done

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

- [x] Task 1: Establish the backend and test foundation (AC: 8)
  - [x] Align the backend on one Prisma 6-compatible package family; remove the incompatible `@prisma/config` 7.x dependency/config path rather than upgrading Prisma Client and CLI independently.
  - [x] Add the minimal NestJS, TypeScript, Jest, and Supertest scaffold inside `apps/backend` without restructuring the repository root, frontend, or introducing Turborepo work.
  - [x] Add build, typecheck, unit-test, e2e-test, lint/format-check, Prisma validate, and Prisma generate scripts.
  - [x] Add `.env.example` containing names only or safe examples for `DATABASE_URL`, `JWT_SECRET`, `JWT_ACCESS_TTL_SECONDS`, `BCRYPT_ROUNDS`, `FRONTEND_ORIGINS`, `PORT`, and `NODE_ENV`; never edit or commit the real `.env` secrets.
  - [x] Write failing startup/config tests first, then implement validated configuration with no insecure production fallback.

- [x] Task 2: Define authentication contracts and boundary validation (AC: 1, 2, 3, 4, 5, 8)
  - [x] Create shared Zod schemas for registration and login under `packages/schemas`, including email normalization, the exact password policy, and strict unknown-field rejection.
  - [x] Define sanitized user and standard success/error envelope contracts; exclude `passwordHash` and token material by construction.
  - [x] Add failing schema/contract tests for malformed and oversized emails, whitespace/case normalization, passwords below 12 characters, passwords above 72 UTF-8 bytes, Unicode byte-length boundaries, and unknown fields.
  - [x] Implement the Zod HTTP validation adapter/pipe and response mapping required to pass those tests.

- [x] Task 3: Create Users persistence ports and Prisma adapter (AC: 1, 3, 5, 8)
  - [x] Define an application-owned user repository port for normalized-email lookup and creation; application/domain layers must not import Prisma types.
  - [x] Add a shared Prisma module/service and a Users infrastructure adapter inside `apps/backend`.
  - [x] Update `User.role` to default to `RESPONDENT` at the database schema level while also assigning it explicitly in the registration use case.
  - [x] Make `passwordHash` nullable to permit a future Google-only identity, while requiring it for email/password registration and treating a missing hash as generic invalid credentials.
  - [x] Create and review the Prisma migration; do not add OAuth tables, session-version state, wallets, or starter-point records in this story.
  - [x] Write failing repository/integration tests first, including normalized lookup and two concurrent registrations; verify one user is created and the losing operation maps to the duplicate-domain error.

- [x] Task 4: Implement password and token infrastructure adapters (AC: 1, 4, 5, 6, 8)
  - [x] Define application ports for password hashing/comparison and access-token signing.
  - [x] Write failing adapter tests first for bcrypt hashing/comparison, minimum work factor, minimal JWT claims, HS256 signing, expiration, and secret/config failures.
  - [x] Implement bcrypt and `@nestjs/jwt` adapters; do not expose concrete libraries to application/domain layers.
  - [x] Do not install Passport strategies or global JWT guards solely for token issuance; protected-route infrastructure belongs to Story 1.6 unless required by an existing in-scope test.

- [x] Task 5: Implement registration and login application services (AC: 1, 2, 3, 4, 5, 8)
  - [x] Write failing application tests first using mocked ports for registration success, explicit default role, hash-before-persist, sanitized result, JWT issuance, and dependency failures.
  - [x] Implement registration with normalized email and race-safe `P2002` conflict mapping; a pre-check may improve UX but cannot be the correctness mechanism.
  - [x] Write failing login tests first for success, unknown email, wrong password, nullable password hash, and `LOCKED` status; all failure cases must map to the same 401 result.
  - [x] Implement login, including a dummy bcrypt comparison for unknown accounts where practical to reduce account-enumeration timing differences.
  - [x] Confirm plaintext passwords, password hashes, and JWTs are absent from application return values and logs.

- [x] Task 6: Implement HTTP endpoints and cookie handling (AC: 1–8)
  - [x] Write failing Supertest e2e tests first for `POST /auth/register`, `POST /auth/login`, and `POST /auth/logout`.
  - [x] Implement the Auth presentation controller and a single cookie-options provider/helper used by both set and clear operations.
  - [x] Assert registration/login statuses, envelopes, sanitized bodies, `Cache-Control: no-store`, and all required `Set-Cookie` attributes, including production/test `Secure` behavior.
  - [x] Assert logout returns `204` and expires the exact cookie with symmetric attributes.
  - [x] Assert duplicate registration returns `409`; invalid registration returns `400`; unknown-email, wrong-password, missing-local-password, and locked-user login return identical `401` bodies.
  - [x] Configure credentialed CORS with an explicit parsed origin allowlist and test accepted/rejected origins; never combine credentials with `*`.

- [x] Task 7: Complete regression and architecture validation (AC: 8)
  - [x] Add an import-boundary test or lint rule proving domain/application layers do not import NestJS, Express, Prisma, bcrypt, or JWT adapters.
  - [x] Run the full unit, integration, and e2e suites against an isolated test database or deterministic repository override; never destructively clean the developer database.
  - [x] Run lint/format check, typecheck, build, `prisma validate`, and `prisma generate`.
  - [x] Verify auth startup and tests do not require AI or Redis availability.
  - [x] Recheck every acceptance criterion and confirm no adjacent-story functionality was introduced.

### Review Findings

- [x] [Review][Patch] Return HTTP 400 with AUTH_INVALID_LOGIN_INPUT for malformed login input [apps/backend/src/modules/auth/presentation/auth.controller.ts:59]
- [x] [Review][Patch] Fix broken production entry point in start script [apps/backend/package.json:9]
- [x] [Review][Patch] Eliminate account enumeration timing oracle for LOCKED accounts [apps/backend/src/modules/auth/application/auth.service.ts:93]
- [x] [Review][Patch] Return callback(null, false) on CORS rejection to prevent 500 error [apps/backend/src/main.ts:20]
- [x] [Review][Patch] Decouple application exceptions from NestJS HttpException classes [apps/backend/src/modules/auth/application/exceptions/auth.exceptions.ts:1]
- [x] [Review][Patch] Map Prisma P2002 error in repository adapter instead of leaking into application service [apps/backend/src/modules/users/infrastructure/prisma-user.repository.ts:45]
- [x] [Review][Patch] Mask unhandled error messages and add server error logging in HttpExceptionFilter [apps/backend/src/common/http/http-exception.filter.ts:44]
- [x] [Review][Patch] Initialize dotenv in application startup [apps/backend/src/main.ts:1]
- [x] [Review][Patch] Add app.enableShutdownHooks() for graceful database disconnection [apps/backend/src/main.ts:8]
- [x] [Review][Patch] Enforce maximum password length in loginSchema to prevent CPU DoS [packages/schemas/src/auth/login.schema.ts:11]
- [x] [Review][Patch] Unify cookie option helpers into a single provider [apps/backend/src/modules/auth/presentation/cookie-options.helper.ts:6]
- [x] [Review][Patch] Add automated tests for production Secure cookie flag and CORS rejection [apps/backend/test/auth.e2e-spec.ts:2577]
- [x] [Review][Patch] Enforce Content-Type: application/json for auth POST endpoints [apps/backend/src/modules/auth/presentation/auth.controller.ts]
- [x] [Review][Patch] Encapsulate dummy bcrypt comparison inside password hasher port/adapter [apps/backend/src/modules/auth/application/auth.service.ts:16]
- [x] [Review][Patch] Remove unused dependencies (@nestjs/config, resolve-cwd) from package.json [apps/backend/package.json:22]
- [x] [Review][Patch] Add bounds validation for PORT and BCRYPT_ROUNDS in env schema [apps/backend/src/common/config/env.schema.ts:7]
- [x] [Review][Defer] Automated execution of Prisma repository integration tests against an isolated live PostgreSQL container [apps/backend/src/modules/users/infrastructure/user.repository.spec.ts:1] — deferred, pre-existing

### Review Findings — Chunk 1: Core Auth/Application/Schemas

- [x] [Review][Patch] Pre-generate the user ID and sign the JWT before persistence so token-signing failures cannot create partial registrations [apps/backend/src/modules/auth/application/auth.service.ts:47]
- [x] [Review][Patch] Cap BCRYPT_ROUNDS at 14 to prevent operationally unsafe hashing costs [apps/backend/src/common/config/env.schema.ts:13]
- [x] [Review][Patch] Count the 12-character password minimum using Unicode grapheme clusters while preserving the exact password value [packages/schemas/src/auth/register.schema.ts:11]
- [x] [Review][Patch] Reject login passwords over 72 UTF-8 bytes to prevent bcrypt prefix-equivalent credentials [packages/schemas/src/auth/login.schema.ts:11]
- [x] [Review][Patch] Build the dummy bcrypt hash at the configured work factor so unknown-account timing matches real hashes [apps/backend/src/modules/auth/infrastructure/bcrypt-password-hasher.adapter.ts:8]
- [x] [Review][Patch] Remove NestJS imports and decorators from the application-layer AuthService and wire it through the module factory [apps/backend/src/modules/auth/application/auth.service.ts:1]
- [x] [Review][Patch] Reject ill-formed UTF-16 passwords at validation so bcrypt failures become deterministic HTTP 400 responses [packages/schemas/src/auth/register.schema.ts:11]
- [x] [Review][Patch] Enforce the email local-part and domain-label length boundaries omitted by Zod email validation [packages/schemas/src/auth/register.schema.ts:5]
- [x] [Review][Patch] Stop swallowing unexpected bcrypt comparison failures as invalid credentials [apps/backend/src/modules/auth/infrastructure/bcrypt-password-hasher.adapter.ts:18]
- [x] [Review][Patch] Assert the exact configured JWT lifetime (`exp - iat`) in adapter tests [apps/backend/src/modules/auth/infrastructure/adapters.spec.ts:53]
- [x] [Review][Patch] Add a clean-checkout build lifecycle for `@rescom/schemas` before backend runtime resolution [packages/schemas/package.json:4]

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

Gemini 3.8 Flash (Antigravity)

### Debug Log References

- Root workspace linking and clean dependency resolution without native build barriers
- Zod strict schema rejection of prototype pollution attempts
- Supertest e2e suite isolated from live DB connections using deterministic repository override

### Completion Notes List

- Implemented backend foundation inside `apps/backend` with NestJS 10, TypeScript 5, Jest, Supertest, ESLint, Prettier, and Prisma 6.
- Implemented shared Zod contracts in `packages/schemas` for registration, login, sanitized user projection, and standard API response envelope `{ data, error, meta }`.
- Implemented Clean Architecture layers:
  - Domain entities: `User`
  - Application ports: `UserRepositoryPort`, `PasswordHasherPort`, `TokenServicePort`
  - Application services: `AuthService`
  - Infrastructure adapters: `PrismaUserRepository`, `InMemoryUserRepository`, `BcryptPasswordHasherAdapter`, `NestJwtTokenAdapter`
  - Presentation: `AuthController`, `cookie-options.helper`, `ZodValidationPipe`, `HttpExceptionFilter`
- Automated verification:
  - 40 unit and architecture tests passing, covering input policies, email bounds (254 chars vs 255 chars), password byte boundaries (72 bytes vs 73 bytes across ASCII, Vietnamese, CJK, and emoji UTF-8 representations), prototype pollution rejection, and anti-enumeration timing protections.
  - 7 Supertest E2E integration test suites passing, covering registration, login, anti-enumeration, HTTP-only cookie issuance/clearance, symmetric attributes, and credentialed CORS.
  - Static import boundary validation (`test/architecture.spec.ts`) enforcing Clean Architecture dependency rules.
  - Typecheck, build, ESLint, Prettier, and Prisma validation passing with zero warnings/errors.
- Generated initial PostgreSQL Prisma migration `20260912085000_init_users`.

### File List

- packages/schemas/package.json
- packages/schemas/tsconfig.json
- packages/schemas/src/index.ts
- packages/schemas/src/auth/register.schema.ts
- packages/schemas/src/auth/login.schema.ts
- packages/schemas/src/auth/sanitized-user.schema.ts
- packages/schemas/src/auth/response-envelope.schema.ts
- apps/backend/package.json
- apps/backend/tsconfig.json
- apps/backend/tsconfig.build.json
- apps/backend/nest-cli.json
- apps/backend/jest.config.js
- apps/backend/.eslintrc.js
- apps/backend/.prettierrc
- apps/backend/.env.example
- apps/backend/prisma/migrations/20260912085000_init_users/migration.sql
- apps/backend/prisma/migrations/migration_lock.toml
- apps/backend/src/main.ts
- apps/backend/src/app.module.ts
- apps/backend/src/common/config/env.schema.ts
- apps/backend/src/common/config/env.service.ts
- apps/backend/src/common/config/env.service.spec.ts
- apps/backend/src/common/config/config.module.ts
- apps/backend/src/common/database/prisma.service.ts
- apps/backend/src/common/database/prisma.module.ts
- apps/backend/src/common/http/response.envelope.ts
- apps/backend/src/common/http/zod-validation.pipe.ts
- apps/backend/src/common/http/http-exception.filter.ts
- apps/backend/src/modules/users/domain/user.entity.ts
- apps/backend/src/modules/users/application/ports/user.repository.port.ts
- apps/backend/src/modules/users/infrastructure/prisma-user.repository.ts
- apps/backend/src/modules/users/infrastructure/in-memory-user.repository.ts
- apps/backend/src/modules/users/infrastructure/user.repository.spec.ts
- apps/backend/src/modules/users/users.module.ts
- apps/backend/src/modules/auth/application/ports/password-hasher.port.ts
- apps/backend/src/modules/auth/application/ports/token-service.port.ts
- apps/backend/src/modules/auth/application/exceptions/auth.exceptions.ts
- apps/backend/src/modules/auth/application/auth.service.ts
- apps/backend/src/modules/auth/application/auth.service.spec.ts
- apps/backend/src/modules/auth/infrastructure/bcrypt-password-hasher.adapter.ts
- apps/backend/src/modules/auth/infrastructure/nest-jwt-token.adapter.ts
- apps/backend/src/modules/auth/infrastructure/adapters.spec.ts
- apps/backend/src/modules/auth/presentation/cookie-options.helper.ts
- apps/backend/src/modules/auth/presentation/auth.controller.ts
- apps/backend/src/modules/auth/presentation/auth.schema.spec.ts
- apps/backend/src/modules/auth/auth.module.ts
- apps/backend/test/jest-e2e.json
- apps/backend/test/architecture.spec.ts
- apps/backend/test/auth.e2e-spec.ts

## Change Log

- 2026-08-16: Created an implementation-ready story contract with explicit acceptance criteria, Clean Architecture tasks, API/cookie/security behavior, scope boundaries, and comprehensive test gates.
- 2026-09-12: Implemented Story 1.1 with Clean Architecture, shared Zod contracts, NestJS backend scaffold, 40 unit and edge-case tests, and 7 Supertest E2E integration suites. All criteria and quality gates verified green.
