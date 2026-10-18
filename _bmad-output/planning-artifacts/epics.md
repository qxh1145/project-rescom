---
stepsCompleted: ["step-01-validate-prerequisites", "step-02-design-epics", "step-03-create-stories", "step-04-final-validation"]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/sprint-change-proposal-2026-09-26.md
  - _bmad-output/brainstorming/brainstorm-backend-integration-deployment-2026-09-29/integration-deployment-plan.md
  - _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md
  - "Figma mkudD5Ngi5RPyIAVxCcxXi page 29 (178:2) · Nạp điểm PayOS & Hoàn tiền – Người dùng"
  - "Figma mkudD5Ngi5RPyIAVxCcxXi page 30 (178:3) · Admin – Nạp điểm PayOS & Hoàn tiền"
  - "Figma mkudD5Ngi5RPyIAVxCcxXi page 20 (113:3) · Component mới (chip trạng thái nạp, thẻ số dư, tooltip)"
---

# project-rescom - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for project-rescom, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR-1: Email/Password Registration
FR-2: Google OAuth Login
FR-3: Single-Session Enforcement
FR-4: Frozen Starter Points
FR-5: Starter Points Expiry
FR-6: Mandatory Demographic Survey
FR-7: Second Onboarding Survey
FR-8: Point Unlock on Activation
FR-9: Demographic Profile
FR-10: Publisher Targeting Criteria
FR-11: Automated Matching
FR-12: External Survey Creation (3-Step Stepper)
FR-13: Server-Generated Completion Code
FR-14: Point Reward Pricing Table
FR-15: Escrow Lock on Publish
FR-16: Drag-and-Drop Form Builder
FR-17: AI Form Generator
FR-18: Form Versioning
FR-19: Internal Form Pricing Discount
FR-20: Moderation Queue
FR-21: Survey Attempt Start
FR-22: Completion Code Verification
FR-23: Missing Code Report
FR-24: 48-Hour Pending Period (External Only)
FR-25: One Completion Per Account
FR-26: In-Platform Survey Experience
FR-27: Automated Validation — Demographic Cross-Check
FR-28: Automated Validation — Bot Detection
FR-29: Instant Point Credit (Internal Only)
FR-30: Immutable Double-Entry Ledger
FR-31: Wallet Dashboard
FR-32: Escrow Refund on Survey Close
FR-33: Survey Reopen with Additional Tokens
FR-34: Top-Up Checkout through PayOS (amended 2026-10-15; replaces Manual Top-Up Request) — 10,000–5,000,000 VNĐ, multiple of 200; Points = amount ÷ 200 server-side; unique orderCode; at most one Processing top-up per user; 5-minute expiry; return and cancel both land on `/wallet`
FR-35: Automatic Crediting on Payment Confirmation (amended 2026-10-15; replaces Admin Top-Up Approval) — only verified confirmations with matching orderCode and amount credit; status + ledger + notification all-or-nothing; idempotent; retry/reconcile with Admin alert 30 min after an uncredited confirmation; late full payment on Cancelled/Expired still credits; amount mismatch is flagged for Admin credit (floor(amount ÷ 200)) or manual refund within 3 business days, overdue raises an Admin alert
FR-36: Personalized Feed
FR-37: Sort & Filter Options
FR-38: Auto-Hide on Quota Completion
FR-39: Progress Tracking
FR-40: Response Data (Internal Forms Only)
FR-41: Traffic Analytics
FR-42: Feedback Summary
FR-43: Post-Completion Feedback
FR-44: Negative Feedback Deprioritization
FR-45: Time Barrier
FR-46: Rate Limiting
FR-47: Immutable FraudLog
FR-48: Frozen Points Anti-Bot
FR-49: Streak Counter
FR-50: Leaderboard
FR-51: Tier Progression
FR-52: User Management
FR-53: Survey Moderation
FR-54: Complaint Resolution
FR-55: FraudLog Monitoring
FR-56: Transaction Dashboard
FR-57: Event Notifications
FR-58: Consent-Aware Behavioral Telemetry
FR-59: Response Integrity Assessment
FR-60: Cold-Start Handling
FR-61: Respondent Reliability
FR-62: Survey Quality Assessment
FR-63: Explainability and Reproducibility
FR-64: Integrity Decision Modes
FR-65: Integrity Review and Feedback Labels
FR-66: TrustGraph-Ready Relationships
FR-67: Assessment Applicability
(FR-68 … FR-75: Rewards — see Epic 12.)
FR-76: Top-Up Status on Wallet — statuses Processing, Successful, Cancelled, Expired, Refund Requested, Refunded, Refund Rejected; Processing self-updates; Cancelled/Expired change no balance; every status change notifies the user
FR-77: Refund Request — own Successful PayOS top-up, within 24h, one request per top-up, no resubmission after rejection; read-only transaction code, amount, Points, top-up time, account email, and refund destination = the paying bank account reported by PayOS (masked; not user-editable; if unreported the request is destination-unverified and the Admin confirms by email); user fields reason (fixed list of 4) + mandatory note ≤ 300 chars; submission emails the Admin refund mailbox and notifies the user; eligible request moves the top-up Points to Refund Hold; eligibility check is atomic with Point spending
FR-78: Refund Eligibility and Admin Resolution — eligible = within 24h and no Point-spending transaction since the top-up; Admin sees verdict and reason; Refunded only with a hold (reversal entry linked to the top-up); Rejected needs a reason and releases the hold; no negative balance; 3-business-day SLA with Admin alert; manual bank refund only to the paying account; every resolution notifies the user and is audited
FR-79: Retirement of the Manual Top-Up Flow — all pending manual requests resolved before enabling PayOS; PayOS cannot be enabled while any is pending; manual form and approval queue removed; historical manual top-ups stay visible

### NonFunctional Requirements

NFR-1: API average response time < 500ms under normal load
NFR-2: Survey Feed loads in < 2 seconds with ≤ 50 surveys
NFR-3: Point transactions use ACID + row-level locking to prevent race conditions
NFR-4: PostgreSQL-authoritative Time Barrier; Redis only for distributed rate limits/cache/ephemeral coordination when triggered
NFR-5: AI Form Generation has a separate timeout (not subject to 500ms SLA)
NFR-6: Short-lived cookie JWT bound to a PostgreSQL-authoritative revocable session with rotating refresh secret
NFR-7: Exact credentialed CORS allowlist, Helmet, CSRF protection, and NestJS throttling on exposed API endpoints
NFR-8: Server-side authority: startTime, Completion Code generation, point calculations — never trust client
NFR-9: All point transactions use ACID to ensure data consistency
NFR-10: FraudLog is append-only — no delete, no update
NFR-11: Point Ledger integrity: balance can never be duplicated or lost
NFR-12: Auto-Refund background job runs on schedule for expired surveys
NFR-13: Pending → Available auto-transfer runs on schedule (48h expiry)
NFR-14: System uptime ≥ 99% during peak academic periods
NFR-15: AI failure must not impact core system (login, surveys, points, marketplace)
NFR-16: Monorepo with Frontend and Backend fully separated
NFR-17: Prisma ORM for database schema management
NFR-18: Zod validation shared between Frontend and Backend
NFR-19: Form Definition JSON schema as a shared package
NFR-20: Modern, minimal UI targeting Gen Z students
NFR-21: Survey creation follows a clear 3-step stepper flow
NFR-22: CSAT target > 4.0/5.0
NFR-31: PayOS credentials stay server-side in secret configuration; payment confirmations are accepted only after signature verification and are never trusted from the client or redirect parameters
NFR-32: A reconciliation job runs every 1 minute over every Processing top-up and every top-up expired/cancelled within the last 24 hours, so a lost confirmation never leaves a paid top-up uncredited or an expired one open

### Additional Requirements

- npm workspace setup for the existing Next.js and backend paths; Turborepo is deferred until measured orchestration/caching value
- Shared versioned Zod contracts in `packages/schemas`, imported by both FE and BE
- Pragmatic Clean Architecture in NestJS: strict dependency direction and ports/adapters at invariant/external seams, without mandatory four-layer folders for trivial CRUD
- PostgreSQL-authoritative Time Barrier and durable workflows; Redis is conditional ephemeral infrastructure for shared distributed state
- One NestJS codebase/image with API and worker entrypoints in production; explicit local co-location is allowed
- Secure API communication with AI Gateway via Tailscale VPN
- Database transaction handling for Double-Entry Ledger (Prisma `$transaction`)

**PayOS top-up and refund (AD-25, AD-26, solution-design §PayOS flows; added 2026-10-15)**
- `TopUpRequest` stays the single top-up entity: new `channel` (`MANUAL` | `PAYOS`), sequence-backed JS-safe `orderCode`, `paymentLinkId`, `expiresAt`, `cancelledAt`, `pointsCredited`, write-once provider facts (`amountPaidVnd`, `providerReference`, `paidAt`) and nullable paying-account facts (`counterAccountBankId/BankName/Name/Number`); `transferReference` nullable; DB `CHECK`s for FR-34 bounds; partial unique index = one `PROCESSING` per user; raw-SQL migration owns sequence, index and checks
- Statuses add `PROCESSING`, `SUCCESSFUL`, `CANCELLED`, `EXPIRED`, `AMOUNT_MISMATCH`, `MANUAL_REFUNDED`; AD-25 payOS status mapping table is binding; late full payment wins over local Cancelled/Expired
- Checkout commits the `PROCESSING` row before `paymentRequests.create` (`maxRetries: 0`); create failure → `CANCELLED`; user cancel calls payOS cancel through the port
- One credit path: `CreditTopUp` (`topup-credit:{topUpId}`) used by webhook and reconciliation; `ResolveTopUpMismatch` (Admin); legacy `ApproveTopUp` (MANUAL only); row lock `FOR UPDATE` + status CAS; lock order `TopUpRequest` → `TopUpRefundRequest` → ledger accounts ascending; credit journal `SYSTEM_CLEARING → USER_AVAILABLE`; `ReverseJournal` forbidden on top-up credits
- Payment proof = verified webhook (HMAC, `code`/`data.code` = "00", matching orderCode) or server-side `GET /v2/payment-requests/{id}`; `returnUrl` params never count; webhook 401 invalid signature, 200 no-op unknown/duplicate (incl. `confirm-webhook` probe), 5xx on processing failure
- Webhook registered on `app.rescom.io.vn/api/...` so `proxy.ts` adds the edge key; no cookie, explicit CSRF opt-out, skips per-IP throttler
- Reconciliation every minute on the Economy scheduler under AD-17 lease/fencing; expires by local clock with best-effort payOS cancel; Admin alerts (notification + Sentry) for uncredited 30 min after payment, mismatch unresolved 3 business days, repeated provider failure
- `@payos/node` 2.x (Node 20+) only inside one Economy adapter behind `PaymentProviderPort` (create, get, cancel, verify webhook); secrets `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` per environment
- `PAYOS_ENABLED` uses the Rewards-flag pattern; if any `MANUAL` `PENDING` row exists at startup the process still boots with PayOS effectively off + Admin alert (never refuses startup), and a pre-deploy script reports `PENDING` rows; flag on = checkout on + manual submission off; webhook/reconciliation/mismatch/refund never flag-gated; enabled by server config only — no UI toggle
- Economy owns `TopUpRefundRequest` (unique `topUpId`, `topUpJournalId`, snapshot of the paying-account destination, `destinationVerified`); new `LedgerAccountClass.REFUND_HOLD`; hold `USER_AVAILABLE → REFUND_HOLD` (`topup-refund-hold:{requestId}`); resolve keyed `topup-refund-resolve:{requestId}`: Refunded `REFUND_HOLD → SYSTEM_CLEARING`, Rejected releases hold to Available; spend journal = debit `USER_AVAILABLE` into `ESCROW` or `SYSTEM_SINK` (named Economy constant); legacy MANUAL top-ups never refundable
- Request, journal and Outbox events (user notification + email to `TOPUP_REFUND_MAILBOX`) commit together; resolution emits the Moderation admin-audit event
- No payOS sandbox: tests use a fake `PaymentProviderPort` and HMAC-signed fixtures; non-prod keeps `PAYOS_ENABLED=false`; production smoke uses 10,000 VNĐ refunded via FR-78
- Business days for every SLA = Monday–Friday in `Asia/Ho_Chi_Minh`, no holiday calendar (ponytail: add a holiday list if false overdue alerts occur)
- Spend-journal completeness test: every journal class that debits `USER_AVAILABLE` must be classified spend / non-spend, so a new spending feature cannot leave refunds eligible
- Destination-unverified refunds: the Admin transfers only when the receiving holder name matches the paying account on the bank statement; otherwise reject
- SLA and uncredited alerts go in-app and by email to `TOPUP_REFUND_MAILBOX` (single-Admin operation is an accepted risk)
- Prod-enable checklist: `confirm-webhook` succeeds; a live 10,000 VNĐ top-up is credited by the webhook (not by reconciliation); one full refund drill; pre-deploy `PENDING` check; emergency-disable runbook (flag off closes checkout while webhook and reconciliation keep running; how to clear in-flight and paid-uncredited top-ups)
- Live payOS probe before refund stories: a prod CLI script creates one payment link through the adapter (`PAYOS_ENABLED` stays false), pays 10,000 VNĐ, and records the real webhook payload and GET response to confirm `counterAccount*` presence, the status enum, and the webhook path through the Vercel proxy; if `counterAccount*` is usually null, revisit FR-77 before refund stories; the probe is paid from the Owner's own bank account, so no money refund is needed and the 50 Points stay on the Owner's account
- Refund stories touch Point-spending flows owned by Epic 6 (publish/reopen escrow) and Epic 12 (voucher redemption): spend-journal classification and AD-24 lock order; both epics' regression suites must pass
- `orderCode` sequence starts at `1000000000`; the payOS account is assumed dedicated to RESCOM (owner to confirm) so codes never collide with other payment links
- Prod `top_up_requests` on 2026-10-15: 4 rows, all `PENDING` (none approved/rejected yet); the Admin resolves these 4 by checking the bank statement before `PAYOS_ENABLED` (FR-79). Re-count right before enable, because the manual flow stays open until then
- Spend-journal completeness test classifies the complaint/dispute reversal that debits `USER_AVAILABLE` as non-spend; `Available ≥ pointsCredited` already blocks those refunds
- Verified 2026-10-15: backend image is `node:22-bookworm-slim` (meets `@payos/node` Node 20+); voucher redemption posts `USER_AVAILABLE → SYSTEM_SINK` (`ledger.service.ts` `spendPoints`), matching the AD-26 spend definition
- payOS `description` ≤ 9 characters (unverified docs limit for bank accounts not linked through payOS): use `RC` + last 7 digits of `orderCode`; the live probe confirms the limit
- User cancel of an own `PROCESSING` top-up is exposed to the client (FR-34); `WithdrawTopUpRefund` adds terminal `WITHDRAWN` (AD-26); `REFUNDED` stores optional `bankTransferReference` / `bankTransferredAt`; Admin CSV export of PayOS top-ups and refunds by date range (FR-78)
- Runbook also covers rotating `PAYOS_CHECKSUM_KEY` / API keys, re-running `confirm-webhook` after a key or domain change, and re-checking with the probe
- Edge-case sweep 2026-10-15: Admin `RecheckTopUp` (on-demand GET + `CreditTopUp`); server `refundDeadline`; mismatch-credited top-ups not refundable in-app, < 200đ remainder not converted; mark `REFUNDED` before transfer (withdraw race closed), withdraw/resolve CAS loser → 409; ban leaves `REFUND_HOLD`; mailbox email masks account number; CSV export audit-logged without account numbers
- Production enable gated by PRD Open Question 27 (personal payOS account terms, fees, tax); OQ-28 late/wrong-amount behavior confirmed during production testing

### UX Design Requirements

(No general UX spine; bmad-ux run `ux-project-rescom-2026-09-14` is an empty stub. Screens follow Figma `mkudD5Ngi5RPyIAVxCcxXi` and `docs/frontend/design-system.md`.)

**PayOS top-up & refund (Figma page 29 `178:2`, page 30 `178:3`, components page 20 `113:3`, rules frame `191:3079`; added 2026-10-15).** Every screen ships Desktop 1440 + Mobile 390 and its default/loading/empty/error states as drawn. A designer fix pass (6 balance cards, paying-account refund destination, mismatch SLA, read-only B4) is pending; implement the fixed version. For NFR-20, the canonical UX artifact for Epic 13 is UX-DR-P1…P25 in this document together with the fixed Figma frames above (decision 2026-10-15, Owner Quan); the empty `ux-designs/ux-project-rescom-2026-09-14` spine is not required for Epic 13 UI stories. UI stories 13.7, 13.8, 13.9, 13.11, 13.12, 13.13 must not be created until the designer fix pass lands and the frames are re-verified.

UX-DR-P1: Top-up status chip component with 7 variants — Processing (amber), Successful (green), Cancelled (grey + x icon), Expired (grey + hourglass icon), Refund Requested (teal), Refunded (dark teal), Refund Rejected (danger); always text + color, WCAG AA; plus Under review for `AMOUNT_MISMATCH` and "Thủ công (cũ)" / "PayOS" channel labels
UX-DR-P2: Balance card component with (i) tooltip; `/wallet` shows 6 cards in order Khả dụng (emphasized) · Đang chờ · Ký quỹ · Đóng băng · Giữ để xét · Giữ chờ hoàn tiền
UX-DR-P3: A1 `/wallet` — CTA "Nạp điểm"; self-updating Processing banner with "Xem chi tiết"; top-up history (code, amount, Points, time, status chip, channel label); states default / processing / loading (6-card skeleton) / empty / load error
UX-DR-P4: A2 `/wallet/top-up` — VNĐ input with thousands formatting; quick chips 20.000 · 50.000 · 100.000 · 200.000 · 500.000; live "Bạn sẽ nhận N Điểm" preview; 5-minute QR note; "Thanh toán qua PayOS" CTA; inline errors below minimum, above maximum, not a multiple of 200 (suggest nearest valid); blocked state when a Processing top-up exists ("Tiếp tục thanh toán" / "Xem giao dịch", input disabled); redirecting overlay; create-failure error
UX-DR-P5: A3 `/wallet/top-up/:id` return page — Processing (polls backend, never trusts URL params), Successful (+N Điểm, new balance, "Về ví" / "Đăng khảo sát"), Cancelled, Expired ("Tạo mã mới"), Amount mismatch (Admin will resolve), not found, load error
UX-DR-P6: A4 top-up detail — info table, vertical status timeline, refund section: "Yêu cầu hoàn tiền" with 24h countdown when eligible, disabled with reason when >24h, already requested, or legacy manual; loading / not found / error states
UX-DR-P7: A4 refund form — read-only locked block (code, amount, Points, time, email) + read-only "Tài khoản nhận hoàn tiền" (bank logo, bank name, •••• last 4, holder) with caption that the destination cannot change; destination-unverified variant (amber notice: Admin will confirm by email; submit still allowed); reason radio (Nạp nhầm số tiền · Nạp nhầm tài khoản Rescom · Không còn nhu cầu dùng Điểm · Lý do khác); note mandatory for every reason, ≤ 300 chars with counter; Refund Hold info callout; validation errors for reason and note only
UX-DR-P8: A5 confirm dialog stating "Hoàn [amount] về [bank] •••• NNNN" and a submitting state; A6 result Eligible (Points held, expected resolution time) / Not eligible (Points spent since top-up, nothing held)
UX-DR-P9: A7 refund status on detail — Refund Requested, Requested–not eligible, Refunded (Points removed, link to reversal entry), Refund Rejected (Admin reason, Points back to Available)
UX-DR-P10: A8 notifications — bell dropdown + `/notifications` items for top-up successful, cancelled, expired, amount mismatch, refund requested, refunded, refund rejected; loading / empty / error
UX-DR-P11: B1 `/admin/top-ups` with 4 tabs and count badges — "Giao dịch PayOS" (status/date filters, search by code/email), "Yêu cầu hoàn tiền" (verdict chip + short reason, 3-business-day SLA countdown, "Quá hạn"), "Cần xử lý" (amount mismatches with 3-business-day countdown/overdue, uncredited >30 min alerts), "Lịch sử thủ công (cũ)" read-only; loading / empty-filter / error
UX-DR-P12: B2 refund detail drawer — original top-up, paying account (bank, full account number, holder) each with Copy, user reason + note, verdict card with explanation, audit trail; destination-unverified chip with "liên hệ qua email" + Copy email; actions: "Đánh dấu Đã hoàn tiền" (enabled only with a hold; confirm dialog states Points removed), "Từ chối" (reason required; checkbox "Tôi đã chuyển trả tiền thủ công" for hold-less requests); minimal mobile list + detail
UX-DR-P13: B3 amount mismatch drawer — requested vs received amounts; "Cộng Điểm theo số thực nhận" with floor(received ÷ 200) preview, or "Đã hoàn tiền thủ công" with mandatory note; 3-business-day deadline
UX-DR-P14: B4 FR-79 banner — read-only "PayOS: Tắt/Bật · cấu hình server (PAYOS_ENABLED)" chip; pending-manual variant with quick approve/reject list; ready variant with checklist and "báo kỹ thuật bật PAYOS_ENABLED và triển khai lại"; no toggle, no Super Admin
UX-DR-P16: "Huỷ giao dịch" on A2 blocked state and A3 Processing; cancels the payOS link and frees the user to start a new top-up
UX-DR-P17: A7 Refunded shows the bank transfer reference and time when the Admin recorded them; B2 "Đánh dấu Đã hoàn tiền" dialog has optional fields for both
UX-DR-P18: A7 Refund Requested (eligible or not) has "Rút yêu cầu" with a confirm dialog; withdrawn returns the top-up to Successful with refund unavailable (reason "đã rút yêu cầu")
UX-DR-P19: Every insufficient-Points message (publish, reopen, voucher redeem) names Points on Refund Hold when any exist: "N Điểm đang giữ chờ hoàn tiền"
UX-DR-P20: B1 "Giao dịch PayOS" tab has "Xuất CSV" for a date range (top-ups and refunds: code, user email, amount, Points, status, paidAt, refund status, bank transfer reference)
UX-DR-P21: B1/B2 "Kiểm tra lại với payOS" action on any PayOS top-up (result toast: credited / still unpaid / mismatch)
UX-DR-P22: B2 "Đánh dấu Đã hoàn tiền" dialog states "Đánh dấu trước, rồi chuyển khoản"; bank reference/time can be added later from the drawer (once)
UX-DR-P23: A4 refund countdown uses the server `refundDeadline`; mismatch-credited top-ups show refund unavailable with reason; A3 mismatch-credited notification states the < 200đ remainder
UX-DR-P24: A3 Processing polls until a terminal status or expiry + 2 minutes, then shows "Kiểm tra lại" with "Nếu bạn đã thanh toán, Điểm vẫn sẽ được cộng"
UX-DR-P25: Withdraw/resolve conflict shows "Yêu cầu đã được xử lý" and reloads; A6 Not eligible explains that a compensated failed redemption still counts as spending
UX-DR-P15: PayOS and bank logos are placeholders in Figma; production uses the official logo sets

### FR Coverage Map

- **Epic 1: System Foundation & Identity** -> FR-1, FR-2, FR-3, FR-ADD-12 (RBAC), FR-ADD-13 (Audit Log), FR-52
- **Epic 2: Core Form Builder & Schema** -> FR-12, FR-16, FR-18, FR-ADD-1, FR-ADD-2, FR-ADD-3, FR-ADD-4, FR-ADD-5, FR-ADD-5b
- **Epic 3: AI Form Generation Assistant** -> FR-17, FR-ADD-6, FR-ADD-7
- **Epic 4: Survey Distribution & Public Access** -> FR-10, FR-11, FR-36, FR-37, FR-38, FR-ADD-8
- **Epic 5: Survey Execution & Responses** -> FR-21, FR-22, FR-23, FR-24, FR-25, FR-26, FR-40, FR-ADD-9, FR-ADD-10, FR-13
- **Epic 6: Point Ledger & Wallet** -> FR-4, FR-5, FR-8, FR-14, FR-15, FR-19, FR-29, FR-30, FR-31, FR-32, FR-33, FR-34 (legacy manual, superseded by Epic 13), FR-35 (legacy manual, superseded by Epic 13), FR-ADD-11
- **Epic 7: Demographics & Gamification** -> FR-6, FR-7, FR-9, FR-27, FR-49, FR-50, FR-51
- **Epic 8: Moderation & Anti-Fraud** -> FR-20, FR-28, FR-45, FR-46, FR-47, FR-48, FR-53, FR-54, FR-55
- **Epic 9: Analytics & Notifications** -> FR-41, FR-42, FR-43, FR-44, FR-56, FR-57
- **Epic 10: Research Integrity Foundation & TrustGraph** -> FR-58, FR-59, FR-60, FR-61, FR-62, FR-63, FR-64, FR-65, FR-66, FR-67
- **Epic IR: Integration Readiness** -> Phase 1 launch journeys and cross-cutting integration acceptance gates; gap-closing stories IR.2a/IR.2b/IR.4a/IR.4b add FR-39, FR-40 and complete FR-5, FR-9, FR-24, FR-32, FR-57 (email)
- **Epic 11: Production Deployment & Pilot Readiness** -> NFR-ADD-3, NFR-ADD-4, NFR-ADD-5, AD-23 (no new FRs)
- **Epic 12: Rewards — Voucher Redemption & Flash Sale** -> FR-68, FR-69, FR-70, FR-71, FR-72, FR-73, FR-74, FR-75
- **Epic 13: PayOS Top-Up & 24-Hour Refund** -> FR-34 (PayOS, amended 2026-10-15), FR-35 (amended 2026-10-15), FR-31 (amend: Escrow + Refund Hold, 6 balances), FR-76, FR-77, FR-78, FR-79; NFR-31, NFR-32; FR-56 amendment (PayOS top-ups by status, open refund requests) covered by the Story 13.8 B1 tab count badges, Epic 9 dashboard unchanged; FR-57 amendment (top-up and refund notifications, email for Successful/Refunded/Refund Rejected) covered by Stories 13.3, 13.4, 13.5, 13.9, 13.10, 13.12
- **Epic 14: Admin Console Completion** -> FR-23 (Admin resolution half), FR-74 (Admin-editable daily limit), FR-ADD-13 (viewer); ledger operator fallbacks from Epic 6 (no new FR)

## Epic List

### Epic 1: System Foundation & Identity
**Goal:** Users can securely authenticate, and Admins can manage the system with strict RBAC and audit logging.
**FRs covered:** FR-1, FR-2, FR-3, FR-ADD-12, FR-ADD-13, FR-52

### Epic 2: Core Form Builder & Schema
**Goal:** Publishers can create, edit, version, and manage surveys using a drag-and-drop interface, while schemas remain strictly validated and immutable upon publish.
**FRs covered:** FR-12, FR-16, FR-18, FR-ADD-1, FR-ADD-2, FR-ADD-3, FR-ADD-4, FR-ADD-5, FR-ADD-5b

### Epic 3: AI Form Generation Assistant
**Goal:** Publishers can rapidly generate form drafts using natural language prompts without blocking manual flows if the AI fails.
**FRs covered:** FR-17, FR-ADD-6, FR-ADD-7

### Epic 4: Survey Distribution & Public Access
**Goal:** Publishers can distribute surveys (internal feed or external links) and set targeting criteria; Respondents can discover targeted surveys.
**FRs covered:** FR-10, FR-11, FR-36, FR-37, FR-38, FR-ADD-8

### Epic 5: Survey Execution & Responses
**Goal:** Respondents can complete surveys securely and smoothly, handling edge cases like timeouts, completion codes, and file uploads.
**FRs covered:** FR-13, FR-21, FR-22, FR-23, FR-24, FR-25, FR-26, FR-40, FR-ADD-9, FR-ADD-10

### Epic 6: Immutable Point Ledger & Wallet
**Goal:** The system maintains an unalterable financial ledger for point transactions ensuring absolute integrity across balances, escrows, and top-ups.
**FRs covered:** FR-4, FR-5, FR-8, FR-14, FR-15, FR-19, FR-29, FR-30, FR-31, FR-32, FR-33, FR-34, FR-35, FR-ADD-11 (FR-34/FR-35 here are the legacy manual top-up, superseded by Epic 13 on 2026-10-15)

### Epic 7: Onboarding, Demographics & Gamification
**Goal:** Respondents complete demographic profiles to unlock the platform and engage with gamification elements (streaks, tiers).
**FRs covered:** FR-6, FR-7, FR-9, FR-27, FR-49, FR-50, FR-51

### Epic 8: Security, Moderation & Integrity Guard
**Goal:** The platform automatically blocks bot activity and provides Admins with tools to moderate content and resolve disputes.
**FRs covered:** FR-20, FR-28, FR-45, FR-46, FR-47, FR-48, FR-53, FR-54, FR-55

### Epic 9: Analytics, Feedback & Notifications
**Goal:** Users receive timely notifications and Publishers gain insights from survey traffic and respondent feedback.
**FRs covered:** FR-41, FR-42, FR-43, FR-44, FR-56, FR-57

### Epic 10: Research Integrity Foundation & TrustGraph
**Goal:** Internal Form responses produce privacy-conscious telemetry, explainable integrity assessments, respondent reliability history, Survey Quality assessments, and TrustGraph-ready evidence without affecting external form compatibility.
**FRs covered:** FR-58, FR-59, FR-60, FR-61, FR-62, FR-63, FR-64, FR-65, FR-66, FR-67

### Epic IR: Integration Readiness
**Goal:** Phase 1 launch journeys run end to end against the real backend with mock mode disabled, verified frontend-to-backend contracts, same-origin `/api` behavior, and evidence for every applicable success and failure state.
**FRs covered:** FR-39, FR-40 (IR.4a) and completion of FR-5, FR-24, FR-32 (IR.2b), FR-9 and FR-57 email (IR.4b), added 2026-09-30 from the implementation-readiness report; otherwise integrates the completed Phase 1 capabilities from Epics 1, 2, 4, 5, 6, 7, 8 and 9. Epic 3, Epic 10 and all other deferred Phase 2 scope remain excluded unless separately approved.

### Epic 11: Production Deployment & Pilot Readiness
**Goal:** The Phase 1 platform runs for pilot students on a simple, portable single-VPS topology (Hostinger VPS + Cloudflare R2, Architecture AD-23 amended 2026-10-05) with automated deploys, error and uptime alerts, tested backups, and a rehearsed exit path to another provider.
**FRs covered:** none (operational epic) — NFR-ADD-3, NFR-ADD-4, NFR-ADD-5, AD-23. Added by `sprint-change-proposal-2026-09-26.md`.
**Dependency:** Packaging, infrastructure and pipeline work may proceed in parallel with Epic IR after IR.1 confirms scope and architecture. Staging promotion requires IR.5; production launch review in Story 11.5 requires IR.6 and Stories 11.1–11.4.

### Epic 12: Rewards — Voucher Redemption & Flash Sale (Phase 2)
**Goal:** Users spend Available Points (earned, top-up, or unlocked starter) on F&B partner vouchers, including time-boxed Flash Sales, and always see the locked price before any Point is deducted. Admins manage catalog, code inventory, Flash Sales, and redemption stats.
**FRs covered:** FR-68 … FR-75. **Architecture:** AD-24 (plus AD-1, AD-10, AD-16). Added by `sprint-change-proposal-2026-10-13.md`.
**Dependency:** Starts after Story 11.5 for production. FE-mock Stories 12.1–12.6 may start immediately using planning-doc defaults in MSW mocks only. Backend gates: 12.7 by PRD OQ-25; 12.8 by OQ-23 and OQ-26; 12.11 (production enable) by OQ-24. UX source: Figma Rescom pages 20–27.

### Epic 13: PayOS Top-Up & 24-Hour Refund
**Goal:** Users top up Points by PayOS QR and are credited instantly without Admin approval, can cancel a Processing top-up, and track every top-up on a 6-balance Wallet. A mistaken top-up can be refunded within 24 hours, only to the paying bank account, and an unresolved request can be withdrawn. Admins resolve amount mismatches and refunds within 3 business days, re-check any payment against payOS, export CSV for reconciliation, and switch from manual top-up to PayOS without taking production down.
**FRs covered:** FR-34, FR-35, FR-76, FR-77, FR-78, FR-79; FR-31 (amend). **NFRs:** NFR-31, NFR-32. **Architecture:** AD-25, AD-26 (+ AD-1, AD-10, AD-17, AD-23 edge proxy, AD-24 SpendPoints lock order). **UX:** UX-DR-P1 … P25 (Figma pages 29, 30, 20; designer fix and addendum pending). Added 2026-10-15 from the PayOS PRD amendment.
**Ordering:** A live payOS probe runs right after the adapter story and before refund stories; if `counterAccount*` is usually null, revisit FR-77.
**Cross-epic touch:** Refund stories change the spend flows of Epic 6 (publish/reopen) and Epic 12 (voucher redemption); both regression suites must pass.
**Dependency:** Builds on Epic 6 and Epic 12; develop against a fake `PaymentProviderPort`. Production enable (`PAYOS_ENABLED`) requires OQ-27, the manual `PENDING` rows resolved (4 on 2026-10-15; re-count before enable), and the prod-enable checklist (confirm-webhook, 10,000 VNĐ credited by webhook, refund drill, pre-deploy `PENDING` check, runbook for emergency disable and key rotation).

### Epic 14: Admin Console Completion
**Goal:** Admins can resolve missing-code reports, change the Rewards daily Points limit, read the Audit Log, and run the ledger operator fallbacks from the console instead of the API or the database.
**FRs covered:** FR-23 (resolution), FR-74 (daily limit setting), FR-ADD-13 (viewer). Added by `sprint-change-proposal-2026-10-18.md`.
**Out of scope:** Story 8.5 (FR-54 complaints) and Story 10.7 (FR-65 quality review) stay Phase 2; the `ATTEMPT_DISPUTE` and `LOCKED_ATTEMPT` dispute kinds stay on MSW.
**Dependency:** Starts after Story 13.13 Part B. Stories are independent; 14.1 is the only one with a migration. Screens without Figma frames (14.2–14.4) reuse the existing Admin shell, table, card, and confirm-dialog components.

### Additional Production Requirements (Newly Added)

**Form Builder & Schema**
- **FR-ADD-1:** Form Builder must support specific block types: text, textarea, number, single choice, multiple choice, rating, linear scale, date, file upload (as per PRD).
- **FR-ADD-2:** Form Builder must support block editing, reordering, and duplication.
- **FR-ADD-3:** Form Builder must support draft/autosave functionality and live preview before publishing.
- **FR-ADD-4:** The Form Definition exports in `packages/schemas` must implement strict Zod validation, including conditional logic rules if any.
- **FR-ADD-5:** Schema Versioning: The system must support versioning of the Form Definition JSON schema to handle future upgrades without breaking old responses. [Decision Required: Specific versioning strategy].
- **FR-ADD-5b:** Immutable Published Form: Once a form is published, its schema/definition becomes strictly immutable to ensure data integrity of responses. Any changes require creating a new version or draft.

**AI Form Generator**
- **FR-ADD-6:** AI Workflow: Prompt -> AI Context -> Structured JSON -> Zod Validation -> Load into Builder for editing.
- **FR-ADD-7:** AI Failure Isolation: If AI times out or fails (e.g., invalid JSON returned), the system must gracefully fail, notify the user, and allow them to continue building manually.
- **NFR-ADD-1:** AI Generation must have a configurable retry mechanism and timeout (e.g., 30s) separate from the standard 500ms API SLA.

**Public Sharing & Responses**
- **FR-ADD-8:** Public Access: The system must generate a shareable survey URL for Respondents to access internal forms. [Decision Required: Are non-logged-in users allowed to view the form without submitting?]
- **FR-ADD-9:** Response Lifecycle: Responses must transition through states (e.g., In Progress, Submitted, Validated, Rejected).
- **FR-ADD-10:** File Upload Validation: Any file upload blocks must validate file type, size, and scan for malware (if applicable).
- **NFR-ADD-2:** Secure File Storage: Uploaded files must be stored securely (e.g., S3) with restricted access policies via signed URLs.

**Security & Production Infra**
- **FR-ADD-11:** Idempotency: All financial operations (Point credits, Escrow locks, Refunds, and Survey completion rewards) must use idempotent keys to prevent double-spending on network retries.
- **FR-ADD-12:** Authorization: the system must enforce permissions. `ADMIN` is a privileged assignment; publishing and responding are simultaneous normal-user capabilities gated by product eligibility, not mutually exclusive account roles.
- **FR-ADD-13:** Audit Log: The system must maintain an immutable audit log of critical administrative actions and system-level financial operations. Admins can view, filter, and open audit records in the Admin console (Story 14.3).
- **NFR-ADD-3:** Secret Management: All environment variables (DB credentials, JWT secrets, OAuth tokens) must be securely managed and not hardcoded.
- **NFR-ADD-4:** Observability: The production system must implement structured logging, APM monitoring, and expose health check endpoints (`/health`).
- **NFR-ADD-5:** Disaster Recovery: The PostgreSQL database must have automated daily backups and a documented restore procedure. [Decision Required: Define RPO (Recovery Point Objective), RTO (Recovery Time Objective), and backup retention period].

**UX Requirements (Form Builder/AI)**
- **UX-ADD-1:** Form Builder needs drag-and-drop interaction patterns.
- **UX-ADD-2:** AI Generator requires clear loading states (e.g., skeleton loaders, progress text) during the 30-60s wait time.
- **UX-ADD-3:** Survey answering requires offline/reconnect handling or error states if submission fails.

## Epic 1: System Foundation & Identity

**Goal:** Users can securely authenticate, and Admins can manage the system with strict RBAC and audit logging.

### Story 1.1: Email/Password Registration & Authentication

As a User,
I want to register, login, and logout using my email and password,
So that I can securely access the RESCOM platform.

**Acceptance Criteria:**

**Given** an unregistered email address
**When** the user submits the registration form with a valid password
**Then** a new account is created with normal-user authorization and Respondent capability, and the user is logged in
**And** the password is securely hashed and a short-lived access JWT bound to a PostgreSQL-authoritative session is issued in a Secure HTTP-Only cookie according to AD-20.

**Given** an already registered email address
**When** the user attempts to register again
**Then** the system returns an appropriate error preventing duplicate registration without leaking account existence unnecessarily.

**Given** an existing user
**When** they attempt to log in with invalid credentials
**Then** the system returns a 401 error.

**Given** a logged-in user
**When** they click logout
**Then** the backend revokes the authoritative session and expires the access/refresh cookies using the same cookie attributes.

### Story 1.2: Google OAuth Login

As a User,
I want to log in using my Google account,
So that I can access the platform quickly without remembering a new password.

**Acceptance Criteria:**

**Given** a user on the login page
**When** they click "Continue with Google" and authorize the app
**Then** the system logs them in (or creates a new account if first time)
**And** issues the same revocable access/refresh session contract defined by AD-20.
**And** OAuth initiation/callback validates one-time expiring state, nonce, PKCE where supported, exact redirect URI, provider-token signature/issuer/audience/expiry, provider subject, and verified-email status.
**And** if the verified Google email matches an existing password account, the system does not auto-link or create a duplicate; the user must authenticate the existing account and explicitly link Google with recent authentication.
**And** identity link/unlink is audited and cannot remove the account's final login method.

### Story 1.3: Single-Session Enforcement

As a User/Admin,
I want my account to only have one active session at a time,
So that my account is protected from unauthorized concurrent access while using short-lived signed access tokens.

**Acceptance Criteria:**

**Given** an already logged-in user
**When** the user logs in from a new device/browser
**Then** the old PostgreSQL-authoritative Session is atomically revoked and the new access JWT carries the new `sessionId` and `sessionVersion`.
**And** any subsequent requests using the old JWT return a 401 Unauthorized error.

### Story 1.4: Role-Based Access Control (RBAC) & User Management

As an Admin,
I want to view all users and manage their roles/status,
So that I can control who has Publisher or Admin privileges and lock bad actors.

**Acceptance Criteria:**

**Given** an authenticated Admin user
**When** they access the User Management dashboard
**Then** they see a paginated list of all users
**And** they can manage privileged authorization assignments and lock/unlock accounts; ordinary publishing/responding capabilities are not mutually exclusive roles.

**Given** a non-Admin user (Respondent or Publisher)
**When** they attempt to access Admin-only API endpoints
**Then** the system explicitly rejects the request with a 403 Forbidden error.
**And** Admins cannot alter another Admin's role unless explicitly authorized by a super-admin rule (or similar boundary definition).

### Story 1.5: System Audit Logging

As a System Owner,
I want critical administrative and financial actions to be immutably logged,
So that I have a traceable history of who did what for security and compliance.

**Acceptance Criteria:**

**Given** an Admin performing a critical action (e.g., changing a user's role)
**When** the action is successfully executed
**Then** a record is appended to the Audit Log.
**And** the Audit Log implementation must be append-only (no updates, no hard deletes permitted) at the database/ORM level.
**And** the record includes the actor's ID, action type, timestamp, and payload details.

### Story 1.6: Security & API Foundation

As a System Architect,
I want the core API infrastructure to include baseline security measures,
So that all subsequent features are built on a secure, standardized foundation.

**Acceptance Criteria:**

**Given** the backend NestJS application
**When** it handles incoming HTTP requests
**Then** all endpoints are protected by basic API-level rate limiting to prevent abuse.
**And** Helmet and CORS are configured according to production security standards.
**And** Global authentication/authorization guards are established so endpoints can be easily decorated for RBAC.
**And** all payload validations use the shared Zod definitions exported by `packages/schemas`.

## Epic 2: Core Form Builder & Schema

**Goal:** Publishers can create, edit, version, and manage surveys using a drag-and-drop interface, while schemas remain strictly validated and immutable upon publish.

### Story 2.1: Shared Form Schema Validation

As a Full-Stack Developer,
I want a shared Zod schema package defining the Form Definition JSON,
So that both the frontend Form Builder and backend APIs validate the form structure consistently.

**Acceptance Criteria:**

**Given** the monorepo architecture
**When** a form definition is evaluated
**Then** it must be validated against the shared Form Definition Zod contract in `packages/schemas`.
**And** the schema must support standard block types (text, textarea, number, single choice, multiple choice, rating, linear scale, date, file upload).
**And** the schema package includes versioned integrity metadata support (expected-effort hints, attention check flags, consistency pairing rules, semantic category tags) that lock immutably with the published Form Version.
**And** the schema package includes basic versioning configuration to handle future upgrades.

### Story 2.2: Form Draft Creation & Lifecycle

As a Publisher,
I want to create a new form and have it saved automatically as a draft,
So that I can work on my survey over multiple sessions without losing progress.

**Acceptance Criteria:**

**Given** an authenticated Publisher
**When** they initiate a new survey creation
**Then** a new form record is created in the database with status `DRAFT`.
**And** subsequent changes made in the Form Builder automatically trigger autosave API calls to update the draft in the database.
**And** visual feedback (e.g., "Saved at 10:45 AM") is shown in the UI.

### Story 2.3: Form Builder Canvas & Block Types

As a Publisher,
I want to build my form using a drag-and-drop canvas supporting various input blocks,
So that I can construct complex surveys intuitively.

**Acceptance Criteria:**

**Given** the Form Builder interface
**When** the user drags a block from the toolbox onto the canvas
**Then** the block is rendered in the canvas and the internal JSON state is updated.
**And** the builder supports all required block types (text, textarea, number, single choice, multiple choice, rating, linear scale, date, file upload).

### Story 2.4: Form Block Editing & Manipulation

As a Publisher,
I want to select, edit, reorder, duplicate, and delete form blocks,
So that I can easily adjust the flow and content of my survey.

**Acceptance Criteria:**

**Given** a form with existing blocks
**When** the user clicks on a block
**Then** a properties panel opens allowing them to edit the block's specific settings (e.g., question text, choices, required flag).
**And** the user can drag the block to reorder it within the list.
**And** the user can click duplicate or delete to instantly manipulate the block.

### Story 2.5: Live Form Preview

As a Publisher,
I want to preview my form exactly as a Respondent will see it,
So that I can verify the layout and block behavior before publishing.

**Acceptance Criteria:**

**Given** a form draft being edited
**When** the user clicks the "Preview" button
**Then** the UI switches to a rendering mode displaying the form strictly via the shared Form Definition parser (no editing controls).
**And** interacting with the preview (e.g., typing in fields) does not save real response data to the database.

### Story 2.6: Form Publish Lifecycle & Immutability

As a Publisher,
I want to finalize my form and initiate the publishing process,
So that it can eventually be distributed while strictly locking the schema from edits to ensure data integrity.

**Acceptance Criteria:**

**Given** a complete form draft
**When** the user clicks "Publish"
**Then** the backend validates the entire form JSON against the shared Form Definition contract.
**And** the form status transitions from `DRAFT` to `ESCROW_LOCKED` (initiating the financial flow for external surveys) or directly to `PUBLISHED` (for internal non-reward surveys).
**And** the full lifecycle state machine is defined: `DRAFT` -> `ESCROW_LOCKED` -> `MODERATION_QUEUE` -> `PUBLISHED` -> `CLOSED`.
**And** once leaving the `DRAFT` state, the API strictly rejects any `PUT`/`PATCH` requests that attempt to mutate the form's blocks or schema.

### Story 2.7: Form Versioning

As a Publisher,
I want to create a new version of an already published form,
So that I can make adjustments (e.g., adding a new question) without corrupting the historical response data of the previous version.

**Acceptance Criteria:**

**Given** a form in `PUBLISHED` state
**When** the user clicks "Create New Version"
**Then** a new `FormVersion` entity is created under the same logical `Form`, with status `DRAFT` and `version_number` incremented under `unique(form_id, version_number)`.
**And** the published `FormVersion` remains immutable.
**And** every Attempt pins one exact `FormVersion`, and any Response derives its authoritative logical Form, version, and participant context from that Attempt.

## Epic 3: AI Form Generation Assistant

**Goal:** Publishers can rapidly generate form drafts using natural language prompts without blocking manual flows if the AI fails.

### Story 3.1: AI Prompt Submission & Payload Preparation

As a Publisher,
I want to describe my survey in natural language,
So that the AI can understand my requirements and generate an appropriate structure.

**Acceptance Criteria:**

**Given** the Form Builder interface
**When** the user clicks "Generate with AI"
**Then** a modal opens allowing them to input a text prompt.
**And** upon submission, the backend constructs a structured prompt payload including the shared Form Definition rules to send to the AI Gateway.

### Story 3.2: AI JSON Generation & UX Loading States

As a Publisher,
I want to see clear visual feedback while the AI is generating my form,
So that I know the system is working during the 30-60 second wait time.

**Acceptance Criteria:**

**Given** a submitted AI prompt
**When** the backend is waiting for the AI Gateway response
**Then** the frontend displays a clear loading state (e.g., skeleton loaders, progress text).
**And** the backend connection to the AI Gateway is configured with a 60-second timeout, bypassing the standard 500ms API SLA.

### Story 3.3: AI Output Parsing & Zod Validation

As a System Architect,
I want the AI output to be strictly validated before being saved,
So that AI hallucinations cannot corrupt the Form Builder state.

**Acceptance Criteria:**

**Given** a JSON response returned by the AI Gateway
**When** the backend receives the payload
**Then** it must parse the JSON and strictly validate it against the shared Form Definition Zod contract in `packages/schemas`.
**And** if validation passes, the JSON is saved as a new `DRAFT` form.
**And** the frontend loads this new draft into the standard drag-and-drop Builder for manual editing.

### Story 3.4: AI Failure & Fallback Isolation

As a Publisher,
I want the system to handle AI errors gracefully,
So that I can immediately switch to manual form creation if the AI server is down or returns invalid data.

**Acceptance Criteria:**

**Given** an AI generation request
**When** the AI Gateway times out, is unreachable via Tailscale, or returns Zod-invalid JSON
**Then** the backend gracefully catches the error and returns a friendly error message to the frontend.
**And** the UI notifies the user ("AI is currently unavailable or returned an invalid structure") and provides a direct CTA to "Build Form Manually."
**And** core system stability (login, survey feed, manual builder) is 100% unaffected by the AI failure.

## Epic 4: Survey Distribution & Public Access

**Goal:** Publishers can distribute surveys (internal feed or external links) and set targeting criteria; Respondents can discover targeted surveys.

### Story 4.1: Survey Targeting Criteria

As a Publisher,
I want to define demographic targeting criteria for my survey (e.g., age range, location),
So that my survey only reaches the relevant audience on the RESCOM Marketplace.

**Acceptance Criteria:**

**Given** a form being prepared for publish
**When** the user configures the distribution settings
**Then** they can set demographic requirements (e.g., Age 18-25, Location: Hanoi).
**And** the targeting configuration is saved as part of the survey's metadata (separate from the schema definition).

### Story 4.2: Automated Marketplace Matching

As a Respondent,
I want to see a personalized feed of surveys that match my demographic profile,
So that I don't waste time clicking on surveys I am not eligible for.

**Acceptance Criteria:**

**Given** an authenticated Respondent who has completed their demographic profile
**When** they view the Marketplace feed
**Then** the backend automatically filters the `PUBLISHED` surveys, only returning those where the Respondent's profile matches the Publisher's targeting criteria.

### Story 4.3: Feed Interactions (Sort/Filter/Auto-Hide)

As a Respondent,
I want to sort/filter my survey feed and automatically hide surveys I've already completed,
So that I can easily find new earning opportunities.

**Acceptance Criteria:**

**Given** the Marketplace feed
**When** the user views the page
**Then** any survey they have already submitted successfully is hidden from the feed.
**And** they can manually sort surveys by Reward amount or Estimated time.

### Story 4.4: Public Link & Guest Submissions

As a Publisher,
I want to generate a public link for my Internal Form and allow non-registered guests to submit responses,
So that I can collect data outside the RESCOM ecosystem without spending Escrow points.

**Acceptance Criteria:**

**Given** a published Internal Form configured for Public Access
**When** a non-logged-in user accesses the public link (`rescom.app/f/{id}`)
**Then** they can view and submit the form.
**And** the submission is tagged as `GUEST` and does NOT deduct points from the Publisher's Escrow, nor does it award points to the submitter.
**And** the guest submission receives Response Integrity assessment and contributes to Survey Quality, but Respondent Reliability is marked `NOT_AVAILABLE` and cannot be merged into an authenticated profile.
**And** the submission endpoint enforces strict IP-based rate limiting (e.g., 3 per day per IP) and requires an invisible reCAPTCHA/Turnstile token to prevent bot spam.

### Story 4.5: External Survey Setup (Google Forms)

As a Publisher,
I want to post a link to a Google Form and have the system auto-generate a Completion Code,
So that I can use RESCOM to drive traffic to my external surveys.

**Acceptance Criteria:**

**Given** the "Create External Survey" stepper
**When** the Publisher inputs their Google Forms link
**Then** the system automatically generates one unique, secure 6-digit Completion Code for the published External Form Version.
**And** shows the plaintext once and instructs the Publisher to paste it at the end of their external form while persisting only a keyed verifier.
**And** changing the code creates a new immutable Form Version; the code is not generated per Respondent attempt.

## Epic 5: Survey Execution & Responses

**Goal:** Respondents can complete surveys securely and smoothly, handling edge cases like timeouts, completion codes, and file uploads.

### Story 5.1: Survey Attempt Initialization & Concurrency

As a Respondent,
I want to start a survey attempt,
So that the system can verify my eligibility and reserve my spot before I spend time answering.

**Acceptance Criteria:**

**Given** a Respondent clicks "Start Survey"
**When** the backend receives the request
**Then** it verifies the exact FormVersion is published/open, the participant remains eligible, and the logical Form has not already been completed (FR-25).
**And** under concurrency it checks quota and conflicting active Attempts, then creates an expiring quota reservation.
**And** it creates an Attempt pinned by foreign key to that immutable `FormVersion`; authenticated one-completion is enforced at the logical `Form` level.
**And** in the same transaction it creates exactly one one-to-one Response identity with status `IN_PROGRESS`, so pre-submission telemetry has a durable `responseId`; submit transitions this record and never creates a second Response (FR-ADD-9, AD-19).
**And** External start applies the same published/open, eligibility, logical-completion, quota, conflicting-attempt, reservation, and server-start-time checks, omitting only the pre-submit Internal Response identity.

### Story 5.2: Internal Form Rendering & Execution

As a Respondent,
I want a smooth survey answering experience,
So that I can easily navigate questions even with unstable internet.

**Acceptance Criteria:**

**Given** an `IN_PROGRESS` internal survey
**When** the user is viewing the form
**Then** the frontend dynamically renders all inputs based on the shared Form Definition contract (FR-26).
**And** the renderer passively emits consented, privacy-preserving behavioral telemetry events (question view, answer select/change, focus/blur, navigation) via the shared telemetry contract (FR-58).
**And** if the network drops during answering, the UI caches inputs locally and shows an offline warning, automatically reconnecting when possible (UX-ADD-3); missing client telemetry must never block form submission.

### Story 5.3: File Upload Validation & Secure Storage

As a Respondent,
I want to upload files securely if a question requires it,
So that I can provide complete data without risking system security.

**Acceptance Criteria:**

**Given** a file upload block in a survey
**When** the user selects a file
**Then** the frontend validates file size and type (e.g., max 5MB, images/pdf only).
**And** the backend generates a secure, time-limited S3 presigned URL.
**And** the file is uploaded directly to private object storage through a scoped URL and enters the durable technical state `UPLOADED` then `QUARANTINED`; only a server-verified `CLEAN` object may become `ATTACHED` to the Response or downloadable, while scan outage fails closed (FR-ADD-10, AD-22).

### Story 5.4: Internal Form Submission

As a Respondent,
I want to submit my completed internal survey,
So that my answers are securely saved and I am credited with my reward instantly.

**Acceptance Criteria:**

**Given** a completed form payload
**When** the user clicks "Submit"
**Then** the backend strictly validates the `answers` array against the immutable FormVersion definition and shared schema contract (FR-40).
**And** upon success, saves the data, transitions the Response status to `VALIDATED`.
**And** for an authenticated Respondent, pins the effective policy-deployment identity/mode and atomically creates independent versioned `InternalRewardRequested` and `IntegrityAssessmentRequested` Outbox events carrying it in the same database transaction, with named ordering stream/sequence when ordering-sensitive, fenced claim/lease, retry/dead-letter, and atomic per-handler effect/deduplication semantics from AD-10; Guest Internal submission creates only the assessment event.
**And** in `SHADOW` or `ADVISORY`, Economy idempotently credits Available without waiting for scoring (FR-29); in an approved `ENFORCED` mode it posts the reward first to a non-spendable Integrity Hold and a later decision command releases or retains that hold.
**And** terminal assessment failure or a missed governance deadline in `ENFORCED` emits one idempotent fail-open release plus an incident so the hold cannot be stranded.

### Story 5.5: External Form Completion Code Verification

As a Respondent,
I want to enter the Completion Code I received from an external survey (e.g., Google Forms),
So that I can prove I finished it and claim my points.

**Acceptance Criteria:**

**Given** a completed external survey attempt
**When** the user enters a 6-digit Completion Code
**Then** the backend verifies the versioned keyed digest in constant time against the exact published External Form Version pinned by the active Attempt, never logs the plaintext/input code, and checks the server-authoritative Time Barrier (FR-13, FR-22).
**And** three failed validations lock the Attempt; account-plus-FormVersion abuse limits apply, and any IP/device scope requires Privacy approval.
**And** a named Participation coordinator atomically commits the completion claim and Economy Pending journal under one shared Unit of Work keyed `external-completion:{attemptId}`; failure rolls both back and retry returns the original result (FR-24, AD-16).
**And** provides an alternate flow ("Missing Code Report") if the user claims the Publisher forgot to include the code (FR-23).

## Epic 6: Immutable Point Ledger & Wallet

**Goal:** The system maintains an unalterable financial ledger for point transactions ensuring absolute integrity across balances, escrows, and top-ups.

### Story 6.1: Double-Entry Ledger Core & Idempotency

As a System Architect,
I want all point movements to be recorded in a double-entry ledger database,
So that point balances are strictly auditable and immune to race conditions or lost data.

**Acceptance Criteria:**

**Given** any financial point transfer (e.g., User to Escrow)
**When** the transaction is executed
**Then** Economy creates one `LedgerJournal` for the business command and at least two equal-and-opposite `LedgerEntry` rows against explicit `LedgerAccount` records (FR-30).
**And** the signed entries for each journal and Point unit sum to zero before posting in one database transaction.
**And** user Available, Pending, Frozen, Escrow, and Integrity Hold accounts cannot overdraft: Economy locks affected balance projections in ascending account-ID order and checks sufficiency, appends entries, and updates the rebuildable projection in the same transaction.
**And** posted journals/entries are append-only; each journal can be reversed at most once through a unique `reversesJournalId` journal that exactly negates it, with reversal-of-reversal forming a non-branching chain.
**And** the journal has one globally unique command/idempotency reference to prevent duplicate posting on retries (FR-ADD-11).

### Story 6.2: Wallet Balance Aggregation & Presentation

As a User,
I want to view my current point balances,
So that I know how much I can spend or withdraw.

**Acceptance Criteria:**

**Given** the Wallet UI
**When** the user loads the page
**Then** the backend calculates their balance dynamically, or via a rebuildable projection, from posted Ledger entries.
**And** the UI clearly displays: Available Balance, Pending Balance, Escrowed Points, and Frozen Points (FR-31).

### Story 6.3: Escrow Lock, Release & Refund

As a Publisher,
I want to lock points in Escrow when publishing a survey and get refunded for unused quotas,
So that respondents are guaranteed payment but I don't lose points if the survey ends early.

**Acceptance Criteria:**

**Given** a survey ready to publish
**When** the Publisher confirms payment
**Then** the system calculates the total cost (applying the 20% internal discount if applicable) (FR-14, FR-19).
**And** the Research publish coordinator atomically commits publication and Economy Escrow journal under one shared Unit of Work keyed by FormVersion; failure rolls both back (FR-15, AD-16).
**And** when the survey is manually closed, the Research close coordinator atomically commits close state and Economy refund journal for remaining Escrow under a stable close command (FR-32, FR-33).

### Story 6.4: Respondent Point Credit & Pending Logic

As a Respondent,
I want my points credited according to the survey type,
So that I receive instant rewards for internal surveys and pending rewards for external ones.

**Acceptance Criteria:**

**Given** a validated survey completion
**When** the reward transaction is triggered
**Then** for authenticated Internal forms in `SHADOW`/`ADVISORY`, Economy transfers points from Escrow to Available from the independent reward event without waiting for scoring (FR-29); Guest forms emit no reward event.
**And** under an `ENFORCED` policy, Economy first places points in an Integrity Hold; an immutable decision/review command releases or retains it, while terminal assessment failure/deadline releases fail-open and opens an incident.
**And** for External forms, the atomic completion coordinator transfers points to Pending, triggering an idempotent scheduled release after 48 hours only if no locked dispute hold exists (FR-24).

### Story 6.5: Frozen Starter Points Lifecycle

As a New User,
I want to receive starter points that unlock when I complete my profile,
So that I am incentivized to fill out my demographic data.

**Acceptance Criteria:**

**Given** a newly registered account
**When** the account is created
**Then** they receive 100 "Frozen" points (FR-4).
**And** when they successfully complete the Mandatory Demographic Survey and 1 additional marketplace survey, the ledger transfers these points from Frozen to Available (FR-8).
**And** a scheduled worker automatically expires (voids) these frozen points if both onboarding steps are not completed within 30 days of registration (FR-5).

### Story 6.6: Point Top-Up Request & Admin Approval

As a User,
I want to top up my balance via bank transfer,
So that I can fund my account to publish surveys.

**Acceptance Criteria:**

**Given** the Top-Up UI
**When** the user generates a transfer request
**Then** they are shown a QR code / Bank Info with a unique transfer syntax (FR-34).
**And** the request enters a "Pending Payment" state.
**And** an Admin can later review this request and click "Approve"; Economy verifies the live capability and idempotently commits approval plus one Ledger journal keyed `topup-approval:{topUpId}`, records actor/correlation, and emits a replayable Moderation admin-audit event (FR-35, AD-16).

## Epic 7: Onboarding, Demographics & Gamification

**Goal:** Respondents complete demographic profiles to unlock the platform and engage with gamification elements (streaks, tiers) to build habits.

### Story 7.1: Mandatory Demographic Survey

As a New Respondent,
I want to fill out my demographic profile upon my first login,
So that I can unlock my frozen starter points and access the survey marketplace.

**Acceptance Criteria:**

**Given** a newly registered user who has not completed onboarding
**When** they attempt to access the Marketplace
**Then** they are redirected to a Mandatory Demographic Survey (FR-6, FR-9).
**And** they cannot bypass this screen to access other earning features.
**And** upon successful submission, the system saves their profile and opens the Marketplace activation step; starter points remain Frozen until one additional Marketplace survey is completed (FR-7, FR-8).

### Story 7.2: Marketplace Survey Activation Step

As a New Respondent,
I want to complete one Marketplace survey after my demographic profile,
So that I can prove initial participation and unlock my starter Points.

**Acceptance Criteria:**

**Given** a Respondent who completed the demographic survey but has not completed activation
**When** they access the Marketplace
**Then** the system prompts them to complete one eligible Marketplace survey (FR-7).
**And** only after that completion does Economy transfer 100 Points from Frozen to Available exactly once (FR-8).

### Story 7.3: Automated Demographic Cross-Check (Algorithmic & AI-Ready)

As a System Architect,
I want the system to passively analyze user answers in internal forms and cross-check them against their onboarding profile,
So that we can detect respondents who provide false demographic data seamlessly.

**Acceptance Criteria:**

**Given** a Respondent submits an Internal Form
**When** the form contains questions related to demographic data (e.g., "Bạn bao nhiêu tuổi?", "Bạn đang sống ở đâu?")
**Then** the system algorithmically extracts the answers and compares them to the user's stored Onboarding profile (FR-27).
**And** if a discrepancy is detected, it creates a versioned integrity signal; it cannot independently reject a response or create a FraudLog entry unless a separate security policy is violated.
**And** the verification module must be designed via an Interface/Port so that a future "AI Verification Engine" can be seamlessly plugged in to augment the basic algorithmic checks without rewriting the core business logic.

### Story 7.4: Gamification: Daily Streaks

As a Respondent,
I want to see my daily survey completion streak,
So that I feel motivated to log in and earn points every day.

**Acceptance Criteria:**

**Given** an active Respondent
**When** they complete at least one survey in a calendar day
**Then** their `current_streak` counter is incremented (FR-49).
**And** if they miss a full calendar day, the `current_streak` resets to 0.
**And** the UI visually displays their streak on their dashboard.

### Story 7.5: Gamification: Respondent Leaderboard

As a Respondent,
I want to see where I rank compared to others,
So that I am competitively driven to complete more surveys.

**Acceptance Criteria:**

**Given** the Leaderboard UI
**When** a user views it
**Then** the backend returns an aggregated ranking of the top point-earners (FR-50).
**And** the user can see their own specific rank relative to the top 100.

### Story 7.6: Gamification: Progression Tiers (Trusted Researcher)

As a Respondent,
I want to unlock higher tiers by completing surveys,
So that I can earn better platform perks like faster payouts.

**Acceptance Criteria:**

**Given** a Respondent who has completed ≥ 100 valid surveys
**When** their count hits the threshold
**Then** they are automatically upgraded to the "Trusted Researcher" tier (FR-51).
**And** this tier automatically reduces the pending period for External Forms from 48 hours to 24 hours.
**And** completion count determines only the engagement tier; it does NOT automatically set Respondent Reliability, which is calculated independently based on verified internal response quality.

## Epic 8: Security, Moderation & Integrity Guard

**Goal:** The platform automatically blocks bot activity and provides Admins with tools to moderate content and resolve disputes.

### Story 8.1: Survey Moderation Queue

As an Admin,
I want to review all newly created surveys before they go live on the Marketplace,
So that I can ensure they meet platform guidelines and don't contain malicious content.

**Acceptance Criteria:**

**Given** a Publisher publishes a survey
**When** the status changes to `MODERATION_QUEUE`
**Then** it appears in the Admin Moderation Dashboard (FR-20, FR-53).
**And** an Admin can preview the survey and click "Approve" (moves to `PUBLISHED`) or "Reject" (moves to `CLOSED`, points refunded).

### Story 8.2: Automated Bot Protection (Time Barrier & Rate Limit)

As a System Architect,
I want to implement automated protections against bots,
So that malicious scripts cannot drain Publisher Escrows.

**Acceptance Criteria:**

**Given** a Respondent submitting an Internal Form
**When** the system receives the submission
**Then** it checks the "Time Barrier" (e.g., submission must take at least `number_of_questions * 2` seconds). If too fast, it's rejected (FR-45).
**And** it enforces the configured Rate Limit (FR-46, FR-28); PostgreSQL remains authoritative for the Attempt, and Redis becomes the shared counter store when multi-replica/shared enforcement is required.
**And** these security controls operate independently of and provide evidence to the Research Integrity Engine.

### Story 8.3: Integrity Incident System

As a System Admin,
I want the system to silently log suspicious behavior,
So that I can review patterns and identify sophisticated bots over time.

**Acceptance Criteria:**

**Given** a user failing the Time Barrier, Rate Limit, or Demographic Cross-Check
**When** the failure occurs
**Then** a rejected hard Time Barrier/Rate Limit violation logs a `FraudLog` entry, while a Demographic Cross-Check mismatch creates only a versioned Integrity signal unless separately confirmed as a security-policy violation (FR-47).
**And** `FraudLog` remains strictly reserved for confirmed abuse and hard security violations; response quality scoring and review routing remain in integrity assessment records.
**And** Admins can view a `FraudLog` monitoring dashboard to analyze these entries (FR-55).

### Story 8.4: Frozen Starter Point Anti-Bot Control

As a System Owner,
I want starter Points to remain unusable until onboarding is completed,
So that creating fake accounts cannot immediately create spendable value.

**Acceptance Criteria:**

**Given** a newly registered account with 100 Frozen Points
**When** onboarding is incomplete
**Then** the account cannot spend those Points (FR-48).
**And** Integrity scores or review routing never automatically freeze Available Balance; a separate authorized security/Admin action is required for account restrictions.

### Story 8.5: Complaint & Dispute Resolution Workflow

As a Publisher,
I want to report invalid responses from external surveys,
So that I don't lose points to low-quality respondents.

**Acceptance Criteria:**

**Given** an external survey response in the 48-hour pending window
**When** the Publisher clicks "Report Response" and provides a reason
**Then** the response enters a `DISPUTED` state, and the points remain locked.
**And** an Admin can review the dispute in the Admin Panel and decide to either "Refund Publisher" (returns points to Escrow/Publisher) or "Reject Complaint" (releases points to Respondent) (FR-54).

## Epic 9: Analytics, Feedback & Notifications

**Goal:** Users receive timely notifications and Publishers gain insights from survey traffic and respondent feedback.

### Story 9.1: Survey Traffic & Analytics Dashboard

As a Publisher,
I want to view basic analytics for my published surveys,
So that I can measure the performance and conversion rate of my campaigns.

**Acceptance Criteria:**

**Given** a published survey
**When** the Publisher opens the Analytics Dashboard
**Then** the UI displays: Total Views, Total Completions, Conversion Rate, and Average Completion Time (FR-41).
**And** for Internal Forms, it displays Response Integrity score distribution, confidence, evidence coverage, safe reason codes, and Survey Quality metrics (FR-40).
**And** for External Forms, the Integrity section displays `NOT_ASSESSED`.
**And** for Internal Forms, it also provides a CSV export of the raw JSON response data with assessment metadata.

### Story 9.2: Respondent Post-Completion Feedback

As a Respondent,
I want to rate and review the survey I just completed,
So that I can report if a survey was broken, misleading, or too long.

**Acceptance Criteria:**

**Given** a newly submitted survey
**When** the submission is successful
**Then** the UI immediately prompts the Respondent with a 5-star rating component and an optional comment box (FR-43).
**And** the feedback is saved, linked to the `form_id`, and feeds into Survey Quality aggregation only after validation.

### Story 9.3: Publisher Feedback Summary

As a Publisher,
I want to see the aggregated feedback from Respondents,
So that I can improve my future surveys.

**Acceptance Criteria:**

**Given** the Publisher's Survey Dashboard
**When** a survey has received feedback
**Then** the UI displays the average star rating and a list of respondent comments/tags (FR-42).

### Story 9.4: Negative Feedback Deprioritization

As a Platform Owner,
I want poorly rated surveys to lose visibility,
So that Respondents have a better experience on the Marketplace.

**Acceptance Criteria:**

**Given** a survey with an average rating below a specific threshold (e.g., < 2 stars after 10 reviews)
**When** the Marketplace feed is generated for a user
**Then** the algorithm deprioritizes this survey, pushing it to the bottom of the feed (FR-44).
**And** if it drops below a critical threshold (e.g., < 1.5 stars), it is automatically flagged for Admin Moderation review.

### Story 9.5: Transaction & Ledger Dashboard

As a User (Publisher/Respondent),
I want to view my complete point transaction history,
So that I can track my earnings and expenditures transparently.

**Acceptance Criteria:**

**Given** the Wallet UI
**When** the user clicks "Transaction History"
**Then** they see a paginated list of their point movements (earned, locked, refunded, spent) projected from owned Ledger journals and entries (FR-56).
**And** each entry shows the date, amount, transaction type, and related `form_id` (if applicable).

### Story 9.6: Event Notification System

As a User,
I want to receive notifications for important account events,
So that I know when my surveys are approved, points are released, or top-ups succeed.

**Acceptance Criteria:**

**Given** a system event (e.g., 48h pending points released, Top-up approved)
**When** the event occurs
**Then** an in-app notification record is created for the target user (FR-57).
**And** a notification badge appears in the user's header navigation.
**And** the user can click to view a list of recent unread notifications.

## Epic 10: Research Integrity Foundation & TrustGraph

**Goal:** Internal Form responses produce privacy-conscious telemetry, explainable integrity assessments, respondent reliability history, Survey Quality assessments, and TrustGraph-ready evidence without affecting external form compatibility.

### Story 10.1: Integrity Consent & Telemetry Event Contract

As a System Architect,
I want a shared Zod contract and consent schema for behavioral telemetry,
So that only approved, non-invasive interaction events are captured with explicit respondent consent.

**Acceptance Criteria:**

**Given** the shared schemas package
**When** telemetry schemas are defined
**Then** the contract permits only allowed event types: `QUESTION_SHOWN`, `ANSWER_SELECTED`, `ANSWER_CHANGED`, `QUESTION_SKIPPED`, `QUESTION_RETURNED`, `PAGE_HIDDEN`, `PAGE_VISIBLE`, `ATTENTION_CHECK_RESULT`, `RESPONSE_SUBMITTED` (FR-58).
**And** raw keystrokes, clipboard content, cross-site trackers, and background device inspection are strictly prohibited.
**And** each event requires `responseId`, `formVersionId`, `clientEventId`, `sequenceNumber`, and timestamp.
**And** the schema records consent-notice version acceptance prior to Internal Form answering.

### Story 10.2: Behavioral Telemetry Collection in Internal Form Renderer

As a Respondent,
I want my interaction telemetry captured smoothly in the background,
So that my survey answering is not slowed down or blocked by network glitches.

**Acceptance Criteria:**

**Given** an authenticated or guest respondent completing an Internal Form
**When** they interact with the form (changing focus, selecting answers, navigating)
**Then** the frontend batches and emits events to `POST /responses/:responseId/integrity-events` (FR-58).
**And** client event IDs ensure deduplication on the backend.
**And** telemetry failures or drops do NOT prevent response submission.

### Story 10.3: Signal Derivation Pipeline & Outbox Processing

As a Data Engineer,
I want a reliable asynchronous worker to derive integrity signals from stored events and answers,
So that raw events are distilled into normalized, immutable features for scoring.

**Acceptance Criteria:**

**Given** an `IntegrityAssessmentRequested` Outbox event triggered independently of the baseline reward event upon Internal Form submission (AD-10, AD-14)
**When** the Integrity Worker processes the event
**Then** it derives versioned signals: Temporal (dwell time, completion ratio), Interaction (revisions, skips), Attention check result, Consistency pairs, Semantic score (via AI Gateway if available), and Historical baseline (FR-59, FR-63).
**And** missing signals are explicitly marked as unavailable evidence rather than default penalties.
**And** derivation is idempotent and can be safely re-run without duplicate side effects.
**And** the worker claims with an owner/fencing token; an ordering-sensitive handler consumes its complete named stream, defers stream-sequence gaps, ignores duplicate/stale sequences, and commits each PostgreSQL-local effect with its processed-handler record atomically. Aggregate version is not used as a partial-subscription delivery offset.

### Story 10.4: Pure Versioned Response Integrity Scoring Core

As a System Architect,
I want a deterministic, pure domain scoring service,
So that response integrity assessments are mathematically reproducible and support progressive policy rollout.

**Acceptance Criteria:**

**Given** derived signals and an immutable `ScoringPolicy` definition
**When** the scoring engine calculates an assessment
**Then** it appends an assessment revision containing `score` (0–100 when applicable), `confidence` (0.0–1.0), `evidenceCoverage` (0.0–1.0), safe `reasonCodes`, policy version, and input lineage (FR-59, FR-63).
**And** a separate immutable `IntegrityDecision` links to that assessment and records operational outcome (`ACCEPT`, `REVIEW`, `NOT_ASSESSED`) plus rollout mode (FR-64).
**And** the engine operates in `SHADOW` (logged only), `ADVISORY` (visible to authorized users), or `ENFORCED` mode (AD-14).
**And** External Form responses automatically receive `NOT_ASSESSED` (FR-67).
**And** re-running with a new policy version creates a new assessment revision without overwriting historical records.

### Story 10.5: Cold Start & Respondent Reliability Snapshots

As a Respondent,
I want my reliability to start at a neutral baseline and build up over time,
So that I am not treated as suspicious just because I am a new user.

**Acceptance Criteria:**

**Given** a new or unestablished respondent (0–2 completed surveys)
**When** their response is scored
**Then** their Respondent Reliability state is `UNESTABLISHED` with low confidence, relying on current response evidence and cohort baselines (FR-60, FR-61).
**And** missing personal history does NOT penalize their integrity score.
**And** as verified internal responses accumulate, the system creates immutable `RespondentReliabilitySnapshot` records with updated `ReliabilityState` (`UNESTABLISHED` → `EMERGING` → `ESTABLISHED` → `TRUSTED`).
**And** guest submissions receive `NOT_AVAILABLE` for Respondent Reliability.

### Story 10.6: Survey Quality Assessment per Form Version

As a Publisher,
I want to receive objective quality insights for my survey design,
So that I can identify confusing questions or high-dropout sections across form versions.

**Acceptance Criteria:**

**Given** an Internal Form Version with completed and abandoned attempts
**When** the Survey Quality Worker aggregates data
**Then** it computes a `SurveyQualitySnapshot` using dropout rates, completion-time variance, question friction, attention failures, and respondent feedback (FR-62).
**And** poor Survey Quality does NOT penalize the reliability score of respondents who answered it.
**And** a new Form Version starts a clean, independent quality assessment.

### Story 10.7: Admin Integrity Review Queue & Label Feedback Loop

As an Admin,
I want a dedicated Integrity Review Queue separate from the FraudLog,
So that I can inspect flagged responses and confirm ground-truth quality labels.

**Acceptance Criteria:**

**Given** an assessment routed to `REVIEW` under an `ENFORCED` policy
**When** an Admin opens the Integrity Review dashboard
**Then** the UI displays the score, confidence, evidence coverage, reason codes, and response context without exposing raw keystrokes or hidden thresholds (FR-65).
**And** the Admin can resolve with `ACCEPTED`, `INSUFFICIENT_EVIDENCE`, or `REJECTED`.
**And** resolving with `ACCEPTED` idempotently releases held Escrow rewards to the respondent.
**And** confirmed review decisions are saved as immutable training/calibration labels.

### Story 10.8: Relational TrustGraph Projection & Evidence Protection

As a System Architect,
I want integrity-relevant relationships stored as a queryable relational projection in PostgreSQL,
So that the system can track graph evidence without requiring a separate graph database in MVP.

**Acceptance Criteria:**

**Given** authoritative records for Users, Responses, Form Versions, Reviews, and Policies are stable and a measured query/evidence trigger has been approved under AD-15
**When** relationships change
**Then** typed `TrustEdge` records are projected in PostgreSQL (e.g., Respondent → Response, FormVersion → Publisher, Response → ReviewOutcome) (FR-66, FR-67, AD-15).
**And** raw graph and device linkages are strictly isolated and never exposed through Publisher-facing APIs.
**And** the projection is fully rebuildable from primary transactional tables.

## Epic IR: Integration Readiness

**Goal:** Phase 1 launch journeys run end to end against the real backend with mock mode disabled, verified frontend-to-backend contracts, same-origin `/api` behavior, and evidence for every applicable success and failure state.

**Scope guard:** This epic integrates completed Phase 1 capabilities. It does not reactivate Epic 3, Epic 10, advanced analytics, advanced integrity, multi-replica scaling, Redis, or any other deferred Phase 2 scope. A deferred or unapproved entry point that remains reachable must be hidden or build-time excluded from the pilot.

**Dependencies and acceptance gates:**

- IR.1 establishes G0/G1 and unblocks IR.2; IR.2 is the G2 local real-stack gate. Epic 11 packaging and infrastructure may proceed in parallel once IR.1 confirms AD-23, the canonical origin, and environment ownership.
- IR.2a (respondent read endpoints) and IR.2b (scheduler and Outbox dispatcher) close backend gaps found by the 2026-09-30 readiness assessment. They may start after IR.1 and in parallel with IR.2. IR.3 requires IR.2a and IR.2b. IR.4a and IR.4b implement publisher/profile/admin reads approved at IR.1; IR.4 requires IR.4a and IR.4b, or the IR.1 decision to hide the corresponding routes. Migration order: IR.2a (attempt `closed_reason`/`closed_at`) → IR.2b (`scheduler_job_leases`, `forms.deadline_at`, Outbox dispatcher) → IR.4b email part (Outbox handler) and IR.4a deadline read. The IR.4b profile and admin-overview parts and IR.4a's other reads do not depend on IR.2b.
- IR.3 and IR.4 may proceed in parallel after IR.2. IR.5 requires both and is the G3 local integration gate.
- IR.6 requires IR.5 plus Stories 11.1–11.4 deployed to staging. IR.6 is the G5 evidence gate and blocks Story 11.5 go/no-go and production launch.
- Story status, a health check, or implementation completion alone is not gate evidence; each gate requires the named test report, trace, manifest, or drill record.

**Internal-testing milestone (2026-10-01, owner decisions in `.omc/plans/mock-off-full-backend.md`; reconciled by `sprint-change-proposal-2026-10-01.md`):**

- The milestone's goal is internal team testing on the real stack, not the pilot. For that goal, the plan replaces IR.1's scope decisions. No screen is hidden: the Phase 2-deferred features (disputes, reliability, quality, AI, engagement) run on MSW through `NEXT_PUBLIC_API_MOCKING=hybrid` (3 MOCK_ONLY + 14 DEFERRED_KEEP_MOCK, enforced by `tests/route-diff.test.mjs`). Screens that use them show a "Dữ liệu minh hoạ" tag.
- Overrides, internal testing only: IR.4a AC7 (export, Survey Quality and complaints stay reachable), IR.4a AC5.2 (version diff visible), IR.4b C3/C4 (`0` placeholders for disputes and quality), IR.4b C7 (no pilot nav filter). The IR.4a and IR.4b acceptance criteria below remain the pilot target.
- Built without a story and traced to the plan: auth throttle made configurable, S3 presigned checksum fix, runner `file_upload`, integrity consent, survey topic, QUOTA auto-close (not reopenable), forgot/reset password, session revoke reason, and admin fraud-log, ledger and outbox views.
- Before the pilot, IR.1 must re-gate every override above: hide or build-exclude the deferred screens, close export, and build staging with mocking `disabled`, not `hybrid` (IR.6).

### Story IR.1: Pilot Scope, Ownership and Contract Freeze

As an Integration Lead,
I want a canonical inventory of every frontend call and direct mock consumer in the approved pilot journeys,
So that the team knows which contracts are real, which gaps must close, and which deferred entry points must be hidden.

**Acceptance Criteria:**

**Given** the approved integration and deployment plan and the completed Phase 1 epics
**When** the G0/G1 review is completed
**Then** the pilot journey list, Integration Lead, Release Manager, domain owners, decision owners and due dates are recorded.
**And** AD-23 is confirmed with `app.rescom.io.vn` as the canonical browser origin and relative `/api` requests rewritten through Vercel, the public API edge/Cloudflare, Caddy and NestJS on private port 4000.
**And** every reachable frontend API call and direct `mockRepository` consumer is mapped to a controller, shared/request-response schema, access mode, status codes, idempotency/pagination behavior and applicable error states, with status `verified`, `assumed` or `mock-only`.
**And** every `assumed` or `mock-only` item has an owner, milestone and acceptance test; no launch-critical call is unclassified.
**And** a contract coverage report proves 100% of pilot-journey calls are mapped and no `mock-only` route remains reachable in the pilot build.
**And** password recovery, reliability, form responses, form analytics, progress, complaints, admin disputes and quality routes are explicitly approved for the pilot or hidden/build-time excluded without expanding deferred Phase 2 scope.
**And** external completion, analytics and consent/telemetry are explicitly recorded as in-scope or out-of-scope.
**And** secrets, credentials, placeholder bank data and other production-blocking defaults are inventoried with an owner and removal or rotation decision.
**And** each internal-testing override of 2026-10-01 (see the Epic IR note) is re-decided for the pilot.

### Story IR.2: Local Real-Stack Integration Foundation

As a Product Engineer,
I want a repeatable local frontend-to-backend integration loop,
So that domains can move from mocks to real APIs without an uncontrolled all-at-once cutover.

**Acceptance Criteria:**

**Given** the IR.1 contract register for the first vertical slice
**When** a developer starts the local integration environment
**Then** browser requests use relative `/api`, with local proxy, session cookies, exact-origin CSRF and the same-host OAuth callback behavior documented and tested.
**And** per-domain hybrid mock controls and a visible environment/mock banner identify whether each request uses mock or real data; an unhandled MSW request cannot silently fall through to the backend.
**And** a deterministic seed command creates a respondent, publisher, two distinct admins and a smoke account without production data.
**And** shell, email authentication, logout/session expiry, demographics and post-login routing run against the real backend without MSW.
**And** baseline unit, integration and E2E results are recorded and contract tests pass for the shell, email-authentication and demographics slice.
**And** migration prerequisites are checked and `prisma migrate deploy` runs through a pipeline-equivalent local path.
**And** build-time, non-secret runtime and secret runtime configuration are classified, with no secret committed or embedded in an image.

### Story IR.2a: Respondent Read Endpoints for the Survey Runner

As a Respondent,
I want the survey summary, my attempt, its pinned form and its outcome to load from the real backend,
So that I can start, resume, cancel and finish a survey without mock data.

**Acceptance Criteria:**

**Given** the frontend contracts currently marked ASSUMED in `lib/participation/survey-form-service.ts`, `attempts-service.ts`, `submission-service.ts` and `external-service.ts`
**When** the contracts are implemented
**Then** each request/response schema is promoted into `@rescom/schemas`, and the frontend service and backend controller import the same schema, which is covered by a contract test.

**Given** any caller, including an unauthenticated one
**When** it calls `GET /surveys/:id`
**Then** it receives only public facts about a published survey (title, description, form type, estimated duration, reward, remaining slots, status), with no targeting internals, Completion Code or Publisher-private data.
**And** an unknown, draft or unpublished survey returns 404 without leaking existence.

**Given** an authenticated Respondent who owns the Attempt
**When** they call `GET /attempts/:attemptId`
**Then** the response returns the Attempt status, server `startedAt`/`expiresAt`, form type and the **pinned** `formVersionId`/`versionNumber`. For an Internal Form it also returns the pinned version's Form Definition, which remains unchanged even after a newer version is published (AD-19, API-05).
**And** another user's Attempt returns 404 (not 403), and Admin read access, if any, is explicit and audited.

**Given** an owned Attempt
**When** the Respondent calls `GET /attempts/:attemptId/outcome`
**Then** the response returns the reward state derived from posted Ledger journals: `AVAILABLE`, `PENDING` with `releasesAt`, or `HELD_IN_INTEGRITY` only when an `ENFORCED` policy exists. It also returns the credited amount and the starter-point unlock effect, and it never recomputes or mutates balances.

**Given** an owned `IN_PROGRESS` Attempt
**When** the Respondent calls `POST /attempts/:attemptId/cancel` with CSRF and an `Idempotency-Key`
**Then** the Attempt moves to its abandoned state with a recorded reason and releases its quota reservation in one transaction.
**And** a retry returns the original result, and cancelling a submitted or completed Attempt returns 409 with a stable error code.

**And** every route uses the `{data,error,meta}` envelope and stable error codes, and has tests for unauthorized, not-found, conflict, concurrency (cancel racing submit) and idempotent retry.

### Story IR.2b: In-Process Scheduler and Outbox Dispatcher

As a Respondent and Publisher,
I want time-based point movements to happen automatically,
So that pending rewards release, starter points expire and unused escrow is refunded without an Admin pressing a button.

**Acceptance Criteria:**

**Given** the single-replica pilot (AD-5 amendment, AD-23)
**When** the API starts with the scheduler configuration flag enabled
**Then** exactly one logical scheduler owner runs in-process; with the flag disabled no job runs. Every job claims work through PostgreSQL with an owner/fencing token and lease (AD-10, AD-17), so a restart or accidental second owner cannot double-process.

**Given** External Form rewards whose 48-hour Pending window has elapsed and that carry no locked dispute hold
**When** the pending-release job runs
**Then** it releases them to Available through the existing idempotent Economy command (FR-24, NFR-13), producing exactly one Ledger journal per reward and a notification.

**Given** accounts whose starter onboarding has not completed within 30 days of registration
**When** the starter-expiry job runs
**Then** the Frozen Points are voided exactly once through the existing Economy command, and the user is notified (FR-5).

**Given** Attempts whose reservation has expired
**When** the reservation-expiry job runs
**Then** each Attempt is closed as abandoned and its quota slot is released, without racing a concurrent submission.

**Given** surveys whose deadline has passed with unfilled slots
**When** the escrow-refund job runs
**Then** the survey closes and the remaining Escrow is refunded under a stable close command, and the Publisher is notified (FR-32, NFR-12).

**Given** unprocessed `OutboxEvent` rows
**When** the Outbox dispatcher runs
**Then** it dispatches each event to its registered handlers with claim/lease, retry with backoff and dead-letter after a bounded number of attempts. Each handler's effect commits atomically with its `ProcessedHandler` record, so replay is a no-op.

**And** the existing admin re-drive and manual release endpoints keep working as operator fallbacks.
**And** job runs, claim conflicts, retries and dead letters are logged with correlation IDs and exposed to readiness/metrics.
**And** tests cover a clock-controlled boundary for every job, duplicate/concurrent runs, crash-after-claim recovery and a no-double-journal ledger invariant.

### Story IR.3: Respondent Journey Without Mocks

As a Respondent,
I want to complete the pilot survey journey against the real backend,
So that attempt state, pinned forms, submissions and rewards are proven before staging promotion.

**Acceptance Criteria:**

**Given** IR.2, IR.2a and IR.2b are complete and the respondent-domain contract gaps are resolved
**When** the respondent journey runs with its domain mocks disabled
**Then** authentication, demographics, marketplace eligibility, survey summary, attempt start/read/resume/cancel/outcome, pinned form read and internal submission complete end to end.
**And** concurrent reservation/start tests prove an attempt is not granted twice and resume continues on the form version pinned to that attempt.
**And** duplicate or offline-retried submissions are idempotent and do not duplicate completion, rewards or ledger entries.
**And** reward and wallet balances are explained by immutable ledger entries rather than direct balance updates.
**And** success and every applicable unauthorized, forbidden, validation, not-found, conflict, rate-limit, session-expiry, offline, idempotency and empty-state case have automated evidence.
**And** external completion is tested for time barrier, expiry and replay only if IR.1 approved it for the pilot; otherwise its entry point is not reachable.

### Story IR.4: Publisher, Financial and Moderation Journeys Without Mocks

As a Publisher and Admin,
I want publishing and governed financial actions to use the real backend,
So that the pilot proves escrow, top-up, moderation and notification invariants before launch.

**Acceptance Criteria:**

**Given** IR.2, IR.4a and IR.4b are complete (or their routes are hidden per IR.1) and publisher-domain contract gaps are resolved
**When** the publisher and administration journeys run with their domain mocks disabled
**Then** form draft creation/editing is idempotent and publish creates the expected escrow ledger entry for sufficient funds while rejecting insufficient funds safely.
**And** top-up approval creates an auditable ledger transaction and retries do not duplicate top-ups, rewards or notifications.
**And** transaction/outbox events produce real in-app notifications with no direct mock source.
**And** moderation is tested with two distinct admins; self-review is forbidden, concurrent decisions record only one result, and every decision has an audit trail.
**And** success and every applicable unauthorized, forbidden, validation, conflict, rate-limit, session-expiry, offline, idempotency and empty-state case have automated evidence.

### Story IR.4a: Publisher Progress and Response Viewing

As a Publisher,
I want to see my survey's progress and read the responses it has collected,
So that I can track collection and review my data inside RESCOM (FR-39, FR-40).

**Acceptance Criteria:**

**Given** the frontend contracts marked ASSUMED in `lib/forms/manage-service.ts` (`GET /forms/:id/progress?range=`), `lib/forms/results-service.ts` (`GET /forms/:id/responses[?versionNumber=]`, `GET /forms/:id/versions/:versionId`) and `lib/forms/results-analytics-service.ts` (`GET /forms/:id/analytics`)
**When** these contracts are implemented
**Then** each schema is promoted into `@rescom/schemas` and is shared by the frontend service and the backend controller under a contract test. Any field IR.1 did not approve is removed from the frontend rather than faked.

**Given** the Publisher who owns the form
**When** they call `GET /forms/:id/progress`
**Then** they receive completions against target, Points spent, Escrow remaining (derived from Ledger), deadline, status, and a bucketed time series for the requested `range` (FR-39).
**And** a non-owner receives 404; Admin read access, if granted, is explicit and audited.

**Given** an Internal Form owned by the Publisher
**When** they call `GET /forms/:id/responses`
**Then** they receive cursor-paginated submitted responses for one pinned Form Version, newest first, each with its `formVersionId` and answers (FR-40).
**And** no raw integrity telemetry, device/account evidence or unrelated Respondent history is returned. Respondent identity follows the IR.1/AD-21 privacy decision, and integrity metadata is `NOT_ASSESSED` while Epic 10 is deferred.
**And** an External Form returns an explicit not-applicable result rather than an empty list that could be mistaken for no data.

**Given** the analytics summary is approved at IR.1
**When** the Publisher calls `GET /forms/:id/analytics`
**Then** they receive per-question aggregates computed server-side for one Form Version within NFR-1, with no unbounded scan (NFR-30). If it is not approved, the analytics entry point is hidden.

**Given** the Form lifecycle has no paused status, and `POST /forms/:id/status` is Admin-only (verified 2026-09-30)
**When** the pilot build is produced
**Then** `PAUSE_SUPPORTED` stays `false`, and the unused ASSUMED `/pause` and `/resume` client and mock handlers are removed. Publisher pause requires a separate lifecycle story if IR.1 wants it.
**And** `deadlineAt` is read from `forms.deadline_at` once IR.2b adds it; until then it returns `null`.

**And** export, Survey Quality and version-diff routes stay hidden unless separately approved (OQ-6, OQ-8).
**And** tests cover owner, non-owner, empty, paginated and mixed-version cases.

### Story IR.4b: Profile Update, Email Delivery and Admin Overview

As a User and as an Admin,
I want to edit my profile, receive critical emails, and see what needs my attention,
So that the pilot supports FR-9 profile updates, FR-57 email for critical events and an actionable admin landing page.

**Acceptance Criteria:**

**Given** the ASSUMED contract in `lib/profile/profile-service.ts`
**When** an authenticated user calls `GET /users/me/profile` or `PATCH /users/me/profile` with CSRF
**Then** they read or update display name and the non-demographic profile fields (university, academic year, onboarding goal) through a shared schema.
**And** demographic matching fields keep flowing through the existing `/demographics` routes and take effect for future matching immediately (FR-9).
**And** the goal intent never changes roles or permissions.

**Given** a critical event (complaint resolution, ban/unban, top-up approved or rejected)
**When** the in-app notification is written
**Then** an email is also queued through an `EmailSenderPort` via the Outbox (IR.2b). A provider adapter is selected, configured and documented, and there is a local no-op/capture adapter.
**And** email sending is idempotent per event, failures retry without blocking the originating transaction, and no secret or personal data beyond what is required appears in logs.

**Given** an authenticated Admin
**When** they call `GET /admin/queue-counts` or `GET /admin/overview` (ASSUMED in `lib/admin/admin-queue-service.ts` and `overview-service.ts`)
**Then** they receive counts for pending moderation, pending top-ups and other queues approved at IR.1, plus overview aggregates computed with bounded queries.
**And** non-admins receive 403, and deferred queues (disputes, quality, fraud-log) are omitted or hidden rather than faked.

**And** tests cover validation, authorization, the email adapter contract and the no-duplicate-email invariant.

### Story IR.5: Launch-Domain Closure and Local Integration Gate

As a QA Lead,
I want a reviewed G3 evidence pack for all approved pilot domains,
So that staging receives only an application whose launch journeys no longer depend on mocks or assumed contracts.

**Acceptance Criteria:**

**Given** IR.3 and IR.4 are complete
**When** the local integration gate is reviewed
**Then** every launch-critical contract is `verified` with frontend path, controller, schema, access mode and passing contract test; none remains `assumed` or `mock-only`.
**And** shell, notification, feedback, onboarding guard and legacy respondent direct mock consumers are removed, redirected, hidden or build-time excluded as approved in IR.1.
**And** the approved upload flow proves presign, private upload, scan and finalize; storage or ClamAV failure is fail-closed and produces correlated alertable evidence.
**And** the respondent report proves one complete no-MSW journey and the publisher report proves a real ledger entry, including the applicable failure, concurrency and idempotency results.
**And** AI and every other deferred Phase 2 entry point remain hidden and no deferred scope is marked complete or moved into Phase 1.
**And** QA records an independent G3 pass; a story status or isolated health response is not accepted as substitute evidence.

### Story IR.6: Staging Integration Acceptance and Go/No-Go Evidence

As a Release Manager,
I want the complete pilot matrix proven on a production-like staging topology,
So that the production go/no-go decision is based on executable evidence rather than implementation status.

**Acceptance Criteria:**

**Given** IR.5 and Stories 11.1–11.4 are complete and deployed to isolated staging
**When** the G5 acceptance review runs
**Then** the staging frontend is built with `NEXT_PUBLIC_API_MOCKING` disabled and no mock route or direct mock consumer is reachable.
**And** synthetic respondent, publisher and two-admin accounts pass the approved journeys through Vercel same-origin `/api` rewrite, the public API edge/Cloudflare, Caddy and NestJS private port 4000.
**And** Google OAuth callback/session persistence, exact-origin CSRF/CORS, trusted client IP/rate limiting, file upload/ClamAV fail-closed behavior and one-replica performance meet the approved acceptance matrix.
**And** the promoted commit-SHA artifact, release manifest, controlled migration log, image scan, readiness/smoke report and no-secret evidence all identify the same release.
**And** correlated logs, Sentry release tracing with PII scrubbing, uptime/dependency alerts, backup/PITR restore and previous-image rollback are demonstrated and independently reviewed.
**And** the evidence pack has no open launch-critical defect and records incident ownership, rotation procedure, stop conditions and a signed G5 gate decision; failure of any required item blocks Story 11.5.

## Epic 11: Production Deployment & Pilot Readiness

**Goal:** The Phase 1 platform runs for pilot students on a simple, portable single-VPS topology (Hostinger VPS + Cloudflare R2, Architecture AD-23 amended 2026-10-05) with automated deploys, error and uptime alerts, tested backups, and a rehearsed exit path to another provider.

**Dependency and gate model:** Stories 11.1–11.4 may run alongside Epic IR after IR.1 confirms AD-23, the canonical origin and owners. Staging promotion requires the IR.5 local integration gate. Story 11.5 requires IR.6 plus Stories 11.1–11.4 and is the G6 gate and only path to production dark deploy and cohort opening. Story 11.6 is the G7 post-launch gate, follows a successful pilot and does not expand Phase 1 launch scope.

### Story 11.1: Deployment-Ready Backend Packaging

As a Developer,
I want the backend packaged as one production Docker image with a production Compose file,
So that the same artifact runs locally, on the pilot VPS, and on any later host.

**Acceptance Criteria:**

**Given** the npm workspace
**When** the production image is built
**Then** a multi-stage `Dockerfile` builds `@rescom/schemas` and the backend, runs as a non-root user on Node 22, and contains no secrets.
**And** `docker-compose.prod.yml` runs `caddy`, `api` and `clamav` with restart policies and healthchecks; no database, object storage or other business data lives in a container volume (AD-23).
**And** the frontend is not packaged or served by Caddy; browser traffic stays on the canonical frontend origin and reaches the backend only through Vercel's external `/api` rewrite, the public API edge/Cloudflare and Caddy.
**And** the `Caddyfile` proxies edge traffic to NestJS on private port 4000 and the trusted-proxy configuration restores, logs and rate-limits by the real client IP across the approved multi-hop chain.
**And** liveness and readiness endpoints exist; readiness reports database reachability and scanner reachability without leaking payloads (AD-17, NFR-ADD-4).
**And** scheduled durable work (pending-credit release, frozen-starter expiry, reservation expiry, Outbox dispatch) runs in-process behind one configuration flag so exactly one scheduler owner exists, still claiming work through PostgreSQL (AD-5 amendment, AD-10).
**And** the S3 client sets `requestChecksumCalculation` and `responseChecksumValidation` to `WHEN_REQUIRED`, and presigned upload plus download pass against the pilot S3-compatible store (Cloudflare R2, verified in Story 11.2) as well as local MinIO.
**And** local `docker-compose.yml` pins MinIO and `minio/mc` to fixed tags instead of `latest`.
**And** no provider-specific SDK (`@google-cloud/*`) is introduced (AD-23).

### Story 11.2: Hostinger VPS Pilot Infrastructure Provisioning

> Re-scoped 2026-10-05 from Google Cloud by `sprint-change-proposal-2026-10-04-hostinger-vps.md` (owner decisions B1–B4).

As an Operator,
I want the pilot infrastructure provisioned on the owner's Hostinger VPS with least exposure,
So that the API, database and storage are reachable only through the intended paths.

**Acceptance Criteria:**

**Given** the greenfield Hostinger VPS (Debian 12, x86_64, 2 vCPU, 7.8 GiB RAM, 99 GB SSD)
**When** the pilot stack is provisioned with Docker Compose
**Then** the host has a swapfile, cron/systemd timers and a measured resource baseline after the stack starts.
**And** PostgreSQL 15 runs as a private container on a durable volume with no public port; `prisma migrate deploy` runs explicitly from the API image, never on API startup.
**And** WAL archiving and a base backup ship to a dedicated private Cloudflare R2 bucket, and archive failures are visible (RPO 15 min / RTO 4 h targets; restore drill belongs to Story 11.4).
**And** each environment has one private Cloudflare R2 bucket for uploads, accessed through the existing S3 adapter with a token scoped to that bucket, and CORS limited to that environment's frontend origin; no MinIO runs on the VPS (`StoredObject.bucket` naming recorded).
**And** the host firewall admits 80/443 only from Cloudflare IP ranges, SSH uses keys only and is limited to team addresses, and Docker-published ports cannot bypass it; NestJS 4000, ClamAV 3310 and PostgreSQL 5432 are not public.
**And** Cloudflare provides the public API edge to the VPS with SSL mode Full (strict), and Caddy enforces the edge-key gate and signed client-IP chain.
**And** Vercel serves the canonical frontend origin from region `sin1` and external-rewrites same-origin `/api` to the public API edge; browser code does not call a backend origin directly.
**And** the Google OAuth client lists the canonical same-host callback under the frontend origin's `/api/...` path and the approved frontend URLs.
**And** secrets live in the VPS `.env` (file mode 600), Vercel server-only variables and GitHub Actions secrets only, never in the repository (NFR-ADD-3).
**And** staging uses a separate database, R2 bucket, OAuth client/secret, domain, edge key and synthetic accounts while mirroring the production proxy topology, run sequentially on the shared VPS.

### Story 11.3: CI/CD Pipeline with Rollback

As a Developer,
I want every merge to main verified, built and deployed automatically,
So that releases are repeatable and a bad release can be reverted in minutes.

**Acceptance Criteria:**

**Given** a push to the main branch
**When** the GitHub Actions workflow runs
**Then** it runs `npm run verify` and stops on failure.
**And** it builds the backend image once, scans it, tags it with the immutable commit SHA and pushes it to GHCR without embedded secrets.
**And** it records a release manifest containing image SHA, schema version and non-secret config version.
**And** after a backup check it deploys over SSH by pulling the tag, running the backward-compatible `prisma migrate deploy`, restarting one API replica and waiting for readiness and synthetic smoke; failure restores the previous tag automatically.
**And** a manual workflow input redeploys an earlier tag using the rehearsed previous-image rollback path; schema incidents use a reviewed forward fix or restore rather than a blind down migration.
**And** the frontend continues to deploy through Vercel's Git integration.

### Story 11.4: Observability, Alerting and Backup-Restore Drill

As an Operator,
I want errors, downtime and backup failures to reach the team quickly,
So that pilot incidents are noticed and recoverable.

**Acceptance Criteria:**

**Given** the deployed pilot environment
**When** observability is configured
**Then** Sentry captures frontend and backend exceptions with release tags, with request bodies, cookies and personal data scrubbed (NFR-ADD-4).
**And** an external uptime monitor checks the canonical frontend and a documented TLS readiness path through the public API edge/Caddy chain and alerts Telegram or email.
**And** WAL-archive or base-backup failures to R2, database connectivity, VPS disk above 80%, memory exhaustion and ClamAV health raise alerts.
**And** one point-in-time restore from the R2 base backup + WAL into an isolated scratch PostgreSQL container has been performed, timed against the approved RPO 15 min / RTO 4 h, and its steps written down; backup retention is proposed for Operations approval (NFR-ADD-5).
**And** a previous-image rollback has been rehearsed against a compatible schema and its evidence is retained for the G5 review.
**And** G4 is recorded as passed only when staging mirrors the approved domain/proxy topology, the database and bucket are private, migrations run only through the controlled pipeline, and previous-image deployment/rollback is reproducible.

### Story 11.5: Pilot Launch Readiness

As the Product Owner,
I want a launch checklist verified on production,
So that the first pilot students meet a working, governed platform.

**Acceptance Criteria:**

**Given** Stories 11.1–11.4 and IR.6 are done with independently reviewed G5 evidence
**When** launch readiness is reviewed
**Then** the AD-21 processing register has Product plus Privacy/Legal approval; without it the launch date moves.
**And** at least two active ADMIN accounts exist (self-moderation and self-top-up approval are forbidden, decision E8-D3).
**And** real top-up bank account values are configured (production refuses placeholders) and `PARTICIPATION_RATE_LIMIT_POLICY_VERSION` is set.
**And** the Form Builder hides the "Generate with AI" entry point while the AI Gateway is unconfigured (AD-3/AD-4 amendment).
**And** a signed go/no-go confirms the freeze window, backup check, immutable rollback artifact, incident owners and approved stop conditions before migration or cohort access.
**And** production is dark-deployed as one API replica, runs the controlled `prisma migrate deploy`, and passes TLS liveness/readiness plus synthetic business smoke using dedicated test accounts and no mock records.
**And** the production smoke covers email and Google registration, onboarding, respondent completion/reward, publisher publish/escrow, two-admin moderation, file upload, top-up approval, notifications and alert delivery.
**And** only after dark-deploy evidence passes is a limited cohort opened; any approved stop condition closes the cohort or triggers rollback.
**And** general pilot access requires a recorded decision after the limited cohort completes without a launch-critical incident.

### Story 11.6: Post-Pilot Hosting Review, Post-Launch Review and Portability Rehearsal

> Re-scoped 2026-10-05: Google Cloud dropped; no trial clock. The pilot runs on the owner-held Hostinger VPS (AD-23 amendment 2026-10-05).

As the Product Owner,
I want the pilot reviewed and the long-term hosting choice made and rehearsed,
So that launch learnings are owned and the platform can move hosts without data loss.

**Acceptance Criteria:**

**Given** Story 11.5 has completed the limited cohort
**When** the hosting review is prepared
**Then** measured VPS CPU, RAM and disk utilization, R2 usage/cost and the Hostinger renewal price are compared with any alternative the team proposes.
**And** a rehearsal restores the database from R2 (base backup + WAL) on a fresh host, keeps R2 objects in place, switches configuration only, and passes the smoke test.
**And** any host change is executed in a maintenance window that stops writes during the final restore/cutover so the ledger stays consistent.
**And** the G7 review records contract gaps, journey failures, incidents, support signals and a remediation backlog with an owner for every launch-critical item.
**And** remaining hybrid mock workarounds are closed, the AI entry point remains hidden, and recurring restore drills, secret rotation, dependency/image updates and rollback-artifact retention have assigned owners.
**And** multi-replica scaling, Redis, advanced synthetic journeys, richer dashboards and other deferred work remain Phase 2 unless a separate decision promotes them.

## Epic 12: Rewards — Voucher Redemption & Flash Sale (Phase 2)

**Goal:** Users spend Available Points (earned, top-up, or unlocked starter) on F&B partner vouchers, including time-boxed Flash Sales, and always see the locked price before any Point is deducted. Admins manage the catalog, code inventory, Flash Sales, and redemption statistics.

**FRs covered:** FR-68 … FR-75. **Architecture:** AD-24 (plus AD-1, AD-10, AD-16). Added by `sprint-change-proposal-2026-10-13.md`.

**Dependency and gate model:** Production enable follows Story 11.5 (pilot launch). FE-mock Stories 12.1–12.6 may start immediately and use the planning-doc defaults only inside MSW mocks. Backend gates: Story 12.7 requires PRD Open Question 25; Story 12.8 requires Open Questions 23 and 26; Story 12.11 (production enable) requires Open Question 24.

**UX source:** Figma Rescom (`mkudD5Ngi5RPyIAVxCcxXi`), pages 20–27. Components and tokens are on page 20 (node `113:3`); screens are on 21 (`113:4`), 22 (`113:5`), 23 (`113:6`), 24 (`113:7`), 25 (`113:8`), 26 (`113:9`), and 27 (`140:2`). Business rules are BR-01…BR-24 in the planning doc "Rescom — Đổi điểm lấy voucher F&B & Flash Sale" (2026-10-13).

**Out of scope:** Partner-API code issuance, a tablet layout, a fifth mobile tab, and fixes for the three existing design-system mismatches (TabBar "Tạo khảo sát", DesktopTopBar showing frozen instead of available points, and the non-component Admin sidebar). The mismatches are tracked separately.

### Story 12.1: Rewards Contracts & MSW Mock Domain

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

### Story 12.2: Voucher Marketplace, Filters & Detail

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

### Story 12.3: Confirm & Redemption Result

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

### Story 12.4: My Vouchers, Code/QR & History

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

### Story 12.5: Admin Voucher Catalog & Codes

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

### Story 12.6: Admin Flash Sale & Rewards Statistics

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

### Story 12.7: Rewards Schema, Catalog & Code Inventory API

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

### Story 12.8: Quote & Redemption Transaction

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

### Story 12.9: Flash Sale Lifecycle

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

### Story 12.10: My Vouchers, Reminders & Faulty-Code Resolution

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
**And** Admin may instead reject a report with a mandatory note; a rejection moves no stock, code or Points, counts as the report's one outcome, and the user is notified (decision 2026-10-14).
**And** expired, unused vouchers are not refunded (BR-23).

### Story 12.12: Admin Code-Issue Queue — Contract & MSW Mock

As a Developer,
I want the Admin code-issue queue contracts and a mock domain,
So that the queue screen can be built and reviewed against the exact backend contract of Story 12.10.

**Acceptance Criteria:**

**Given** the Admin schemas defined by Story 12.10 in `packages/schemas`
**When** the frontend adopts them
**Then** MSW handlers exist for `GET /admin/rewards/code-issues`, `GET /admin/rewards/code-issues/:id`, and `POST /admin/rewards/code-issues/:id/resolve`, parse every payload with the shared Zod schemas, and are listed in `DEFERRED_KEEP_MOCK` until Story 12.11.
**And** the mock state and rules mirror the backend: one OPEN report per redemption, at most one outcome (REPLACE, REFUND, or REJECT with a mandatory note), `canReplace` and `replaceBlockedReason` (shared code, no stock, no code, expired ticket), repeat of the same outcome is a no-op, a different outcome returns `CODE_ISSUE_ALREADY_RESOLVED`.
**And** resolving in the mock updates the user's ticket and history (replacement code, REFUNDED entry with an `RFD-` reference and points back, or unchanged for REJECT) so both portals stay consistent.
**And** no Admin payload contains an original or replacement code value.
**And** mock-only unit tests cover the rules and every error code; the route-diff and allowlist tests stay green.

### Story 12.13: Admin Code-Issue Queue Screen

As an Admin,
I want a queue of faulty-code reports with clear resolve actions,
So that users get a replacement, a refund, or an explanation within the target of one business day.

**Acceptance Criteria:**

**Given** an Admin in the Admin console
**When** they open Báo cáo mã lỗi (new AdminSidebar entry next to Voucher, Flash Sale, and Thống kê voucher)
**Then** the list shows open reports oldest first with voucher, brand, reason, note, points, age, and ticket status, filters Open, Resolved, and All, and paginates (FR-75).
**And** the detail shows the redemption reference and the resolution history, and offers Thay mã, Hoàn điểm, and Từ chối; Thay mã is disabled with the reason when `canReplace` is false.
**And** each action asks for confirmation that explains its effect (replacement uses one stock unit and one code; refund returns the Points and cannot be undone; rejection requires a note that the user will see).
**And** loading, empty, error, and already-resolved states are handled, and success and failure toasts use the backend error codes.
**And** the screen works against the Story 12.12 mock; the design source is a new Figma page for the queue that must exist before this story starts (Open Question: design owner Quan).

### Story 12.11: Rewards Integration Without Mocks & Enable Gate

As the Product Owner,
I want Rewards proven end to end on the real stack before it is enabled,
So that the pilot economy is not put at risk.

**Acceptance Criteria:**

**Given** Stories 12.1–12.10, 12.12, and 12.13 are done
**When** Rewards journeys run with mocks disabled
**Then** browse, redeem (success and every failure code), my vouchers, faulty-code resolution (user report and Admin queue), Admin catalog, Flash Sale, and statistics pass against the real backend.
**And** the statistics API backs the Admin dashboard.
**And** a load test of concurrent redemptions on one Flash voucher at start time records p95 latency and confirms no oversell and no double charge on the pilot VPS profile.
**And** Rewards sits behind a feature flag that is off by default; production enable requires the PRD Open Question 24 decision (accounting and tax) to be recorded, and the Ví điểm copy says that Points are never withdrawn as cash.

## Epic 13: PayOS Top-Up & 24-Hour Refund

Users top up Points by PayOS QR and are credited instantly without Admin approval, can cancel a Processing top-up, and track every top-up on a 6-balance Wallet. A mistaken top-up can be refunded within 24 hours, only to the paying bank account, and an unresolved request can be withdrawn. Admins resolve amount mismatches and refunds within 3 business days, re-check any payment against payOS, export CSV for reconciliation, and switch from manual top-up to PayOS without taking production down. Architecture: AD-25, AD-26. UX source: Figma pages 29, 30, 20 (after the designer fix and addendum). Production enable is gated by PRD Open Question 27 and Story 13.13.

### Story 13.1: Top-Up Schema for PayOS

As a Developer,
I want `TopUpRequest` extended for the PayOS channel,
So that manual and PayOS top-ups share one durable, constrained entity.

**Acceptance Criteria:**

**Given** the current `top_up_requests` table with `PENDING`/`APPROVED`/`REJECTED` manual rows
**When** the migration runs
**Then** `TopUpRequest` gains `channel` (`MANUAL` | `PAYOS`, existing rows backfilled `MANUAL`), `orderCode` (unique, from a PostgreSQL sequence starting at `1000000000`), `paymentLinkId`, `expiresAt`, `cancelledAt`, `pointsCredited`, write-once provider facts `amountPaidVnd`, `providerReference`, `paidAt`, and nullable `counterAccountBankId`, `counterAccountBankName`, `counterAccountName`, `counterAccountNumber` (AD-25).
**And** `TopUpStatus` adds `PROCESSING`, `SUCCESSFUL`, `CANCELLED`, `EXPIRED`, `AMOUNT_MISMATCH`, `MANUAL_REFUNDED`; legacy statuses keep their meaning and existing rows are unchanged.
**And** `transferReference` becomes nullable and stays unique for `MANUAL` rows.
**And** raw-SQL migration steps own the sequence, the `CHECK`s for `PAYOS` rows (10,000 ≤ `amountVnd` ≤ 5,000,000, `amountVnd % 200 = 0`), and the partial unique index allowing at most one `PROCESSING` row per user.
**And** a second `PROCESSING` insert for the same user fails at the database, proven by an integration test.
**And** the full migration chain applies from an empty database and from the current production snapshot, and the existing manual top-up tests still pass.

### Story 13.2: PaymentProviderPort & payOS Adapter

As a Developer,
I want one Economy adapter behind `PaymentProviderPort`,
So that the payOS SDK never leaks into the domain and every test runs without real money.

**Acceptance Criteria:**

**Given** `@payos/node` 2.x is added to the backend only
**When** the adapter is implemented
**Then** `PaymentProviderPort` exposes create, get, cancel, and verify-webhook, and only the Economy infrastructure adapter imports `@payos/node` (enforced by a lint/boundary rule) (AD-25, AD-10).
**And** create sends `orderCode`, exact `amount`, `description` = `RC` + last 7 digits of `orderCode` (≤ 9 characters), `returnUrl`, `cancelUrl`, `expiredAt` = now + 5 minutes, with SDK `maxRetries: 0`.
**And** the adapter maps payOS statuses to local effects exactly as the AD-25 table (`PAID` full / other amount / `UNDERPAID` / `PENDING` / `PROCESSING` / `CANCELLED` / `EXPIRED` / `FAILED`), and extracts `amountPaid`, `transactionDateTime` (parsed `Asia/Ho_Chi_Minh`, stored UTC), and `counterAccount*` (first non-null wins).
**And** `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` are read from server-only config, validated at startup when used, and never logged or sent to the client (NFR-31).
**And** a fake adapter and HMAC-signed fixture webhooks are available to tests; contract tests run against recorded payOS payloads, including null `counterAccount*`.

### Story 13.3: Top-Up Checkout, User Cancel & Enable Guard

As a User,
I want to start a PayOS top-up for an exact amount and cancel it if I change my mind,
So that I can pay by QR without waiting for an Admin.

**Acceptance Criteria:**

**Given** `PAYOS_ENABLED=true` and no manual `PENDING` row existed at startup
**When** the user posts a checkout amount
**Then** amounts below 10,000, above 5,000,000, or not a multiple of 200 VNĐ are rejected with a field error before any payOS call (FR-34).
**And** the server computes Points = amount ÷ 200; any client-supplied Points value is ignored.
**And** the `PROCESSING` row commits before `paymentRequests.create`; on success `paymentLinkId` is stored and `checkoutUrl` returned; on create failure the row moves to `CANCELLED` and the user sees a retryable error (AD-25).
**And** a second checkout while one is `PROCESSING` returns 409 with the existing top-up id.
**And** the owner can cancel their `PROCESSING` top-up: payOS cancel is called through the port, the row becomes `CANCELLED`, the user notification is written to the Outbox, and a new checkout is allowed at once; cancelling another user's top-up returns 404 (FR-76).
**And** if the payOS cancel call fails or times out, the row still becomes `CANCELLED` locally, the failure is logged, and a later full payment is credited through the existing late-payment path (FR-35, AD-25).
**And** checkout is limited per user (5 checkouts per 10 minutes, configurable); excess requests return 429 before any payOS call (NFR-7).
**And** if any `MANUAL` `PENDING` row exists at startup, the process still starts with PayOS effectively off (checkout closed, manual submission open), raises an Admin alert and an error log, and turns PayOS on only after a restart with no `PENDING` rows (FR-79, AD-25).
**And** with PayOS effectively off, checkout returns 404/feature-disabled and the manual flow behaves exactly as before.
**And** a pre-deploy script prints the count of `MANUAL` `PENDING` rows and exits non-zero when any exist.

### Story 13.4: Payment Webhook & Automatic Credit

As a User,
I want my Points credited the moment PayOS confirms payment,
So that I can use them without waiting.

**Acceptance Criteria:**

**Given** a `PAYOS` top-up and a payOS webhook delivered to `app.rescom.io.vn/api/...` (proxied with the edge key; no cookie, explicit CSRF opt-out, no per-IP throttling) (AD-25)
**When** the webhook arrives
**Then** an invalid signature returns 401 and changes nothing; a valid but unknown or duplicate `orderCode` (including the `confirm-webhook` probe) returns 200 with no effect; a processing failure returns 5xx (NFR-31).
**And** a valid `code`/`data.code` = `"00"` triggers a server-side GET for the authoritative `amountPaid` and status; `returnUrl` parameters are never treated as proof.
**And** a valid signature with `code` or `data.code` ≠ `"00"` returns 200, changes nothing, and is logged; reconciliation (Story 13.5) remains the recovery path.
**And** `CreditTopUp` (`topup-credit:{topUpId}`) locks the row `FOR UPDATE`, compare-and-sets the status, writes provider facts and `counterAccount*`, posts `SYSTEM_CLEARING → USER_AVAILABLE` for `amountVnd / 200`, sets `pointsCredited`, and writes the user notification and the user email (top-up Successful) to the Outbox in one transaction (FR-35, FR-57).
**And** a full payment on a local `CANCELLED` or `EXPIRED` row still credits and moves it to `SUCCESSFUL` with a notification.
**And** `PAID` with another amount or `UNDERPAID` moves the row to `AMOUNT_MISMATCH` with cumulative `amountPaidVnd`, credits nothing, and notifies the user.
**And** concurrent and repeated deliveries credit at most once, proven by a concurrency test of two webhooks plus a direct `CreditTopUp` call; `ReverseJournal` on a top-up credit journal is rejected.

### Story 13.5: Reconciliation Job, Alerts & Admin Re-Check

As an Admin,
I want lost confirmations recovered automatically and on demand,
So that no paid top-up stays uncredited and no expired one stays open.

**Acceptance Criteria:**

**Given** the Economy scheduler with AD-17 lease/fencing
**When** the job runs every minute
**Then** it checks `PROCESSING` rows, unresolved `AMOUNT_MISMATCH` rows, and rows `EXPIRED` or `CANCELLED` within the last 24 hours against payOS GET and applies the AD-25 mapping through `CreditTopUp` (NFR-32).
**And** a `PROCESSING` row past `expiresAt` (local clock) becomes `EXPIRED`, with a best-effort payOS cancel and a user notification.
**And** this story introduces the server-only config key `TOPUP_REFUND_MAILBOX` (validated at startup when PayOS is used; Story 13.10 reuses it for refund emails).
**And** an Admin alert (in-app notification, email to `TOPUP_REFUND_MAILBOX`, Sentry) fires once per condition: uncredited 30 minutes after a verified payment; `AMOUNT_MISMATCH` unresolved 3 business days after `paidAt`; repeated provider failure.
**And** business days are Monday–Friday in `Asia/Ho_Chi_Minh` with no holiday calendar, implemented in one shared helper with tests across a weekend.
**And** Admin `RecheckTopUp` on any `PAYOS` row runs the same GET + mapping + `CreditTopUp` path on demand, is idempotent, is audited, and returns credited / still unpaid / mismatch.
**And** two job instances never process the same row concurrently, proven by a lease test, and job + webhook racing still credits once.

### Story 13.6: Live payOS Probe in Production

As the Product Owner,
I want one real payment captured before refund work starts,
So that the refund design rests on payOS behavior we have observed, not assumed.

**Acceptance Criteria:**

**Given** Stories 13.1–13.5 are deployed to production with `PAYOS_ENABLED=false`
**When** the Owner completes the payOS setup and runs the probe CLI script on the VPS
**Then** this story delivers a `confirm-webhook` CLI script (through `PaymentProviderPort`, no SDK use outside the adapter) and an Owner-run setup checklist in `docs/` with these steps, each recorded with date in the story record:
  1. create the payOS payment channel linked to the Owner's bank account and copy Client ID, API Key, and Checksum Key;
  2. add `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`, and `TOPUP_REFUND_MAILBOX` to `deploy/.env.prod` on the VPS only (never committed), then rebuild and restart the `backend` service;
  3. run the `confirm-webhook` script with the production webhook URL (`https://app.rescom.io.vn/api/...` from Story 13.4) and record success; the probe-delivery webhook returns 200 with no effect.
**And** the probe script refuses to run when any `PAYOS_*` key is missing or `confirm-webhook` has not succeeded.
**And** the script creates one 10,000 VNĐ payment link through the adapter for an Owner-designated account, without opening checkout to users.
**And** after the Owner pays, the webhook arrives through the Vercel proxy and the top-up is credited by the webhook path, not by reconciliation (log evidence).
**And** the recorded webhook payload and GET response (secrets and full account numbers redacted) are saved as test fixtures and attached to the story record, confirming the status enum, `amountPaid`, `transactionDateTime`, whether `counterAccount*` is present, and whether a 9-character `description` is accepted.
**And** if `counterAccount*` is null, the Owner decides whether FR-77 changes before Story 13.10 starts; the decision is recorded in the PRD.
**And** the probe is paid from the Owner's own bank account to the Owner's payOS account, so no money refund is needed; the 50 credited Points stay on the Owner's RESCOM account and are noted in the story record (no ad-hoc ledger adjustment).

### Story 13.7: Wallet & Top-Up Screens

As a User,
I want to top up, follow each payment, and see all my balances,
So that I always know where my Points and money are.

**Acceptance Criteria:**

**Given** the fixed Figma page 29 frames A1–A4 and A8 and the Story 13.3–13.5 APIs
**When** the user opens `/wallet`
**Then** six balance cards show in order Khả dụng (emphasized), Đang chờ, Ký quỹ, Đóng băng, Giữ để xét, Giữ chờ hoàn tiền, each with a tooltip (FR-31, UX-DR-P2).
**And** top-up history shows code, amount, Points, time, status chip (7 statuses plus Under review for mismatch, icon + text, WCAG AA) and channel label PayOS / Thủ công (cũ) (FR-76, UX-DR-P1, P3).
**And** while a `PROCESSING` top-up exists, `/wallet` shows the Processing banner and polls the same status query as `/wallet/top-up/:id` until a terminal status or expiry + 2 minutes, then refreshes balances and history without a page reload (FR-76, UX-DR-P3).
**And** a `MANUAL_REFUNDED` top-up shows the Refunded chip with the copy "Đã hoàn tiền thủ công cho thanh toán sai số tiền — không có Điểm nào được cộng" and no reversal-entry link (FR-76, UX-DR-P1, P9).
**And** the Point-history list labels a PayOS top-up credit as "Nạp Điểm qua PayOS" and a mismatch credit as "Nạp Điểm (đã điều chỉnh theo số thực nhận)" (FR-31).
**And** `/wallet/top-up` validates min, max, and multiple of 200 inline with a nearest-valid suggestion, shows the Points preview and quick chips, and redirects to `checkoutUrl`; when a `PROCESSING` top-up exists the input is disabled with "Tiếp tục thanh toán", "Xem giao dịch", and "Huỷ giao dịch" (UX-DR-P4, P16).
**And** `/wallet/top-up/:id` shows Processing, Successful, Cancelled, Expired, mismatch, not found, and error states from the backend only, never from URL parameters (NFR-31, UX-DR-P5).
**And** Processing polls until a terminal status or expiry + 2 minutes, then shows "Kiểm tra lại" with the note that a completed payment will still be credited (UX-DR-P24).
**And** the top-up detail shows the info table and status timeline; the refund section is hidden until Story 13.11.
**And** notifications render for top-up successful, cancelled, expired, and mismatch (UX-DR-P10).
**And** every screen ships Desktop 1440 and Mobile 390 with loading, empty, and error states, and the manual top-up form remains reachable only while PayOS is effectively off.

### Story 13.8: Admin Top-Up Console

As an Admin,
I want one place to see every top-up, re-check payments, and export records,
So that I can support users and reconcile against the bank.

**Acceptance Criteria:**

**Given** the fixed Figma page 30 frame B1
**When** the Admin opens `/admin/top-ups`
**Then** the page shows tabs with count badges; this story ships "Giao dịch PayOS" (filters by status and date, search by code or email) and "Lịch sử thủ công (cũ)" (read-only, existing manual rows) (UX-DR-P11).
**And** while any manual `PENDING` row exists, the existing approve/reject actions stay available until Story 13.13 retires them.
**And** each PayOS row offers "Kiểm tra lại với payOS", calling `RecheckTopUp` and showing the credited / still unpaid / mismatch toast (UX-DR-P21).
**And** "Xuất CSV" exports PayOS top-ups for a chosen date range with code, user email, amount, Points, status, and `paidAt` columns, and without any bank account number (Story 13.12 adds refund columns); only ADMIN can export, and each export writes an admin-audit event (FR-78, UX-DR-P20).
**And** loading, empty-filter, and error states match Figma; the page has a minimal mobile layout.

### Story 13.9: Amount Mismatch Resolution

As an Admin,
I want to resolve payments whose amount differs from the request,
So that the user gets either fair Points or their money back.

**Acceptance Criteria:**

**Given** an `AMOUNT_MISMATCH` top-up
**When** the Admin opens the "Cần xử lý" tab and the B3 drawer
**Then** the tab lists mismatches with requested vs received amount and a 3-business-day countdown that turns "Quá hạn" when overdue, plus uncredited-over-30-minutes alerts (UX-DR-P11, P13).
**And** "Cộng Điểm theo số thực nhận" runs `ResolveTopUpMismatch` (`topup-mismatch:{topUpId}`), credits floor(`amountPaidVnd` ÷ 200), moves the row to `SUCCESSFUL`, and notifies the user, stating any remainder below 200 VNĐ is not converted (FR-35).
**And** "Đã hoàn tiền thủ công" requires a note, moves the row to `MANUAL_REFUNDED` without any journal, and notifies the user.
**And** a credit through mismatch resolution is identifiable from its journal key (`topup-mismatch:{topUpId}`) so later refund eligibility can exclude it (FR-77), and both actions are audited and idempotent; a concurrent provider `PAID` full-amount result and an Admin resolution credit at most once.

### Story 13.10: Refund Request, Refund Hold & Withdrawal

As a User,
I want to request a refund of a mistaken top-up within 24 hours,
So that I get my money back to the account I paid from.

**Acceptance Criteria:**

**Given** Story 13.6 confirmed the refund destination data, and a `PAYOS` `SUCCESSFUL` top-up not credited through mismatch resolution
**When** the owner submits a refund request before `refundDeadline` = `paidAt` + 24 hours (server clock, exclusive; returned by the API)
**Then** Economy creates `TopUpRefundRequest` (unique `topUpId`, `topUpJournalId`, reason from the fixed list, note 1–300 characters, snapshot of `counterAccount*`, `destinationVerified` false when they are null) and the `LedgerAccountClass.REFUND_HOLD` class exists (AD-26).
**And** the request is eligible only if Available ≥ `pointsCredited` and no spend journal follows the top-up credit journal; eligible posts `USER_AVAILABLE → REFUND_HOLD` (`topup-refund-hold:{requestId}`), ineligible records the reason with no journal (FR-77, FR-78).
**And** spend journals are defined by one named Economy constant (publish and reopen into `ESCROW`, voucher redemption into `SYSTEM_SINK`); a completeness test fails when any journal type debiting `USER_AVAILABLE` is unclassified, and complaint/dispute reversals are classified non-spend.
**And** the hold is atomic with spending under the AD-24 lock order: a concurrent publish or redemption either completes first (request becomes not eligible) or fails for insufficient Available, proven by a concurrency test.
**And** request, journal, user notification, and an email to `TOPUP_REFUND_MAILBOX` (account number masked to the last 4 digits, link to the Admin Panel) commit together through the Outbox.
**And** a second request for the same top-up, a request after the deadline, on a legacy `MANUAL` top-up, or on another user's top-up is refused.
**And** `WithdrawTopUpRefund` (`topup-refund-withdraw:{requestId}`, owner only) moves an unresolved request to terminal `WITHDRAWN`, releases any hold to Available, and notifies user and Admin; resubmission is refused.
**And** insufficient-Points error payloads in publish, reopen, and voucher redemption carry the Refund Hold amount as a field when one exists; Story 13.11 renders the message (UX-DR-P19); Epic 6 and Epic 12 regression suites pass.
**And** the Point-history list labels the hold as "Giữ chờ hoàn tiền" and its release (withdrawal or rejection) as "Hoàn lại từ giữ chờ hoàn tiền" (FR-31).

### Story 13.11: Refund Screens

As a User,
I want a clear refund form and status,
So that I know what will happen to my Points and money.

**Acceptance Criteria:**

**Given** the fixed Figma frames A4–A7 and A8 and the Story 13.10 API
**When** the user opens a Successful top-up detail
**Then** "Yêu cầu hoàn tiền" shows a countdown from the server `refundDeadline`, and is disabled with the reason when expired, already requested or withdrawn, legacy manual, or credited through mismatch resolution (UX-DR-P6, P23).
**And** the form shows read-only code, amount, Points, time, email, and "Tài khoản nhận hoàn tiền" (bank, holder, •••• last 4) with the no-change caption, or the destination-unverified notice; the user only picks a reason and writes a note (required, ≤ 300, counter) (UX-DR-P7).
**And** the confirm dialog names the amount and masked account; the result shows Eligible (Points held) or Not eligible (with reason, including that a compensated failed redemption still counts as spending) (UX-DR-P8, P25).
**And** status views show Refund Requested, Requested–not eligible, Refunded (with bank transfer reference/time when present), Refund Rejected (with reason), and Withdrawn; "Rút yêu cầu" has a confirm dialog (UX-DR-P9, P17, P18).
**And** a conflict response shows "Yêu cầu đã được xử lý" and reloads (UX-DR-P25); notifications render refund requested, refunded, rejected, and withdrawn.
**And** publish, reopen, and redeem screens show "N Điểm đang giữ chờ hoàn tiền" in their insufficient-Points message (UX-DR-P19); all screens ship Desktop and Mobile with loading, empty, and error states.

### Story 13.12: Admin Refund Resolution

As an Admin,
I want to review and resolve refund requests within the SLA,
So that users are refunded correctly and the ledger stays balanced.

**Acceptance Criteria:**

**Given** the fixed Figma frames B1 "Yêu cầu hoàn tiền" and B2
**When** the Admin opens the tab
**Then** it lists requests with verdict chip and short reason, destination-verified state, and a 3-business-day countdown that shows "Quá hạn" when overdue; an overdue request raises a one-time Admin alert (FR-78, UX-DR-P11).
**And** the drawer shows the original top-up, the paying account in full with copy buttons (or the unverified chip with copy email and the instruction to match the holder name on the bank statement), the user's reason and note, the verdict explanation, and the audit trail (UX-DR-P12).
**And** "Đánh dấu Đã hoàn tiền" is enabled only for a held request, tells the Admin to mark before transferring, and runs `ResolveTopUpRefund` REFUNDED: `REFUND_HOLD → SYSTEM_CLEARING` linked by `topUpJournalId`, never as `reversesJournalId` (AD-26, UX-DR-P22).
**And** `TopUpRefundRequest` gains optional `bankTransferReference` and `bankTransferredAt`; they can be set once after marking, and the user then sees them.
**And** the Story 13.8 CSV export gains refund status, refund resolution time, and bank transfer reference columns, still without account numbers.
**And** "Từ chối" requires a reason, releases any hold to Available, and for a hold-less request offers "Tôi đã chuyển trả tiền thủ công", recorded as a note with no journal.
**And** withdrawal and resolution of the same request cannot both succeed; the loser gets 409 `REFUND_ALREADY_RESOLVED`, proven by a concurrency test.
**And** every resolution notifies the user in-app and by email (Refunded, Refund Rejected) through the Outbox, writes the Moderation admin-audit event, keeps every balance non-negative, and works for banned users (FR-57, FR-78).
**And** the Point-history list labels the `REFUND_HOLD → SYSTEM_CLEARING` journal as "Hoàn tiền nạp Điểm" with a link to the original top-up (FR-31).

### Story 13.13: Manual Top-Up Retirement & Production Enable

As the Product Owner,
I want to switch production from manual top-up to PayOS safely,
So that users get instant top-ups without stranded requests or downtime.

**Acceptance Criteria:**

**Given** Stories 13.1–13.12 are deployed and PRD Open Question 27 is answered
**When** the Admin opens `/admin/top-ups`
**Then** the B4 banner shows a read-only "PayOS: Tắt/Bật · cấu hình server (PAYOS_ENABLED)" chip; with manual `PENDING` rows it lists them with approve/reject, otherwise it shows the ready checklist with no toggle (FR-79, UX-DR-P14).
**And** each resolved manual request notifies its user; the 4 rows pending on 2026-10-15 are recounted and resolved before enable.
**And** after enable, the manual request form and approval queue are no longer reachable, while historical manual top-ups stay visible in Wallet and Admin history.
**And** the prod-enable checklist is executed and recorded: pre-deploy `PENDING` check is zero; `confirm-webhook` succeeds; a live 10,000 VNĐ top-up is credited by the webhook; one full refund drill (request → hold → mark Refunded → bank transfer → reference added) passes.
**And** the runbook in `docs/` covers emergency disable (flag off closes checkout while webhook and reconciliation keep running), clearing in-flight and paid-uncredited top-ups, rotating payOS keys with a `confirm-webhook` re-run, and re-checking with the probe.
**And** `TOPUP_REFUND_MAILBOX` and payOS secrets are present in `deploy/.env.prod` and absent from the repository.
**And** placeholder PayOS and bank logos are replaced with the official logo sets before enable (UX-DR-P15).

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
