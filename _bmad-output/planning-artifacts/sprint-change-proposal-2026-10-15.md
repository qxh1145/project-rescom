# Sprint Change Proposal — Epic 13 PayOS Readiness Fixes

**Date:** 2026-10-15
**Project:** project-rescom
**Author:** Claude (bmad-correct-course), Owner Quan
**Mode:** Incremental — all 10 proposals approved individually
**Status:** Approved 2026-10-15 by Quan; edits P1–P10 applied

## 1. Issue Summary

The implementation readiness check for Epic 13, PayOS Top-Up & 24-Hour Refund (`implementation-readiness-report-2026-10-15.md`), returned **NEEDS WORK**. It found 29 findings and none was critical. The issue was found before implementation, and no Epic 13 code or story file exists yet.

Main problems:

- **Q1:** No story owns the payOS channel creation, the `PAYOS_*` production secrets, or the `confirm-webhook` registration that Story 13.6 assumes.
- **Missing ACs:**
  - user-cancel notification (G1);
  - payOS cancel-failure behavior (Q6);
  - checkout throttle (Q7);
  - a webhook with a valid signature but a non-`"00"` code (Q8);
  - the owner of `TOPUP_REFUND_MAILBOX` (Q9);
  - `/wallet` Processing polling (G3/U5);
  - `MANUAL_REFUNDED` display (G2/U2);
  - Point-history labels (G4);
  - the user email channel for top-up events (G6).
- **PRD hygiene:**
  - The Compliance line "cannot be bought" contradicts FR-34.
  - The FR-34 and UJ-5 return URLs do not match the UX.
  - UJ-5 omits the maximum amount.
  - FR-76 has no status for a mismatch.
  - FR-34 does not cover payment-creation failure.
  - "Business days" is undefined.
- **Architecture:** the AD-26 eligibility bullet is mis-indented.
- **Tracking:** Epic 13 is absent from `sprint-status.yaml`.
- **UX:**
  - The Figma designer fix pass is pending (W1).
  - NFR-20 names no canonical UX artifact (W2).

Category: a specification gap found during readiness review. It is not a pivot or a technical failure.

## 2. Impact Analysis

- **Epic impact:** Only Epic 13 is affected. Its structure, story count, and order are unchanged. Epic 9 is untouched; the FR-56 amendment is mapped to the Story 13.8 badges.
- **Story impact:** Story 13.3, 13.4, 13.5, 13.6, 13.7, 13.10, and 13.12 gain or reword ACs.
- **Artifact conflicts:**
  - PRD: Compliance, UJ-5, FR-34, FR-35, FR-76, and FR-57.
  - Architecture: AD-25 Checkout and the AD-26 indentation.
  - Epics: FR Coverage Map and the UX PayOS paragraph.
  - `sprint-status.yaml`.
- **Technical impact:**
  - New per-user checkout rate limit.
  - New `confirm-webhook` CLI script and Owner setup checklist in `docs/`.
  - User email via the Outbox for Successful, Refunded, and Refund Rejected.
  - No schema change beyond what Epic 13 already planned.

## 3. Recommended Approach

**Option 1 — Direct Adjustment.** Effort: Low. Risk: Low. Timeline impact: none.

- Rollback is not viable because no code exists.
- An MVP review is not needed because the scope is unchanged.

Decisions:

- Do not split Story 13.7 (Q4). It is large but cohesive, and splitting would force renumbering.
- Fold the Q4 message overlap between 13.10 and 13.11 into a clear boundary: 13.10 returns the data and 13.11 renders it.
- Skip PRD-3, the closed spend list. The completeness test in 13.10 already guards it.

Gates that stay in force, by design:

- 13.10–13.12 wait for the 13.6 `counterAccount*` result.
- UI stories 13.7, 13.8, 13.9, 13.11, 13.12, and 13.13 wait for the Figma fix pass.
- Production enable waits for OQ-27.

## 4. Detailed Change Proposals

### 4.1 Stories (`epics.md`)

**P1 — Story 13.3 (G1, Q6, Q7).** Replace the cancel AC with:

```
**And** the owner can cancel their `PROCESSING` top-up: payOS cancel is called through the port, the row becomes `CANCELLED`, the user notification is written to the Outbox, and a new checkout is allowed at once; cancelling another user's top-up returns 404 (FR-76).
**And** if the payOS cancel call fails or times out, the row still becomes `CANCELLED` locally, the failure is logged, and a later full payment is credited through the existing late-payment path (FR-35, AD-25).
**And** checkout is limited per user (5 checkouts per 10 minutes, configurable); excess requests return 429 before any payOS call (NFR-7).
```

**P2 — Story 13.4 (Q8, G6).**

- After the `"00"` AC, add:

  ```
  **And** a valid signature with `code` or `data.code` ≠ `"00"` returns 200, changes nothing, and is logged; reconciliation (Story 13.5) remains the recovery path.
  ```

- In the `CreditTopUp` AC, change "writes the user notification to the Outbox in one transaction (FR-35)" to "writes the user notification and the user email (top-up Successful) to the Outbox in one transaction (FR-35, FR-57)".

**P3 — Story 13.5 (Q9).** Before the alert AC, add:

```
**And** this story introduces the server-only config key `TOPUP_REFUND_MAILBOX` (validated at startup when PayOS is used; Story 13.10 reuses it for refund emails).
```

**P4 — Story 13.6 (Q1).** Replace the Given/When lines with:

```
**Given** Stories 13.1–13.5 are deployed to production with `PAYOS_ENABLED=false`
**When** the Owner completes the payOS setup and runs the probe CLI script on the VPS
**Then** this story delivers a `confirm-webhook` CLI script (through `PaymentProviderPort`, no SDK use outside the adapter) and an Owner-run setup checklist in `docs/` with these steps, each recorded with date in the story record:
  1. create the payOS payment channel linked to the Owner's bank account and copy Client ID, API Key, and Checksum Key;
  2. add `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`, and `TOPUP_REFUND_MAILBOX` to `deploy/.env.prod` on the VPS only (never committed), then rebuild and restart the `backend` service;
  3. run the `confirm-webhook` script with the production webhook URL (`https://app.rescom.io.vn/api/...` from Story 13.4) and record success; the probe-delivery webhook returns 200 with no effect.
**And** the probe script refuses to run when any `PAYOS_*` key is missing or `confirm-webhook` has not succeeded.
```

The former first `**Then**` line ("the script creates one 10,000 VNĐ payment link…") becomes `**And**`.

**P5 — Story 13.7 (G3/U5, G2/U2, G4).** After the history AC, add:

```
**And** while a `PROCESSING` top-up exists, `/wallet` shows the Processing banner and polls the same status query as `/wallet/top-up/:id` until a terminal status or expiry + 2 minutes, then refreshes balances and history without a page reload (FR-76, UX-DR-P3).
**And** a `MANUAL_REFUNDED` top-up shows the Refunded chip with the copy "Đã hoàn tiền thủ công cho thanh toán sai số tiền — không có Điểm nào được cộng" and no reversal-entry link (FR-76, UX-DR-P1, P9).
**And** the Point-history list labels a PayOS top-up credit as "Nạp Điểm qua PayOS" and a mismatch credit as "Nạp Điểm (đã điều chỉnh theo số thực nhận)" (FR-31).
```

**P6 — Stories 13.10 and 13.12 (G4, G6, Q4).**

- Story 13.10: replace the UX-DR-P19 AC with:

  ```
  **And** insufficient-Points error payloads in publish, reopen, and voucher redemption carry the Refund Hold amount as a field when one exists; Story 13.11 renders the message (UX-DR-P19); Epic 6 and Epic 12 regression suites pass.
  **And** the Point-history list labels the hold as "Giữ chờ hoàn tiền" and its release (withdrawal or rejection) as "Hoàn lại từ giữ chờ hoàn tiền" (FR-31).
  ```

- Story 13.12: replace the final AC with:

  ```
  **And** every resolution notifies the user in-app and by email (Refunded, Refund Rejected) through the Outbox, writes the Moderation admin-audit event, keeps every balance non-negative, and works for banned users (FR-57, FR-78).
  **And** the Point-history list labels the `REFUND_HOLD → SYSTEM_CLEARING` journal as "Hoàn tiền nạp Điểm" with a link to the original top-up (FR-31).
  ```

**P7 — Coverage map and UX source (G5, W2, W1).**

- Append to the Epic 13 coverage line:

  ```
  ; FR-56 amendment (PayOS top-ups by status, open refund requests) covered by the Story 13.8 B1 tab count badges, Epic 9 dashboard unchanged; FR-57 amendment (top-up and refund notifications, email for Successful/Refunded/Refund Rejected) covered by Stories 13.3, 13.4, 13.5, 13.9, 13.10, 13.12
  ```

- Append to the UX PayOS paragraph:

  ```
  For NFR-20, the canonical UX artifact for Epic 13 is UX-DR-P1…P25 in this document together with the fixed Figma frames above (decision 2026-10-15, Owner Quan); the empty `ux-designs/ux-project-rescom-2026-09-14` spine is not required for Epic 13 UI stories. UI stories 13.7, 13.8, 13.9, 13.11, 13.12, 13.13 must not be created until the designer fix pass lands and the frames are re-verified.
  ```

### 4.2 PRD (`prds/prd-project-rescom-2026-08-08/prd.md`)

**P8 — PRD edits:**

- **8a Compliance.** Use "Points are NOT positioned as currency — they can be acquired with money only through PayOS top-up (FR-34) and cannot be sold or transferred between accounts".
- **8b UJ-5.**
  - Step 2 adds "maximum 5,000,000 VNĐ".
  - Step 5 becomes "PayOS returns her to the top-up result page (`/wallet/top-up/:id`), which shows the result from RESCOM and links to `/wallet` with her new balance."
- **8c FR-34.**
  - The return bullet now points to `/wallet/top-up/:id`, with the result taken from RESCOM only.
  - Add: a payment-creation failure leads to Cancelled, no balance change, and a retryable on-screen error with no notification.
  - Add: at most 5 checkouts per 10 minutes per user.
- **8d FR-35.**
  - A mismatch shows the user "Under review".
  - New bullet: business days in every SLA (FR-35, FR-78) are Monday–Friday in Asia/Ho_Chi_Minh, with no holiday calendar.
- **8e FR-76.**
  - Statuses add Under review and Withdrawn.
  - A manual mismatch refund shows Refunded, with copy stating that no Points were credited.
  - The notification rule exempts a top-up cancelled because payment creation failed.
- **8f FR-57.** Email events become "complaint resolution, ban, top-up Successful, top-up Refunded, top-up Refund Rejected".

### 4.3 Architecture (`architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md`)

**P9 — Architecture edits:**

- **9a AD-25 Checkout.** "A user cancel calls the payOS cancel through the port, then sets `CANCELLED` even when that call fails or times out (logged); a later full payment credits through the late-payment path. Checkout is rate-limited per user (default 5 per 10 minutes) before any port call."
- **9b AD-26.** Indent "the top-up was not credited through `ResolveTopUpMismatch`;" into the eligibility list (6 spaces).

### 4.4 Tracking (`implementation-artifacts/sprint-status.yaml`)

**P10:** Add `epic-13: backlog` after `epic-12-retrospective`, followed by stories `13-1` through `13-13` as `backlog` and `epic-13-retrospective: optional`. A comment block records the gates.

### 4.5 UI/UX

No artifact edit. The Figma designer fix pass (W1) is an external action and stays a precondition for the UI stories.

## 5. Implementation Handoff

**Scope: Minor.** These are document-only edits, applied directly by the Developer agent in this session on branch `docs/payos-prd-epic-13`.

| Role | Responsibility |
|---|---|
| Developer (this session) | Apply P1–P10 and commit with the readiness report on `docs/payos-prd-epic-13` |
| Owner (Quan) | Finish the Figma designer fix pass; run the payOS setup in Story 13.6; answer OQ-27 before 13.13 |
| Developer (next) | `bmad-create-story` 13.1 on a new branch `feat/13-1-top-up-schema-for-payos` from `origin/develop` |

**Success criteria:**

- Every readiness finding is either addressed by P1–P10 or explicitly gated or skipped:
  - Q1–Q11, G1–G6, U1–U5, W2, and PRD 1–6 are covered.
  - W1, Q2, and Q3 stay gated.
  - Q5 and PRD-3 are accepted as-is.
- `sprint-status.yaml` lists Epic 13.
- Backend stories 13.1–13.5 are READY.

**Sequence after approval:** 13.1 → 13.2 → 13.3 → 13.4 → 13.5 → Owner payOS setup + 13.6 → 13.10 → (Figma fix pass) → UI stories → OQ-27 → 13.13.
