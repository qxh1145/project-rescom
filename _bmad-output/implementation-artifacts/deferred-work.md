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

## Deferred from: code review of stories 2.2–2.7 (2026-09-15)

- Replace the pre-existing two-node-only consistency-pair check with full cycle detection so longer cycles cannot pass publication validation [packages/schemas/src/forms/form-definition.schema.ts:57].
- Reject impossible calendar dates instead of accepting values that merely match the ISO-shaped regular expression [packages/schemas/src/forms/form-blocks.schema.ts:325].

## Deferred to Phase 2: BMAD Scope Pruning & MVP Focus (2026-09-17)

- **Epic 3: AI Form Generation Assistant (Stories 3.1 - 3.4)** — deferred to Phase 2. Core manual Form Builder (Epic 2) is already functional. AI form draft generation via Ollama/Qwen GPU is an optional convenience feature.
- **Story 4.4: Public Link & Guest Submissions** — deferred to Phase 2. Gated until repeat-abuse and anonymous fraud rules are established; Phase 1 enforces authenticated student accounts.
- **Story 7.3: Automated Demographic Cross-Check** — deferred to Phase 2. Algorithmic and AI-based cross-validation between profile and responses.
- **Story 7.4 - 7.6: Gamification (Streaks, Leaderboard, Tiers)** — deferred to Phase 2. User engagement mechanics (daily streaks, point leaderboards, Trusted Researcher badge) deferred to focus on core survey completion and point settlement.
- **Story 8.3 - 8.5: Automated Incident Engine & Dispute State Machine** — deferred to Phase 2. High-complexity incident lifecycle and automated arbitration deferred; Phase 1 uses append-only FraudLog (FR-47) and manual Admin moderation.
- **Story 9.1, 9.3, 9.4, 9.5: Advanced Dashboards & Algorithmic Deprioritization** — deferred to Phase 2. Traffic funnel analytics, NLP feedback summarization, automated feed deprioritization, and system-wide BI ledger dashboards deferred to Phase 2.
- **Epic 10: Research Integrity Foundation & TrustGraph (Stories 10.1 - 10.8)** — deferred to Phase 2. Telemetry derivation workers, versioned pure scoring engine, reliability snapshots, and relational TrustGraph deferred to Phase 2 progressive rollout (SHADOW/ADVISORY mode). Phase 1 relies on Time Barrier (FR-45), Rate Limiting (FR-46), Completion Codes (FR-22), and 48h dispute window.
