---
baseline_commit: 45983a3202862d4d7e6a6ba35e05f99910e53b2f
---
# Story 12.12: Admin Code-Issue Queue — Contract & MSW Mock

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Developer,
I want the Admin code-issue queue contracts and a mock domain,
so that the queue screen can be built and reviewed against the exact backend contract of Story 12.10.

## Acceptance Criteria

1. **Adopt the 12.10 contract.** Given the Admin schemas from Story 12.10 in `packages/schemas` (`adminCodeIssueListQuerySchema`, `adminCodeIssueSchema`, `adminCodeIssueListSchema`, `adminResolveCodeIssueSchema`), when the frontend adopts them, then MSW handlers exist for `GET /admin/rewards/code-issues`, `GET /admin/rewards/code-issues/:id` and `POST /admin/rewards/code-issues/:id/resolve`. The handlers parse every query and body with the shared Zod schemas and are listed in `DEFERRED_KEEP_MOCK` until Story 12.11. A typed FE service (`lib/admin/rewards-code-issues-service.ts`) calls the three routes and parses every response with the same schemas.
2. **Rules mirror the backend.** The mock state and rules match the backend:
   - one OPEN report per redemption;
   - at most one outcome per report: REPLACE, REFUND, or REJECT (REJECT needs a note);
   - `canReplace` and `replaceBlockedReason` (`SHARED_CODE`, `TICKET_EXPIRED`, `NO_STOCK`, `NO_CODE`) follow the backend's priority order;
   - repeating the same outcome is a 200 no-op that returns the stored result;
   - a different outcome returns 409 `CODE_ISSUE_ALREADY_RESOLVED`.
3. **Both portals stay consistent.** Resolving in the mock updates the user's ticket and history:
   - REPLACE: the ticket shows the replacement code and is no longer marked used.
   - REFUND: a REFUNDED history entry with an `RFD-` reference is added, and the Points go back to the wallet.
   - REJECT: the ticket is unchanged, and the user may report again.
   - In every case `openIssue` shows the new status.
4. **No code values in Admin payloads.** No Admin payload contains an original or replacement code value.
5. **Tests.** Mock-only unit tests cover the rules and every error code. The route-diff, contract-callsite, pilot-scope, and hybrid allowlist tests stay green, with their counts updated.

Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 → Story 12.12 (FR-75, BR-22). Contract source: `packages/schemas/src/rewards/rewards-admin.schema.ts` lines 71–142 (Story 12.10 Task 5.1) and the backend implementation `apps/backend/src/modules/rewards/{application/rewards-admin-code-issues.service.ts, domain/code-issue-resolution.ts, infrastructure/prisma-my-vouchers.repository.ts#listReportsForAdmin/findReportForAdmin}`. Design reference for the seed data only: Figma page **28 · Admin – Báo cáo mã lỗi** (`mkudD5Ngi5RPyIAVxCcxXi`, node `150:2`). The screen itself is Story 12.13.

## Tasks / Subtasks

- [x] **Task 0: Branch and baseline** — the branch `feat/12-12-admin-code-issue-queue-contract-msw-mock` exists. It was cut from `origin/develop` @ `45983a3` (12.10 merged, PR #27), with no upstream. The working tree also carries the uncommitted Story 12.11 file and its `sprint-status.yaml` line. Leave both alone and do not commit them with this story's code unless Quan asks. Run `git status --short --branch` before the first edit. Scope: `apps/frontend/my-app` only. **No backend and no `packages/schemas` change** (see Dev Notes, "Contract is frozen").
- [x] **Task 1: Pure rules** (AC: 2) in `apps/frontend/my-app/mocks/data/rewards-rules.ts`, next to `codeIssueDecision`:
  - [x] 1.1 `replaceBlockedReason(facts, now)` returns `"SHARED_CODE" | "TICKET_EXPIRED" | "NO_STOCK" | "NO_CODE" | null`, given `{ status, isSharedCode, expiresAt, stockRemaining, codesAvailable }`. It must use the exact order of the backend repository (`prisma-my-vouchers.repository.ts` ~L733–753):
    1. report not `OPEN` ⇒ `null`, and `canReplace` is false;
    2. shared code ⇒ `SHARED_CODE`;
    3. `now >= expiresAt` ⇒ `TICKET_EXPIRED`;
    4. `stockRemaining <= 0` ⇒ `NO_STOCK`;
    5. `codesAvailable <= 0` ⇒ `NO_CODE`;
    6. otherwise `null`, and `canReplace` is true.

    `canReplace = status === "OPEN" && reason === null`.
  - [x] 1.2 `resolveCodeIssueDecision(report, ticket, voucher, outcome, now)` ports `apps/backend/src/modules/rewards/domain/code-issue-resolution.ts#resolveDecision` with the same codes. It must also give the service's same-outcome rule (`rewards-admin-code-issues.service.ts` ~L111–127): when the report is not OPEN and the outcome matches its status (`REPLACE↔REPLACED`, `REFUND↔REFUNDED`, `REJECT↔REJECTED`), it returns `{ ok: true, replay: true }`. A non-matching outcome returns `409 CODE_ISSUE_ALREADY_RESOLVED`. On an OPEN report:
    - `REJECT` is always ok.
    - `REFUND` gets `409 TICKET_REFUNDED` when the redemption is already refunded; otherwise it is ok, **including on an expired ticket** (BR-23 covers only expiry without a report).
    - `REPLACE` checks, in this order: `REPLACEMENT_NOT_SUPPORTED` (shared code), `TICKET_EXPIRED`, then `NO_REPLACEMENT_AVAILABLE` (no stock or no code). All are 409.
- [x] **Task 2: Mock state** (AC: 2, 3, 4) in `apps/frontend/my-app/mocks/data/rewards.ts`:
  - [x] 2.1 Extend `IssueRow` with `resolvedBy: { id: string; name: string } | null` and `resolutionNote: string | null`. The existing creation path in `reportCodeIssue` sets both to `null`. The user-facing `POST /rewards/my-vouchers/:id/issues` response must still contain **only** the `codeIssueReportSchema` fields: pick them before returning, so that no admin field reaches the user.
  - [x] 2.2 Seed (bump `SCHEMA_VERSION` in `mocks/db/store.ts` 10 → 11, because the persisted shape changes). Keep the demo users (`user-active-002`, its clones, `…d001`) and their tickets as they are, with one exception: add the missing ticket row `id(494)` that the existing REFUNDED report `id(493)` points to. Use voucher `id(6)` (The Coffee House), reference `RDM-2610-5TC1`, 200 points `BASE`, `openIssue: { id: id(493), status: "REFUNDED" }`, a code ≥ 4 chars, and give `id(493)` the new fields. `ticketsOf` already hides it. The test `tests/rewards-mock.test.mjs` ~L86 counts `UNUSED`/`EXPIRING` tickets: if it now counts 4, change it to exclude refunded tickets (list semantics) and record why. Put every **new** report on **new seed users**, never on the demo user, so the 12.4/12.10 user-side tests keep their state. Their ids are UUID-shaped and start with the Figma user labels, e.g. `2e770000-0000-4000-8000-000000000001` ⇒ `#2E77`. Each new user gets the tickets plus history (`SUCCEEDED`, plus `REFUNDED` for refunds) that its reports need. Seed content:
    - **6 OPEN**, matching Figma frame 28-1a (vouchers, reasons, notes, points, price source, labels, ages):
      - Phúc Long, `CODE_INVALID`, 120 PROMO, `#2E77`, waiting 1 d 15 h, ticket **expired** ⇒ `TICKET_EXPIRED`.
      - Highlands, `CODE_INVALID`, 150 FLASH, `#E41B`, 1 d 3 h ⇒ `canReplace` true.
      - Lotteria, `STORE_REFUSED`, 125 BASE, `#7C20`, 1 d 2 h.
      - KFC, `CODE_ALREADY_USED`, 200 BASE, `#B91E`, 21 h.
      - The Coffee House, `CODE_INVALID`, 200 BASE, `#5D02`, 19 h. Voucher `id(6)` has no codes ⇒ `NO_CODE`.
      - Gong Cha, `OTHER`, 100 BASE, `#A3F1`, 4 h, ticket `isSharedCode: true` ⇒ `SHARED_CODE` (see Dev Notes, "Shared-code deviation").

      Copy the user notes from the Figma rows (quoted in Dev Notes).
    - **32 resolved** (Figma 28-1b: 14 replaced, 11 refunded, 7 rejected). The existing demo refund `id(493)` counts as one of the 11. Generate the rest from a compact spec array in a loop (no 32 hand-written objects).
      - REPLACED rows carry a `replacementCode` on the report and the ticket.
      - REFUNDED rows carry an `RFD-` reference that also appears in that user's history.
      - REJECTED rows carry a `resolutionNote`.
      - Use `resolvedBy` `{ id: id(999), name: "Admin Hùng" }` for seeds.

    Totals: OPEN 6 / RESOLVED 32 / ALL 38.
  - [x] 2.3 `adminCodeIssueRow(userId, issue, now)` builds the DTO exactly as the backend does:
    - `id`; `redemptionId = ticket.redemptionId`; `reference = ticket.reference` (RDM).
    - `userLabel = "#" + userId.slice(0, 4).toUpperCase()` (backend rule; **not** the `slice(-4)` of the 12.5 `adminVoucherDetailOf`).
    - `voucher { id, title, brand }` from the catalog; `reason`, `note`, `status`, `createdAt`, `resolvedAt`, `resolvedBy`.
    - `pricePoints = ticket.pointsSpent`, `priceSource`.
    - `ticketStatus = ticketStatus(ticket, now)`.
    - `canReplace` / `replaceBlockedReason` from Task 1.1, using `stockRemaining`/`codesAvailable` of the catalog voucher and `ticket.expiresAt`.
    - `resolution = null` when OPEN, else `{ outcome: status, refundReference? }`: include `refundReference` only for REFUNDED, and omit the key otherwise (backend sends `undefined`).
    - `resolutionNote`.

    Never copy `code` or `replacementCode` into it.
  - [x] 2.4 `adminCodeIssuesOf(query, now)`:
    - Scan **all** `rewardsState.users`, including the `user-active-002` template.
    - De-duplicate by report id, first one wins: the demo report exists in several user copies.
    - Filter: `OPEN` ⇒ `status === "OPEN"`; `RESOLVED` ⇒ the other three; `ALL`.
    - Sort by `createdAt` ASC, then `id` ASC, for every filter (backend `orderBy createdAt asc`).
    - Return `{ items: slice(offset, offset + limit), total, limit, offset, hasMore: offset + limit < total, summary: { open, oldestOpenAt } }`. `summary` counts OPEN over all reports, whatever the filter.

    `adminCodeIssueOf(id, now)` returns the row, or `{ ok: false, status: 404, code: "CODE_ISSUE_NOT_FOUND" }`.
  - [x] 2.5 `resolveAdminCodeIssue(id, input, admin, now)`:
    - Find the report (404 `CODE_ISSUE_NOT_FOUND`) and run `resolveCodeIssueDecision`.
    - On `replay`, return the stored row and change nothing.
    - On failure, return the decision and change nothing.
    - On success, apply the change **to every user copy that holds this report id**, so the template and the clones stay equal. Use one `rewardsState.update`, plus one `rewardsCatalog.update` for REPLACE. Set `status`, `resolvedAt = now`, `resolvedBy = { id: admin.id, name: admin.email }` (backend uses the admin email as the name), and `resolutionNote = note?.trim() || null`. REJECT stores its required note.

    Then the outcome:
    - **REPLACE**: on the voucher, `stockRemaining--`, `code = codePools[v.id].shift()`, `codesAvailable = pool.length`. Set `report.replacementCode = code`. On the ticket, `code = code`, `usedAt = null`, `undoUntil = null` (12.10 review decision 3A), `openIssue = { id, status: "REPLACED" }`.
    - **REFUND**: add history row `{ kind: "REFUNDED", reference: RFD-…, points: +ticket.pointsSpent, journalId: mockId(), note: null, createdAt: now, … }` at the top. Set `report.refundReference` and `ticket.openIssue = { id, status: "REFUNDED" }`. Credit the wallet (Task 2.6). Stock and codes are **not** returned (12.10 Open point 1).
    - **REJECT**: `ticket.openIssue = { id, status: "REJECTED" }`. Ticket, stock, code and Points are unchanged.

    Return `{ ok: true, result: adminCodeIssueRow(...) }`. Generate the refund reference with the existing `generateReference`, using an `RFD` prefix (add a prefix parameter; do not copy the function). It must match `REFUND_REFERENCE_PATTERN`.
  - [x] 2.6 Wallet credit on REFUND (AC 3). Only credit user ids that already have a mock wallet (`walletOf` would seed a new one from the email). Use `updateWallet(user, w => { w.available += points })` and `recordTransaction` with a new `MockTransactionKind` `"VOUCHER_REFUND"`. In `mocks/data/economy-rules.ts`:
    - `entriesOf` ⇒ `[["USER_AVAILABLE", amount]]`;
    - `journalOf` ⇒ key `redemption-refund:{reportId}` (the backend ledger key), description `Reversal of journal …`;
    - `ledgerItemsFromRows` ⇒ `reversesJournalId` = the redemption id, non-null, so `lib/wallet/wallet-history.ts#historyKindOf` shows `REVERSAL` like the real `reverseJournal`. Store the report id and redemption id on the row (reuse the optional `rewardRowId` field for the redemption id if it fits; otherwise add one optional field).

    Use `// ponytail:` to note the ceiling: a copy whose wallet does not exist yet (the template) gets no credit.
- [x] **Task 3: MSW handlers** (AC: 1, 2) in `apps/frontend/my-app/mocks/handlers/rewards-admin.ts`. Reuse the file's `guarded`, `body` and `respond` helpers, and add an `// ASSUMED API CONTRACT: backend Story 12.10 …` comment on each route, listing its status codes:
  - [x] 3.1 `GET /admin/rewards/code-issues`: parse the query with `adminCodeIssueListQuerySchema`. On failure return 400 `VALIDATION_ERROR` (same shape as the stats route). Otherwise `ok(adminCodeIssuesOf(query.data))`.
  - [x] 3.2 `GET /admin/rewards/code-issues/:id`: `respond(adminCodeIssueOf(id))`. If `id` is not a UUID, return 400 `VALIDATION_ERROR`, like the backend `ParseUUIDPipe`. Use `z.string().uuid()` from the shared `id` schema, or the regex the file already uses, if any.
  - [x] 3.3 `POST /admin/rewards/code-issues/:id/resolve`: `guarded(request, true)` (CSRF), check the UUID, parse the body with `adminResolveCodeIssueSchema` (REJECT without a note ⇒ 400), then `respond(resolveAdminCodeIssue(...), 200)`. Success is **200**, not 201 (backend `@HttpCode(OK)`).
  - [x] 3.4 Forced errors, so that 12.13 can show Figma 28-3e without a race. Add four scenarios to `mocks/scenarios.ts` `MOCK_SCENARIOS`, each with a one-line comment: `rewards-resolve-already-resolved`, `rewards-resolve-no-replacement`, `rewards-resolve-not-supported`, `rewards-resolve-ticket-expired`. In the resolve handler only, an active one returns its 409 code **without changing state**. Loading, list errors and network failure already work through `slow`, `api-error` and `api-offline` via `applyScenario("admin")`; do not add more.
- [x] **Task 4: FE service** (AC: 1) — new file `apps/frontend/my-app/lib/admin/rewards-code-issues-service.ts`, in the pattern of `rewards-flash-service.ts`:
  - `listAdminCodeIssues(query: { status?, limit?, offset? }, signal?)` ⇒ `apiRequest("/admin/rewards/code-issues?…", { schema: adminCodeIssueListSchema })`;
  - `getAdminCodeIssue(id, signal?)` ⇒ `adminCodeIssueSchema`;
  - `resolveAdminCodeIssue(id, input: AdminResolveCodeIssueDto, signal?)` ⇒ `POST …/resolve`, with body `adminResolveCodeIssueSchema.parse(input)` and response schema `adminCodeIssueSchema`.

  Each function starts with `if (PILOT_BUILD) throw new Error("Rewards admin disabled in pilot");` (`tests/pilot-scope.test.mjs` requires the guard in the same function; 12.11 later swaps it for `REWARDS_ENABLED`). Build the query with `URLSearchParams` and `encodeURIComponent(id)`. No hooks and no UI: those are 12.13.
- [x] **Task 5: Allowlists and counts** (AC: 1, 5):
  - [x] 5.1 `mocks/route-allowlist.ts` `DEFERRED_KEEP_MOCK`: add the 3 routes. Reason: `"rewards admin, Epic 12 (Phase 2; backend Story 12.10, screen Story 12.13)"`. The count becomes 41 → **44**.
  - [x] 5.2 `tests/helpers/frontend-callsites.mjs` `CALL_ALLOWLIST`: add 3 `deferred-hidden` entries. Each note must contain `Epic 12 Phase 2`, e.g. `"Admin code-issue queue hidden in pilot (Epic 12 Phase 2, Story 12.12)"`, because `contract-callsites.test.mjs` L41 keys on that text.
  - [x] 5.3 `tests/route-diff.test.mjs`:
    - add `"GET /admin/rewards/code-issues"`, `"GET /admin/rewards/code-issues/:param"` and `"POST /admin/rewards/code-issues/:param/resolve"` to the `deferredRewards` set (~L90; the backend already serves them);
    - change the gate-G expectation `DEFERRED_KEEP_MOCK: 41` → `44` (~L120, L123).
  - [x] 5.4 `tests/hybrid-mocking.test.mjs` ~L131/134: 41 → 44 (test title and assertion).
  - [x] 5.5 `contract-callsites.test.mjs` "every matched call is exercised by a backend e2e spec": `apps/backend/test/rewards-my-vouchers.e2e-spec.ts` L311–352 already calls all three paths literally. Add an exemption only if the test fails, and record why.
- [x] **Task 6: Tests** (AC: 2–5) — new `apps/frontend/my-app/tests/rewards-admin-code-issues.test.mjs`. Copy the TS loader preamble from `tests/rewards-admin-flash-domain.test.mjs`. Exercise the handlers through `getResponse(handlers or hybridHandlers, new Request(...))`, as `tests/hybrid-mocking.test.mjs` L92–116 does.
  - [x] 6.1 Rules:
    - the `replaceBlockedReason` order with several reasons true at once, e.g. shared + expired ⇒ `SHARED_CODE`;
    - the expiry boundary `now = expiresAt − 1 ms` ⇒ replaceable, `= expiresAt` ⇒ `TICKET_EXPIRED`;
    - a resolved report ⇒ `canReplace` false and reason `null`;
    - the `resolveCodeIssueDecision` matrix: 3 outcomes × OPEN, REPLACED, REFUNDED, REJECTED, plus REFUND on an expired ticket ⇒ ok, plus REFUND on a refunded redemption ⇒ `TICKET_REFUNDED`.
  - [x] 6.2 Seed and list:
    - totals 6/32/38;
    - `summary.open = 6` under every filter;
    - `oldestOpenAt` = the Phúc Long report;
    - oldest-first order;
    - pagination: `limit 10, offset 10` on RESOLVED ⇒ 10 items, `hasMore` true;
    - the demo report appears once;
    - every list and detail parses with `adminCodeIssueListSchema` / `adminCodeIssueSchema`;
    - the six OPEN rows give `canReplace`/reason values of TICKET_EXPIRED, true, …, NO_CODE, SHARED_CODE as seeded.
  - [x] 6.3 Resolve — every error code once:
    - 400 `VALIDATION_ERROR`: bad query, bad body, REJECT without a note, non-UUID id;
    - 401: no session in full mock;
    - 403: non-admin (`FORBIDDEN_RESOURCE`), and missing CSRF on POST;
    - 404 `CODE_ISSUE_NOT_FOUND`;
    - 409 `CODE_ISSUE_ALREADY_RESOLVED`, `NO_REPLACEMENT_AVAILABLE` (drain the codes or stock of a replaceable voucher), `REPLACEMENT_NOT_SUPPORTED`, `TICKET_EXPIRED`, `TICKET_REFUNDED` (rule level);
    - each forced scenario returns its code and changes nothing.
  - [x] 6.4 Effects:
    - REPLACE: stock −1, codes −1, the user ticket (`ticketOf`) shows a new code and `usedAt` null, `openIssue.status` REPLACED, and the replaced code is never handed out again.
    - REFUND: a REFUNDED entry with `RFD-` appears in `historyOf` (parses `redemptionHistoryListSchema`; `monthSummary` nets the refund), `ticketsOf` hides the ticket, the wallet `available` rises by `pricePoints` once, and the wallet item kind is `REVERSAL` with key `redemption-refund:{id}`.
    - REJECT: the note is stored, the ticket is unchanged, and the user can `reportCodeIssue` again (201).
    - Same outcome twice ⇒ 200, same body, no second refund or code.
    - The template and the clones stay equal after a resolve.
  - [x] 6.5 Secrecy: for every list, detail and resolve response, `JSON.stringify(body)` contains no seeded or replacement code value (collect them from the tickets and `codePools`).
  - [x] 6.6 User side unchanged: `POST /rewards/my-vouchers/:id/issues` returns exactly the `codeIssueReportSchema` keys (no `resolvedBy` / `resolutionNote`). The existing `rewards-*.test.mjs` suites stay green.
- [x] **Task 7: Verification** — in `apps/frontend/my-app`:
  - `npm test` (`node --test tests/*.test.mjs`): all green;
  - `npm run typecheck` (the exhaustive `MockTransactionKind` switches will flag every missing `VOUCHER_REFUND` case);
  - `npm run lint`;
  - `npm test` in `packages/schemas` (unchanged; it proves no contract drift).

  Record the commands and pass counts in the Completion Notes. No browser pass is needed: there is no UI. One manual check is optional: `?msw=default` in full-mock mode, then `fetch('/api/admin/rewards/code-issues')` as admin from the devtools console.

### Review Findings

- [x] [Review][Patch] REFUND gives each report copy its own history `id`/`journalId` (`mockId()` inside the per-copy loop), so the template and clones diverge (Task 2.5). Generate the ids once before `rewardsState.update`. Reachable when the template reports an issue and `claimDemoRewards` clones it while it is still OPEN. [apps/frontend/my-app/mocks/data/rewards.ts:700]
- [x] [Review][Patch] The "template and clone stay equal" test resolves demo report `id(493)`, which is seeded as REFUNDED. Both calls hit the replay no-op, so the `deepEqual` passes trivially and hides the divergence above. Use an OPEN report that exists in the template and the clone, resolve it with REFUND, then compare. [apps/frontend/my-app/tests/rewards-admin-code-issues.test.mjs:207]

## Dev Notes

### Scope boundaries (read first)

- **In:** the mock rules, state, and seed; 3 MSW routes; 4 forced scenarios; the FE service module; allowlists and counts; tests.
- **Out:**
  - the queue screen, AdminSidebar entry, hooks, toasts, and routes `/admin/code-issues…` (12.13);
  - any de-mocking or `REWARDS_ENABLED` (12.11);
  - backend and schema changes (12.10 is merged; see "Contract is frozen");
  - user notifications in the mock (the backend sends `CODE_ISSUE_RESOLVED` via the Outbox; the mock notifications list is not touched; add it when a story asks);
  - search, SLA KPIs, and business-day maths (12.13 or a contract change, see the Open points).
- **Gates:** none new. Production enable is still OQ-24 (12.11).

### Contract is frozen (12.10 backend shipped it)

`rewards-admin.schema.ts` L71–142 is the source of truth, and the backend serves it already. The mock must produce exactly what the backend produces. Behaviour facts read from the backend code:

| Fact | Backend | Mock must |
|---|---|---|
| Order | `orderBy createdAt asc` for every filter | ASC, plus `id` as a stable tie-break |
| `RESOLVED` filter | status in REPLACED, REFUNDED, REJECTED | same |
| `summary` | `open` = count of all OPEN, `oldestOpenAt` = min `createdAt` of OPEN, both independent of the filter | same |
| `userLabel` | `#` + first 4 chars of userId, upper case | same (seed ids start with the Figma label) |
| `resolvedBy.name` | admin **email** (`adminNames` maps id → email; the controller passes `admin.email`) | `admin.email` (seeds use "Admin Hùng" as stored history) |
| `resolution.refundReference` | `r.refund?.reference` ⇒ key absent unless REFUNDED | omit unless REFUNDED |
| `resolutionNote` | stored for all three outcomes (`note?.trim() \|\| null`) | same |
| Same outcome again | checked **before** any other rule; returns the stored DTO, 200 | same (`replay`) |
| REPLACE | stock −1, one unissued code, `deleteUsage` (the new code is unused) | same |
| REFUND | reversal journal `redemption-refund:{reportId}`, `RFD-` reference, no stock or code back, Flash claim freed | Points back + history; per-user Flash caps are not mocked, so nothing to free |
| REJECT | only the report changes | same |
| Statuses | 400 `VALIDATION_ERROR` (body/query/UUID), 401, 403 `FORBIDDEN_RESOURCE` (role) / `REWARDS_ADMIN_CAPABILITY_REQUIRED` (live capability), 404 `CODE_ISSUE_NOT_FOUND`, 409 `CODE_ISSUE_ALREADY_RESOLVED`, `NO_REPLACEMENT_AVAILABLE`, `REPLACEMENT_NOT_SUPPORTED`, `TICKET_EXPIRED`, `TICKET_REFUNDED`; resolve success 200 | same codes; the mock has no live-capability split (`requireMockAdmin` covers it) |

### Mock data model gotchas

1. **Mock `ticket.id` ≠ `redemptionId`** (seed `id(300+n)` vs `id(400+n)`). The backend uses `ticket.id = redemption.id`. The Admin DTO only exposes `redemptionId`, so use `ticket.redemptionId`. Find the ticket of a report with `issue.ticketId`.
2. **The demo state is copied.** `users["user-active-002"]` is the template; `claimDemoRewards` clones it per session id, and `…d001` is the hybrid member. The demo report `id(493)` therefore exists 2+ times. List: de-duplicate by id. Resolve: update every copy. Wallet: credit only copies that have a wallet.
3. **Ticket `id(494)` is missing today.** The seeded REFUNDED report points to a ticket that does not exist, so `adminCodeIssueRow` would crash. Task 2.2 adds it.
4. **`SCHEMA_VERSION` bump** (10 → 11): without it, an old browser localStorage keeps the old seed with no queue data.
5. **Do not add reports to the demo user.** `tests/rewards-my-vouchers.test.mjs` L113 and `rewards-mock.test.mjs` L85–89 read `users['user-active-002'].tickets[0]` / `issues[0]`.
6. `?msw=<scenario>` persists in localStorage until `?msw=default` (12.2 gotcha). The new forced scenarios must touch only the resolve route.
7. `rtk`/hooks rewrite shell commands; quote globs in zsh.

### Shared-code deviation

The backend reads `isSharedCode` from the **voucher**. No seeded mock voucher is shared, and making Gong Cha shared would change catalog, redeem and stats tests. For `SHARED_CODE`, the mock therefore uses `ticket.isSharedCode || voucher.isSharedCode` (the ticket copies the voucher flag at redeem, so the two agree for every real ticket). Mark this with a `// ponytail:` comment and list it in the Completion Notes.

### Figma 28 seed notes (verbatim from frame 28-1a)

- Phúc Long "Giảm giá trà & bánh": "Nhân viên nhập mã báo không tồn tại, mình đã thử ở 2 cửa hàng khác nhau"
- Highlands "Voucher mua đồ uống": "Thu ngân báo mã không tồn tại trên máy POS, nhập tay cũng lỗi. Mình dùng ở chi nhánh Nguyễn Huệ sáng 13/10."
- Lotteria "Voucher burger & gà": "Cửa hàng Lê Duẩn nói chưa nhận voucher Rescom"
- KFC "Voucher combo gà rán": "Quét QR báo đã dùng lúc 11:02 ngày 13/10 nhưng mình chưa dùng lần nào"
- The Coffee House "Voucher cà phê & bánh": "Mã sai định dạng, nhân viên nhập không được. Mã có 9 ký tự nhưng máy POS yêu cầu 10."
- Gong Cha "Voucher trà sữa": "Ứng dụng không hiện QR, chỉ có mã chữ nên quầy không quét được"

Use the existing mock voucher of each brand. Titles come from the catalog, not from Figma.

### Figma 28 vs the frozen contract (for 12.13, not fixed here)

Figma page 28 shows data that `adminCodeIssueSchema` does not carry. The mock must **not** invent these fields:

| Figma shows | Contract has | Gap |
|---|---|---|
| Report reference `RPT-1013-01` | `id` (UUID), `reference` = RDM | no report reference |
| Counts per tab "Đã xử lý · 32", "Tất cả · 38"; "thay mã 14, hoàn điểm 11, từ chối 7"; "6 voucher · 6 người dùng" | `total` of the current filter, `summary.open`, `oldestOpenAt` | resolved/all counts, outcome breakdown, distinct counts |
| KPIs "Quá hạn 1 ngày làm việc", "Đến hạn trong 4 giờ", "Xử lý trung bình 6,5 giờ · 84% đúng hạn" | — | SLA aggregates (the FE could compute overdue only on the loaded page) |
| Search "Tìm RPT, RDM hoặc #user" | no `q` | search |
| Voucher value "50.000đ", redeemed at, expiry date "31/12/2026 · còn 78 ngày", base price, Flash session, code batch file, "tồn kho còn 63 · lô còn 63 mã" | `voucher {id,title,brand}`, `pricePoints`, `priceSource`, `ticketStatus` | value, dates, stock and batch numbers |
| "lần báo đầu tiên cho ticket này" | — | report count per ticket |
| Blocked reasons named `OUT_OF_STOCK`/`NO_CODES` with priority expired → shared → stock → codes, and "lists every true reason" | one `replaceBlockedReason`: `NO_STOCK`/`NO_CODE`, priority shared → expired → stock → code | names, priority, single value |
| "Thử lại gửi lại cùng idempotency key" | no `Idempotency-Key` on resolve; the same-outcome no-op makes a retry safe | none (UI text only) |

This is Open point 1. Default: the contract stays and 12.13 adapts the design.

### Existing code to reuse (do not reinvent)

| Need | Use |
|---|---|
| Ticket status / boundaries | `ticketStatus` in `mocks/data/rewards-rules.ts` |
| Reference generator | `generateReference` in `mocks/data/rewards.ts` (add a prefix parameter) |
| Admin guard, CSRF, body parse, respond | `guard`/`guarded`/`body`/`respond` in `mocks/handlers/rewards-admin.ts`; `requireMockAdmin`; `HYBRID_ADMIN` |
| Envelope | `ok`/`fail`/`missingCsrf` in `mocks/envelope.ts` |
| Persisted state | `createCollection`, `rewardsState`, `rewardsCatalog` (one `update` per collection per write) |
| Wallet | `updateWallet`, `recordTransaction`, `walletOf` in `mocks/data/economy.ts`; journal and entries in `mocks/data/economy-rules.ts` |
| FE request | `apiRequest` in `lib/api/client.ts`; pattern `lib/admin/rewards-flash-service.ts` |
| Handler tests | `getResponse` from `msw` (`tests/hybrid-mocking.test.mjs` L92–116); TS loader preamble (`tests/rewards-admin-flash-domain.test.mjs` L1–6) |
| Backend truth | `rewards-admin-code-issues.service.ts`, `domain/code-issue-resolution.ts`, `prisma-my-vouchers.repository.ts` L671–905 |

### Testing standards

- `node --test`. Parse every response with the shared Zod schemas. No `test.skip` / `.only` and no placeholder tests. Tests that change module state reset the store before each case, like `tests/rewards-admin-flash-domain.test.mjs` L68–70 (`initialCatalog`/`initialUsers` snapshots, then `rewardsCatalog.set` / `rewardsState.set`). Snapshot the economy wallet and transaction collections the same way for the refund case. Assert durable effects (stock, codes, ticket, history, wallet), not only status codes.

### Project Structure Notes

- New: `lib/admin/rewards-code-issues-service.ts`, `tests/rewards-admin-code-issues.test.mjs`.
- Changed: `mocks/data/rewards-rules.ts`, `mocks/data/rewards.ts`, `mocks/data/economy-rules.ts` (+ `economy.ts` only if a helper is needed), `mocks/handlers/rewards-admin.ts`, `mocks/route-allowlist.ts`, `mocks/scenarios.ts`, `mocks/db/store.ts` (`SCHEMA_VERSION`), `tests/helpers/frontend-callsites.mjs`, `tests/route-diff.test.mjs`, `tests/hybrid-mocking.test.mjs`, maybe `tests/rewards-mock.test.mjs` (Task 2.2).
- `AGENTS.md` in `apps/frontend/my-app` warns that Next.js here differs from training data. This story touches no Next.js API, so the warning does not apply.

### Previous story intelligence

- **12.10** (merged, `cece1db` / PR #27): it built the backend queue and froze the contract. Its review decisions apply to the mock:
  - 3A: REPLACE resets usage;
  - 1A: a refunded ticket hides `code`. The mock `ticketOf` still returns the code for a refunded ticket, but the user list hides refunded tickets. Do **not** fix the user side here, because it is not in this AC. If a test needs it, note it for 12.11.
  - `resolvedBy` is the real admin, not `'Admin'`;
  - `canReplace` is false when the report is resolved.

  12.10 Open point 4 created 12.12 and 12.13.
- **12.5 / 12.6** (Admin voucher and Flash mocks): the handler style in `rewards-admin.ts` (one line per route, `guarded`, `respond`), the "one catalog update per successful write" rule, `requireMockAdmin` vs `HYBRID_ADMIN`, and the PILOT_BUILD guard per service function.
- **12.4**: the user ticket and report flow (`reportCodeIssue`, `openIssue`, refunded tickets hidden from the list). Mock session ids are generated, so per-user seeds key by email (`claimDemoRewards`).
- **12.1**: Rewards routes go into `DEFERRED_KEEP_MOCK`, and the counts are hard-coded in two tests. Avoid `reward*` export names, which collide with survey rewards; new exports should use `adminCodeIssue*`.

### Git intelligence

- `45983a3` Merge PR #27 (12.10), `cece1db` 12.10 implementation, `d6db08d` PR #26 (12.9), `b64da7f` 12.9. The 12.10 FE diff touched only `tests/route-diff.test.mjs` and the notification presentation map. `mocks/data/rewards.ts` was last changed by 12.6 and 12.4.

### Latest tech information

- No new dependency. MSW 2 (`http`, `getResponse`), Zod 3.24 (via `@rescom/schemas`), Node test runner. `adminResolveCodeIssueSchema` is a `discriminatedUnion` on `outcome`: invalid `outcome` values and REJECT without a note both fail `safeParse`, which gives 400.

### Open points for Quan (do not block; solo owner)

1. **RESOLVED (Quan, 2026-10-14): option A.** **Figma 28 vs contract** (table above). (A, chosen) Keep the 12.10 contract. 12.13 shows the RDM reference instead of RPT, the tab count only for the active filter plus `summary.open`, and overdue only for loaded rows. It drops search, value, dates, stock and batch numbers, and the outcome breakdown. (B) Extend the contract, schema and backend before 12.13: add `reportReference`, `voucher.valueVnd`, `redeemedAt`, `expiresAt`, `summary.{resolved, all, byOutcome, overdue, dueSoon, avgResolutionMinutes}`, `q`, and maybe `replaceBlockedReasons[]`. This is a new backend story, or a 12.13 scope increase.
2. **Blocked-reason priority.** The backend uses shared → expired; Figma uses expired → shared. The mock follows the backend. Change the backend if the Figma order is wanted.
3. **Gong Cha shared-code seed** uses the ticket flag (deviation above). The alternative is a new shared-code seed voucher, which needs catalog and stats test updates.
4. **Seed volume** of 38 reports matches Figma 28. Say if a smaller seed is preferred.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12, Stories 12.10, 12.12, 12.13, 12.11]
- [Source: `_bmad-output/implementation-artifacts/12-10-my-vouchers-reminders-faulty-code-resolution.md` Task 5, Review Findings, Open points 1–7]
- [Source: `_bmad-output/implementation-artifacts/12-11-rewards-integration-without-mocks-enable-gate.md` Task 0.3, 5.1, 5.5, 7.1 (counts 44 and the 12.12 routes expected)]
- [Source: `packages/schemas/src/rewards/rewards-admin.schema.ts` L71–142; `packages/schemas/src/rewards/redemption.schema.ts` L26–40]
- [Source: `apps/backend/src/modules/rewards/application/rewards-admin-code-issues.service.ts`; `domain/code-issue-resolution.ts`; `infrastructure/prisma-my-vouchers.repository.ts` L671–905; `presentation/admin-rewards-code-issues.controller.ts`; `common/http/http-exception.filter.ts` ~L632–641]
- [Source: `apps/frontend/my-app/mocks/{data/rewards.ts, data/rewards-rules.ts, data/economy.ts, data/economy-rules.ts, handlers/rewards-admin.ts, handlers/rewards.ts, handlers/index.ts, route-allowlist.ts, scenarios.ts, hybrid.ts, db/store.ts, db/session.ts}`; `lib/admin/rewards-flash-service.ts`; `lib/wallet/wallet-history.ts`; `tests/{route-diff,hybrid-mocking,contract-callsites,pilot-scope,rewards-mock,rewards-my-vouchers,rewards-admin-flash-domain}.test.mjs`; `tests/helpers/frontend-callsites.mjs`]
- [Source: Figma `mkudD5Ngi5RPyIAVxCcxXi` page 28 "Admin – Báo cáo mã lỗi" (node `150:2`): frames 28-1a `150:3`, 28-1b `151:196`, 28-2a…c, spec `156:1262`, errors 28-3e `158:1898`, states 28-4a…f]

## Dev Agent Record

### Agent Model Used

- Antigravity (parallel implementation and test subagents).

### Debug Log References

- Frontend: `npm test`; `npm run typecheck`; `npm run lint`; focused `node --test tests/rewards-admin-code-issues.test.mjs`.
- Shared contract: `npm test` in `packages/schemas`.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Added queue projection, 38 seeded reports, replacement/refund/rejection rules, wallet reversals, three MSW handlers, four forced resolve scenarios, guarded FE service, route allowlists, and regression tests.
- Coffee House seed holds stock with no code; Gong Cha shared-code mock uses ticket flag (existing voucher is not shared). Refunded demo report now links to previously absent ticket; refunded tickets excluded from legacy visible-ticket count. Existing admin voucher history assertion updated because ticket now links historic refund.
- Full frontend `npm test`: 895 passed / 0 failed; focused queue: 9 passed / 0 failed; `npm run typecheck`: passed; `npm run lint`: 0 errors, one pre-existing unused-import warning (`tests/rewards-admin-flash.test.mjs`); schema `npm test`: 46 suites / 635 tests passed.
- No dependencies, backend/schema edits, UI, notifications, production gate change, or commit. Existing 12.11 story and sprint entry preserved.

### File List

- `apps/frontend/my-app/mocks/data/rewards-rules.ts`
- `apps/frontend/my-app/mocks/data/rewards.ts`
- `apps/frontend/my-app/mocks/data/economy-rules.ts`
- `apps/frontend/my-app/mocks/db/store.ts`
- `apps/frontend/my-app/mocks/handlers/rewards-admin.ts`
- `apps/frontend/my-app/mocks/scenarios.ts`
- `apps/frontend/my-app/mocks/route-allowlist.ts`
- `apps/frontend/my-app/lib/admin/rewards-code-issues-service.ts`
- `apps/frontend/my-app/tests/helpers/frontend-callsites.mjs`
- `apps/frontend/my-app/tests/hybrid-mocking.test.mjs`
- `apps/frontend/my-app/tests/route-diff.test.mjs`
- `apps/frontend/my-app/tests/rewards-admin-vouchers.test.mjs`
- `apps/frontend/my-app/tests/rewards-mock.test.mjs`
- `apps/frontend/my-app/tests/rewards-admin-code-issues.test.mjs`
- `_bmad-output/implementation-artifacts/12-12-admin-code-issue-queue-contract-msw-mock.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

- 2026-10-14: Code review: 2 patches applied (shared refund row/journal ids across report copies; clone-equality test now resolves a real OPEN copy). npm test 895/895, typecheck and lint clean. Status done.
- 2026-10-14: Implemented frozen 12.10 admin queue mock/service/allowlists, seeded 38 reports, tested refund and replacement effects, marked ready for review.
- 2026-10-14: Story created (create-story). Contract frozen to 12.10; seed mirrors Figma page 28; Open points 1–4 for Quan.
