# Sprint Change Proposal — Admin Console Gaps (2026-10-18)

- **Author:** Quan (Owner, all roles) with the BMad Correct Course workflow
- **Mode:** Batch
- **Status:** Approved by Quan on 2026-10-18 (D1–D4 defaults accepted); edits in §4.1–4.3 applied
- **Scope classification:** Moderate (new epic and 4 backlog stories; no PRD MVP change, no architecture decision change)

---

## 1. Issue Summary

**Trigger.** An admin-console gap review on 2026-10-18, done while Story 13.13 is in `review`. No single story revealed the issue. The review compared every Admin backend route with every Admin screen.

**Problem statement.** The Admin console has 4 Phase 1 gaps:

1. **FR-23 is only half built.** A Respondent can report a missing completion code (`POST /attempts/:id/report-missing-code`). The Admin can only *read* the reports (`GET /admin/missing-code-reports`, read only). PRD FR-23 requires: *"Admin receives the report and can resolve (refund Respondent or instruct Publisher)"*. No resolve route exists. Outside full-mock mode, the "Báo thiếu mã" tab of `/admin/disputes` has no actions. The only workaround is `POST /admin/completion-code-limits/reset`, which forgives wrong codes but cannot pay a Respondent whose Publisher never embedded a code.
2. **The Rewards daily Points limit has no Admin UI.** Story 12.8 task 4.6 built `GET/PUT /admin/rewards/settings` (`dailyPointsLimit`, PRD FR-74 / BR-20). It recorded *"The Admin dashboard UI is not in 12.8 … record it for 12.11 / a follow-up FE story"*. No follow-up story was created.
3. **The Audit Log has no viewer.** Story 1.5 built `GET /admin/audit-logs` and `GET /admin/audit-logs/:id` (AC3/AC4). No screen reads them. An Admin cannot see who changed a role, a voucher price, or a refund without database access.
4. **Ledger operator fallbacks are API-only.** The Admin-only routes `GET /economy/integrity`, `GET /economy/accounts/:id/balance`, `POST /economy/accounts/:id/reconcile`, `POST /economy/rewards/internal/:responseId`, `POST /economy/rewards/external/:attemptId`, and `POST /economy/rewards/release-matured` can only be called with curl and a CSRF token.

**Issue type.** Planning omission (items 1, 3, 4) plus a dropped follow-up (item 2). This is not a strategic pivot.

**Out of scope (confirmed by the Owner on 2026-10-18).**

- Story 8.5 (Publisher complaint / `ATTEMPT_DISPUTE`, FR-54) stays in `phase_2_deferred` (`sprint-status.yaml`). `NoExternalDisputeHolds` stays bound.
- Story 10.7 (Integrity Review Queue, `/admin/quality`, FR-65) stays deferred. It depends on the Epic 10 scoring pipeline (10.1–10.6 are `backlog`). It cannot be built earlier.
- The `LOCKED_ATTEMPT` dispute kind stays on MSW. Its only action (`CODE_LIMIT_RESET`) already has a real route.

### Evidence

| Gap | Evidence |
|---|---|
| FR-23 resolve | `apps/frontend/my-app/lib/admin/disputes-service.ts:24-50` ("ASSUMED API CONTRACT (no backend read/resolve route exists)"); `apps/backend/src/modules/admin/application/admin-missing-code-reports.service.ts` ("read only"); `prisma-missing-code-report-stats.ts:51-54` (unresolved = reported, not `COMPLETED`, no later reset) |
| Rewards settings UI | `_bmad-output/implementation-artifacts/12-8-quote-redemption-transaction.md:56`; no FE reference to `dailyPointsLimit` |
| Audit Log viewer | `admin-audit-logs.controller.ts`; `packages/schemas/src/admin/audit-logs.schema.ts`; no FE page calls `/admin/audit-logs` |
| Ledger ops | `apps/backend/src/modules/economy/presentation/ledger.controller.ts:100-125`; `participation/presentation/admin-reward-redrive.controller.ts`; no FE caller |

---

## 2. Impact Analysis

### Checklist status

| Item | Status | Note |
|---|---|---|
| 1.1 Trigger | [x] | Admin gap review, 2026-10-18 |
| 1.2 Problem | [x] | Planning omission + dropped follow-up |
| 1.3 Evidence | [x] | Table above |
| 2.1 Current epic | [N/A] | No in-flight epic is blocked. Epic 13 continues unchanged |
| 2.2 Epic-level change | [x] | Add **Epic 14: Admin Console Completion** |
| 2.3 Remaining epics | [x] | Epic 8 (8.5) and Epic 10 (10.7) unchanged, still deferred. 14.1 must not pre-empt 8.5's dispute-hold design |
| 2.4 Obsolete or new epics | [x] | One new epic. None obsolete |
| 2.5 Order | [x] | Epic 14 runs after Story 13.13 Part B. It does not block the PayOS enable |
| 3.1 PRD | [!] | FR-23 consequences made testable. FR-74 gains an Admin-editable daily limit line. MVP unchanged |
| 3.2 Architecture | [x] | No new AD. 14.1 reuses the External completion settlement (`external-completion:{attemptId}`, FR-24 Pending) under AD-16 module ownership |
| 3.3 UX | [!] | Figma 11c (62:1609) covers the disputes screen. Settings, Audit Log, and Ledger ops have **no Figma frames**. They reuse existing Admin table, card, and dialog patterns (Owner decision D3) |
| 3.4 Other artifacts | [!] | `tests/route-diff.test.mjs` allowlist and category counts; MSW handlers; `docs/` runbook link for ledger ops |
| 4.1 Direct adjustment | Viable | Effort Medium, risk Low–Medium |
| 4.2 Rollback | Not viable | Nothing to revert |
| 4.3 MVP review | Not viable / not needed | MVP stays achievable. The change closes a Phase 1 FR |
| 4.4 Path | [x] | Option 1: Direct Adjustment via a new epic |

### Epic impact

- **New Epic 14** with 4 stories (14.1–14.4).
- **Epic 5** (done): FR-23 completion moves to 14.1. Epic 5 stays `done`.
- **Epic 8** and **Epic 10**: no change. Their deferred entries stay.
- **Epic 12**: 14.2 delivers the FE follow-up of 12.8 task 4.6. Epic 12 status is unchanged.

### Technical impact

- **Backend (14.1 only):** one Participation-owned route, one additive migration on `survey_attempts`, one Outbox notification type, one audit action. 14.3 adds additive display-name fields to the audit-log read DTO. 14.4 adds audit events only where they are missing.
- **Frontend:** wire the "Báo thiếu mã" tab to the real route; 3 new Admin screens or panels; route-diff allowlist update.
- **Deployment:** standard backend + FE deploy (`prod-deploy-procedure`). One migration (14.1). No new env vars or flags. The Rewards settings card follows the existing `REWARDS_ENABLED` gate.

---

## 3. Recommended Approach

**Option 1 — Direct Adjustment.** Add Epic 14 with 4 independent stories. Run them after Story 13.13 Part B.

- **Rationale:** The backend for 3 of the 4 gaps already exists and is tested, so 14.2–14.4 are mostly frontend work. 14.1 closes the only user-facing hole: a Respondent who reports a missing code currently waits forever. The reports appear in the Admin overview count, but nothing can close them except a code reset.
- **Effort:** 14.1 Medium; 14.2 Low; 14.3 Low–Medium; 14.4 Medium.
- **Risk:** 14.1 moves Points (Escrow → Pending), so it is the risky story. It reuses the existing idempotent settlement path, so the risk is Low–Medium. 14.4 exposes money-moving operator routes in the UI, so it needs confirmations and audit. Its risk is Low because the routes are already idempotent and Admin-only.
- **Timeline:** about 1 sprint. 14.2–14.4 can run in parallel after 14.1 starts.
- **Alternatives considered:** pull Story 8.5 forward (rejected by the Owner: high effort, Phase 2 scope); build Story 10.7 (blocked by Epic 10); skip the ledger ops UI (the Owner chose to include it).

---

## 4. Detailed Change Proposals

### 4.1 PRD — `prds/prd-project-rescom-2026-08-08/prd.md`

**FR-23: Missing Code Report** — Consequences

OLD:
```
**Consequences (testable):**
- Report button is visible on the code input modal
- Admin receives the report and can resolve (refund Respondent or instruct Publisher)
```

NEW:
```
**Consequences (testable):**
- Report button is visible on the code input modal
- Admin receives the report and can resolve (refund Respondent or instruct Publisher)
- "Refund Respondent" confirms the completion: the attempt becomes Completed and the reward follows the normal External path (Escrow → Pending 48 h → Available), paid at most once; it is refused when the survey is closed or its quota is full, the escrow is short, or the attempt is a guest attempt or already completed
- "Dismiss" requires a reason; the Respondent is notified with it
- On "Refund Respondent" the Publisher is notified to check the completion code on the external form
- Each report is resolved at most once, and every resolution is audited (FR-ADD-13)
```

Rationale: The current text cannot be tested. The new lines fix the payment path (the same as FR-24), the refusals, and the notifications.

**FR-74: Redemption Limits and Abuse Controls** — add after the per-user limits line

OLD:
```
- Per-user limits apply per voucher (default 2 per 30 days) and per day (default 500 Points), counted inside the redemption transaction (BR-20, Open Question 23)
```

NEW:
```
- Per-user limits apply per voucher (default 2 per 30 days) and per day (default 500 Points), counted inside the redemption transaction (BR-20, Open Question 23)
- Admin can change the per-day Points limit (1–1,000,000) in the Admin console; a change applies to the next redemption and is audited (FR-ADD-13)
```

Rationale: This records behavior that already shipped in Story 12.8 task 4.6, so 14.2 can be traced to an FR.

Also bump the frontmatter `updated: 2026-10-15` → `updated: 2026-10-18`.

### 4.2 Epics — `planning-artifacts/epics.md`

**a) Additional Production Requirements — FR-ADD-13**

OLD:
```
- **FR-ADD-13:** Audit Log: The system must maintain an immutable audit log of critical administrative actions and system-level financial operations.
```

NEW:
```
- **FR-ADD-13:** Audit Log: The system must maintain an immutable audit log of critical administrative actions and system-level financial operations. Admins can view, filter, and open audit records in the Admin console (Story 14.3).
```

**b) FR Coverage Map** — append after the Epic 13 line

```
- **Epic 14: Admin Console Completion** -> FR-23 (Admin resolution half), FR-74 (Admin-editable daily limit), FR-ADD-13 (viewer); ledger operator fallbacks from Epic 6 (no new FR)
```

**c) Epic List** — append after Epic 13

```
### Epic 14: Admin Console Completion
**Goal:** Admins can resolve missing-code reports, change the Rewards daily Points limit, read the Audit Log, and run the ledger operator fallbacks from the console instead of the API or the database.
**FRs covered:** FR-23 (resolution), FR-74 (daily limit setting), FR-ADD-13 (viewer). Added by `sprint-change-proposal-2026-10-18.md`.
**Out of scope:** Story 8.5 (FR-54 complaints) and Story 10.7 (FR-65 quality review) stay Phase 2; the `ATTEMPT_DISPUTE` and `LOCKED_ATTEMPT` dispute kinds stay on MSW.
**Dependency:** Starts after Story 13.13 Part B. Stories are independent; 14.1 is the only one with a migration. Screens without Figma frames (14.2–14.4) reuse the existing Admin shell, table, card, and confirm-dialog components.
```

**d) New section** — append at the end of the file

```
## Epic 14: Admin Console Completion

Admins can resolve missing-code reports, change the Rewards daily Points limit, read the Audit Log, and run the ledger operator fallbacks from the console. Added 2026-10-18 by `sprint-change-proposal-2026-10-18.md`.

### Story 14.1: Missing-Code Report Resolution

As an Admin,
I want to resolve a Respondent's missing-code report,
So that a Respondent whose Publisher forgot the completion code is paid or told why not.

**Acceptance Criteria:**

**Given** an unresolved missing-code report (`GET /admin/missing-code-reports`)
**When** the Admin calls `POST /admin/missing-code-reports/:attemptId/resolve` with `{ outcome, note }` (`ADMIN` only, CSRF, JSON-only, strict body)
**Then** `outcome` is `CREDIT_RESPONDENT` or `DISMISSED`, and `note` is required (1–500 characters) for `DISMISSED` and optional for `CREDIT_RESPONDENT` (FR-23).
**And** `CREDIT_RESPONDENT` moves the attempt to `COMPLETED` and settles through the existing External completion path (`external-completion:{attemptId}` → Pending, released after 48 h by the scheduler); Respondent, Publisher, and amount are derived server-side, never from the body (FR-24, FR-ADD-11).
**And** it is refused with 409 when the attempt is a guest attempt, already `COMPLETED` or already rewarded, the survey is closed or its quota is full, or the escrow is below the reward (`INSUFFICIENT_BALANCE`); nothing changes on refusal.
**And** `survey_attempts` gains additive nullable columns `missing_code_resolved_at`, `missing_code_resolution`, `missing_code_resolution_note`, `missing_code_resolved_by`; resolved reports leave the unresolved list and count.
**And** resolution takes a row lock on the attempt with a CAS on `missing_code_resolved_at IS NULL`; a second resolve, or a resolve racing a code reset or a late correct code, gets 409 `MISSING_CODE_ALREADY_RESOLVED` or the existing completion conflict, proven by a concurrency test; the reward is paid at most once.
**And** the resolution, its audit event, and its Outbox notifications commit in one transaction: the Respondent is notified for both outcomes (with the note), and the Publisher is notified on `CREDIT_RESPONDENT` to check the completion code on the external form (FR-57).
**And** with mocking disabled, the "Báo thiếu mã" tab of `/admin/disputes` (Figma 11c, 62:1609) shows "Cộng Điểm cho người làm" and "Bỏ qua" (reason required), plus the existing "Mở lại giới hạn mã"; `MISSING_CODE` leaves the MSW-only set in `tests/route-diff.test.mjs`, and the category counts are updated.
**And** the `ATTEMPT_DISPUTE` and `LOCKED_ATTEMPT` kinds and `NoExternalDisputeHolds` are unchanged.

### Story 14.2: Rewards Daily Points Limit Setting

As an Admin,
I want to change the per-user daily Points redemption limit in the console,
So that I can tune abuse controls without an API call.

**Acceptance Criteria:**

**Given** Rewards is enabled (`REWARDS_ENABLED`)
**When** the Admin opens `/admin/vouchers`
**Then** a "Giới hạn Điểm đổi mỗi ngày" card shows the current `dailyPointsLimit` from `GET /admin/rewards/settings` (FR-74).
**And** editing accepts integers 1–1,000,000 (`updateRewardsSettingsSchema`), shows a confirm dialog with old → new value and "áp dụng từ lần đổi tiếp theo", and saves with `PUT /admin/rewards/settings`.
**And** validation and server errors are shown inline; the card is hidden when Rewards is disabled.
**And** an MSW handler and a contract test match the shared schema; no backend change.

### Story 14.3: Admin Audit Log Viewer

As an Admin,
I want to read the Audit Log in the console,
So that I can trace who changed what without database access.

**Acceptance Criteria:**

**Given** `GET /admin/audit-logs` and `GET /admin/audit-logs/:id` (Story 1.5)
**When** the Admin opens `/admin/audit-log` (new nav item "Nhật ký thao tác")
**Then** a paginated table lists time, action, actor, target user, and outcome, newest first, with filters for action, actor, target user, outcome, and date range (`listAuditLogsQuerySchema`) (FR-ADD-13).
**And** the read DTO gains additive `actor` / `targetUser` `{ id, displayName }` fields, resolved through the existing `findDisplayLabels` port; IDs remain available.
**And** a row opens a detail drawer showing `errorCode` and `metadata` as formatted JSON.
**And** before release, the audit writers are checked: no metadata stores passwords, tokens, OTPs, or full bank account numbers; any such key is masked in the read DTO, covered by a test.
**And** non-Admins get 403; empty, loading, and error states follow the FraudLog screen.

### Story 14.4: Ledger Operations Panel

As an Admin,
I want to run the ledger operator fallbacks from the console,
So that I can repair a stuck reward or check balances without curl.

**Acceptance Criteria:**

**Given** the existing Admin-only routes in `ledger.controller.ts` and `admin-reward-redrive.controller.ts`
**When** the Admin opens the "Vận hành" tab of `/admin/transactions`
**Then** "Kiểm tra toàn vẹn sổ cái" runs `GET /economy/integrity` and shows the report; each account it flags offers "Kiểm tra số dư" (`GET /economy/accounts/:id/balance`) and "Đối soát" (`POST /economy/accounts/:id/reconcile`).
**And** "Chạy lại trả thưởng" accepts a response ID (Internal) or an attempt ID (External) and calls the matching re-drive route with an empty body; the result shows the posted or existing settlement.
**And** "Giải phóng Điểm chờ đã đủ 48 giờ" calls `POST /economy/rewards/release-matured` with an optional limit (1–500) and shows released count and `hasMore`.
**And** every mutating action needs a confirm dialog naming its effect, sends CSRF, and disables itself while running; 404 and 409 codes are shown in Vietnamese.
**And** every mutating route writes an audit event; any route that does not is fixed in this story (backend touch limited to adding the audit event).
**And** the `docs/` operations runbook links to the panel.
```

### 4.3 Sprint status — `implementation-artifacts/sprint-status.yaml`

Insert after `epic-13-retrospective: optional`:

```yaml

  # Added 2026-10-18 by sprint-change-proposal-2026-10-18 (Admin console gaps; 8.5/10.7 stay Phase 2)
  # Starts after 13.13 Part B; stories independent; 14.1 has the only migration
  epic-14: backlog
  14-1-missing-code-report-resolution: backlog
  14-2-rewards-daily-points-limit-setting: backlog
  14-3-admin-audit-log-viewer: backlog
  14-4-ledger-operations-panel: backlog
  epic-14-retrospective: optional
```

### 4.4 Architecture

No change. 14.1 follows AD-16: Participation owns the attempt and the resolve route; Economy settles through the existing coordinator; Admin reads through ports. Record the decisions below in the 14.1 story file.

### 4.5 UX

No Figma change for 14.1 (frame 11c). Stories 14.2–14.4 have no Figma frames and reuse the existing Admin components (decision D3).

---

## 5. Owner decisions (defaults applied; confirm or change at approval)

| ID | Decision | Default |
|---|---|---|
| D1 | Does a `CREDIT_RESPONDENT` reward go through Pending 48 h, or straight to Available? | **Pending 48 h**: same path as every External reward; no new journal type. The FE mock's `internal-reward:{attemptId}` assumption is dropped |
| D2 | Does a credited missing-code attempt count toward the survey quota? | **Yes**: it becomes a normal `COMPLETED` attempt |
| D3 | Screens without Figma (14.2–14.4) | **Build with existing Admin components**; no design pass |
| D4 | Ledger ops placement | **Tab on `/admin/transactions`**, not a new nav item |

---

## 6. Implementation Handoff

- **Scope:** Moderate. One new epic and 4 backlog stories; no replan.
- **Product Owner / PM (Quan):** approve this proposal and D1–D4; apply the PRD and epics edits in §4.1–4.2.
- **Scrum Master / Dev (Quan with BMad):** apply §4.3; for each story, branch `feat/14-<n>-<slug>` from `origin/develop` and run `bmad-create-story`, then `bmad-dev-story`, then `bmad-code-review`, in that order. Start with 14.1.
- **Sequencing:** after Story 13.13 Part B. 14.1 first; 14.2–14.4 in any order, at most two in parallel.

**Success criteria**

- With mocking disabled, an Admin resolves a missing-code report both ways. The reward is paid exactly once, through Pending. Both parties are notified, and the report leaves the list and the overview count.
- The daily limit, the Audit Log, and every ledger fallback are usable from the console, with no curl and no database access.
- `route-diff.test.mjs` passes with the updated counts. The FE, schema, and backend suites pass, including the 14.1 concurrency test.
- Stories 8.5 and 10.7 are still `phase_2_deferred`. No screen fakes their data on the pilot build.
