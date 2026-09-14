---
baseline_commit: 7e16b823e20e88220055106263e8a493a776c5b9
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/addendum.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
---

# Story 1.4: Role-Based Access Control (RBAC) & User Management

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Admin,
I want to view all users and manage their roles and account status via secure administrative APIs,
so that I can manage privileged authorization assignments, lock malicious or compromised actors, and maintain system security while ensuring that ordinary publishing and responding capabilities remain non-mutually exclusive for marketplace participants.

## Acceptance Criteria

### AC1 — Route-Level RBAC Guard & Authorization Protection (`RolesGuard`)

**Given** an incoming request to an administrative endpoint protected by `@UseGuards(SessionAuthGuard, RolesGuard)` and decorated with `@Roles('ADMIN')`
**When** the request is evaluated
**Then** the authorization layer enforces:
1. `SessionAuthGuard` first authenticates the request via `rescom_access_token` cookie, validates the session, checks user locked status, sanitizes the user, and attaches `req.user: AuthenticatedUser` and `req.session: Session`. If unauthenticated, `SessionAuthGuard` rejects immediately with HTTP `401 Unauthorized` (`AUTH_UNAUTHORIZED`).
2. `RolesGuard` reads required roles via NestJS `Reflector` from handler or controller metadata:
   - If `req.user.role === 'ADMIN'`, access is granted (`canActivate` returns `true`).
   - If `req.user.role !== 'ADMIN'` (e.g., `RESPONDENT` or `PUBLISHER`), `RolesGuard` throws `ForbiddenResourceException` (located in auth domain exceptions), which `HttpExceptionFilter` formats as HTTP `403 Forbidden` with code `FORBIDDEN_RESOURCE`:
     ```json
     {
       "data": null,
       "error": {
         "code": "FORBIDDEN_RESOURCE",
         "message": "Access denied: insufficient permissions."
       },
       "meta": {}
     }
     ```
   - If no `@Roles()` decorator is present on the route or controller, `RolesGuard` permits any authenticated user.
   - `RolesGuard` does NOT clear session cookies on `403 Forbidden` failures (the user remains logged in; they are simply forbidden from accessing administrative resources).
3. `RolesGuard` is exported by `AuthModule` as an `@Injectable()` provider. `@Roles` is exported exclusively through the TypeScript barrel `decorators/index.ts` (not in Nest module `exports`).

### AC2 — Consistent Locked-Account Session Rejection (`403 AUTH_USER_LOCKED`)

**Given** an account has been locked (`status === 'LOCKED'`) and all its active sessions have been marked `revoked = true`
**When** a client presents an access token or refresh cookie previously issued to that user
**Then** the session validation and refresh pipelines in `SessionService` (covering BOTH access-token validation `validateSession` and refresh-token flows `refreshSession` and `rotateCsrf`):
1. Retrieve session records regardless of `revoked` state (e.g. `findById`, `findCredentialWithSession`).
2. Query PostgreSQL for the user by `session.userId`.
3. Inspect `user.isLocked()` BEFORE deciding on generic session revocation for BOTH access-token and refresh-token flows:
   - If `user.isLocked() === true`, the service MUST throw `UserLockedException()` (HTTP `403 Forbidden`, error code `AUTH_USER_LOCKED`) and symmetrically clear auth cookies, REGARDLESS of whether `session.revoked === true`.
   - If the user is NOT locked, but `session.revoked === true`, the service throws `SessionRevokedException()` (HTTP `401 Unauthorized`, error code `AUTH_SESSION_REVOKED`).

### AC3 — Dual-Capability Non-Mutually Exclusive Marketplace Invariant (FR-ADD-12)

**Given** the RESCOM platform user model
**When** authorization decisions are made across the platform
**Then**:
1. `ADMIN` is a privileged security role granting access to administrative operations (user management, moderation queue, dispute resolution).
2. `RESPONDENT` and `PUBLISHER` roles in the database represent normal platform users. The backend MUST NOT treat `RESPONDENT` and `PUBLISHER` as mutually exclusive access barriers for normal survey features:
   - Any normal user (`RESPONDENT` or `PUBLISHER`) is eligible to both respond to surveys and create/publish surveys, subject to product-level eligibility rules (onboarding survey completion, demographic profile, and sufficient point balance in Epic 2/Epic 6), NOT restricted by RBAC role gates.
   - Role assignment by an Admin updates `user.role` to `ADMIN`, `PUBLISHER`, or `RESPONDENT` without corrupting user profile or wallet data.

### AC4 — Paginated User Listing, Search & Filtering (`GET /admin/users`)

**Given** an authenticated Admin making a `GET /admin/users` request
**When** query parameters are supplied
**Then** the endpoint:
1. Validates query parameters against shared `listUsersQuerySchema`:
   - `page`: integer ≥ 1, default `1`
   - `limit`: integer between 1 and 100, default `20`
   - `search`: optional string, trimmed; filters where `email` contains `search` (case-insensitive)
   - `role`: optional enum filter (`ADMIN` | `PUBLISHER` | `RESPONDENT`)
   - `status`: optional enum filter (`ACTIVE` | `LOCKED`)
2. Queries the database through `UserRepositoryPort.findMany` with pagination offsets (`skip: (page - 1) * limit`, `take: limit`) and ordering by `createdAt DESC`.
3. Returns HTTP `200 OK` conforms to `paginatedAdminUsersResponseSchema`:
   ```json
   {
     "data": {
       "items": [
         {
           "id": "123e4567-e89b-12d3-a456-426614174000",
           "email": "user@example.com",
           "role": "RESPONDENT",
           "status": "ACTIVE",
           "createdAt": "2026-09-14T10:00:00.000Z",
           "updatedAt": "2026-09-14T10:00:00.000Z"
         }
       ],
       "pagination": {
         "page": 1,
         "limit": 20,
         "total": 42,
         "totalPages": 3
       }
     },
     "error": null,
     "meta": {}
   }
   ```
4. Sensitive fields (`passwordHash`, salts, session digests) MUST NEVER be present in items or serialized in the response body. An explicit sanitized allowlist mapper (`toAdminUserResponse`) must project every user item (no object spread).

### AC5 — Single User Detail Retrieval & Standardized UUID Validation (`GET /admin/users/:id`)

**Given** an authenticated Admin making a `GET /admin/users/:id` request
**When** the user ID parameter is evaluated
**Then**:
1. If `:id` is not a valid UUID format, the endpoint rejects the request with HTTP `400 Bad Request` formatted in the standardized error envelope with error code `VALIDATION_ERROR` (not NestJS default error structure):
   ```json
   {
     "data": null,
     "error": {
       "code": "VALIDATION_ERROR",
       "message": "Invalid UUID parameter"
     },
     "meta": {}
   }
   ```
2. If the user exists in PostgreSQL, returns HTTP `200 OK` conforms to `adminUserDetailResponseSchema`:
   ```json
   {
     "data": {
       "user": {
         "id": "123e4567-e89b-12d3-a456-426614174000",
         "email": "target@example.com",
         "role": "RESPONDENT",
         "status": "ACTIVE",
         "createdAt": "2026-09-14T10:00:00.000Z",
         "updatedAt": "2026-09-14T10:00:00.000Z"
       }
     },
     "error": null,
     "meta": {}
   }
   ```
3. If no user exists matching `:id`, returns HTTP `404 Not Found` with code `USER_NOT_FOUND`.

### AC6 — Concurrency-Safe Account Locking/Unlocking & Atomic UoW (`PATCH /admin/users/:id/status`)

**Given** an authenticated Admin making a `PATCH /admin/users/:id/status` request
**When** payload `{ "status": "LOCKED" | "ACTIVE" }` is submitted
**Then** `UserAdminService` coordinates business policies and executes atomic operations through `UserAdminTransactionPort`:
1. **Self-Lock Prevention**: Evaluated in `UserAdminService` before transaction entry (depends only on actor ID, target ID, and requested `newStatus === 'LOCKED'`). If `targetUserId === admin.id` and requested `status === 'LOCKED'`, the request is rejected with HTTP `400 Bad Request`, records an audit failure with error code `CANNOT_LOCK_SELF` ("Admins cannot lock their own account"), and throws `CannotLockSelfException`.
2. **Transactional Snapshot Isolation**: Do NOT use a `targetUser` snapshot loaded before `UserAdminTransactionPort.run()` for existence, no-op, role/status, or last-admin decisions, as it can become stale between initial read and transaction start. All target state evaluation occurs within `userAdminTransaction.run(async (ctx) => { ... })`.
3. **Transactional Target Fetch & Existence**: Inside the transaction, re-fetches the target user via `ctx.findUserById(targetUserId)`. If target user does not exist, throws `UserNotFoundException`. Caught outside the transaction by `UserAdminService` to record an audit failure (`USER_NOT_FOUND`) and rethrow (HTTP `404 Not Found`).
4. **No-Op Status Updates**: Evaluated inside the transaction on the fresh transactional snapshot. If `targetUser.status === newStatus`:
   - Skips status update and session revocation.
   - Records an audit log inside the transaction via `ctx.appendAuditLog(...)` with `outcome: 'SUCCESS'` and `metadata: { previousStatus, newStatus, changed: false }`.
   - Returns HTTP `200 OK` with the current sanitized user projection.
5. **Concurrency-Safe Last-Admin Protection**:
   - If `targetUser.role === 'ADMIN' && targetUser.status === 'ACTIVE' && newStatus === 'LOCKED'`:
   - Within the transaction, `UserAdminService` calls `ctx.lockActiveAdmins()`.
   - The transaction adapter acquires a row-level lock matching exact PostgreSQL mapped table and enum identifiers:
     `SELECT "id" FROM "users" WHERE "role" = 'ADMIN'::"Role" AND "status" = 'ACTIVE'::"UserStatus" FOR UPDATE`
     and returns the locked active admin count. (Target user is re-read/revalidated if necessary before mutation).
   - `UserAdminService` enforces the business policy: if active admin count ≤ 1, it throws `CannotLockLastAdminException`, aborting the transaction. Caught outside the transaction to record an audit failure (`CANNOT_LOCK_LAST_ADMIN`) and rethrow (HTTP `400 Bad Request`).
6. **Atomic Execution**: Inside the atomic transaction (`UserAdminTransactionPort.run`):
   - `ctx.updateUserStatus(targetUserId, newStatus)` updates `status` in the `"users"` table.
   - If `status === 'LOCKED'`, `ctx.revokeUserSessions(targetUserId)` revokes all unrevoked sessions for `targetUserId` in the `"sessions"` table (`SessionRepositoryPort.revokeAllByUserId(targetUserId)`).
   - `ctx.appendAuditLog(...)` appends an audit log record in `"identity_audit_logs"` with `action: 'USER_STATUS_CHANGED'`, `userId: admin.id`, `targetUserId: targetUserId`, `outcome: 'SUCCESS'`, and `metadata: { previousStatus, newStatus, changed: true }`.
7. **Concurrency Invariant**: With exactly 2 ACTIVE ADMINs, concurrent mutations—including overlapping role and status operations (e.g. simultaneous lock and demote requests on the two admins)—must be serialized by row-level locking/transaction isolation; the system must NEVER reach 0 ACTIVE ADMINs, and exactly one request must fail with `CANNOT_LOCK_LAST_ADMIN` or `CANNOT_DEMOTE_LAST_ADMIN`.
8. Returns HTTP `200 OK` with the updated sanitized user projection.

### AC7 — Concurrency-Safe Role Management & Atomic UoW (`PATCH /admin/users/:id/role`)

**Given** an authenticated Admin making a `PATCH /admin/users/:id/role` request
**When** payload `{ "role": "ADMIN" | "PUBLISHER" | "RESPONDENT" }` is submitted
**Then** `UserAdminService` coordinates business policies and executes atomic operations through `UserAdminTransactionPort`:
1. **Self-Demotion Prevention**: Evaluated in `UserAdminService` before transaction entry (depends only on actor ID, target ID, and requested `newRole !== 'ADMIN'`). If `targetUserId === admin.id` and requested `role !== 'ADMIN'`, the request is rejected with HTTP `400 Bad Request`, records an audit failure with error code `CANNOT_DEMOTE_SELF` ("Admins cannot demote or alter their own admin role"), and throws `CannotDemoteSelfException`.
2. **Transactional Snapshot Isolation**: Do NOT use a `targetUser` snapshot loaded before `UserAdminTransactionPort.run()` for existence, no-op, role/status, or last-admin decisions, as it can become stale between initial read and transaction start. All target state evaluation occurs within `userAdminTransaction.run(async (ctx) => { ... })`.
3. **Transactional Target Fetch & Existence**: Inside the transaction, re-fetches the target user via `ctx.findUserById(targetUserId)`. If target user does not exist, throws `UserNotFoundException`. Caught outside the transaction by `UserAdminService` to record an audit failure (`USER_NOT_FOUND`) and rethrow (HTTP `404 Not Found`).
4. **No-Op Role Updates**: Evaluated inside the transaction on the fresh transactional snapshot. If `targetUser.role === newRole`:
   - Skips role update and session revocation.
   - Records an audit log inside the transaction via `ctx.appendAuditLog(...)` with `outcome: 'SUCCESS'` and `metadata: { previousRole, newRole, changed: false }`.
   - Returns HTTP `200 OK` with the current sanitized user projection.
5. **Concurrency-Safe Last-Admin Protection**:
   - The last-admin check strictly applies ONLY when:
     `targetUser.role === 'ADMIN' && targetUser.status === 'ACTIVE' && newRole !== 'ADMIN'`
   - Within the transaction, `UserAdminService` calls `ctx.lockActiveAdmins()`.
   - The transaction adapter acquires a row-level lock matching exact PostgreSQL mapped table and enum identifiers:
     `SELECT "id" FROM "users" WHERE "role" = 'ADMIN'::"Role" AND "status" = 'ACTIVE'::"UserStatus" FOR UPDATE`
     and returns the locked active admin count. (Target user is re-read/revalidated if necessary before mutation).
   - `UserAdminService` enforces the business policy: if active admin count ≤ 1, it throws `CannotDemoteLastAdminException`, aborting the transaction. Caught outside the transaction to record an audit failure (`CANNOT_DEMOTE_LAST_ADMIN`) and rethrow (HTTP `400 Bad Request`).
6. **Atomic Execution**: Inside the atomic transaction (`UserAdminTransactionPort.run`):
   - `ctx.updateUserRole(targetUserId, newRole)` updates `role` in the `"users"` table.
   - `ctx.revokeUserSessions(targetUserId)` revokes all unrevoked sessions for `targetUserId` via `SessionRepositoryPort.revokeAllByUserId(targetUserId)` to force re-authentication with fresh role claims.
   - `ctx.appendAuditLog(...)` appends an audit log record in `"identity_audit_logs"` with `action: 'USER_ROLE_CHANGED'`, `userId: admin.id`, `targetUserId: targetUserId`, `outcome: 'SUCCESS'`, and `metadata: { previousRole, newRole, changed: true }`.
7. **Concurrency Invariant**: With exactly 2 ACTIVE ADMINs, concurrent mutations—including overlapping role and status operations (e.g. simultaneous lock and demote requests on the two admins)—must be serialized by row-level locking/transaction isolation; the system must NEVER reach 0 ACTIVE ADMINs, and exactly one request must fail with `CANNOT_DEMOTE_LAST_ADMIN` or `CANNOT_LOCK_LAST_ADMIN`.
8. Returns HTTP `200 OK` with the updated sanitized user projection.

### AC8 — Clarified Audit Scope for Administrative Operations

**Given** requests hitting administrative endpoints
**When** audit records are evaluated
**Then**:
1. Pre-service rejections (HTTP 400 from invalid Zod syntax, HTTP 400 from invalid UUID syntax, HTTP 401 unauthenticated, HTTP 403 `RolesGuard` rejections) terminate at the presentation layer and do NOT generate `identity_audit_logs` entries.
2. Every authenticated, syntactically valid mutation reaching `UserAdminService` MUST generate an audit record:
   - Successful mutations generate `outcome: 'SUCCESS'`.
   - Domain-level failures (`USER_NOT_FOUND`, `CANNOT_LOCK_SELF`, `CANNOT_LOCK_LAST_ADMIN`, `CANNOT_DEMOTE_SELF`, `CANNOT_DEMOTE_LAST_ADMIN`) generate `outcome: 'FAILURE'`, populated with the matching `errorCode`, `userId: admin.id`, `targetUserId`, and `metadata`.
3. Audit log records remain append-only and immutable.

### AC9 — Shared Zod Schema Contracts (`@rescom/schemas`)

**Given** the monorepo contracts package `packages/schemas`
**When** imported by backend controllers and future frontend dashboards
**Then**:
1. Exports:
   - `listUsersQuerySchema` & type `ListUsersQuery`
   - `updateUserStatusSchema` & type `UpdateUserStatusDto`
   - `updateUserRoleSchema` & type `UpdateUserRoleDto`
   - `adminUserSchema` & type `AdminUser`
   - `adminUserDetailResponseSchema` & type `AdminUserDetailResponse`
   - `paginatedAdminUsersResponseSchema` & type `PaginatedAdminUsersResponse`
2. Schemas use `.strict()` mode to reject unrecognized fields across all objects, including root response envelopes and nested response objects (`data`, `pagination`, etc.).
3. Request payloads (query parameters, mutation request bodies) are runtime-validated by schemas via `ZodValidationPipe`. Controller responses conform to response schemas (validated via contract test assertions with `.parse()`, with timestamps typed and serialized as ISO datetime strings).
4. The package builds cleanly via `npm run build --workspace @rescom/schemas`.

### AC10 — Modular Architecture & Circular Dependency Elimination

**Given** the NestJS dependency injection graph
**When** `AdminUsersController` and `UserAdminService` are integrated
**Then**:
1. Circular dependency between `UsersModule` and `AuthModule` is strictly avoided. An `AdminModule` is created:
   - `AdminModule` imports `UsersModule` (providing `USER_REPOSITORY_PORT`) and `AuthModule` (providing `SESSION_REPOSITORY_PORT`, `IDENTITY_AUDIT_PORT`, `SessionAuthGuard`, `RolesGuard`).
   - Neither `UsersModule` nor `AuthModule` imports `AdminModule`.
   - No `forwardRef()` is used.
2. Clean Architecture boundaries are preserved:
   - Domain layer (`modules/users/domain/`): Pure TypeScript classes, ZERO dependencies on `@nestjs/`, Prisma, or Express.
   - Application layer (`modules/users/application/`): Pure TypeScript ports, exceptions, and services. Zero framework or Prisma imports.
   - Infrastructure layer (`modules/users/infrastructure/`): Implements repository and transaction ports with Prisma and row-level locking.
3. `test/architecture.spec.ts` reports 0 violations.

### AC11 — Comprehensive Test Coverage & Zero Regressions

**Given** the entire backend test suite
**When** executed via `npm run test` and `npm run test:e2e`
**Then**:
1. Unit tests cover all branches of `UserAdminService` (listing, filtering, pagination, no-ops, self-lock/demotion rejection, last-admin lock/demotion rejection, session revocation, audit logging).
2. Unit tests cover `RolesGuard` with various combinations of roles, missing user, and authorized/forbidden contexts.
3. Integration/unit tests cover `PrismaUserRepository` and `InMemoryUserRepository` for port methods (`findMany`, `countByRoleAndStatus`, atomic updates).
4. End-to-end test suite `apps/backend/test/admin-users.e2e-spec.ts` validates:
   - Full RBAC protection on `/admin/users` routes (401 unauthenticated, 403 non-admin, 200 admin).
   - Standardized 400 `VALIDATION_ERROR` for malformed UUID parameters.
   - Paginated user list with email search and role/status filtering.
   - Single user retrieval with 404 for nonexistent IDs.
   - Status change with self-lock rejection and last-admin lock rejection.
   - Locked user's existing tokens rejected with 403 `AUTH_USER_LOCKED` for both access-token and refresh-token flows even when session is revoked.
   - Role change with self-demotion rejection and last-admin demotion rejection.
   - No-op updates returning 200 without DB updates and audited with `changed: false`.
   - Verification of `identity_audit_logs` entries for all successes and domain failures.
5. Real Concurrency Integration Test:
   - With exactly 2 ACTIVE ADMINs seeded in the database, runs concurrent mutations simultaneously (e.g. via `Promise.allSettled`):
     - Concurrent lock vs. lock: Admin A attempts to lock Admin B while Admin B attempts to lock Admin A.
     - Concurrent demote vs. demote: Admin A attempts to demote Admin B while Admin B attempts to demote Admin A.
     - Overlapping role vs. status mutations: Admin A attempts to demote Admin B while Admin B attempts to lock Admin A (or vice versa).
   - Asserts that the system never reaches 0 ACTIVE ADMINs under any concurrent execution, transactional state decisions never rely on stale pre-transaction snapshots, and exactly one request succeeds while the other fails with the appropriate last-admin error (`CANNOT_LOCK_LAST_ADMIN` or `CANNOT_DEMOTE_LAST_ADMIN`).
6. All existing test suites continue to pass 100%.

---

## Tasks / Subtasks

- [x] **Task 1: Shared User Management Zod Schemas (`@rescom/schemas`)** (AC: 4, 5, 6, 7, 9)
  - [x] 1.1 In `packages/schemas/src/users/admin-users.schema.ts`:
    - Define `listUsersQuerySchema` (page, limit, search, role, status)
    - Define `updateUserStatusSchema` (`{ status: z.enum(['ACTIVE', 'LOCKED']) }`)
    - Define `updateUserRoleSchema` (`{ role: z.enum(['ADMIN', 'PUBLISHER', 'RESPONDENT']) }`)
    - Define `adminUserSchema`:
      ```typescript
      export const adminUserSchema = z.object({
        id: z.string().uuid(),
        email: z.string().email(),
        role: z.enum(['ADMIN', 'PUBLISHER', 'RESPONDENT']),
        status: z.enum(['ACTIVE', 'LOCKED']),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
      }).strict();
      ```
    - Define `adminUserDetailResponseSchema`:
      ```typescript
      export const adminUserDetailResponseSchema = z.object({
        data: z.object({
          user: adminUserSchema,
        }).strict(),
        error: z.null(),
        meta: z.record(z.unknown()).default({}),
      }).strict();
      ```
    - Define `paginatedAdminUsersResponseSchema`:
      ```typescript
      export const paginatedAdminUsersResponseSchema = z.object({
        data: z.object({
          items: z.array(adminUserSchema),
          pagination: z.object({
            page: z.number().int().min(1),
            limit: z.number().int().min(1),
            total: z.number().int().min(0),
            totalPages: z.number().int().min(0),
          }).strict(),
        }).strict(),
        error: z.null(),
        meta: z.record(z.unknown()).default({}),
      }).strict();
      ```
  - [x] 1.2 Export schemas and inferred types in `packages/schemas/src/index.ts`.
  - [x] 1.3 Build schemas package (`npm run build --workspace @rescom/schemas`) and verify clean compilation.

- [x] **Task 2: Domain Exceptions & Core Ports** (AC: 1, 2, 6, 7, 8, 10)
  - [x] 2.1 In `apps/backend/src/modules/auth/application/exceptions/auth.exceptions.ts`:
    - Add generic `ForbiddenResourceException` (`FORBIDDEN_RESOURCE`, HTTP 403).
  - [x] 2.2 In `apps/backend/src/modules/users/application/exceptions/user-admin.exceptions.ts`:
    - Define domain-specific exceptions:
      - `UserNotFoundException` (`USER_NOT_FOUND`, HTTP 404)
      - `CannotLockSelfException` (`CANNOT_LOCK_SELF`, HTTP 400)
      - `CannotLockLastAdminException` (`CANNOT_LOCK_LAST_ADMIN`, HTTP 400)
      - `CannotDemoteSelfException` (`CANNOT_DEMOTE_SELF`, HTTP 400)
      - `CannotDemoteLastAdminException` (`CANNOT_DEMOTE_LAST_ADMIN`, HTTP 400)
  - [x] 2.3 In `apps/backend/src/common/http/http-exception.filter.ts`:
    - Register mappings for `ForbiddenResourceException` (403) and user-admin exceptions (400, 404) into standardized JSON error envelopes.
  - [x] 2.4 In `apps/backend/src/modules/auth/application/ports/identity-audit.port.ts`:
    - Extend `IdentityAuditAction` to include `'USER_STATUS_CHANGED' | 'USER_ROLE_CHANGED'`.
  - [x] 2.5 In `apps/backend/src/modules/auth/application/ports/session-repository.port.ts`:
    - Add focused session revocation method:
      ```typescript
      revokeAllByUserId(userId: string): Promise<void>;
      ```
      (Strictly without `auditRecord` parameter).
  - [x] 2.6 In `apps/backend/src/modules/users/application/ports/user.repository.port.ts`:
    - Define `ListUsersParams`: `{ page: number; limit: number; search?: string; role?: UserRole; status?: UserStatus; }`
    - Define `PaginatedUsersResult`: `{ users: User[]; total: number; }`
    - Extend `UserRepositoryPort`:
      ```typescript
      export interface UserRepositoryPort {
        findByEmail(email: string): Promise<User | null>;
        findById(id: string): Promise<User | null>;
        create(data: CreateUserData): Promise<User>;
        findMany(params: ListUsersParams): Promise<PaginatedUsersResult>;
        countByRoleAndStatus(role: UserRole, status: UserStatus): Promise<number>;
      }
      ```
  - [x] 2.7 In `apps/backend/src/modules/users/application/ports/user-admin-transaction.port.ts`:
    - Define atomic Unit of Work / Transaction port providing transaction runner, locking, target user re-fetch, and atomic repository operations:
      ```typescript
      export interface UserAdminTransactionContext {
        findUserById(userId: string): Promise<User | null>;
        lockActiveAdmins(): Promise<number>;
        updateUserStatus(userId: string, status: UserStatus): Promise<User>;
        updateUserRole(userId: string, role: UserRole): Promise<User>;
        revokeUserSessions(userId: string): Promise<void>;
        appendAuditLog(record: CreateIdentityAuditRecord): Promise<void>;
      }

      export interface UserAdminTransactionPort {
        run<T>(work: (ctx: UserAdminTransactionContext) => Promise<T>): Promise<T>;
      }

      export const USER_ADMIN_TRANSACTION_PORT = Symbol('UserAdminTransactionPort');
      ```

- [ ] **Task 3: Session Validation Locked-Account Fix in `SessionService`** (AC: 2)
  - [ ] 3.1 In `apps/backend/src/modules/auth/application/session.service.ts`:
    - Ensure session lookups (`findById`, `findCredentialWithSession`) retrieve session records regardless of `revoked` state.
    - In `validateSession(accessToken: string)`:
      - Query `user = await this.userRepository.findById(session.userId)`.
      - Check `if (user && user.isLocked()) { throw new UserLockedException(); }` (HTTP 403 `AUTH_USER_LOCKED`) BEFORE checking `if (session.revoked)`.
      - If user is not locked, check `if (session.revoked) { throw new SessionRevokedException(); }` (HTTP 401 `AUTH_SESSION_REVOKED`).
      - Ensure locked users ALWAYS trigger `UserLockedException` and symmetrically clear auth cookies.
    - In `refreshSession(rawRefreshToken: string, csrfToken: string)` and `rotateCsrf(...)`:
      - Query `user = await this.userRepository.findById(session.userId)`.
      - Check `if (user && user.isLocked()) { throw new UserLockedException(); }` (HTTP 403 `AUTH_USER_LOCKED`) BEFORE checking `if (session.revoked)`.
      - If user is not locked, check `if (session.revoked) { throw new SessionRevokedException(); }` (HTTP 401 `AUTH_SESSION_REVOKED`).
  - [ ] 3.2 Update `session.service.spec.ts`, `session-auth.guard.spec.ts`, and auth controller specs to test locked user with revoked session returning 403 `AUTH_USER_LOCKED` across both access-token and refresh-token flows (vs 401 `AUTH_SESSION_REVOKED` for revoked non-locked users).

- [ ] **Task 4: Repository & Transaction Port Implementations** (AC: 6, 7, 8, 10)
  - [ ] 4.1 In `apps/backend/src/modules/auth/infrastructure/prisma-session.repository.ts`:
    - Implement `revokeAllByUserId(userId: string): Promise<void>`:
      `await this.prisma.session.updateMany({ where: { userId, revoked: false }, data: { revoked: true } })`.
  - [ ] 4.2 In `apps/backend/src/modules/auth/infrastructure/in-memory-session.repository.ts`:
    - Implement matching in-memory `revokeAllByUserId`.
  - [ ] 4.3 In `apps/backend/src/modules/users/infrastructure/prisma-user.repository.ts`:
    - Implement `findMany`: build Prisma filter with `contains` (mode: `'insensitive'`) on `email`, pagination `skip` and `take`, ordering `createdAt: 'desc'`.
    - Implement `countByRoleAndStatus(role: UserRole, status: UserStatus): Promise<number>`:
      `await this.prisma.user.count({ where: { role, status } })`.
  - [ ] 4.4 In `apps/backend/src/modules/users/infrastructure/prisma-user-admin-transaction.adapter.ts`:
    - Implement `UserAdminTransactionPort` using `this.prisma.$transaction(async (tx) => work(ctx))`:
      - Provide atomic context operations (strictly atomic data/locking operations without domain policy decisions or domain exceptions):
        1. `findUserById(userId)`: queries `await tx.user.findUnique({ where: { id: userId } })`, returns domain `User | null`.
        2. `lockActiveAdmins`: executes PostgreSQL row lock using exact mapped table and enum names:
           `await tx.$queryRaw\`SELECT "id" FROM "users" WHERE "role" = 'ADMIN'::"Role" AND "status" = 'ACTIVE'::"UserStatus" FOR UPDATE\``
           (PostgreSQL table `"users"` from `@@map("users")`, columns `"id"`, `"role"`, `"status"`, enums `"Role"`, `"UserStatus"`);
           returns count of active admins via `await tx.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })`.
        3. `updateUserStatus(userId, status)`: `await tx.user.update({ where: { id: userId }, data: { status } })`, returns domain `User`.
        4. `updateUserRole(userId, role)`: `await tx.user.update({ where: { id: userId }, data: { role } })`, returns domain `User`.
        5. `revokeUserSessions(userId)`: `await tx.session.updateMany({ where: { userId, revoked: false }, data: { revoked: true } })`.
        6. `appendAuditLog(record)`: appends audit log record via `tx.identityAuditLog.create({ data: { ... } })`.
  - [ ] 4.5 In `apps/backend/src/modules/users/infrastructure/in-memory-user.repository.ts`:
    - Implement `findMany` and `countByRoleAndStatus`.
  - [ ] 4.6 In `apps/backend/src/modules/users/infrastructure/in-memory-user-admin-transaction.adapter.ts`:
    - Implement matching in-memory atomic transaction adapter providing `run` and context operations (`findUserById`, `lockActiveAdmins`, `updateUserStatus`, `updateUserRole`, `revokeUserSessions`, `appendAuditLog`) for unit testing.

- [ ] **Task 5: Application Service `UserAdminService`** (AC: 4, 5, 6, 7, 8, 10)
  - [ ] 5.1 In `apps/backend/src/modules/users/application/user-admin.service.ts`:
    - Pure TypeScript class without `@nestjs/` imports.
    - Inject `UserRepositoryPort`, `UserAdminTransactionPort`, and `IdentityAuditPort`.
    - `listUsers(params: ListUsersParams)`: calls `findMany`, computes pagination metadata (`totalPages = Math.ceil(total / limit)`), returns sanitized users via allowlist mapper.
    - `getUserById(id: string)`: calls `findById`, throws `UserNotFoundException` if null, returns sanitized user.
    - `updateUserStatus(actorUserId: string, targetUserId: string, status: UserStatus)`:
      - 1. Self-lock pre-check outside transaction: if `actorUserId === targetUserId && status === 'LOCKED'`, appends audit failure (`CANNOT_LOCK_SELF`) and throws `CannotLockSelfException`.
      - 2. Enter transaction boundary via `userAdminTransaction.run(async (ctx) => { ... })`:
        - Re-fetch target inside transaction: `const targetUser = await ctx.findUserById(targetUserId)`.
        - If `!targetUser`, throw `UserNotFoundException`.
        - No-op check on fresh transactional snapshot: if `targetUser.status === status`:
          - Appends audit log inside transaction: `await ctx.appendAuditLog({ action: 'USER_STATUS_CHANGED', userId: actorUserId, targetUserId, outcome: 'SUCCESS', metadata: { previousStatus: targetUser.status, newStatus: status, changed: false } })`.
          - Returns `targetUser`.
        - Active admin last-admin protection:
          - If `targetUser.role === 'ADMIN' && targetUser.status === 'ACTIVE' && status === 'LOCKED'`:
            - `const activeAdminCount = await ctx.lockActiveAdmins()`.
            - If `activeAdminCount <= 1`, throw `CannotLockLastAdminException`.
        - `const updatedUser = await ctx.updateUserStatus(targetUserId, status)`.
        - If `status === 'LOCKED'`, calls `await ctx.revokeUserSessions(targetUserId)`.
        - Appends audit log inside transaction: `await ctx.appendAuditLog({ action: 'USER_STATUS_CHANGED', userId: actorUserId, targetUserId, outcome: 'SUCCESS', metadata: { previousStatus: targetUser.status, newStatus: status, changed: true } })`.
        - Returns `updatedUser`.
      - 3. Catch domain failures outside transaction:
        - If `UserNotFoundException`, `CannotLockLastAdminException`, etc. are thrown from the transaction, `UserAdminService` catches them, appends an audit failure record (`outcome: 'FAILURE'`, matching `errorCode`), and rethrows.
      - 4. Returns sanitized user projection via `toAdminUserResponse`.
    - `updateUserRole(actorUserId: string, targetUserId: string, role: UserRole)`:
      - 1. Self-demotion pre-check outside transaction: if `actorUserId === targetUserId && role !== 'ADMIN'`, appends audit failure (`CANNOT_DEMOTE_SELF`) and throws `CannotDemoteSelfException`.
      - 2. Enter transaction boundary via `userAdminTransaction.run(async (ctx) => { ... })`:
        - Re-fetch target inside transaction: `const targetUser = await ctx.findUserById(targetUserId)`.
        - If `!targetUser`, throw `UserNotFoundException`.
        - No-op check on fresh transactional snapshot: if `targetUser.role === role`:
          - Appends audit log inside transaction: `await ctx.appendAuditLog({ action: 'USER_ROLE_CHANGED', userId: actorUserId, targetUserId, outcome: 'SUCCESS', metadata: { previousRole: targetUser.role, newRole: role, changed: false } })`.
          - Returns `targetUser`.
        - Active admin last-admin protection:
          - If `targetUser.role === 'ADMIN' && targetUser.status === 'ACTIVE' && role !== 'ADMIN'`:
            - `const activeAdminCount = await ctx.lockActiveAdmins()`.
            - If `activeAdminCount <= 1`, throw `CannotDemoteLastAdminException`.
        - `const updatedUser = await ctx.updateUserRole(targetUserId, role)`.
        - Calls `await ctx.revokeUserSessions(targetUserId)` to force re-authentication with fresh role claims.
        - Appends audit log inside transaction: `await ctx.appendAuditLog({ action: 'USER_ROLE_CHANGED', userId: actorUserId, targetUserId, outcome: 'SUCCESS', metadata: { previousRole: targetUser.role, newRole: role, changed: true } })`.
        - Returns `updatedUser`.
      - 3. Catch domain failures outside transaction:
        - If `UserNotFoundException`, `CannotDemoteLastAdminException`, etc. are thrown from the transaction, `UserAdminService` catches them, appends an audit failure record (`outcome: 'FAILURE'`, matching `errorCode`), and rethrows.
      - 4. Returns sanitized user projection via `toAdminUserResponse`.
  - [ ] 5.2 Create unit tests in `apps/backend/src/modules/users/application/user-admin.service.spec.ts` covering all branches, no-ops, guard failures, and audit logging.

- [ ] **Task 6: Presentation Decorators & RolesGuard in `AuthModule`** (AC: 1, 10)
  - [ ] 6.1 In `apps/backend/src/modules/auth/presentation/decorators/roles.decorator.ts`:
    - Define `@Roles(...roles: UserRole[])` using `SetMetadata('roles', roles)`.
    - Re-export via `apps/backend/src/modules/auth/presentation/decorators/index.ts`.
  - [ ] 6.2 In `apps/backend/src/modules/auth/presentation/guards/roles.guard.ts`:
    - Implement `RolesGuard implements CanActivate`:
      - Extract required roles via `Reflector.getAllAndOverride<UserRole[]>('roles', [context.getHandler(), context.getClass()])`.
      - If no roles required, return `true`.
      - Extract `req = context.switchToHttp().getRequest<AuthenticatedRequest>()`.
      - If `!req.user`, throw `UnauthorizedSessionException`.
      - If `!requiredRoles.includes(req.user.role)`, throw `ForbiddenResourceException`.
      - Return `true`.
  - [ ] 6.3 Register and export `RolesGuard` in `AuthModule` providers and exports.
  - [ ] 6.4 Create unit tests in `apps/backend/src/modules/auth/presentation/guards/roles.guard.spec.ts`.

- [ ] **Task 7: Standardized UUID Pipe, Controller & `AdminModule` Wiring** (AC: 4, 5, 6, 7, 10)
  - [ ] 7.1 In `apps/backend/src/common/http/parse-uuid.pipe.ts`:
    - Create custom pipe (or use Zod) that validates UUID format and throws `ValidationException('Invalid UUID parameter', 'VALIDATION_ERROR')` on invalid UUID, ensuring consistent standard error envelope.
  - [ ] 7.2 In `apps/backend/src/modules/admin/presentation/admin-users.controller.ts`:
    - `@Controller('admin/users')`
    - Class-level guards: `@UseGuards(SessionAuthGuard, RolesGuard)` and `@Roles('ADMIN')`.
    - `GET /admin/users`: query parsed via `new ZodValidationPipe(listUsersQuerySchema)`.
    - `GET /admin/users/:id`: id parsed via `new ParseUuidPipe()`.
    - `PATCH /admin/users/:id/status`: id parsed via `new ParseUuidPipe()`, body parsed via `new ZodValidationPipe(updateUserStatusSchema)`.
    - `PATCH /admin/users/:id/role`: id parsed via `new ParseUuidPipe()`, body parsed via `new ZodValidationPipe(updateUserRoleSchema)`.
    - Explicit projection allowlist: `toAdminUserResponse(user)`.
    - Standard response wrapper `{ data, error: null, meta: {} }` that conforms to `paginatedAdminUsersResponseSchema` / `adminUserDetailResponseSchema`.
  - [ ] 7.3 In `apps/backend/src/modules/admin/admin.module.ts`:
    - Create `AdminModule` importing `UsersModule` and `AuthModule`.
    - Provide `USER_ADMIN_TRANSACTION_PORT` with `PrismaUserAdminTransactionAdapter`.
    - Provide `UserAdminService` via `useFactory` injecting `USER_REPOSITORY_PORT`, `USER_ADMIN_TRANSACTION_PORT`, and `IDENTITY_AUDIT_PORT`.
    - Register `AdminUsersController`.
  - [ ] 7.4 In `apps/backend/src/app.module.ts`:
    - Add `AdminModule` to `imports: [ConfigModule, PrismaModule, UsersModule, AuthModule, AdminModule]`.
    - Verify zero circular dependencies.

- [ ] **Task 8: Automated Tests & Verification** (AC: 11)
  - [ ] 8.1 Create `apps/backend/test/admin-users.e2e-spec.ts`:
    - Test unauthenticated requests return 401 `AUTH_UNAUTHORIZED`.
    - Test non-admin (`RESPONDENT`, `PUBLISHER`) requests return 403 `FORBIDDEN_RESOURCE`.
    - Test invalid UUID returns standardized 400 `VALIDATION_ERROR`.
    - Test listing users with pagination, email search, and role/status filtering.
    - Test single user retrieval (200) and nonexistent user (404).
    - Test status update to `LOCKED`:
      - Verify self-lock rejected with 400 `CANNOT_LOCK_SELF`.
      - Verify sole active admin lock rejected with 400 `CANNOT_LOCK_LAST_ADMIN`.
      - Verify locked user's existing tokens rejected with 403 `AUTH_USER_LOCKED` on subsequent probe (for both access-token and refresh-token flows).
    - Test role update:
      - Verify self-demotion rejected with 400 `CANNOT_DEMOTE_SELF`.
      - Verify sole active admin demotion rejected with 400 `CANNOT_DEMOTE_LAST_ADMIN`.
      - Verify non-admin to admin promotion works.
    - Test no-op updates: same status or same role returns 200 without DB updates and writes audit record with `changed: false`.
    - Add real concurrency integration test: with exactly 2 ACTIVE ADMINs, run concurrent operations (via `Promise.allSettled`), including:
      - Overlapping role & status mutations (e.g. Admin A locks Admin B while Admin B simultaneously demotes Admin A).
      - Concurrent demote vs. demote and lock vs. lock.
      - Assert system never reaches 0 ACTIVE ADMINs, state decisions never rely on stale pre-transaction snapshots, exactly one request succeeds, and one request fails with `CANNOT_LOCK_LAST_ADMIN` or `CANNOT_DEMOTE_LAST_ADMIN`.
    - Verify `identity_audit_logs` entries for all successes and domain failures.
  - [ ] 8.2 Run `npm run test` and `npm run test:e2e` to verify 100% test pass.
  - [ ] 8.3 Run `npm run test -- test/architecture.spec.ts` to verify 0 boundary violations.

---

## Dev Notes

### Architecture & Security Guardrails

1. **Framework Isolation in Domain & Application Layers**:
   - `test/architecture.spec.ts` strictly forbids imports from `@nestjs/`, `express`, `@prisma/client`, or `bcrypt` inside `modules/*/domain` and `modules/*/application`.
   - `UserAdminService` must be a plain TypeScript class instantiated through a NestJS module factory provider (`useFactory`).
2. **Transaction & Business Policy Boundary (No Stale Pre-Transaction Snapshots)**:
   - Business policies (`USER_NOT_FOUND`, no-op check, last-admin threshold evaluation) reside strictly within `UserAdminService`.
   - Critical concurrency rule: Do NOT use a `targetUser` snapshot loaded before `UserAdminTransactionPort.run()` for existence, no-op, role/status, or last-admin decisions. Between an initial read and transaction start, concurrent operations can alter target user state.
   - Self-mutation pre-checks (`CANNOT_LOCK_SELF`, `CANNOT_DEMOTE_SELF`) are evaluated outside transaction because they depend exclusively on immutable actor and target IDs.
   - Inside `userAdminTransaction.run(async (ctx) => { ... })`, the service re-fetches the target user via `ctx.findUserById(targetUserId)`. All existence (`USER_NOT_FOUND`), no-op (`targetUser.status === status` / `targetUser.role === role`), and last-admin evaluations are performed against this fresh transactional snapshot.
   - For active-admin mutations, `ctx.lockActiveAdmins()` acquires the row-level lock and revalidates count (or runs at SERIALIZABLE isolation).
   - Success and no-op audit records are appended inside the transaction (`changed: true` or `changed: false`), guaranteeing atomicity. Domain failures thrown from the transaction are caught outside in `UserAdminService` to append a failure audit log (`outcome: 'FAILURE'`) and rethrow.
3. **Concurrency-Safe Last-Admin Protection & Row-Lock Identifiers**:
   - To prevent race conditions where two concurrent requests simultaneously demote/lock the last active admin, the transaction adapter executes:
     `SELECT "id" FROM "users" WHERE "role" = 'ADMIN'::"Role" AND "status" = 'ACTIVE'::"UserStatus" FOR UPDATE`
   - Identifier accuracy is critical: table `"users"` matches Prisma mapping `@@map("users")`, column names `"id"`, `"role"`, `"status"` match PostgreSQL definitions, and enum types `"Role"` and `"UserStatus"` match the PostgreSQL enums. Never blindly hardcode unquoted or unmapped identifiers.
4. **Consistent Locked-Account Rejection Across Token Flows**:
   - Locked-session validation must retrieve sessions regardless of `revoked` state. In BOTH access-token validation (`validateSession`) and refresh-token validation (`refreshSession`, `rotateCsrf`), checking `user.isLocked()` occurs BEFORE checking `session.revoked`. This ensures that locked accounts consistently return HTTP 403 `AUTH_USER_LOCKED` and clear auth cookies, while revoked non-locked sessions return HTTP 401 `AUTH_SESSION_REVOKED`.
5. **No-Op Update Semantics**:
   - If an Admin sends a request with the status or role identical to the user's current status or role, `UserAdminService` skips transaction execution, DB updates, and session revocations, logs an audit entry with `changed: false`, and returns HTTP 200 OK.
6. **Explicit Response Mapping & Schema Conformance**:
   - Use `toAdminUserResponse(user: User)` mapper to explicitly project allowed fields (`id`, `email`, `role`, `status`, `createdAt`, `updatedAt`). Never spread `...user` to prevent leaking internal properties.
   - Outgoing response payloads conform to shared Zod response schemas (`createdAt` and `updatedAt` are ISO datetimes via `z.string().datetime()`, and all response objects and nested response objects use `.strict()`). Incoming request bodies and parameters are validated at runtime via `ZodValidationPipe`.
7. **Module Architecture (Avoiding Circular Dependencies)**:
   - To prevent `UsersModule <-> AuthModule` cycles, `AdminModule` imports both `UsersModule` and `AuthModule`. Neither `UsersModule` nor `AuthModule` imports `AdminModule`.
8. **Prisma IdentityAuditLog Verification**:
   - `IdentityAuditLog` table in PostgreSQL already supports `action` (`TEXT`), `user_id` (`UUID`), `target_user_id` (`UUID`), `outcome` (`TEXT`), `error_code` (`TEXT`), and `metadata` (`JSONB`). No new database migration is required.

### Expected Files

- **NEW files**:
  - `packages/schemas/src/users/admin-users.schema.ts`
  - `apps/backend/src/common/http/parse-uuid.pipe.ts`
  - `apps/backend/src/modules/auth/presentation/decorators/roles.decorator.ts`
  - `apps/backend/src/modules/auth/presentation/guards/roles.guard.ts`
  - `apps/backend/src/modules/auth/presentation/guards/roles.guard.spec.ts`
  - `apps/backend/src/modules/users/application/ports/user-admin-transaction.port.ts`
  - `apps/backend/src/modules/users/application/exceptions/user-admin.exceptions.ts`
  - `apps/backend/src/modules/users/application/user-admin.service.ts`
  - `apps/backend/src/modules/users/application/user-admin.service.spec.ts`
  - `apps/backend/src/modules/users/infrastructure/prisma-user-admin-transaction.adapter.ts`
  - `apps/backend/src/modules/users/infrastructure/in-memory-user-admin-transaction.adapter.ts`
  - `apps/backend/src/modules/admin/admin.module.ts`
  - `apps/backend/src/modules/admin/presentation/admin-users.controller.ts`
  - `apps/backend/test/admin-users.e2e-spec.ts`
- **UPDATE files**:
  - `packages/schemas/src/index.ts`
  - `apps/backend/src/common/http/http-exception.filter.ts`
  - `apps/backend/src/modules/auth/application/exceptions/auth.exceptions.ts`
  - `apps/backend/src/modules/auth/application/session.service.ts`
  - `apps/backend/src/modules/auth/application/session.service.spec.ts`
  - `apps/backend/src/modules/auth/application/ports/identity-audit.port.ts`
  - `apps/backend/src/modules/auth/application/ports/session-repository.port.ts`
  - `apps/backend/src/modules/auth/infrastructure/prisma-session.repository.ts`
  - `apps/backend/src/modules/auth/infrastructure/in-memory-session.repository.ts`
  - `apps/backend/src/modules/auth/presentation/decorators/index.ts`
  - `apps/backend/src/modules/auth/auth.module.ts`
  - `apps/backend/src/modules/users/application/ports/user.repository.port.ts`
  - `apps/backend/src/modules/users/infrastructure/prisma-user.repository.ts`
  - `apps/backend/src/modules/users/infrastructure/in-memory-user.repository.ts`
  - `apps/backend/src/modules/users/infrastructure/user.repository.spec.ts`
  - `apps/backend/src/app.module.ts`

### Testing Standards Summary

- **Unit Tests**:
  - `user-admin.service.spec.ts`: Test listing, pagination, no-ops, self-lock/demotion rejection, last-admin lock/demotion rejection, audit logging.
  - `roles.guard.spec.ts`: Test role metadata extraction, role matching, role mismatch, unauthenticated rejection.
  - `session.service.spec.ts`: Test locked user session validation order across both access and refresh token flows (403 over 401).
  - `user.repository.spec.ts`: Test `findMany`, `countByRoleAndStatus`, and atomic transaction adapters.
- **E2E / Concurrency Tests (`apps/backend/test/admin-users.e2e-spec.ts`)**:
  - Supertest integration tests testing authentication/authorization gates, standardized UUID error format, listing with pagination & search, user retrieval, status & role mutations, locked user probe rejection across token flows, no-op updates, and audit log entries in `identity_audit_logs`.
  - Real concurrency integration tests: seed exactly 2 ACTIVE ADMINs, run concurrent operations (including overlapping role vs. status mutations, concurrent demotes, and concurrent locks via `Promise.allSettled`); assert database active admin count never reaches 0, no decisions depend on stale reads, exactly one request succeeds, and one request fails with `CANNOT_LOCK_LAST_ADMIN` or `CANNOT_DEMOTE_LAST_ADMIN`.
- **Architecture Test**:
  - `npm run test -- test/architecture.spec.ts` must pass with 0 boundary violations.

### Project Structure Notes

- Alignment with unified project structure:
  - Modules: `apps/backend/src/modules/users`, `apps/backend/src/modules/auth`, `apps/backend/src/modules/admin`
  - Schemas: `packages/schemas/src/users`
  - Common HTTP pipes/filters: `apps/backend/src/common/http`

### References

- [FR-52: User Management](_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md#L740-L747)
- [FR-ADD-12: Dual-Capability & Privileged Admin Assignment](_bmad-output/planning-artifacts/epics.md#L203)
- [AD-20: Revocable Cookie Session Contract & RBAC Rules](_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md#L178-L182)
- [Solution Design §2: Capability Invariant & Identity Audit Boundary](_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md#L57)
- [Story 1.3 Baseline Context](_bmad-output/implementation-artifacts/1-3-single-session-enforcement.md)

---

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
