---
baseline_commit: 0be7a93983bede87701702a5823f7de5a87b574c
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/implementation-artifacts/1-4-role-based-access-control-rbac-user-management.md"
---

# Story 1.5: System Audit Logging

Status: done

## Story

As a System Owner,
I want critical administrative and security actions to be immutably logged and queryable through administrative APIs,
so that I have a verifiable, tamper-evident, and traceable history of who did what for security, operational governance, and compliance.

## Acceptance Criteria

### AC1 — Append-Only Immutability Enforcement at Database & ORM Level
**Given** an audit record persisted in the audit log table (`identity_audit_logs`)
**When** any mutation or deletion is attempted (via Prisma ORM or raw SQL)
**Then**:
1. At the ORM / repository layer, `AuditLogRepositoryPort` exposes ONLY `append()`, `findMany()`, and `findById()` operations. No `update`, `updateMany`, `delete`, or `deleteMany` methods exist on the port or repository implementation.
2. Prisma client extensions or middleware intercept any attempt to invoke `update`, `updateMany`, `delete`, `deleteMany`, or `upsert` on the `IdentityAuditLog` model, immediately rejecting the operation with `ImmutableAuditLogException` before execution.
3. At the PostgreSQL database level, a trigger (`trg_identity_audit_logs_immutable`) on `identity_audit_logs` raises an exception (`'Audit log records are immutable and cannot be updated or deleted'`) on any `BEFORE UPDATE` or `BEFORE DELETE`, ensuring tamper-resistance even against direct database operations.

### AC2 — Complete Audit Trail Record Structure
**Given** a critical administrative or identity action (e.g. changing user status, changing user role, login failure, session replacement)
**When** the action is evaluated
**Then** the appended record strictly contains:
1. `id`: Unique UUID generated on creation.
2. `action`: The categorized action identifier (e.g. `USER_ROLE_CHANGED`, `USER_STATUS_CHANGED`, `LOGIN_SUCCESS`, `LOGIN_FAILURE`, `SESSION_REPLACED`, `REFRESH_ROTATED`, `REFRESH_REUSE_REVOKED`, `LOGOUT`, `IDENTITY_LINKED`, `IDENTITY_UNLINKED`, `ADMIN_ACTION`).
3. `userId`: The authenticated actor's UUID who performed or triggered the action (nullable for unauthenticated actions like failed logins).
4. `targetUserId`: The subject user's UUID impacted by the action (nullable if not user-specific).
5. `outcome`: `'SUCCESS'` or `'FAILURE'`.
6. `errorCode`: Optional error string when `outcome === 'FAILURE'` (e.g. `CANNOT_DEMOTE_LAST_ADMIN`, `CANNOT_LOCK_SELF`).
7. `metadata`: JSON payload containing context-specific details (e.g. previous/new values, reason, IP address, user-agent, changes made).
8. `createdAt`: Immutable ISO timestamp set automatically upon insertion (`NOW()`).

### AC3 — Paginated Admin Audit Log Retrieval (`GET /admin/audit-logs`)
**Given** an authenticated Admin user making a `GET /admin/audit-logs` request
**When** query parameters are supplied
**Then** the endpoint:
1. Is protected by `SessionAuthGuard` and `RolesGuard` with `@Roles('ADMIN')`. Requests without admin privileges are rejected with HTTP `403 Forbidden` (`FORBIDDEN_RESOURCE`); unauthenticated requests are rejected with HTTP `401 Unauthorized`.
2. Validates query parameters against shared `listAuditLogsQuerySchema`:
   - `page`: integer ≥ 1, default `1`
   - `limit`: integer between 1 and 100, default `20`
   - `action`: optional string / enum filter matching `action`
   - `userId`: optional valid UUID filtering by acting user
   - `targetUserId`: optional valid UUID filtering by target user
   - `outcome`: optional enum filter (`SUCCESS` | `FAILURE`)
   - `startDate`: optional ISO datetime string filtering `createdAt >= startDate`
   - `endDate`: optional ISO datetime string filtering `createdAt <= endDate`
3. Queries the database through `AuditLogRepositoryPort.findMany` with pagination offsets (`skip: (page - 1) * limit`, `take: limit`) and ordering by `createdAt DESC`.
4. Returns HTTP `200 OK` conforming to `paginatedAuditLogsResponseSchema` wrapped in `createSuccessEnvelope`:
   ```json
   {
     "data": {
       "items": [
         {
           "id": "123e4567-e89b-12d3-a456-426614174000",
           "action": "USER_ROLE_CHANGED",
           "userId": "123e4567-e89b-12d3-a456-426614174001",
           "targetUserId": "123e4567-e89b-12d3-a456-426614174002",
           "outcome": "SUCCESS",
           "errorCode": null,
           "metadata": {
             "previousRole": "RESPONDENT",
             "newRole": "ADMIN",
             "changed": true
           },
           "createdAt": "2026-09-14T12:00:00.000Z"
         }
       ],
       "pagination": {
         "page": 1,
         "limit": 20,
         "total": 1,
         "totalPages": 1
       }
     },
     "error": null,
     "meta": {}
   }
   ```

### AC4 — Single Audit Log Detail Retrieval (`GET /admin/audit-logs/:id`)
**Given** an authenticated Admin making a `GET /admin/audit-logs/:id` request
**When** the audit log ID parameter is evaluated
**Then**:
1. If `:id` is not a valid UUID, the endpoint returns HTTP `400 Bad Request` with standardized code `VALIDATION_ERROR`.
2. If the audit log record exists, returns HTTP `200 OK` conforming to `auditLogDetailResponseSchema`:
   ```json
   {
     "data": {
       "auditLog": {
         "id": "123e4567-e89b-12d3-a456-426614174000",
         "action": "USER_ROLE_CHANGED",
         "userId": "123e4567-e89b-12d3-a456-426614174001",
         "targetUserId": "123e4567-e89b-12d3-a456-426614174002",
         "outcome": "SUCCESS",
         "errorCode": null,
         "metadata": {
           "previousRole": "RESPONDENT",
           "newRole": "ADMIN",
           "changed": true
         },
         "createdAt": "2026-09-14T12:00:00.000Z"
       }
     },
     "error": null,
     "meta": {}
   }
   ```
3. If no audit record exists matching `:id`, returns HTTP `404 Not Found` with code `AUDIT_LOG_NOT_FOUND`.

### AC5 — Shared Zod Schema Contracts (`@rescom/schemas`)
**Given** the shared contracts package `packages/schemas`
**When** imported by backend controllers and frontend admin dashboards
**Then**:
1. Exports:
   - `listAuditLogsQuerySchema` & type `ListAuditLogsQuery`
   - `auditLogItemSchema` & type `AuditLogItem`
   - `paginatedAuditLogsResponseSchema` & type `PaginatedAuditLogsResponse`
   - `auditLogDetailResponseSchema` & type `AuditLogDetailResponse`
2. All schemas use `.strict()` mode to reject unrecognized fields.
3. Package builds cleanly via `npm run build --workspace @rescom/schemas`.

### AC6 — Clean Architecture & Module Integration
**Given** Clean Architecture and NestJS modular design
**When** the audit logging features are integrated
**Then**:
1. Clean Architecture boundaries are strictly respected:
   - Domain layer (`modules/admin/domain` or `modules/auth/domain`): Pure TypeScript entities and types, no framework or Prisma imports.
   - Application layer (`modules/admin/application`): Pure ports, services, and domain exceptions (`AUDIT_LOG_NOT_FOUND`, `IMMUTABLE_AUDIT_LOG`).
   - Infrastructure layer (`modules/admin/infrastructure` or `modules/auth/infrastructure`): Prisma repository implementations, database trigger migration.
   - Presentation layer (`modules/admin/presentation`): `AdminAuditLogsController` with route-level guards.
2. `AdminModule` integrates `AdminAuditLogsController` and binds `AUDIT_LOG_REPOSITORY_PORT` with `PrismaAuditLogRepository`.
3. `test/architecture.spec.ts` passes with 0 violations.

### AC7 — Comprehensive Testing & Regression Verification
**Given** the complete test suite
**When** executed via `npm test`
**Then**:
1. Unit tests cover `AuditLogService`, `AdminAuditLogsController`, `PrismaAuditLogRepository`, and `InMemoryAuditLogRepository`.
2. Immutability tests assert that ORM and database prevent updates and deletes.
3. E2E tests cover access control, filtering, pagination, single detail fetch, and end-to-end admin action audit trail creation.
4. All existing tests (186+ tests) continue to pass 100%.

---

## Tasks / Subtasks

- [x] **Task 1: Shared Audit Log Zod Schemas (`@rescom/schemas`)** (AC: 3, 4, 5)
  - [x] 1.1 In `packages/schemas/src/admin/audit-logs.schema.ts`:
    - Define `listAuditLogsQuerySchema` (page, limit, action, userId, targetUserId, outcome, startDate, endDate)
    - Define `auditLogItemSchema` (id, action, userId, targetUserId, outcome, errorCode, metadata, createdAt)
    - Define `paginatedAuditLogsResponseSchema`
    - Define `auditLogDetailResponseSchema`
  - [x] 1.2 Export schemas and inferred TypeScript types in `packages/schemas/src/index.ts`.
  - [x] 1.3 Build schemas package (`npm run build --workspace @rescom/schemas`) and verify clean compilation.

- [x] **Task 2: Database Immutability Trigger & Migration** (AC: 1, 2)
  - [x] 2.1 Create PostgreSQL migration script to attach `BEFORE UPDATE OR DELETE` trigger on `identity_audit_logs`.
  - [x] 2.2 Apply migration to local database (`npx prisma db push` or migration run) and verify trigger exists.

- [x] **Task 3: Domain & Application Ports, Entities & Exceptions** (AC: 1, 2, 4, 6)
  - [x] 3.1 In `apps/backend/src/modules/admin/domain/audit-log.entity.ts`:
    - Define `AuditLog` entity with pure TypeScript properties (`id`, `action`, `userId`, `targetUserId`, `outcome`, `errorCode`, `metadata`, `createdAt`).
  - [x] 3.2 In `apps/backend/src/modules/admin/application/exceptions/audit-log.exceptions.ts`:
    - Define `AuditLogNotFoundException` (`AUDIT_LOG_NOT_FOUND`, HTTP 404).
    - Define `ImmutableAuditLogException` (`IMMUTABLE_AUDIT_LOG`, HTTP 403 / 400).
  - [x] 3.3 In `apps/backend/src/common/http/http-exception.filter.ts`:
    - Register mapping for audit log exceptions.
  - [x] 3.4 In `apps/backend/src/modules/admin/application/ports/audit-log-repository.port.ts`:
    - Define `ListAuditLogsParams` and `PaginatedAuditLogsResult`.
    - Define `AuditLogRepositoryPort` interface (`append`, `findMany`, `findById`).

- [x] **Task 4: Infrastructure Repositories & ORM Immutability Protection** (AC: 1, 6)
  - [x] 4.1 In `apps/backend/src/modules/admin/infrastructure/in-memory-audit-log.repository.ts`:
    - Create in-memory implementation supporting pagination, filtering, and strict append-only operations.
  - [x] 4.2 In `apps/backend/src/modules/admin/infrastructure/prisma-audit-log.repository.ts`:
    - Implement `AuditLogRepositoryPort` using Prisma with sanitized entity mapping and query filtering.
  - [x] 4.3 Add ORM-level immutability guard or verification ensuring update/delete methods are blocked.

- [x] **Task 5: Application Service & Presentation Controller** (AC: 3, 4, 6)
  - [x] 5.1 In `apps/backend/src/modules/admin/application/audit-log.service.ts`:
    - Implement `AuditLogService` with `listAuditLogs(params)` and `getAuditLogById(id)`.
  - [x] 5.2 In `apps/backend/src/modules/admin/presentation/admin-audit-logs.controller.ts`:
    - Implement `AdminAuditLogsController` with `GET /admin/audit-logs` and `GET /admin/audit-logs/:id`.
    - Decorate with `@UseGuards(SessionAuthGuard, RolesGuard)` and `@Roles('ADMIN')`.
    - Apply `ZodValidationPipe` and `ParseUuidPipe`.
  - [x] 5.3 In `apps/backend/src/modules/admin/admin.module.ts`:
    - Register controller and bind `AUDIT_LOG_REPOSITORY_PORT` provider to `PrismaAuditLogRepository`.

- [x] **Task 6: Comprehensive Unit & Integration Tests** (AC: 7)
  - [x] 6.1 Create `apps/backend/src/modules/admin/application/audit-log.service.spec.ts`.
  - [x] 6.2 Create `apps/backend/src/modules/admin/presentation/admin-audit-logs.controller.spec.ts`.
  - [x] 6.3 Create `apps/backend/src/modules/admin/infrastructure/prisma-audit-log.repository.spec.ts`.
  - [x] 6.4 Create E2E test `apps/backend/test/admin-audit-logs.e2e-spec.ts`.
  - [x] 6.5 Run full test suite (`npm test`) and verify 100% pass with zero regressions.

### Review Findings
- [x] [Review][Patch] Implement Prisma Client extension/middleware intercepting update/delete/upsert on identityAuditLog [apps/backend/src/common/database/prisma.service.ts]
- [x] [Review][Patch] Remove dummy update/delete methods from repository implementations [apps/backend/src/modules/admin/infrastructure/prisma-audit-log.repository.ts:127, apps/backend/src/modules/admin/infrastructure/in-memory-audit-log.repository.ts:83]
- [x] [Review][Patch] Add statement-level BEFORE TRUNCATE trigger to prevent audit log truncation [apps/backend/prisma/migrations/20260914144000_immutable_audit_logs/migration.sql:18]
- [x] [Review][Patch] Support timezone offsets, date order validation, and action length bounds in shared schemas [packages/schemas/src/admin/audit-logs.schema.ts:1225]
- [x] [Review][Patch] Avoid case-insensitive mode in action repository query to leverage standard index [apps/backend/src/modules/admin/infrastructure/prisma-audit-log.repository.ts:25]
- [x] [Review][Patch] Add end-to-end admin action audit trail verification in E2E tests [apps/backend/test/admin-audit-logs.e2e-spec.ts:1010]
- [x] [Review][Patch] Add ORM and database immutability verification tests [apps/backend/src/modules/admin/infrastructure/prisma-audit-log.repository.spec.ts:109]
- [x] [Review][Patch] Add dedicated unit test suite for InMemoryAuditLogRepository [apps/backend/src/modules/admin/infrastructure/in-memory-audit-log.repository.spec.ts]
- [x] [Review][Patch] Add test coverage for startDate, endDate, userId, and targetUserId query filters [apps/backend/src/modules/admin/application/audit-log.service.spec.ts:150, apps/backend/test/admin-audit-logs.e2e-spec.ts:1160]
- [x] [Review][Patch] Guard date string parsing against NaN in repository filter construction [apps/backend/src/modules/admin/infrastructure/prisma-audit-log.repository.ts:40, apps/backend/src/modules/admin/infrastructure/in-memory-audit-log.repository.ts:45]
- [x] [Review][Patch] Support JSON arrays in audit log metadata schema and deep freeze entity [packages/schemas/src/admin/audit-logs.schema.ts:1246, apps/backend/src/modules/admin/domain/audit-log.entity.ts:25]
- [x] [Review][Patch] Update modified file list in story documentation [1-5-system-audit-logging.md:261]
- [x] [Review][Defer] Add compound indexes for (userId, createdAt) and (targetUserId, createdAt) [apps/backend/prisma/schema.prisma:295] — deferred, pre-existing schema structure

---

## Dev Notes

### Architecture Compliance & Guardrails
- **Clean Architecture:** Domain and Application layers have 0 imports of `@nestjs/`, `@prisma/client`, or `express`.
- **Immutability Principle:** Audit logs are strictly append-only. No updates, no deletes, no overwrites permitted at both PostgreSQL trigger and ORM levels.
- **Data Protection:** Passwords, session digests, and tokens must never appear in audit records.
- **Consistent Envelopes:** All responses return `{ data, error, meta }`.

### Testing Requirements
- Unit tests with `InMemoryAuditLogRepository` for fast execution.
- Integration tests for Prisma repository.
- E2E tests for route guards, error envelopes, filtering, and database immutability.

---

## Dev Agent Record

### Implementation Plan
1. Defined shared Zod schemas (`listAuditLogsQuerySchema`, `auditLogItemSchema`, `paginatedAuditLogsResponseSchema`, `auditLogDetailResponseSchema`) in `packages/schemas`.
2. Created PostgreSQL database trigger `trg_identity_audit_logs_immutable` and migration script to reject all `UPDATE` and `DELETE` commands on `identity_audit_logs`.
3. Created pure domain entity `AuditLog`, domain exceptions (`AuditLogNotFoundException`, `ImmutableAuditLogException`), and `AuditLogRepositoryPort`.
4. Registered exception responses in `HttpExceptionFilter` (404 for not found, 403 for immutability violations).
5. Implemented `InMemoryAuditLogRepository` and `PrismaAuditLogRepository` with explicit immutability guards throwing on update/delete attempts.
6. Implemented `AuditLogService` and `AdminAuditLogsController` with `SessionAuthGuard`, `RolesGuard`, `@Roles('ADMIN')`, `ZodValidationPipe`, and `ParseUUIDPipe`.
7. Registered components in `AdminModule`.
8. Added unit tests for service, controller, and repositories, plus full E2E test suite in `admin-audit-logs.e2e-spec.ts`.
9. Addressed all 12 code review findings (Prisma ORM immutability middleware, TRUNCATE trigger, schema refinements, filter test suites, admin action audit trail integration).

### Completion Notes
- All 6 main tasks and all review findings completed.
- 100% test pass rate across 28 unit test suites (207 tests) and 7 E2E test suites (71 tests).
- Clean Architecture boundaries validated with 0 violations in `architecture.spec.ts`.
- Database row-level and TRUNCATE triggers verified against live PostgreSQL instance.

---

## File List

### New Files
- `packages/schemas/src/admin/audit-logs.schema.ts`
- `apps/backend/prisma/migrations/20260914144000_immutable_audit_logs/migration.sql`
- `apps/backend/src/modules/admin/domain/audit-log.entity.ts`
- `apps/backend/src/modules/admin/application/exceptions/audit-log.exceptions.ts`
- `apps/backend/src/modules/admin/application/ports/audit-log-repository.port.ts`
- `apps/backend/src/modules/admin/application/audit-log.service.ts`
- `apps/backend/src/modules/admin/infrastructure/in-memory-audit-log.repository.ts`
- `apps/backend/src/modules/admin/infrastructure/in-memory-audit-log.repository.spec.ts`
- `apps/backend/src/modules/admin/infrastructure/prisma-audit-log.repository.ts`
- `apps/backend/src/modules/admin/presentation/admin-audit-logs.controller.ts`
- `apps/backend/src/modules/admin/application/audit-log.service.spec.ts`
- `apps/backend/src/modules/admin/presentation/admin-audit-logs.controller.spec.ts`
- `apps/backend/src/modules/admin/infrastructure/prisma-audit-log.repository.spec.ts`
- `apps/backend/test/admin-audit-logs.e2e-spec.ts`
- `_bmad-output/implementation-artifacts/1-5-system-audit-logging.md`

### Modified Files
- `packages/schemas/src/index.ts`
- `apps/backend/src/common/database/prisma.service.ts`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/modules/admin/admin.module.ts`
- `apps/backend/test/admin-users.prisma.e2e-spec.ts`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/deferred-work.md`

---

## Change Log
- 2026-09-14: Implemented Story 1.5 System Audit Logging, including shared Zod schemas, PostgreSQL immutability trigger, pure domain entity and ports, Prisma and in-memory repositories, application service, and AdminAuditLogsController with comprehensive unit and E2E tests.
- 2026-09-14: Code review completed with all 12 patches applied: PrismaService immutability middleware for IdentityAuditLog mutations, statement-level BEFORE TRUNCATE database trigger, schema hardening (offset timestamps, date order validation, action string bounds), dedicated InMemoryAuditLogRepository unit test suite, and complete end-to-end admin action audit trail verification in E2E tests.

