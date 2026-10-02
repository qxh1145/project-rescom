# IR.3 / IR.4 automated evidence (2026-10-02)

Scope decisions (owner, 2026-10-02): real Postgres is required for concurrency, idempotency and ledger clauses; error cases (401/403/validation/404/409) keep the existing in-memory e2e evidence. Internal-draft `POST /forms` idempotency is N/A (autosave PATCH is proven instead). Publisher/admin endpoint-specific rate limits are N/A: only the global 429 envelope (`security.e2e`) and the open top-up request limit exist by design. Internal-testing overrides of 2026-10-01 still apply (hybrid mocking for Phase 2 routes); IR.1 has not run, external completion is treated as in scope.

PG suites skip when their DB is unreachable and fail when the env var is set but unreachable. With the env var unset and no DB on :5433 every PG test skips and the run looks green: set `JOURNEY_TEST_DATABASE_URL` / `FINANCIAL_TEST_DATABASE_URL` in CI (Story 11.3) so they cannot silently skip.

Full backend e2e on 2026-10-02: 56 suites passed (1 skipped, pre-existing), 473 tests passed, 4 skipped (pre-existing). Frontend: 747 passed.

## IR.3 Respondent journey

| AC clause | Evidence | Store |
|---|---|---|
| End-to-end journey (auth, demographics, feed, summary, start, pinned read, submit, outcome, wallet) | `respondent-journey.prisma.e2e-spec.ts` (a) | PG |
| Attempt not granted twice | (b1) same user 5 parallel starts → 1 attempt, 4×409 with resume details; (b2) 7 users on quota 3 → exactly 3 | PG |
| Resume on pinned version | (c) | PG |
| Duplicate / offline-retried submit idempotent | (d) 5 parallel submits, same key and different keys → 1 response, 1 journal, 1 outbox row, 1 notification | PG |
| Rewards explained by ledger entries | (a), (d) via `fixtures/ledger-invariants.ts`: balance = sum of entries, journals zero-sum. Immutability itself is enforced by the `ledger_journals_append_only` trigger, not exercised by these specs | PG |
| Expiry | (e) expired reservation → 409 ATTEMPT_EXPIRED, no ledger entry | PG |
| External completion replay | (f) 3 sequential + 3 parallel replays → 1 pending credit | PG |
| Rate limit | `respondent-journey.e2e-spec.ts` start and submit 429 with Retry-After | MEM |
| Session expiry | `respondent-journey.e2e-spec.ts` revoked session → 401 → re-login resumes same attempt; `single-session.e2e`; FE `session-refresh.test.mjs` | MEM |
| Offline | (d) server idempotency; FE `offline-cache.test.mjs` | PG + FE |
| Empty state | `respondent-journey.e2e-spec.ts` filtered-empty feed (search matches nothing), empty wallet history, empty notifications | MEM |
| Unauthorized / forbidden / validation / not-found / conflict | `survey-runner-reads`, `survey-attempt`, `participation-submission`, `marketplace-feed`, `demographic-onboarding` e2e; PG cancel races in `attempt-cancel.prisma` | MEM (+PG) |
| External time barrier / expiry | `external-completion.e2e` 1–8 | MEM |

## IR.4 Publisher, financial and moderation

| AC clause | Evidence | Store |
|---|---|---|
| Draft editing idempotent | `financial-publisher.prisma` autosave PATCH twice (sequential + concurrent) → 1 version, 1 form; repeat gets 409 FORM_CONFLICT | PG |
| Publish escrow / insufficient funds | raced publish → 1 escrow journal + 409; insufficient → 409 INSUFFICIENT_ESCROW_BALANCE, no journal | PG |
| Top-up approval auditable, retries no duplicate | two admins approve concurrently → 1 journal, 1 `AdminTopUpApproved` outbox event, 1 notification; replay no change; reject-after-approve 409; self-approval 403 | PG |
| Notifications real, no mock source | top-up/moderation PG specs assert exactly one notification row per decision (counted separately from the outbox event, not linked by key); `email-delivery.prisma`; FE `hybrid-mocking.test.mjs` notification routes not mocked | PG + FE |
| Moderation: two admins, self-review, concurrency, audit | `moderation.prisma`: concurrent approves → 1 decision, 1 outbox event, 1 notification; approve vs reject → 409 MODERATION_ALREADY_DECIDED; self-review 403; reject refunds escrow once | PG |
| Ledger invariants | final invariant test in both PG specs | PG |
| Empty state | `empty-states.e2e-spec.ts`: forms list, top-up queue, moderation queue, notifications | MEM |
| Offline | FE `form-builder-autosave.test.mjs` network and non-network failure retry | FE |
| Unauthorized / forbidden / validation / conflict | `forms-draft`, `forms-publish`, `forms-escrow`, `top-up`, `survey-moderation`, `admin-audit-logs` e2e | MEM |
| Rate limit, session expiry | N/A beyond global 429 and generic session tests (see scope decisions) | — |

## Observations (no product bugs found)

- A revoked session on `POST /responses/:id/submit` (guest-capable route) returns 403 PARTICIPANT_NOT_ELIGIBLE, not 401 AUTH_SESSION_REVOKED. The runner's attempt read gets the 401 first; recorded in deferred-work.md.
- Autosave retry after a successful save returns 409 FORM_CONFLICT; the frontend reloads the baseline.
