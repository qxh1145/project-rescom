# Deferred Work

## Deferred from: code review of 1-1-emailpassword-registration-authentication.md (2026-09-12)

- Automated execution of Prisma repository integration tests against an isolated live PostgreSQL container [apps/backend/src/modules/users/infrastructure/user.repository.spec.ts:1] — deferred, requires active Docker PostgreSQL test container lifecycle in CI/dev.

## Deferred from: code review of 1-2-google-oauth-login.md (2026-09-12)

- Automated execution of Prisma OAuth, Session, and IdentityAudit repositories and migration-chain against an isolated live PostgreSQL container — deferred, requires active Docker PostgreSQL test container lifecycle in CI/dev.
## Deferred from: code review of 1-5-system-audit-logging.md (2026-09-14)

- Add compound indexes for `(userId, createdAt DESC)` and `(targetUserId, createdAt DESC)` on `IdentityAuditLog` [apps/backend/prisma/schema.prisma:295] — deferred, pre-existing schema structure optimization for future high-volume audit query scaling.

## Deferred from: code review of 1-6-security-api-foundation.md (2026-09-14)

- Redis distributed storage for multi-replica rate limiting [apps/backend/src/common/security/security.module.ts:9] — in-memory throttling is sufficient for single-instance MVP; bind Redis connection for multi-replica scaling.
- IPv6 /64 CIDR subnet clustering for edge WAF [apps/backend/src/common/security/app-throttler.guard.ts:9] — handled by edge reverse proxy/WAF (Cloudflare/AWS WAF).
- `SessionAuthGuard` clearing refresh cookie on expired access token [apps/backend/src/modules/auth/presentation/guards/session-auth.guard.ts:54] — pre-existing from Story 1.3, sliding session refresh flow optimization.

## Deferred from: code review of 2-1-shared-form-schema-validation.md (2026-09-14)

- Cross-block semantic type compatibility validation for consistency pairing rules [packages/schemas/src/forms/form-definition.schema.ts:51] — deferred to Story 2.6 (Publish Lifecycle Immutability) / Epic 10 (Integrity Pipeline).
- Dynamic form submission validator against specific FormDefinition instances (AC4.2 / AC4.3) [packages/schemas/src/forms/form-answer.schema.ts:1] — deferred to Story 5.4 (Internal Form Submission) where response answer verification against published version schema is implemented.

