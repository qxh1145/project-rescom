---
stepsCompleted: [step-01-document-discovery, step-02-prd-analysis, step-03-epic-coverage-validation, step-04-ux-alignment, step-05-epic-quality-review, step-06-final-assessment]
focus: Epic 13 (PayOS auto top-up + refund)
filesIncluded:
  - prds/prd-project-rescom-2026-08-08/prd.md
  - prds/prd-project-rescom-2026-08-08/addendum.md
  - architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md
  - architecture/architecture-project-rescom-2026-08-08/solution-design.md
  - epics.md
  - ux-designs/ux-project-rescom-2026-09-14/DESIGN.md
  - ux-designs/ux-project-rescom-2026-09-14/EXPERIENCE.md
---
# Implementation Readiness Assessment Report

**Date:** 2026-10-15
**Project:** project-rescom

**Focus:** Epic 13 — PayOS auto top-up + refund

## Document Inventory

| Type | File | Notes |
|---|---|---|
| PRD | prds/prd-project-rescom-2026-08-08/prd.md (104.7K) | sharded folder; review/reconcile files excluded |
| PRD | prds/prd-project-rescom-2026-08-08/addendum.md (14.4K) | |
| Architecture | architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md (67.5K) | |
| Architecture | architecture/architecture-project-rescom-2026-08-08/solution-design.md (34.6K) | |
| Epics | epics.md (151.9K) | whole |
| UX | ux-designs/ux-project-rescom-2026-09-14/DESIGN.md, EXPERIENCE.md | near-empty pointers |

Excluded: architecture/RESCOM-Architecture-V2.archive.md (archive). No whole/sharded duplicates. No project-context.md found.

## PRD Analysis

Scope: Epic 13 (PayOS). Full PRD read for §4.10 plus every PayOS/top-up/refund cross-reference. Addendum covers the Research Integrity Engine only; not relevant to Epic 13.

### Functional Requirements (Epic 13 scope)

- **FR-34 Top-Up Checkout through PayOS** — VNĐ amount on `/wallet`; amount 10,000–5,000,000, multiple of 200, rejected before any PayOS call; Points = amount ÷ 200 server-side; unique order code per top-up; max one Processing top-up per user; PayOS payment expires after 5 min; user can cancel own Processing top-up (PayOS cancel → Cancelled); success and cancel both return to `/wallet`.
- **FR-35 Automatic Crediting** — only verified confirmations with matching order code and amount credit; status + ledger + notification atomic; idempotent on repeated confirmations; retry/reconcile until credited, Admin alert if uncredited 30 min after confirmation; late full-amount payment on Cancelled/Expired credits and moves to Successful; amount mismatch credits nothing, is flagged, Admin credits floor(amount ÷ 200) or refunds manually, remainder <200 VNĐ stated in notification; Admin manual re-check against PayOS at any time via same idempotent path; mismatch resolution SLA 3 business days with Admin alert.
- **FR-76 Top-Up Status on Wallet** — statuses Processing, Successful, Cancelled, Expired, Refund Requested, Refunded, Refund Rejected; Processing self-updates; Cancelled/Expired change no balance; every status change notifies the user.
- **FR-77 Refund Request** — own Successful top-up only, within 24 h of payment time (server-computed, exclusive); Admin-credited mismatch top-ups not refundable in-app; ban does not release Refund Hold; one request per top-up, no resubmission after reject/withdraw; user withdrawal returns hold, status back to Successful, Admin notified; read-only prefill (transaction code, amount, Points, time, email, destination); destination = PayOS-reported paying account (masked), not editable; unverified-destination path; reason enum + mandatory note ≤300 chars; submission time recorded, email to Admin refund mailbox, user notified; eligible → Points move Available → Refund Hold; ineligible recorded without hold; Available < top-up Points → Not eligible; eligibility check + hold atomic with spending.
- **FR-78 Refund Eligibility and Admin Resolution** — eligible = within 24 h and no Point-spending transaction (publish, reopen, voucher redemption) between top-up and submission; Admin sees verdict + reason; Refunded only with hold, via top-up reversal ledger entry linked to original; mark Refunded before transfer, bank reference/time optional and added later, shown to user; withdrawal vs resolution race → later refused "request already resolved"; CSV export by date range without account numbers, audit-logged; mailbox email masks account to last 4 digits and links to Admin Panel; Rejected needs reason, releases hold; no negative balance; resolution SLA 3 business days with alert; manual refund without hold recorded as Rejected with note, no balance change; RESCOM never moves money; every resolution notifies user and is audit-logged.
- **FR-79 Retirement of Manual Top-Up** — all pending manual requests resolved (approve/reject + notify) before PayOS enable; enable blocked while any pending; manual form and approval queue removed; historical manual top-ups remain visible.

Related FRs touched by Epic 13:
- **FR-31 Wallet Dashboard** — adds Refund Hold balance and top-up / top-up reversal history types.
- **FR-56 Transaction Dashboard** — PayOS top-ups by status, open refund requests.
- **FR-57 Event Notifications** — every top-up and refund status change; email for top-up.
- **FR-30 Ledger** — top-up reversal must be append-only, double-entry.

Total Epic 13 FRs: 6 primary (FR-34, FR-35, FR-76, FR-77, FR-78, FR-79) + 4 touched (FR-30, FR-31, FR-56, FR-57).

### Non-Functional Requirements (Epic 13 scope)

- **NFR-31** — PayOS credentials server-side only; confirmations accepted only after signature verification; never trusted from client or redirect parameters.
- **NFR-32** — reconciliation job every 1 min over all Processing top-ups and top-ups expired within the last 24 h; later payments credited only via PayOS confirmation (FR-35).
- **NFR-3 / NFR-9 / NFR-11** — ACID, row-level locking, no duplicated or lost Points.
- **NFR-7** — throttling on all API endpoints (applies to checkout/cancel/refund endpoints).
- **NFR-8** — server-side authority for point calculations.
- **NFR-20** — UI-heavy stories gated on a canonical UX artifact.

### Additional Requirements and Constraints

- UJ-5 and UJ-6 define the user and Admin journeys.
- Glossary: Refund Hold is non-spendable and distinct from Frozen.
- §5 Non-Goals: PayOS only for Point top-ups; no cash-out except the 24 h refund.
- OQ-27 (owner Quan) gates PayOS production enable: personal-account fees, limits, terms, tax.
- OQ-28: late and wrong-amount behavior decided 2026-10-15; open only for confirmation against real PayOS behavior.
- OQ-24: Rewards accounting/tax interacts with refundable top-up Points.

### PRD Completeness Assessment

The Epic 13 scope is detailed and testable. Every FR has explicit consequences, and the edge cases (late payment, mismatch, race conditions, ban, withdrawal) are covered. Issues found:

1. **Contradiction (minor):** Compliance §Constraints says Points "cannot be bought, sold, or transferred". FR-34 is a purchase of Points. The wording predates PayOS and needs an amendment such as "cannot be sold or transferred between accounts".
2. **Journey drift (minor):** UJ-5 step 2 gives the minimum and the multiple of 200 but omits the 5,000,000 VNĐ maximum from FR-34.
3. **Ambiguity:** the FR-78 "Point-spending transaction" list (publish, reopen, voucher redemption) is closed. Future spend types are not covered by default. The FR-77 balance check (Available < top-up Points → Not eligible) partly guards this.
4. **Ambiguity:** "business days" in the 3-business-day SLAs (FR-35, FR-78) has no holiday calendar or timezone. Implementation needs a rule, for example Mon–Fri Asia/Ho_Chi_Minh with no holidays.
5. **Gap:** FR-34 does not say what happens when PayOS payment creation fails or times out. The user-facing error, and whether a top-up row exists, are undefined.
6. **Gap:** FR-76 has no status for an amount-mismatch top-up awaiting Admin action (Flagged / Under review). The user-visible status during mismatch handling is undefined.

## Epic Coverage Validation

The epics FR Coverage Map assigns FR-34, FR-35 (amended), FR-31 (amend), FR-76, FR-77, FR-78, FR-79, NFR-31 and NFR-32 to Epic 13. Epic 6 keeps FR-34/FR-35 as legacy manual, superseded. FR-56 and FR-57 stay mapped to Epic 9.

### Coverage Matrix

| FR | PRD requirement (short) | Epic coverage | Status |
|---|---|---|---|
| FR-34 | PayOS checkout, bounds, 1 Processing, 5-min expiry, user cancel | 13.1 (DB checks, partial unique), 13.2 (create, expiredAt), 13.3 (validation, 409, cancel), 13.7 (UI) | ✓ Covered |
| FR-35 | Verified credit, atomic, idempotent, late payment, mismatch, alerts, re-check, SLA | 13.4, 13.5, 13.8 (re-check UI), 13.9 | ✓ Covered |
| FR-76 | 7 statuses, Processing self-updates, every change notifies | 13.7, 13.11; statuses split across `TopUpStatus` + `TopUpRefundRequest` | ⚠ Partial — see gaps G1–G3 |
| FR-77 | Refund request, destination, hold, withdrawal, atomic with spend | 13.6 (destination probe), 13.10, 13.11 | ✓ Covered |
| FR-78 | Eligibility, Refunded/Rejected, race, CSV, mailbox masking, SLA, audit | 13.8 (CSV), 13.10, 13.12 | ✓ Covered |
| FR-79 | Retire manual flow, enable guard, history visible | 13.3 (guard, pre-deploy script), 13.13 | ✓ Covered |
| FR-31 (amend) | 6 balances incl. Refund Hold; history types top-up / top-up reversal | 13.7 (6 cards) | ⚠ Partial — see G4 |
| FR-30 | Append-only double-entry | 13.4 (`ReverseJournal` forbidden), 13.10, 13.12 (linked journals) | ✓ Covered |
| FR-56 (amend) | Dashboard: PayOS top-ups by status, open refund requests | Epic 9 (pre-amendment); 13.8 B1 tab count badges | ⚠ Partial — see G5 |
| FR-57 (amend) | Notify every top-up/refund change; email for top-up | 13.4/13.5/13.9/13.10/13.12 via Outbox (in-app) | ⚠ Partial — see G6 |
| NFR-31 | Server-side secrets, signature-verified confirmations only | 13.2, 13.4, 13.7 (no URL trust) | ✓ Covered |
| NFR-32 | 1-min reconciliation | 13.5 (scope is wider than the PRD: adds CANCELLED + AMOUNT_MISMATCH) | ✓ Covered (epics stricter) |

### Missing / Partial Requirements

No Epic 13 FR is missing outright. Six partial gaps:

- **G1 (Low; AD-25 covers it: "Every transition … writes its user notification to the Outbox") — FR-76 "every status change notifies the user":** Story 13.3 user cancel and create-failure → `CANCELLED` have no notification AC. UX-DR-P10 covers cancelled, but the backend story does not emit it for a user cancel. Recommendation: add an AC to 13.3, or amend the PRD to exempt user-initiated cancel.
- **G2 (Low; AD-25 projection maps `MANUAL_REFUNDED` → Refunded) — FR-76 statuses vs `MANUAL_REFUNDED`:** a mismatch refunded manually (`MANUAL_REFUNDED`) has no user-facing chip in UX-DR-P1 or Story 13.7. The PRD status list does not include it either. Recommendation: define the label (e.g. "Đã hoàn tiền") in PRD FR-76 and UX-DR-P1.
- **G3 (Low) — FR-76 Processing self-update on `/wallet`:** Story 13.7 specifies polling only on `/wallet/top-up/:id`. UX-DR-P3 asks for a self-updating banner on `/wallet`, but no story AC covers it. Recommendation: add an AC to 13.7.
- **G4 (Medium) — FR-31 transaction-history types:** no story adds Refund Hold placed/released or top-up reversal as types in the point-history list (Story 6.x, FR-56 history at line ~1039). Recommendation: add an AC to 13.10/13.12 for the history projection labels.
- **G5 (Low) — FR-56 amendment:** the Admin Transaction Dashboard (Epic 9) is not updated with PayOS-by-status and open-refund metrics. 13.8 count badges partly satisfy it. Recommendation: accept the B1 badges as FR-56 coverage and record that in the map, or add an AC.
- **G6 (Medium) — FR-57 email for top-up:** the PRD lists top-up as a critical email event. Epic 13 stories email only the Admin mailbox. The user's channel is "notification … Outbox" with no explicit email. Recommendation: state in 13.4/13.10/13.12 which user events also email (at least Successful, Refunded, Rejected), or amend FR-57.

### Coverage Statistics

- Epic 13 scope FRs: 10 (6 primary + 4 touched)
- Fully covered: 6 (FR-30, FR-34, FR-35, FR-77, FR-78, FR-79)
- Partially covered: 4 (FR-31, FR-56, FR-57, FR-76)
- Missing: 0
- NFRs in scope: NFR-31, NFR-32 covered
- Coverage: 100% traced, 60% fully covered

## UX Alignment Assessment

### UX Document Status

- `ux-designs/ux-project-rescom-2026-09-14/DESIGN.md` and `EXPERIENCE.md` are empty stubs: frontmatter only, `status: in-progress`.
- The working UX source for Epic 13 is UX-DR-P1…P25 in `epics.md` plus Figma `mkudD5Ngi5RPyIAVxCcxXi` (pages 29, 30, 20; rules frame `191:3079`) and `docs/frontend/design-system.md`.
- The epics state: "A designer fix pass (6 balance cards, paying-account refund destination, mismatch SLA, read-only B4) is pending; implement the fixed version."

### UX ↔ PRD Alignment

- UJ-5 and UJ-6 map cleanly to A1–A8 and B1–B4. Every FR-34…FR-79 consequence that needs UI has a UX-DR: bounds (P4), cancel (P16), Processing polling (P5, P24), statuses (P1), refund form and destination (P7), withdrawal (P18), conflict (P25), CSV (P20), re-check (P21), mark-before-transfer (P22), server deadline (P23), FR-79 banner (P14).
- **U1 (Low):** the PRD (FR-34, UJ-5) says success and cancel return to `/wallet`. UX-DR-P5 and Story 13.7 return to `/wallet/top-up/:id`. The UX choice is better, because it shows the result. Amend the FR-34 wording.
- **U2 (Low):** UX-DR-P1 lists 7 chips plus Under review. AD-25 maps `MANUAL_REFUNDED` → Refunded, and UX-DR-P9 says Refunded means "Points removed, link to reversal entry". For `MANUAL_REFUNDED` no Points were credited or removed. Copy and the reversal link must differ for that case. No UX-DR covers it.
- **U3 (Low):** the UX-DR-P10 notification list omits withdrawn and mismatch-credited. Stories 13.11 and P23 add them. Consistent overall.
- **U4 (Low):** UJ-5 omits the 5,000,000 VNĐ maximum. UX-DR-P4 includes it.

### UX ↔ Architecture Alignment

- The AD-25 wallet status projection (`SUCCESSFUL` + refund state; `AMOUNT_MISMATCH` → Under review; `MANUAL_REFUNDED` → Refunded) supports the UX-DR-P1 chips.
- The server `refundDeadline` (AD-26) supports the P23 countdown. The 409 `REFUND_ALREADY_RESOLVED` supports P25. "Never trust URL params" (AD-25) supports P5.
- The B4 read-only flag chip matches AD-25 "enabled by server config only — no UI toggle".
- **U5 (Medium):** UX-DR-P3 and FR-76 require a self-updating Processing banner on `/wallet`. AD-25 defines no push channel, so this means polling. Story 13.7 defines polling only on the detail page. Add a `/wallet` banner polling AC, or reuse the same query.

### Warnings

- **W1 (High, precondition):** the Figma designer fix pass is pending. Stories 13.7, 13.8, 13.9, 13.11, 13.12 and 13.13 all open with "Given the fixed Figma page/frames". UI stories are not ready until the fix pass lands and the frames are re-verified. Backend stories 13.1–13.6 and 13.10 are unaffected.
- **W2 (Medium):** NFR-20 gates UI-heavy stories on a canonical UX artifact. The UX spine is still an empty stub. The UX-DR list plus Figma is a de facto contract. Record that decision explicitly, or NFR-20 stays formally unmet.
- **W3 (Low):** UX-DR-P15 uses placeholder PayOS and bank logos. This is gated in 13.13 and does not block development.

## Epic Quality Review (Epic 13)

### Epic structure

- **User value:** ✓. The title and goal describe user and Admin outcomes: instant top-up, cancel, 24 h refund, Admin resolution, safe switch-over.
- **Independence:** ✓. Epic 13 depends only on earlier, done epics: Epic 6 ledger, Epic 9 and IR notifications plus Outbox email, Epic 12 redemption spend path and flag pattern, AD-17 scheduler. No dependency on a later epic.
- **Brownfield fit:** ✓. It extends `TopUpRequest` instead of adding a second entity. The migration is proven against the production snapshot (13.1). Regression suites for Epic 6 and Epic 12 are required (13.10).
- **Sprint tracking:** ⚠ Epic 13 and stories 13.1–13.13 are absent from `implementation-artifacts/sprint-status.yaml`, and no story files exist yet. Run sprint planning or add the entries before `bmad-create-story`.

### Dependency map (within epic)

13.1 → 13.2 → 13.3 → 13.4 → 13.5 → 13.6 (prod probe) → 13.10 → 13.11 / 13.12; 13.7 needs 13.3–13.5; 13.8 needs 13.5; 13.9 needs 13.4 + 13.8; 13.13 needs 13.1–13.12 + OQ-27.

- No forward dependencies. Forward mentions ("refund section hidden until 13.11", "13.12 adds refund columns", "approve/reject stay until 13.13") are scoped deferrals, not blockers. ✓
- Entity timing: ✓. `TopUpRequest` fields are added in 13.1. `TopUpRefundRequest` and `REFUND_HOLD` are added in 13.10, when first needed.

### 🔴 Critical Violations

None.

### 🟠 Major Issues

- **Q1 — No owner for the payOS account/credentials/webhook-registration setup.** Story 13.6 starts with "Given … the webhook registered through `confirm-webhook`". No earlier story has an AC that creates the payOS payment channel, puts `PAYOS_*` keys in `deploy/.env.prod`, or runs `confirm-webhook` against `app.rescom.io.vn/api/...`. 13.13 checks the secrets only at the end. Remediation: add these as ACs to 13.4 or 13.6, with Owner-run steps listed like the existing VPS procedure.
- **Q2 — 13.10–13.12 scope depends on a 13.6 outcome.** If `counterAccount*` turns out null, FR-77 may change, and the refund stories could be re-planned. This is accepted by design ("revisit FR-77"). Do not create story files 13.10–13.12 until 13.6 records its result.
- **Q3 — UI stories gated on the pending Figma fix pass** (W1): 13.7, 13.8, 13.9, 13.11, 13.12, 13.13.
- **Q4 — Story sizing.** Story 13.7 bundles 6-card Wallet, top-up form, return page with polling, detail page, notifications, desktop and mobile. Story 13.10 bundles the refund domain, spend-journal classification, concurrency proofs, and error-message changes in 3 other flows. Both are large but cohesive. Consider splitting 13.7 into "Wallet balances + history" and "Top-up form + return/detail", and moving the 13.10 UX-DR-P19 message changes into 13.11, which already repeats them.
- **Q5 — Technical stories.** 13.1 (schema) and 13.2 (adapter) are "As a Developer" stories with no user value alone. They are acceptable as brownfield enablers with tests and boundary lint, but they break the user-story rule. Alternative: merge 13.1 into 13.3. Low priority; keeping them is pragmatic.

### 🟡 Minor Concerns

- **Q6 —** 13.3 does not specify behavior when the payOS cancel call fails on a user cancel: does the row still become `CANCELLED`, or does the user get an error? The AD-25 order is "cancel through port, then CANCELLED". Specify one, e.g. local `CANCELLED` regardless, with late payment credited via the existing path.
- **Q7 —** 13.3 has no throttle AC on checkout/cancel. A create→cancel loop can spam payOS link creation and the `orderCode` sequence. NFR-7 has a global throttler, but the webhook explicitly skips it. Add a per-user limit AC on checkout, e.g. N per 10 minutes.
- **Q8 —** 13.4 does not say what a valid-signature webhook with `code` ≠ `"00"` does. The mapping implies 200 no-op. State it.
- **Q9 —** 13.5 sends alerts to `TOPUP_REFUND_MAILBOX` before 13.10 introduces the mailbox. Name the config key in 13.5 so its owner is clear.
- **Q10 —** G1–G6 and U1–U5 above. These are mostly one-line AC additions: user-cancel notification, `/wallet` banner polling, history labels for hold/reversal, FR-57 user email channel, `MANUAL_REFUNDED` copy.
- **Q11 —** PRD hygiene: Compliance "Points cannot be bought" contradicts FR-34. FR-34 return URL `/wallet` vs `/wallet/top-up/:id`. UJ-5 omits the maximum. The AD-26 eligibility bullet "not credited through `ResolveTopUpMismatch`" is mis-indented.

### Best-practices checklist (Epic 13)

- [x] Epic delivers user value
- [x] Epic functions independently (on earlier epics only)
- [~] Stories appropriately sized (13.7, 13.10 large)
- [x] No forward dependencies
- [x] Database tables created when needed
- [~] Clear acceptance criteria (minor gaps Q6–Q9)
- [x] Traceability to FRs maintained (FR tags on ACs)

## Summary and Recommendations

### Overall Readiness Status

**NEEDS WORK.** Readiness is split by story group:

| Group | Stories | Status |
|---|---|---|
| Backend foundation | 13.1, 13.2, 13.3, 13.4, 13.5 | **READY** once Q1 (payOS setup owner) and the small AC additions Q6–Q8 are applied |
| Prod probe | 13.6 | Ready after 13.1–13.5 are deployed and Q1 is resolved |
| Refund backend | 13.10 | **BLOCKED** on the 13.6 result (Q2) |
| UI stories | 13.7, 13.8, 13.9, 13.11, 13.12 | **BLOCKED** on the Figma designer fix pass (W1) |
| Prod enable | 13.13 | **BLOCKED** on OQ-27 (by design) |

No critical violations were found. FR traceability is complete: every Epic 13 FR and NFR maps to a story.

### Critical Issues Requiring Immediate Action

1. **Q1:** no story owns payOS channel creation, `PAYOS_*` prod secrets, or `confirm-webhook` registration before Story 13.6.
2. **W1 / Q3:** the Figma fix pass is pending, which blocks 6 UI stories.
3. **Sprint tracking:** Epic 13 is not in `sprint-status.yaml`.

### Recommended Next Steps

1. Add to `epics.md`: a Q1 setup AC in 13.4 or 13.6; Q6 cancel-failure behavior, Q7 checkout throttle and Q8 non-"00" webhook in 13.3/13.4; G1 cancel notification; G3/U5 `/wallet` banner polling in 13.7; G4 history labels for Refund Hold and top-up reversal; G6 user email channel for top-up events.
2. Fix PRD hygiene (one edit pass): the Compliance "cannot be bought" line, the FR-34 return URL, the UJ-5 maximum, the FR-76 `MANUAL_REFUNDED` display, and the AD-26 indentation.
3. Run `bmad-sprint-planning` to add Epic 13. Then `bmad-create-story` 13.1 on a new branch `feat/13-1-...` from `origin/develop`.
4. Do not create story files for 13.10–13.12 until 13.6 records `counterAccount*`. Do not create UI story files until the Figma fix pass lands.
5. Optional: split 13.7 into two stories, and move the UX-DR-P19 message changes from 13.10 into 13.11 (Q4).

### Final Note

This assessment found 29 findings across 4 categories: PRD 6, coverage 6, UX 8 (5 alignment + 3 warnings), story quality 9. Some overlap. None is critical. Three items need action before or early in implementation: Q1, W1 and sprint tracking. The backend foundation (13.1–13.5) can start after the small AC additions.

**Assessor:** Claude (PM role, bmad-check-implementation-readiness) — 2026-10-15
