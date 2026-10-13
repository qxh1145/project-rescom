---
title: Sprint Change Proposal — Rewards (Voucher Redemption & Flash Sale)
project: project-rescom
date: 2026-10-13
author: Quan
workflow: bmad-correct-course
mode: Incremental
status: approved 2026-10-13 (Quan) — applied to PRD, Architecture Spine, solution-design, epics, sprint-status
scope_classification: Moderate
---

# Sprint Change Proposal — Rewards: Voucher Redemption & Flash Sale

## 1. Issue Summary

**Trigger:** A new stakeholder requirement, not an implementation defect. On 2026-10-13 a planning package was completed for a second way to spend Points: redeeming F&B partner vouchers, including time-boxed Flash Sales, in the User Portal (mobile 390 first, desktop 1440) and the Admin console (desktop 1440).

**Evidence:**
- Planning doc "Rescom — Đổi điểm lấy voucher F&B & Flash Sale" (Claude Docs, 2026-10-13): 14 screen groups (U1–U8, A1–A6), 9 new components, 21 icons, 24 business rules (BR-01…BR-24), a concurrency design, an edge-case table, and 12 unconfirmed assumptions.
- Figma Rescom (`mkudD5Ngi5RPyIAVxCcxXi`), pages 20–27: 30 screens built on the existing design system. Access was verified on page 21 (node `113:4`: mobile, desktop, loading, empty, error, and filter-sheet frames).

**Decisions already made by the stakeholder (not reopened here):**
- 1 Point ≈ 200 VNĐ, the top-up rate. A 50,000 VNĐ voucher costs 250 Points.
- All Available Points can be redeemed, including topped-up Points (changed on 2026-10-13). Pending, Frozen, Escrow, and Integrity Hold Points cannot.
- On mobile, Đổi quà sits under the Ví điểm tab; on desktop it is the fourth top-bar item. Admin gets three new sidebar entries.

**Decisions made in this workflow:**
- Rewards is **Phase 2**, after pilot launch (Story 11.5). It does not block Epic 11 or IR.6.
- Epic 12 is **full stack in two layers**: FE-mock stories first, then backend stories gated by PRD Open Questions.

## 2. Impact Analysis

### Checklist results

| Item | Status | Finding |
|---|---|---|
| 1.1 Trigger story | N/A | New requirement; no story revealed it |
| 1.2 Problem type | Done | New requirement from stakeholders |
| 1.3 Evidence | Done | Planning doc + Figma pages 20–27 |
| 2.1 Current epic | N/A | No existing epic is affected |
| 2.2 Epic changes | Action-needed | Add Epic 12 |
| 2.3 Remaining epics | Done | Epic 11 and IR.6 unchanged; Epic 12 depends on 11.5 for production |
| 2.4 New gaps | Action-needed | Story 8.5 (complaints) is deferred and the backend has no complaint model, so BR-22's "existing queue" does not exist; Epic 12 owns a minimal code-issue queue |
| 2.5 Order | Done | Unchanged; Epic 12 follows Epic 11 |
| 3.1 PRD | Action-needed | Conflicts with §5 Non-Goals ("Points … not currency"); new §4.20, FR-68…FR-75, §6.2 entry, Open Questions 23–26 |
| 3.2 Architecture | Action-needed | New AD-24 Rewards boundary; ownership map and financial workflow map rows |
| 3.3 UX | Done | Figma pages 20–27 are the UX source; `ux-designs/DESIGN.md` is a stub and is not changed |
| 3.4 Other artifacts | Done | Migrations and two scheduler jobs only; no infrastructure, CI, or deploy changes |
| 4.1 Direct Adjustment | Viable | Effort High (11 stories), risk Medium, no pilot delay |
| 4.2 Rollback | Not viable | Nothing to revert |
| 4.3 MVP Review | Not needed | MVP unchanged; Rewards is Phase 2 |
| 4.4 Selected path | Done | Option 1, Direct Adjustment (new epic) |

### Epic impact
- **New:** Epic 12, Rewards — Voucher Redemption & Flash Sale (Phase 2), 11 stories.
- **Unchanged:** Epics 1–11 and IR. Deferred stories stay deferred; Story 8.5 is not pulled forward.

### Artifact conflicts
- **PRD §5 Non-Goals** says Points are "for platform exchange only — not currency". Redeemable top-up Points mean Rescom effectively sells vouchers for top-up money. The statement must be amended, and the accounting/tax question becomes a gate (Open Question 24).
- **PRD §9** says no unresolved inference is an implementation default. The 12 planning assumptions therefore become Open Questions 23–26. FE mocks may use their defaults; backend stories may not.
- **Architecture:** AD-1 already provides `SYSTEM_SINK`, journal idempotency, and reversal journals. The new elements are the Rewards context, the stock/code locks, and the fixed lock order.

### Technical impact
- New backend module `rewards`, about 8 tables, and migrations; Economy gains `SpendPoints` and uses its existing reversal capability.
- Two idempotent jobs on the existing IR.2b scheduler (Flash start and end) plus expiry reminders through the existing Outbox and notifications.
- No Redis or queue. Stock-row locking serializes redemptions per voucher; a load test is required before Flash Sales open beyond the pilot.
- Frontend: about 14 new routes or screens, 9 components, 21 icons, MSW mock domain, and a new mock `SCHEMA_VERSION`.

## 3. Recommended Approach

**Direct Adjustment: add Epic 12 as Phase 2 work.**

- **Why:** The feature is additive. It reuses the ledger, the scheduler, the Outbox, and the design system. It does not need to change any delivered story.
- **Sequencing:** FE-mock Stories 12.1–12.6 can start now without risk to the pilot, because they touch only new routes and MSW mocks. Backend Stories 12.7–12.10 wait for their Open Questions. Story 12.11 (production enable) waits for 11.5 and the accounting/tax answer.
- **Effort:** High, 11 stories. Rough split: FE about 55%, backend about 45%.
- **Risk:** Medium. The main risks are the concurrency correctness of the redemption (mitigated by AD-24 and the PostgreSQL race tests in 12.8), the Flash load at 12:00 (load test in 12.11), and accounting/tax (gate on OQ-24).
- **Timeline:** No change to pilot launch. Epic 12 runs after or alongside Epic 11 ops work.
- **Alternatives considered:** Putting Rewards in pilot scope would delay Story 11.5 and add financial risk at launch, so it was rejected. FE-only now, with backend later, would leave contracts unvalidated and require a second correct-course, so it was rejected.

## 4. Detailed Change Proposals

All four proposals were approved individually on 2026-10-13 (Incremental mode).

### 4.1 PRD — `prds/prd-project-rescom-2026-08-08/prd.md` (approved)

**1a. §5 Non-Goals, first bullet**

OLD:
```
- **RESCOM is NOT a money-making app.** Points are internal tokens for platform exchange only — not currency, not cashable, not transferable between accounts.
```
NEW:
```
- **RESCOM is NOT a money-making app.** Points are internal tokens — not currency, not cashable, not transferable between accounts.
  > **Amendment 2026-10-13 (sprint-change-proposal-2026-10-13, Phase 2 Rewards):** Available Points, including topped-up Points, may also be spent on partner vouchers in the Rewards catalog (§4.20). Points can never be withdrawn as cash or converted back to money. Accounting/tax treatment is Open Question 24.
```

**1b. New §4.20 after §4.19**, with FR-68…FR-75. Full text is in Appendix A. In §0, "FR-1 through FR-67" becomes "FR-1 through FR-75".

**1c. §6.2 Out of Scope for MVP**, add:
```
- **Rewards: voucher redemption + Flash Sale (§4.20)** — Phase 2, after pilot launch (Story 11.5). Approved by sprint-change-proposal-2026-10-13.
```

**1d. §8 Open Questions**, add 23–26:
```
23. `[NOTE FOR PM — Owner: Product Manager + Economy owner; gate: before Story 12.8 readiness]` **Rewards economics:** Can unlocked starter Points be redeemed (default: yes)? Who funds codes and Flash discounts (bought from partners or sponsored), and is the 200 VNĐ rate sustainable? Confirm per-user limits (default 2 per voucher per 30 days, 500 Points per day), Flash quota reserved from stock with 1 unit per user, whether tier affects eligibility (default: no), and the BR-13 rule for a point price that deviates more than 20% from value ÷ 200 VNĐ. The planning default is second-Admin approval; with one pilot Admin, the proposed default is a warning plus an audit record.
24. `[NOTE FOR PM — Owner: Product Manager + Accounting/Legal reviewer; gate: before Rewards production enable (Story 12.11)]` **Rewards accounting and tax:** Redeemable top-up Points mean vouchers are effectively sold for top-up money. Confirm invoice, tax, and recipient-information obligations, and the Wallet wording that Points are never withdrawn as cash. This document is not legal advice.
25. `[NOTE FOR PM — Owner: Product Manager + Tech lead; gate: before Story 12.7 readiness]` **Code supply and usage:** Confirm CSV code import without partner API (default), code expiry at least 7 days after the redemption window, no refund for expired unused vouchers, faulty-code resolution within 1 business day, and self-marked "used" with 24-hour undo.
26. `[NOTE FOR PM — Owner: Tech lead; gate: before Story 12.8 readiness]` **Quote TTL:** Confirm the quote lifetime (default 5 minutes, capped at the Flash end).
```

### 4.2 Architecture (approved)

**2a. `ARCHITECTURE-SPINE.md`, new AD after AD-23:**
```
### AD-24 — Rewards Redemption Boundary [ADOPTED 2026-10-13, Phase 2]
- **Binds:** Rewards context, Economy, scheduler (IR.2b), Outbox/Notifications, Admin.
- **Prevents:** Overselling stock, double spend on retry, one code issued twice, client-trusted pricing, lock cycles with existing ledger flows, Points lost on a failed redemption.
- **Rule:** Rewards owns Voucher, append-only VoucherPriceVersion, VoucherCode, FlashSale, FlashSaleItem, RedemptionQuote, append-only Redemption, and CodeIssueReport. `RedeemVoucher` runs as one PostgreSQL Unit of Work coordinated by Rewards: idempotency lookup → lock Voucher → lock FlashSaleItem (if any) → conditional stock decrement (`remaining > 0`, or `sold < quota`) → claim one code `FOR UPDATE SKIP LOCKED` → Economy `SpendPoints` (journal `redemption:{idempotencyKey}`, USER_AVAILABLE → SYSTEM_SINK; Economy locks ledger accounts by ascending id and enforces no-overdraft) → Redemption SUCCEEDED + Outbox event → commit. Lock order is fixed: Voucher → FlashSaleItem → VoucherCode → ledger accounts. Existing flows lock only ledger accounts, so no cycle is possible. The effective price (Flash > promo > base) is computed server-side at commit; a priceVersion mismatch with the quote returns PRICE_CHANGED. A failed attempt is recorded in a separate transaction with no journal. Flash start/end are idempotent jobs on the existing in-process scheduler. Refunds only by an Economy reversal journal (`redemption-refund:{caseId}`). DB constraints: remaining >= 0; unique (voucherId, code); unique VoucherCode.redemptionId; unique (flashItemId, userId) when per-user cap = 1; RESTRICT delete on a Voucher with redemptions. No Redis or queue at pilot scale; load-test the stock-row lock before opening Flash Sales beyond the pilot.
```

**2b. Module and Durable-State Ownership Map, new row:**
```
| **Rewards** (Phase 2) | Voucher, VoucherPriceVersion, VoucherCode, FlashSale, FlashSaleItem, RedemptionQuote, Redemption, CodeIssueReport | Never writes Ledger; spends and refunds only through Economy commands under AD-24. Reads Identity eligibility and FraudLog flags through ports. |
```

**2c. Cross-Context Financial Workflow Map, new rows:**
```
| Redeem voucher | Rewards `RedeemVoucher` coordinator calls Economy `SpendPoints` under one shared Unit of Work (AD-24 lock order). | `redemption:{idempotencyKey}`; stock, code claim, Redemption and journal commit or roll back together; retry returns the original result. |
| Resolve faulty code with refund | Rewards `ResolveCodeIssue` coordinator (Admin) calls Economy `ReverseJournal` under one shared Unit of Work. | `redemption-refund:{caseId}`; at most one refund or replacement per case. |
```

**2d. `solution-design.md` §12 Module Ownership**, add: `Rewards (Phase 2): see Spine AD-24.`

### 4.3 Epics — `epics.md` (approved)

- Epic List: add the Epic 12 summary entry after Epic 11.
- Add the full Epic 12 section with Stories 12.1–12.11 after Epic 11. Full text is in Appendix B.

### 4.4 Sprint status — `implementation-artifacts/sprint-status.yaml` (approved)

Add after `epic-11-retrospective`, before `phase_2_deferred`, and set `last_updated` to 2026-10-13:
```yaml
  # Added 2026-10-13 by sprint-change-proposal-2026-10-13 (Rewards: voucher redemption + Flash Sale, Phase 2, AD-24)
  # FE-mock stories 12.1-12.6 may start now; backend 12.7+ gated by PRD OQ-23..26; production enable after 11.5
  epic-12: backlog
  12-1-rewards-contracts-msw-mock-domain: backlog
  12-2-voucher-marketplace-filters-detail: backlog
  12-3-confirm-redemption-result: backlog
  12-4-my-vouchers-code-qr-history: backlog
  12-5-admin-voucher-catalog-codes: backlog
  12-6-admin-flash-sale-rewards-stats: backlog
  12-7-rewards-schema-catalog-code-inventory-api: backlog
  12-8-quote-redemption-transaction: backlog
  12-9-flash-sale-lifecycle: backlog
  12-10-my-vouchers-reminders-faulty-code-resolution: backlog
  12-11-rewards-integration-without-mocks-enable-gate: backlog
  epic-12-retrospective: optional
```

## 5. Implementation Handoff

**Scope classification: Moderate.** This is a new epic and backlog reorganization with PRD and architecture amendments. It is not a fundamental replan, because the MVP and pilot launch are unchanged.

| Role (owner: Quan, solo) | Responsibility |
|---|---|
| PM / PO | Answer Open Questions 23, 25, and 26 before the gated backend stories. Get the OQ-24 accounting/tax answer from an external reviewer before production enable. |
| Architect | AD-24 is adopted. Review Story 12.8's design notes against AD-24 before dev. |
| SM | Create story files with `bmad-create-story`, starting with 12.1. |
| Developer | Implement 12.1 → 12.6 (FE mock), then 12.7 → 12.11 as gates clear. Use one BMAD code review per story. |

**Success criteria:**
- FE-mock flows match Figma pages 21–27 at 390 px and 1440 px, including every listed state.
- The PostgreSQL race tests in Story 12.8 pass: no oversell, no double charge, no Points lost on failure, and every journal balances.
- The Flash load test records p95 latency and shows zero oversell.
- Rewards stays behind a flag that is off by default until 11.5 is done and OQ-24 is recorded.

**Not in this change:** partner-API codes, tablet layout, a fifth mobile tab, fixes for the three existing design-system mismatches, and pulling Story 8.5 forward.

---

## Appendix A — PRD §4.20 (insert after §4.19)

### 4.20 Rewards — Voucher Redemption & Flash Sale (Phase 2)

> **Added 2026-10-13 by sprint-change-proposal-2026-10-13 (Phase 2, after pilot launch).** Design source: Figma Rescom pages 20–27; business rules BR-01…BR-24 in the planning doc "Rescom — Đổi điểm lấy voucher F&B & Flash Sale" (2026-10-13). Architecture: AD-24.

**Description:** Users spend Available Points on F&B partner vouchers, which becomes the second way to spend Points after publishing surveys. 1 Point ≈ 200 VNĐ, the top-up rate. Every Point in Available Balance can be redeemed, including topped-up Points and unlocked starter Points. Pending, Frozen, Escrow, and Integrity Hold Points can never be redeemed. Admins manage the catalog, code inventory, and time-boxed Flash Sales. Behavior that depends on Open Questions 23–26 stays gated until those questions are answered.

**Functional Requirements:**

#### FR-68: Voucher Catalog and Discovery
Users browse active vouchers, search by name or brand, filter by category, brand, point range, "on sale", and "I can afford", sort the results, and open a voucher detail page.

**Consequences (testable):**
- Every price is compared with the user's Available Balance, and the balance shown says that Pending Points are excluded
- User-facing states are Available, Sold Out, Expired (redemption window ended), and Paused. A Paused voucher stays listed with the redeem action disabled
- Hidden or archived vouchers are not listed, but vouchers already redeemed remain in the owner's account (BR-10)
- A voucher that has any redemption cannot be deleted, only hidden or archived (BR-24)

#### FR-69: Quote and Redemption
Opening the confirmation step creates a server quote. Confirming the quote redeems the voucher exactly once, at the locked price.

**Consequences (testable):**
- A quote returns `quoteId`, effective price, `priceVersion`, and an expiry no later than the quote TTL (Open Question 26) or the Flash Sale end
- The client creates one idempotency key per confirmation. Resending the same key returns the first result (BR-08)
- Redemption succeeds only if Available Balance ≥ the price at commit (BR-01). The price is resolved on the server at commit time in the order Flash > promotion > base. A `priceVersion` that differs from the quote returns `PRICE_CHANGED` with the new price (BR-11)
- A success posts exactly one balanced journal, USER_AVAILABLE → SYSTEM_SINK, for the integer price (BR-03). It decrements stock without ever going below zero (BR-04), assigns one unique code, and records one Redemption with its own RDM reference (BR-07, BR-14)
- Any failure rolls back Points, stock, and code assignment together (BR-09). The failed attempt is still recorded, without a journal (BR-07)
- Failure codes are `SOLD_OUT`, `PRICE_CHANGED`, `INSUFFICIENT_POINTS` (with the new balance), `VOUCHER_UNAVAILABLE`, and `ACCOUNT_NOT_ELIGIBLE`. Every failure message states that no Points were deducted
- Successful redemptions cannot be cancelled or refunded, except under FR-75 (BR-22)

#### FR-70: My Vouchers and Redemption History
Users see their redeemed vouchers as tickets, can use a code, and can review their redemption history.

**Consequences (testable):**
- Tabs are Unused, Used, and Expired. Tickets are sorted by nearest expiry, and Expiring is shown 7 days before expiry
- A ticket shows the code, a QR code, a copy action, and usage instructions
- The user can mark a voucher as used and undo it within 24 hours (Open Question 25)
- Reminders are sent 7 days and 1 day before expiry. An expired, unused voucher is not refunded (BR-23, Open Question 25)
- Redemption history shows Success, Failed, and Refunded entries, and each links to its ledger entry

#### FR-71: Flash Sale
Admins schedule time-boxed Flash Sales with a reserved quota at a lower price.

**Consequences (testable):**
- A Flash Sale applies only within `[start, end)` server time, in Asia/Ho_Chi_Minh. When it ends, sells out, or is ended early, the regular price returns immediately (BR-17)
- The Flash quota is reserved from regular stock at start, and unsold quota returns to stock at end. Start and end jobs run exactly once (BR-05)
- One voucher cannot be in two overlapping Flash Sales. The Flash price must be lower than the regular price, and the quota cannot exceed unreserved stock (BR-18)
- Each user may redeem at most N units per voucher per Flash Sale, default 1 (BR-19)
- Countdowns use server time. The client clock never decides the price

#### FR-72: Admin Voucher Management
Admins create, edit, pause, hide, and archive vouchers, with a card preview, and manage code inventory.

**Consequences (testable):**
- Codes are uploaded as CSV. A file is rejected if it contains duplicates within itself or codes already stored for that voucher (BR-15). Shared codes require an explicit `isShared` setting (BR-14)
- Stock can be reduced only within the unissued portion that is not reserved for Flash (BR-06)
- A price change applies only to redemptions after it is saved. Price history is append-only, and each redemption stores the price it used (BR-12)
- A point price that deviates more than 20% from value ÷ 200 VNĐ follows the approval rule in Open Question 23 (BR-13)
- Code expiry must be at least 7 days after the redemption window ends (BR-16, Open Question 25)
- Every Admin change is audited (FR-ADD-13)

#### FR-73: Admin Flash Sale Operations and Rewards Statistics
Admins create Flash Sales with a User Portal preview, monitor them, end them early, and view redemption statistics.

**Consequences (testable):**
- Scheduling rejects overlaps, a Flash price ≥ the regular price, and a quota above unreserved stock
- Monitoring shows Scheduled, Upcoming, Active, Sold Out, and Ended programs, with sold/quota counts
- Ending early requires confirmation. It returns unsold quota to stock, and users in confirmation receive `PRICE_CHANGED`
- Statistics show redemptions by day and by brand, Points spent, Flash Sale performance, and the self-reported usage rate, labelled as self-reported

#### FR-74: Redemption Limits and Abuse Controls
Redemption is limited per user and blocked for ineligible accounts.

**Consequences (testable):**
- Only activated accounts that are not locked can redeem. Accounts flagged in FraudLog cannot redeem in a Flash Sale (BR-21)
- Flash Sale eligibility requires at least one completed survey in the last 30 days, and Admin can disable this rule (BR-02)
- Per-user limits apply per voucher (default 2 per 30 days) and per day (default 500 Points), counted inside the redemption transaction (BR-20, Open Question 23)
- A redemption in a Flash Sale within 24 hours after a top-up creates a FraudLog flag for review. It does not block the redemption automatically

#### FR-75: Faulty Code Resolution
A user can report a code that does not work. An Admin resolves the report with a replacement code or a refund.

**Consequences (testable):**
- The report is linked to the Redemption and enters an Admin queue. Story 8.5 is deferred, so this queue is Rewards-owned
- Admin either issues a replacement code or refunds through an Economy reversal journal (`reversesJournalId`). Each report has at most one outcome
- The target resolution time is 1 business day (Open Question 25), and the user is notified of the outcome

## Appendix B — Epic 12 (insert into epics.md after Epic 11)

### Epic 12: Rewards — Voucher Redemption & Flash Sale (Phase 2)

**Goal:** Users spend Available Points (earned, top-up, or unlocked starter) on F&B partner vouchers, including time-boxed Flash Sales, and always see the locked price before any Point is deducted. Admins manage the catalog, code inventory, Flash Sales, and redemption statistics.

**FRs covered:** FR-68 … FR-75. **Architecture:** AD-24 (plus AD-1, AD-10, AD-16). Added by `sprint-change-proposal-2026-10-13.md`.

**Dependency and gate model:** Production enable follows Story 11.5 (pilot launch). FE-mock Stories 12.1–12.6 may start immediately and use the planning-doc defaults only inside MSW mocks. Backend gates: Story 12.7 requires PRD Open Question 25; Story 12.8 requires Open Questions 23 and 26; Story 12.11 (production enable) requires Open Question 24.

**UX source:** Figma Rescom (`mkudD5Ngi5RPyIAVxCcxXi`), pages 20–27. Components and tokens are on page 20 (node `113:3`); screens are on 21 (`113:4`), 22 (`113:5`), 23 (`113:6`), 24 (`113:7`), 25 (`113:8`), 26 (`113:9`), and 27 (`140:2`). Business rules are BR-01…BR-24 in the planning doc "Rescom — Đổi điểm lấy voucher F&B & Flash Sale" (2026-10-13).

**Out of scope:** Partner-API code issuance, a tablet layout, a fifth mobile tab, and fixes for the three existing design-system mismatches (TabBar "Tạo khảo sát", DesktopTopBar showing frozen instead of available points, and the non-component Admin sidebar). The mismatches are tracked separately.

#### Story 12.1: Rewards Contracts & MSW Mock Domain

As a Developer,
I want versioned Rewards contracts and a mock Rewards domain,
So that the User Portal and Admin screens can be built and reviewed before the backend exists.

**Acceptance Criteria:**

**Given** `packages/schemas`
**When** the Rewards contracts are added
**Then** Zod schemas exist for voucher (list item and detail), price and status, Flash Sale and Flash item, quote, redeem command (`quoteId` + `Idempotency-Key`), redemption result, my-voucher ticket, redemption history entry, code-issue report, and Admin voucher, Flash Sale, and statistics payloads.
**And** the error codes `SOLD_OUT`, `PRICE_CHANGED`, `INSUFFICIENT_POINTS`, `VOUCHER_UNAVAILABLE`, and `ACCOUNT_NOT_ELIGIBLE` are a closed enum, and `PRICE_CHANGED` and `INSUFFICIENT_POINTS` carry the new price or balance.
**And** the MSW mock repository seeds 7 vouchers across 4 categories and 6 brands, one active Flash Sale, a user with 186 Available and 18 Pending Points, and 3 unused tickets, and the mock `SCHEMA_VERSION` is bumped.
**And** mock handlers implement idempotent redeem (same key returns the first result) and can be switched to each failure code for UI review.
**And** contract spec tests cover every schema and error payload.

#### Story 12.2: Voucher Marketplace, Filters & Detail

As a User,
I want to browse vouchers and Flash Sales and see whether I can afford each one,
So that I can choose what to redeem with my Points.

**Acceptance Criteria:**

**Given** a signed-in, activated user
**When** they open Đổi quà (under the Ví điểm tab on mobile, or the fourth top-bar item on desktop)
**Then** the page shows the Available Balance card ("Dùng được cả điểm nạp. N điểm chờ duyệt chưa được tính."), search, category chips, the Flash Sale strip with a Countdown, and the voucher list, matching Figma page 21 at 390 px and 1440 px (FR-68).
**And** the filter opens as a bottom sheet on mobile and a 264 px left column on desktop, with category, brand, point range, "Chỉ voucher đang giảm giá", and "Chỉ voucher tôi đủ điểm đổi", plus a sort control.
**And** Loading (skeleton, no layout shift), Empty (with suggestions), and Error (retry; "Điểm và voucher của bạn vẫn an toàn") states are implemented.
**And** voucher detail (page 22) shows the Enough, Not enough (suggests both surveys and top-up), and Sold out states, plus the regular price when Flash is sold out but stock remains.
**And** Countdown uses server time from the API and announces to screen readers only when the minute changes; status is always shown as text, and progress bars always show numbers.
**And** new components VoucherCard (Row/Tile × Default/Sale/Sold out/Expired), FlashSaleCard (Upcoming/Active/Ended/Sold out), Countdown, Toggle, and SegmentedControl reuse existing tokens; `color/sale/*` is added as an alias to existing red; touch targets are at least 44 px, including chips.

#### Story 12.3: Confirm & Redemption Result

As a User,
I want to confirm the exact price before Points are deducted and get a clear result,
So that I never lose Points by mistake.

**Acceptance Criteria:**

**Given** a voucher the user can redeem
**When** they tap Đổi ngay
**Then** a quote is requested and a confirmation opens (bottom sheet on mobile, dialog on desktop) showing the locked price, balance after redemption, and the Flash price end time (page 23, FR-69).
**And** one idempotency key is created when the confirmation opens; the confirm button locks after the first tap; resubmitting returns the first result.
**And** success shows the ticket summary, the balance counting down in 400 ms, and a mascot with light confetti in 600 ms, all disabled under reduced motion.
**And** `SOLD_OUT`, `PRICE_CHANGED` (shows the new price and asks to confirm again), and `INSUFFICIENT_POINTS` (shows the new balance) have their own screens; `VOUCHER_UNAVAILABLE` and `ACCOUNT_NOT_ELIGIBLE` use the shared error sheet; every error says "bạn chưa bị trừ điểm" and offers one next action.
**And** on network loss the client polls by idempotency key 3 times (after 2, 4, and 8 seconds), then shows "Đang kiểm tra kết quả".
**And** the confirmation traps focus and returns focus to Đổi ngay when closed.

#### Story 12.4: My Vouchers, Code/QR & History

As a User,
I want to see my vouchers and use their codes at the counter,
So that I can actually claim what I redeemed.

**Acceptance Criteria:**

**Given** a user with redeemed vouchers
**When** they open Voucher của tôi
**Then** tickets (VoucherTicket: Unused, Expiring, Used, Expired) appear in Unused, Used, and Expired tabs, sorted by nearest expiry, with an Empty state (page 24, FR-70).
**And** opening a ticket shows the code, a QR code, a copy action, store instructions, and expiry.
**And** the user can mark a ticket as used and undo it within 24 hours.
**And** "Báo mã lỗi" creates a code-issue report and shows its status (FR-75).
**And** redemption history shows Success, Failed, and Refunded entries.
**And** the header badge shows the unused count.

#### Story 12.5: Admin Voucher Catalog & Codes

As an Admin,
I want to create vouchers, upload codes, and manage stock and price,
So that the catalog stays accurate and never oversells.

**Acceptance Criteria:**

**Given** an Admin in the Admin console
**When** they open Voucher (new sidebar entry; AdminSidebar becomes a component with Voucher, Flash Sale, and Thống kê voucher)
**Then** the list shows each voucher's status, stock, price, and visibility toggle, plus an action menu with pause, hide, and archive (page 25, FR-72).
**And** create/edit shows a live VoucherCard preview and field-level validation (code expiry at least 7 days after the redemption window, shared-code flag).
**And** CSV upload reports in-file duplicates and already-stored codes before saving.
**And** stock adjustment cannot go below issued plus Flash-reserved units, and a price change shows that it applies only to future redemptions.
**And** voucher detail shows stock, price history, and redemption history.

#### Story 12.6: Admin Flash Sale & Rewards Statistics

As an Admin,
I want to schedule and monitor Flash Sales and see redemption statistics,
So that I can run promotions safely and measure them.

**Acceptance Criteria:**

**Given** an Admin
**When** they create a Flash Sale
**Then** the form validates overlap, Flash price below the regular price, and quota within unreserved stock, and it previews the result with the User Portal FlashSaleCard (page 26, FR-73).
**And** monitoring shows all five program states with sold/quota counts.
**And** Kết thúc sớm requires a confirmation dialog that explains that quota returns to stock and the price returns to regular.
**And** the statistics dashboard (page 27) shows 5 KPIs, redemptions by day, redemptions by brand, and Flash Sale performance; the usage rate is labelled as self-reported.

#### Story 12.7: Rewards Schema, Catalog & Code Inventory API

As a Developer,
I want the Rewards module, data model, and Admin catalog API,
So that the catalog and code inventory are durable and consistent.

**Acceptance Criteria:**

**Given** PRD Open Question 25 is answered
**When** the Rewards module and migrations are added
**Then** Rewards owns Voucher, VoucherPriceVersion (append-only), VoucherCode, FlashSale, FlashSaleItem, RedemptionQuote, Redemption (append-only), and CodeIssueReport (AD-24, AD-16).
**And** the database enforces `remaining >= 0`, unique `(voucherId, code)`, unique `VoucherCode.redemptionId`, and RESTRICT delete on vouchers with redemptions (BR-04, BR-14, BR-15, BR-24).
**And** the Admin API supports create, edit, pause, hide, archive, CSV code import with dedup, and stock adjustment within the unissued, unreserved portion (BR-06), and every change is audited (FR-ADD-13).
**And** a price change writes a new price version and never rewrites a past redemption (BR-12); the BR-13 deviation rule follows the Open Question 23 decision.
**And** user catalog endpoints return effective price, status, and server time, and match the Story 12.1 contracts.
**And** the full migration chain applies from an empty database and from the previous snapshot.

#### Story 12.8: Quote & Redemption Transaction

As a User,
I want my redemption to be exact and safe under concurrency,
So that I am charged once, at the agreed price, or not at all.

**Acceptance Criteria:**

**Given** PRD Open Questions 23 and 26 are answered
**When** the user requests a quote
**Then** the server returns `quoteId`, effective price (Flash > promotion > base), `priceVersion`, and an expiry no later than the quote TTL or the Flash end, after checking eligibility (BR-02, BR-21).
**And** `RedeemVoucher` follows AD-24 in one transaction: idempotency lookup, lock Voucher then FlashSaleItem, compare `priceVersion`, conditional stock decrement, claim one code with `FOR UPDATE SKIP LOCKED`, Economy `SpendPoints` keyed `redemption:{idempotencyKey}` (USER_AVAILABLE → SYSTEM_SINK, ledger accounts locked by ascending id), Redemption SUCCEEDED plus Outbox event, then commit.
**And** per-user limits (per voucher per 30 days, per day in Points, Flash cap) are counted inside the transaction after the wallet lock (BR-19, BR-20).
**And** any failure rolls back everything; the failed attempt is recorded in a separate transaction with no journal (BR-07, BR-09).
**And** a Flash redemption within 24 hours after a top-up creates a FraudLog flag but is not blocked.
**And** PostgreSQL integration tests prove: two users racing for the last unit (one success, one `SOLD_OUT`, no deduction); a double submit with the same key (one journal); balance changed between quote and confirm (`INSUFFICIENT_POINTS`); price changed or Flash ended (`PRICE_CHANGED`); stock > 0 with no free code (rollback, Admin alert, `SOLD_OUT` to the user); ledger sum per journal is zero.

#### Story 12.9: Flash Sale Lifecycle

As an Admin,
I want Flash Sales to start and end automatically and correctly,
So that quota and price are always right without manual work.

**Acceptance Criteria:**

**Given** a scheduled Flash Sale
**When** its start time arrives
**Then** an idempotent job on the existing in-process scheduler reserves the quota from regular stock (BR-05).
**And** at end, sell-out, or early end, the regular price applies immediately and unsold quota returns to stock exactly once (BR-05, BR-17).
**And** the Admin Flash API rejects overlapping windows, a Flash price ≥ the regular price, and a quota above unreserved stock (BR-18).
**And** windows use server time in Asia/Ho_Chi_Minh and `[start, end)` boundaries.
**And** the per-user cap is enforced with unique `(flashItemId, userId)` when the cap is 1 (BR-19).
**And** job reruns and scheduler restarts do not double-reserve or double-return quota.

#### Story 12.10: My Vouchers, Reminders & Faulty-Code Resolution

As a User,
I want reminders before my vouchers expire and a fix when a code fails,
So that I do not lose what I redeemed.

**Acceptance Criteria:**

**Given** redeemed vouchers
**When** the user opens Voucher của tôi or the redemption history
**Then** the API returns tickets by tab and nearest expiry, plus history with Success, Failed, and Refunded entries, matching the Story 12.1 contracts (FR-70).
**And** mark-used is allowed with undo within 24 hours.
**And** reminders 7 days and 1 day before expiry are emitted through the Outbox to the existing notification system (AD-10).
**And** a code-issue report enters a Rewards-owned Admin queue; Admin resolves it with either a replacement code or a refund keyed `redemption-refund:{caseId}` through an Economy reversal journal, at most one outcome per report, and the user is notified (FR-75, BR-22).
**And** expired, unused vouchers are not refunded (BR-23).

#### Story 12.11: Rewards Integration Without Mocks & Enable Gate

As the Product Owner,
I want Rewards proven end to end on the real stack before it is enabled,
So that the pilot economy is not put at risk.

**Acceptance Criteria:**

**Given** Stories 12.1–12.10 are done
**When** Rewards journeys run with mocks disabled
**Then** browse, redeem (success and every failure code), my vouchers, faulty-code resolution, Admin catalog, Flash Sale, and statistics pass against the real backend.
**And** the statistics API backs the Admin dashboard.
**And** a load test of concurrent redemptions on one Flash voucher at start time records p95 latency and confirms no oversell and no double charge on the pilot VPS profile.
**And** Rewards sits behind a feature flag that is off by default; production enable requires the PRD Open Question 24 decision (accounting and tax) to be recorded, and the Ví điểm copy says that Points are never withdrawn as cash.
