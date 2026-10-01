/**
 * Endpoints the frontend calls (an MSW handler exists) that the NestJS
 * backend does not serve, each with the reason it may stay that way. Checked
 * by `tests/route-diff.test.mjs`, which fails on an MSW-only endpoint missing
 * here and on an entry that went stale (the backend serves it now, or its MSW
 * handler is gone): delete the entry then. At gate G of the mock-off plan
 * (`.omc/plans/mock-off-full-backend.md`) only `MOCK_ONLY` and
 * `DEFERRED_KEEP_MOCK` may remain.
 *
 * Keys are `METHOD /path` as written in the MSW handler (the `apiUrl` path,
 * without `/api`); `:param` names need not match the backend's.
 */
export const ROUTE_ALLOWLIST: Record<"MOCK_ONLY" | "DEFERRED_KEEP_MOCK" | "PLANNED" | "REMOVE", Record<string, string>> = {
  /** Mock mode only: the real app never calls them. */
  MOCK_ONLY: {
    "POST /auth/google/mock-complete": "stands in for the Google OAuth redirect, which MSW cannot intercept",
    "GET /mock/demo-accounts": "demo account list on /login",
    "PUT /storage/mock-uploads/:id":
      "stands in for the browser PUT to the presigned object-storage URL (outside /api), Phase 7",
  },

  /** Deferred PRD scope (decision Q1, 2026-10-01): stays on MSW in the hybrid mode of gate G. */
  DEFERRED_KEEP_MOCK: {
    "POST /forms/:id/attempts/:attemptId/disputes": "disputes, Story 8.5",
    "GET /admin/disputes": "disputes, Story 8.5",
    "POST /admin/disputes/:id/resolve": "disputes, Story 8.5",
    "GET /integrity/reliability/me": "reliability, Epic 10",
    "GET /admin/quality-reviews": "admin quality review, Epic 10",
    "POST /admin/quality-reviews/:responseId/decision": "admin quality review, Epic 10",
    "GET /forms/:id/quality": "survey quality, Epic 10 (FR-62)",
    "GET /forms/:id/ai/conversation": "AI builder, Epic 3",
    "POST /forms/:id/ai/messages": "AI builder, Epic 3",
    "POST /forms/:id/ai/suggest-block": "AI builder, Epic 3",
    // Phase 6 fix (no orphan draft): the first prompt is answered before `POST /forms`, then attached.
    "POST /forms/ai/messages": "AI builder, Epic 3 (first prompt of a new chat)",
    "POST /forms/:id/ai/conversation": "AI builder, Epic 3 (attach a new chat to its draft)",
    "GET /engagement/me": "streak and tier, Stories 7.4-7.6",
    "GET /engagement/leaderboard": "leaderboard, Stories 7.4-7.6",
  },

  /** Backend still to build, tagged with the plan item that builds it. */
  PLANNED: {},

  /** Handlers to delete rather than implement. */
  REMOVE: {},
};
