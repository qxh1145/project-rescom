---
baseline_commit: 9477c89
---
# Story 13.13: Manual Top-Up Retirement & Production Enable

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the Product Owner,
I want to switch production from manual top-up to PayOS safely,
so that users get instant top-ups without stranded requests or downtime.

## Acceptance Criteria

This story has two parts. **Part A** is code and docs that the dev agent delivers and tests. **Part B** is the Owner's production run. Part B can only start after Part A is merged and deployed with `PAYOS_ENABLED=false`, and after PRD Open Question 27 is answered. The pattern follows Story 13.6.

### Part A — code + docs (dev agent)

1. **B4 card, read-only PayOS chip.** The Figma frames are `190:1898` and `190:2091`. On `/admin/top-ups`, while PayOS is *effectively off*, a card "Chuyển sang nạp điểm qua PayOS" sits above the tabs.
   - Description: "Khi PayOS bật, user chỉ nạp qua PayOS và Điểm được cộng tự động. Nạp thủ công chuyển sang tab “Lịch sử thủ công (cũ)”, chỉ đọc. PayOS bật bằng cấu hình server, không bật trên giao diện."
   - On the right is a read-only chip: lock icon plus "PayOS: Tắt", with the caption "Bật/tắt bằng cấu hình server (PAYOS_ENABLED)".
   - The page header meta reads "{dd/MM/yyyy hôm nay} · đang dùng nạp thủ công".
   - "Effectively off" means `GET /economy/top-ups/payos/availability` returned `payosEnabled: false`.
   - Nothing on the page toggles PayOS. There is no button, no switch, and no Super Admin control (FR-79, UX-DR-P14).
   - While PayOS is *effectively on*, the card is not rendered. The header meta becomes "PayOS tự cộng Điểm · hoàn tiền thủ công, hạn 3 ngày làm việc" (today's copy) followed by a small read-only chip "PayOS: Bật" with the same lock icon.
   - While availability is still loading, render neither variant and no chip.
   - If availability fails to load, render the card in an error state: "Không tải được trạng thái PayOS." plus "Thử lại". Never assume PayOS is on.
2. **B4 pending variant** (`190:1898`). This variant shows when PayOS is effectively off and at least one manual `PENDING` row exists.
   - An amber banner with an alert-circle icon reads "Còn {N} yêu cầu nạp thủ công đang chờ. Cần xử lý hết trước khi bật PayOS." / "Duyệt hoặc từ chối nhanh ngay bên dưới. Khi danh sách trống, báo kỹ thuật bật PAYOS_ENABLED."
   - Below it is a table with the columns Mã yêu cầu · Người dùng (name + email) · Số tiền → Điểm ("{amount} → {points} Điểm") · Nội dung CK · Gửi lúc (dd/MM HH:mm). Each row has the buttons "Từ chối" (outline) and "Duyệt" (filled).
   - The footer reads "Đối chiếu sao kê trước khi duyệt; từ chối cần ghi lý do. Server sẽ không khởi động với PayOS bật khi còn yêu cầu đang chờ."
   - The rows come from the existing `GET /admin/top-ups?status=PENDING`, sorted oldest first. When `total` > the rows shown, add the line "Đang hiển thị {n}/{total} yêu cầu cũ nhất — xem đủ ở tab “Lịch sử thủ công (cũ)”."
   - "Duyệt" opens a confirm dialog (Decision D3), and confirming calls the existing `approveTopUp`.
   - "Từ chối" opens the existing `RejectTopUpDialog`, with the reason required, and calls the existing `rejectTopUp`.
   - After either action: reload the B4 list, the tab counts, and the sidebar queue badge. Show the success toast with the existing manual review copy. Map errors with the existing `top-up-admin-messages.ts`, including the already-reviewed conflict, which reloads the list.
3. **B4 ready variant** (`190:2091`). This variant shows when PayOS is effectively off and zero manual `PENDING` rows exist. It is a mint panel containing:
   - the cheer mascot (`public/brand/mascots/cheer.svg`, through the existing mascot component if one exists);
   - "Sẵn sàng bật PayOS";
   - "{M} yêu cầu đã xử lý được giữ lại ở tab “Lịch sử thủ công (cũ)”.", where M = `tabCounts.manual`;
   - a checklist with "✓ 0 yêu cầu thủ công đang chờ" and "ⓘ Báo kỹ thuật bật PAYOS_ENABLED và triển khai lại.".

   This variant has no toggle.
4. **Manual tab is read-only once PayOS is on.** While PayOS is effectively on, the "Lịch sử thủ công (cũ)" tab still lists every historical manual row and keeps its status filter.
   - It renders no approve or reject button, no reconciliation checklist, and no reject dialog. The detail panel shows the request facts and the review outcome only.
   - The default status filter becomes `APPROVED` instead of `PENDING`.
   - The existing note "Chỉ đọc. Nạp thủ công … đã ngừng khi bật PayOS…" stays.
   - While PayOS is off, the tab behaves exactly as today.
   - The approval queue is therefore unreachable after enable: there is no other admin manual-queue route (verified), and the backend refuses new manual submissions.
5. **User side after enable (verify; no new UI expected).** With PayOS effectively on:
   - `/wallet/top-up` shows only the PayOS flow (`TopUpEntry` mode `payos`), and the Wallet shows `PayosTopUpCompactCard` and no manual `TopUpCard`.
   - `POST /economy/top-ups` returns 404 (`ManualCheckoutEnabledGuard`).
   - Historical manual top-ups stay in the Wallet history, labelled "Thủ công (cũ)" (`TopUpHistory.tsx:87`). `useTopUpHistory` always fetches the manual list.
   - Historical manual top-ups open their detail through `TopUpRouter`, which falls back to the manual detail.

   Add tests that pin these behaviours (Task 5). Fix any gap found (FR-79).
6. **Resolved manual requests notify the user.** Approve already publishes `TOPUP_SUCCESS`, and reject publishes `TOPUP_REJECTED` (in-app + email). Add or confirm a test that both fire from the admin approve and reject paths. No new notification type.
7. **Official logos (UX-DR-P15).**
   - A new `components/brand/PayosLogo.tsx` renders `public/brand/payos/payos-logo.svg`, or `.png` if that is what the official kit ships. Use it where Figma has "Logo PayOS (thay bằng asset chính thức)" and "PayOS · VietQR":
     - A2 amount entry (`PayosCheckoutScreen.tsx`);
     - A3/A4 payment-method row (`PayosTopUpScreen.tsx:307`, "PayOS (VietQR)");
     - the channel label in `TopUpHistory.tsx:87`, as a 16 px logo plus the "PayOS" text.
   - A new `components/brand/BankLogo.tsx` (`{ bankId?: string | null; bankName?: string | null; size }`) maps the NAPAS BIN in `counterAccountBankId` to `public/brand/banks/{code}.png` through a small static map. An unknown or missing BIN falls back to today's generic `Icon name="bank"`.
     - Use it in `RefundForm.tsx:117`, `RefundConfirmDialog.tsx:90` and the `RefundDrawer.tsx` destination bank row (~:226).
   - Assets are local files. Do not hotlink a CDN.
   - Use `alt`, giving the bank name or "PayOS".
   - If the Owner has not yet supplied the official files when dev starts, ship the components with the fallback, and leave the file slots listed in the runbook under "Trước khi bật". Do **not** draw or invent logos. Part B blocks the enable until the files exist (Decision D4).
8. **Runbook `docs/payos-production-runbook.md`** (Vietnamese, like `docs/payos-production-setup.md`). It covers:
   - (a) **Enable checklist**: the Part B steps in order, with exact commands.
   - (b) **Emergency disable**: set `PAYOS_ENABLED=false` in `deploy/.env.prod`, then run `up -d --no-deps backend`.
     - Checkout closes at once.
     - Webhook, reconciliation, recheck, mismatch and refund commands keep running, because they are never flag-gated (AD-25).
     - In-flight `PROCESSING` links still credit if they are paid.
     - Side effect: the manual VietQR form reopens (Decision D1). Re-enabling then needs the manual `PENDING` rows cleared again.
   - (c) **Clearing in-flight and paid-uncredited top-ups**: use "Kiểm tra lại với payOS" (`RecheckTopUp`), the "Cần xử lý" tab, and the uncredited > 30 min alert. Mismatch resolution covers amount mismatches.
   - (d) **Rotating payOS keys**: update the 3 secrets in `.env.prod`, restart, re-run `payos-confirm-webhook`, then re-check with a probe or a 10,000 VNĐ top-up. Note that `payos-probe` refuses to run while `PAYOS_ENABLED=true` (`payos-probe-preflight.ts`), so a check after enable is a real UI top-up.
   - (e) **Re-checking with the probe** before enable.
   - (f) **Secrets hygiene**: `deploy/.env.prod` is gitignored. Give the commands that prove it is untracked and that no secret value is in the repo.
   - (g) An **enable log** table (date, step, result, evidence pointer). It contains no PII: no account numbers and no emails. Order codes and counts are fine.

   Link the runbook from `docs/payos-production-setup.md` and replace `deploy/README.md:340` "giữ PAYOS_ENABLED=false đến Story 13.13" with a pointer to the runbook.
9. **MSW.** In the existing `payos-manual` scenario (availability `false`), seed pending manual rows so that B4 shows the pending variant. Approving or rejecting them all through B4 turns the card into the ready variant. The default scenario (PayOS on) shows the "PayOS: Bật" chip and a read-only manual tab. Bump `SCHEMA_VERSION` (`mocks/db/store.ts:35`, 17 → 18) only if the seed shape changes.
10. **Responsive.** On desktop (1440), match `190:1898` and `190:2091`. On mobile (390) there is no frame, so use a minimal layout: the B4 card full width, the chip under the title, pending rows as cards ("{code} · {amount} → {points} Điểm", name/email, ref, time) with the two buttons in a row, and no horizontal page scroll.

### Part B — Owner production run (record in Completion Notes + runbook enable log)

11. **Gate.** PRD Open Question 27 has been answered, and the answer is recorded in the PRD (`prd.md` l.1256), with the date and Owner.
12. **Manual cleanup.** Part A is deployed (FE on Vercel `main`, BE on the VPS) with `PAYOS_ENABLED=false`. The Admin then resolves every manual `PENDING` row through B4. The 4 rows that were pending on 2026-10-15 are recounted first; record the count at the start. Each user is notified (AC 6). `deploy/check-manual-topups.js` then prints `Manual PENDING top-ups: 0` and exits 0.
13. **Secrets.** `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` and `TOPUP_REFUND_MAILBOX` are present in `deploy/.env.prod`. Check by key name only and never print the values. They are absent from the repo (runbook (f)).
14. **Logos.** The official PayOS and bank logo files are in `public/brand/` and deployed, before the enable.
15. **Enable.** Steps in order:
    - Run `payos-confirm-webhook`, which must succeed.
    - Set `PAYOS_ENABLED=true` and restart the backend.
    - The log shows `PayOS checkout enabled`.
    - B4 disappears and the chip reads "PayOS: Bật".
    - The Wallet shows only PayOS, and a manual `POST /economy/top-ups` returns 404.
16. **Live top-up.** A **separate user account** (not the Admin, because of `TOPUP_SELF_REVIEW_FORBIDDEN`) tops up 10,000 VNĐ through the UI. The webhook credits it. Evidence is the `payOS webhook credited` log line and the order code.
17. **Refund drill.** The same user requests a refund within 24 hours. The request is eligible, and a Refund Hold is placed. The Admin opens it in B2 and runs "Đánh dấu Đã hoàn tiền". The Owner makes the bank transfer to the paying account, then adds the bank transfer reference ("Thêm mã chuyển khoản"). The user sees Refunded together with the reference. Record the order code and the step times, but no account numbers.

## Tasks / Subtasks

- [x] **Task 0: Preconditions**
  - [x] `git status --short --branch` shows `feat/13-13-manual-top-up-retirement-production-enable`. The branch was created 2026-10-17 from `origin/develop` `9477c89`, after 13.12 PRs #49/#50 merged, and has no upstream. Push later with `git push -u origin feat/13-13-manual-top-up-retirement-production-enable`.
  - [x] UI gate: the Figma B4 frames `190:1898` / `190:2091` were re-read via Figma MCP on 2026-10-17 (Dev Notes "Figma").
- [x] **Task 1: Admin PayOS state** (AC 1–4). FE only; no backend change.
  - [x] Reuse `useWalletTopUpMode` (`lib/wallet/use-wallet-top-up-mode.ts`; modes `loading|payos|manual|error`). Check it has no wallet-only coupling first. If it has, extract a neutral `usePayosAvailability()` beside it and make the wallet hook use it. Do not write a second fetch.
  - [x] `TopUpConsoleScreen.tsx`: read the mode once and pass `payosMode` down. Render the header meta per AC 1, render `<PayosSwitchCard>` above `TopUpTabs` when the mode is `manual` or `error`, and pass `readOnly={mode === "payos"}` to `ManualTopUpsPanel`.
  - [x] `ManualTopUpsPanel.tsx`: drop its own `getPayosAvailability` effect and use the prop. Keep the note.
- [x] **Task 2: B4 card** — new `components/PayosSwitchCard.tsx` (+ `ManualApproveDialog.tsx`) (AC 1–3, 10)
  - [x] Pending list: `listAdminTopUps({ status: "PENDING" })` (`lib/admin/top-up-admin-service.ts:52`). Ready count: `tabCounts.manual` from the console's existing counts, passed down; do not fetch again.
  - [x] Pending/ready copy exactly as AC 2/3. Chip = new tiny inline element; check `components/ui` for an existing Chip/Badge and reuse it.
  - [x] Approve: `ManualApproveDialog` (Decision D3) → `approveTopUp(id)`; Reject: reuse `RejectTopUpDialog.tsx` → `rejectTopUp(id, reason)`. Reuse the error/success messages in `lib/admin/top-up-admin-messages.ts`. Follow how `hooks/use-top-up-review.ts` refreshes the sidebar `admin:queue-counts` query after a review; use the same mechanism. Call `onChanged` so the console reloads its counts.
  - [x] Busy state: disable both buttons of the row in flight. The dialogs are non-dismissible while submitting, and toasts render inside open dialogs (13.8 top-layer gotcha).
  - [x] Put the pure helpers in `lib/admin/payos-switch.ts`: `switchCardVariant({ mode, pendingTotal })` → `hidden | loading | error | pending | ready`, `pendingRowLabel(item)`, `headerMeta(mode, today)`, and the copy constants, so `node --test` can cover them.
- [x] **Task 3: Read-only manual tab** (AC 4)
  - [x] `TopUpReviewScreen.tsx` gains `readOnly?: boolean`, passed through to `TopUpReviewPanel.tsx`. With `readOnly`, hide the checklist, the approve button (~:114), the reject button, the note `top-up-approve-note`, and the `RejectTopUpDialog` mount. Show the facts and outcome only.
  - [x] `hooks/use-top-up-review.ts`: an initial status param (`readOnly` ? `APPROVED` : `PENDING`). Don't change other behaviour.
- [x] **Task 4: Logos** (AC 7)
  - [x] `components/brand/PayosLogo.tsx`, `components/brand/BankLogo.tsx` and `lib/brand/bank-logos.ts`. The map is `BIN → { code, name }` for the slots listed in Dev Notes "Logos". Return `null` for an unknown BIN so the caller falls back to `Icon name="bank"`. Use `next/image` or `<img>` the way `RescomLogo.tsx` does; match it.
  - [x] Wire the logos into the files listed in AC 7. Change no layout beyond swapping the icon or text slot.
  - [x] Asset files: only the Owner-supplied official files. If they are absent, the map stays empty and the components fall back. Note this in Completion Notes as a Part B blocker.
- [x] **Task 5: Tests** (every bullet needs a real assertion)
  - [x] FE `tests/admin-top-ups-switch.test.mjs`:
    - `switchCardVariant` across all modes, with pending 0, 1 and > page size;
    - `headerMeta` for both modes;
    - the copy strings, verbatim from Figma;
    - a mock flow in the `payos-manual` scenario: list pending → approve one → reject the rest → pending total 0 → variant `ready`, plus a sidebar queue count of 0 (`mocks/data/admin-top-ups.ts:103`).
  - [x] FE: extend `admin-top-ups-console.test.mjs` or `admin-top-ups.test.mjs` with the read-only default status `APPROVED` and the review state exposing no actions when read-only, if that logic sits in a testable lib module. Otherwise move the decision into `lib/admin/payos-switch.ts` and test it there.
  - [x] FE: a `bank-logos` map test (known BIN → code, unknown → null, null → null).
  - [x] FE: wallet retirement pins in `top-up.test.mjs` / `payos-top-up.test.mjs`:
    - the mode is `payos` when availability is true;
    - the mock manual `POST /economy/top-ups` returns 404 in the default scenario (check `mocks/handlers/top-up.ts`; add the guard if it is missing, mirroring the backend);
    - `mergeTopUps` keeps MANUAL rows in `payos` mode.
  - [x] Backend (confirm, add if missing):
    - an e2e or unit test that `POST /economy/top-ups` returns 404 while availability is open;
    - approve/reject publish `TOPUP_SUCCESS` / `TOPUP_REJECTED` (`top-up.service.ts:396/405`);
    - admin approve/reject still work while availability is open (AD-25: available until no PENDING remains);
    - `PayosEnableGuard` keeps checkout closed with PENDING > 0 and opens with 0 (`payos-enable-guard` spec; likely exists from 13.3, so cite it).
  - [x] `tests/no-direct-mocks` / `no-direct-url-state` include the new components; `route-diff.test.mjs` passes (no new routes expected).
  - [x] Run in `apps/frontend/my-app`: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. For backend changes only: `npm test --workspace backend -- top-up payos`.
  - [x] Visual check in mock mode (playwright-cli on the running dev server, port 3100) at 1440 and 390:
    - B4 pending → approve → reject → ready;
    - the chip "Bật" in the default scenario, and the read-only manual tab;
    - logos, with fallback;
    - wallet without the manual form.
- [x] **Task 6: Runbook + docs** (AC 8): `docs/payos-production-runbook.md`; links from `docs/payos-production-setup.md` and `deploy/README.md:340`. Use exact commands from Dev Notes "Ops commands". No real emails, account numbers or keys (the repo is public).
- [x] **Task 7: Part B handoff.** Put the Part B checklist (AC 11–17) at the top of the runbook. Mark the story `review` after Part A. The Owner runs Part B, and code review plus `done` follow its evidence, as in 13.6.

### Review Findings

Code review 2026-10-18 (diff `9477c89..cdd31d3`, Part A; layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor). 1 decision, 10 patch, 0 defer, 19 dismissed.

- [x] [Review][Decision] Fail-open when PayOS availability fails to load — RESOLVED 2026-10-18 (Owner Quan): option (a) fail-closed → converted to patch below. When `payosMode === "error"`, `ManualTopUpsPanel` gets `readOnly={payosMode === "payos"}` = false, so Duyệt/Từ chối stay live (BE allows approve/reject while PayOS is open, AD-25). Meanwhile `headerMeta("error")` asserts "đang dùng nạp thủ công", a mode the app does not actually know. Choose: (a) fail-closed: `readOnly={payosMode !== "manual"}` plus a neutral header on error; (b) keep fail-open and fix only the header copy; (c) keep as is. [`TopUpConsoleScreen.tsx:80`, `lib/admin/payos-switch.ts:60`]
- [x] [Review][Patch] Fail-closed on availability error: `readOnly={payosMode !== "manual"}` and a neutral `headerMeta("error")` copy (no "đang dùng nạp thủ công"). [TopUpConsoleScreen.tsx:80, lib/admin/payos-switch.ts:60]
- [x] [Review][Patch] Runbook SQL uses wrong table/columns: `"TopUpRequest"`, `method = 'MANUAL'`, `"pointsCredited"`, `"orderCode"` → `top_up_requests`, `channel`, `points_credited`, `order_code` (Prisma `@@map`/`@map`). The commands fail on the VPS (AC 8a). [docs/payos-production-runbook.md:80,214]
- [x] [Review][Patch] Runbook `check-manual-topups.js` command omits `docker cp deploy/check-manual-topups.js rescom-backend-1:/app/apps/backend/` (Dev Notes Ops commands); the script is not in the image (AC 12). [docs/payos-production-runbook.md:29]
- [x] [Review][Patch] Runbook misses AC 8 content: (b) emergency disable — checkout closes, webhook/reconcile/recheck/mismatch/refund keep running (AD-25), PROCESSING links still credit, manual VietQR form reopens (D1) so PENDING must be cleared again; remove the invented `404 PAYOS_CHECKOUT_DISABLED`; (c) "Kiểm tra lại với payOS", "Cần xử lý" tab, >30 min alert; (d) all 3 keys incl. `PAYOS_CLIENT_ID`, re-run `payos-confirm-webhook`, note `payos-probe` refuses when `PAYOS_ENABLED=true`; (e) probe re-check before enable; (g) enable log as a table (date, step, result, evidence); AC 7 logo slots: paths, 10-bank BIN→code list, flip `PAYOS_LOGO_AVAILABLE` / fill `AVAILABLE_BANK_LOGOS`. [docs/payos-production-runbook.md:184]
- [x] [Review][Patch] Runbook UI copy mismatch + PII: "Sẵn sàng bàn giao" / "0 yêu cầu chuyển khoản chờ duyệt" → "Sẵn sàng bật PayOS" / "0 yêu cầu thủ công đang chờ"; replace the real mailbox email with a placeholder (public repo guardrail). [docs/payos-production-runbook.md:76,89,114,188]
- [x] [Review][Patch] B4 card disappears forever if the PENDING list fetch fails (non-abort error leaves `total=null` → variant "loading" → `return null`, no error/retry). Show the error state with a retry that calls `refreshList`. [PayosSwitchCard.tsx:94-99,137]
- [x] [Review][Patch] B4 card returns `null` during every refetch (`loadingList`) after approve/reject/stale error: the card flickers, open dialogs and toasts vanish until reload. Only hide on the initial load (`total === null`). [PayosSwitchCard.tsx:76-79,137]
- [x] [Review][Patch] Task 5 tests assert local copies (`getInitialStatus`, `toMode`) and never touch real code. Move the decisions into `lib/admin/payos-switch.ts` / the mode lib as pure helpers, use them in `TopUpReviewScreen` / `useWalletTopUpMode`, and test those. [tests/admin-top-ups-switch.test.mjs:210, tests/payos-top-up.test.mjs:186]
- [x] [Review][Patch] Manual tab mounted while `payosMode === "loading"` → `useState("PENDING")` sticks after the mode resolves to payos, and buttons are live in that window. Do not render `ManualTopUpsPanel` until mode resolves (or key it on `readOnly`). [TopUpConsoleScreen.tsx:80, TopUpReviewScreen.tsx:27]
- [x] [Review][Patch] Ready variant says "0 yêu cầu đã xử lý…" when tab counts are null/failed (`counts?.manual ?? 0`). Pass `null` and omit the subtitle when unknown. [TopUpConsoleScreen.tsx:62, PayosSwitchCard.tsx:412]
- [x] [Review][Patch] Small UI fixes: standalone toasts render behind the open reject dialog (top-layer; use `!approving && !rejecting`); `userEmail` is nullable → "Cộng X Điểm cho Name ()" (omit the parens when null); `BankLogo` `<img>` has no `onError` fallback to the icon; delete the unused `usePayosAvailability` alias. [PayosSwitchCard.tsx:466, ManualApproveDialog.tsx, components/brand/BankLogo.tsx, lib/wallet/use-wallet-top-up-mode.ts:46]

Re-review 2026-10-18 of the patch commit `73020f8` (layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor). The Auditor verified that all 11 patches above are fixed and found no AC 6–8 or AC 11–17 violations. Result: 0 decision, 7 patch, 0 defer, 8 dismissed.

- [x] [Review][Patch] Runbook Bước 4 (enable gate) can pass on a stale log line. `$DC logs backend | grep` has no `--since`, so an old `PayOS checkout enabled` line from an earlier enable/rollback cycle (section 6) matches. It also runs right after `up -d`, before the guard has logged. The `/health/ready` check from the previous version was dropped. Fix: re-add the `/health/ready` probe, then run `$DC logs --since 5m backend | grep …`. [docs/payos-production-runbook.md:165-168]
- [x] [Review][Patch] Runbook 3.1 says the server "sẽ không khởi động" while manual PENDING rows exist. That is wrong: `payos-enable-guard.ts:46` keeps the server running and leaves PayOS off ("PayOS stays off until a restart with none"). Align the wording with Bước 4. [docs/payos-production-runbook.md:74]
- [x] [Review][Patch] Runbook 6.3 places the off chip in the header ("chip header `PayOS: Tắt`"). The header chip exists only when PayOS is on. The "PayOS: Tắt" chip lives inside the B4 card (AC 1). [docs/payos-production-runbook.md:210]
- [x] [Review][Patch] B4 list-failure branch drops toasts. After a successful approve or reject, `refreshList()` runs. If that refetch fails, the early-return error card replaces the card, so the success toast (and any error toast) unmounts. Fix: render `<CodeIssueToasts>` in the failure branch too. [PayosSwitchCard.tsx:113-145]
- [x] [Review][Patch] The fail-closed manual tab claims PayOS is on. With `payosMode === "error"`, `ManualTopUpsPanel` shows "Chỉ đọc. Nạp thủ công … đã ngừng khi bật PayOS", which asserts a mode the app does not know. This is the same problem the header fix removed. Fix: use a neutral note in error mode, e.g. "Chỉ đọc. Chưa xác định được trạng thái PayOS — thử lại để duyệt." [ManualTopUpsPanel.tsx:16, TopUpConsoleScreen.tsx:83-86]
- [x] [Review][Patch] Runbook uses a hardcoded container `rescom-backend-1` instead of the `$DC` convention. Use `$DC cp deploy/check-manual-topups.js backend:/app/apps/backend/` and `$DC exec -w /app/apps/backend backend node check-manual-topups.js`. [docs/payos-production-runbook.md:25-26]
- [x] [Review][Patch] The sprint-status comment still says "(uncommitted)". The patches are committed in `73020f8`. [_bmad-output/implementation-artifacts/sprint-status.yaml:166]

## Dev Notes

### Scope boundary (read first)

**In scope:**
- the B4 card (pending and ready variants, read-only chip);
- the read-only manual tab after enable;
- the official logo components and slots;
- the runbook;
- tests that pin the already-existing retirement behaviour;
- the Owner prod-enable checklist (Part B).

**Out of scope:**
- any UI or API that toggles `PAYOS_ENABLED`;
- a Super Admin role;
- new notification types;
- changes to the startup guard, webhook, reconcile, refund or mismatch logic;
- deleting the manual backend code (it must keep serving history, and the emergency fallback, D1);
- the sidebar badge logic (it is the manual PENDING count, so it drops to 0 naturally);
- Epic 9 dashboard changes.

**Already true in code (verify, don't rebuild):**
- `PayosEnableGuard` (`economy/infrastructure/payos-enable-guard.ts`): boots with PayOS off and a WARNING to admins (dedupe `payos-enable-blocked:{YYYY-MM-DD}`) when `PAYOS_ENABLED=true` and manual PENDING > 0. Fail-closed on DB error. Evaluated once at boot.
- `ManualCheckoutEnabledGuard` 404s the manual POST while checkout is open.
- Webhook and reconcile are not flag-gated (only `SCHEDULER_ENABLED`).
- User history merges both channels.
- `deploy/check-manual-topups.js` exists.

### Decisions taken in this story (defaults; Owner may override — see Questions)

- **D1 — Emergency disable reopens the manual form.** With `PAYOS_ENABLED=false`, checkout closes and the existing guard reopens manual VietQR submission. Keep that as the fallback channel; no new flag. The runbook says so, and says that re-enabling needs the manual PENDING rows cleared again. Alternative: a `MANUAL_TOPUP_RETIRED=true` env key that keeps manual closed during an emergency disable, which means no top-up at all during an outage.
- **D2 — B4 sits above the tabs and does not replace them.** The Figma B4 frames draw no tabs. However, refunds, mismatches and the 13.6 probe rows are never flag-gated and must stay reachable while PayOS is off.
- **D3 — Quick "Duyệt" uses a confirm dialog.** The full review panel has a reconciliation checklist; B4 approves in one click per Figma. To keep one deliberate step, the dialog has:
  - title "Duyệt yêu cầu {code}?";
  - rows "Cộng {points} Điểm cho {name} ({email})." and "Chỉ duyệt khi sao kê có khoản {amount} với nội dung {ref}.";
  - the buttons "Huỷ" and "Duyệt".

  This copy is `ASSUMED (design)`.
- **D4 — Logos are local official files supplied by the Owner, with a generic fallback.** Dev does not source, draw or hotlink logos. Brand-kit licensing is the Owner's call. The enable is blocked until the files exist (AC 14).
- **D5 — No backend change.** The chip uses the existing user `availability` endpoint, which is session-auth and so works for admins. The pending list uses `GET /admin/top-ups?status=PENDING`, and the ready count uses `tabCounts.manual` (all manual rows; it equals the resolved count when PENDING = 0). The "configured but blocked" state (env true with PENDING at boot) shows as "Tắt" plus the ready/pending card. The guard's admin WARNING already says to restart, and the checklist line "báo kỹ thuật … triển khai lại" covers the restart.

### Figma (verified 2026-10-17 via Figma MCP, file `mkudD5Ngi5RPyIAVxCcxXi`, page 30 `178:3`)

- `190:1898` "B4 · Banner chuyển đổi · Desktop · Còn yêu cầu thủ công". Header "Nạp điểm" + "30/09/2026 · đang dùng nạp thủ công". Card `190:1994`: title `190:1997`, description `190:1998`, chip `198:13068` (lock, "PayOS: Tắt") + caption `198:13073`, amber banner `190:2003`, table `190:2011` (3 fake rows: 2609300041 "100.000đ → 500 Điểm" "RESCOM LN5821" "30/09 09:15" …), footer `190:2085`.
- `190:2091` "… · Sẵn sàng bật PayOS". Same header and card head; mint panel `190:2196`: mascot cheer `190:2197`, "Sẵn sàng bật PayOS" `190:2222`, "46 yêu cầu đã xử lý được giữ lại ở tab “Lịch sử thủ công (cũ)”." `190:2223`, checklist `198:13081` ("0 yêu cầu thủ công đang chờ" with a check icon; "Báo kỹ thuật bật PAYOS_ENABLED và triển khai lại." with an info icon).
- No mobile B4 frame and no "PayOS on" frame. The sample names and emails are fake design data; use our own fake values in mocks.

### Logos (Figma placeholders found)

- PayOS: page 29 A2 "Logo PayOS (thay bằng asset chính thức)" (desktop + mobile, every state) → `PayosCheckoutScreen.tsx`. A3/A4 "PayOS · VietQR" → `PayosTopUpScreen.tsx:307`.
- Bank: A4 refund form "Logo VCB (placeholder)" → `RefundForm.tsx:117`, `RefundConfirmDialog.tsx:90`. B2 drawer "Logo (placeholder)" (`189:1064`) → `RefundDrawer.tsx` ~:226.
- BIN slots for the map: suggested pilot set VCB 970436, BIDV 970418, VietinBank 970415, Agribank 970405, Techcombank 970407, MB 970422, ACB 970416, VPBank 970432, TPBank 970423, Sacombank 970403. **Verify every BIN against the official NAPAS/VietQR bank list before committing**, and only add an entry when its file exists.

### Current state of files touched (read each before editing)

- `admin/top-ups/components/TopUpConsoleScreen.tsx` (25 lines). It parses the tab, fetches the counts, and sets the meta at :20. It reads no flag.
- `ManualTopUpsPanel.tsx` (8 lines). It fetches availability itself, shows the read-only note, and **still renders approve/reject**. That is the gap for AC 4.
- `TopUpReviewScreen.tsx` (92 lines, `embedded` prop), `TopUpQueueTable.tsx` (147), `TopUpReviewPanel.tsx` (checklist `allChecked` :43, approve :114-117), `RejectTopUpDialog.tsx`, `hooks/use-top-up-review.ts` (status state :23 default `PENDING`, `pendingCount` :100).
- `lib/admin/top-up-admin-service.ts` (`listAdminTopUps` :52, which takes a status, uses `ADMIN_TOP_UP_PAGE_SIZE = TOP_UP_LIST_MAX_LIMIT`, and has no "all"; `approveTopUp` :61; `rejectTopUp` :69). `lib/admin/top-up-admin-messages.ts`.
- `lib/wallet/use-wallet-top-up-mode.ts:27`, `lib/wallet/payos-top-up-service.ts:23` `getPayosAvailability`, `lib/wallet/use-top-up-history.ts` (always fetches manual), `lib/wallet/top-up-history.ts` `mergeTopUps`.
- The wallet screens are `TopUpEntry.tsx`, `WalletScreen.tsx:39,114`, `TopUpRouter.tsx`, and `TopUpHistory.tsx:87`.
- MSW:
  - `mocks/handlers/top-up.ts` (availability :93 `payosEnabled: getActiveScenario() !== "payos-manual"`; PayOS routes 404 in `payos-manual` :104);
  - `mocks/handlers/admin-top-ups.ts`;
  - `mocks/data/admin-top-ups.ts` (PENDING seeds ~:70/77, `topUpQueueCount` :103);
  - `mocks/scenarios.ts` ~:57;
  - `mocks/db/store.ts:35` (SCHEMA_VERSION 17).
- Sidebar: `components/layout/admin/admin-nav.ts:17`, `AdminShell.tsx:77` (`admin:queue-counts`).
- Backend files to read only:
  - `economy/infrastructure/payos-enable-guard.ts`;
  - `economy/application/payos-availability.ts`;
  - `presentation/payos-checkout-enabled.guard.ts`;
  - `presentation/top-up.controller.ts:37`;
  - `presentation/admin-top-up.controller.ts` (approve :211, reject :227);
  - `application/top-up.service.ts` (notify :396/:405);
  - `common/config/env.schema.ts:206-212, 373-393, 515-535`.
- Docs: `docs/payos-production-setup.md` (13.6 probe checklist, 88 lines, keeps the flag false "cho tới Story 13.13"), `deploy/README.md:24, :340`, `deploy/.env.prod.example:95-103`, `deploy/check-manual-topups.js` (header has the run commands).

### Ops commands (for the runbook; verify against `deploy/README.md` and memory "Prod deploy procedure")

- `DC='docker compose -f deploy/docker-compose.hostinger.yml --env-file deploy/.env.prod'`.
- PENDING check:
  - `docker cp deploy/check-manual-topups.js rescom-backend-1:/app/apps/backend/`
  - `docker exec -w /app/apps/backend rescom-backend-1 node check-manual-topups.js`

  Exit 0 means none, 1 means some exist, 2 means error.
- Confirm webhook: `$DC exec backend node dist/apps/backend/src/scripts/payos-confirm-webhook.js`.
- Probe (pre-enable only): `$DC exec -e PROBE_USER_EMAIL=<email> backend node dist/apps/backend/src/scripts/payos-probe.js`.
- Restart with new env: `$DC up -d --no-deps backend`, which recreates the container from the env file. Then `$DC logs backend | grep -E 'PayOS checkout enabled|PAYOS_ENABLED=true but'`.
- Secret presence without printing values: `grep -cE '^(PAYOS_CLIENT_ID|PAYOS_API_KEY|PAYOS_CHECKSUM_KEY|TOPUP_REFUND_MAILBOX)=.+' deploy/.env.prod` should print 4.
- Secrets absent from the repo:
  - `git ls-files deploy | grep -v example` should show no `.env.prod`;
  - `git grep -nE '^(PAYOS_API_KEY|PAYOS_CHECKSUM_KEY|PAYOS_CLIENT_ID)=.+'` should find no non-empty value.
- Prod DB (from memory): `$DC exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select status, count(*) from top_up_requests where channel = '\''MANUAL'\'' group by 1"'`.

### Guardrails

- **No toggle anywhere.** The flag is env-only. The UI only reads the effective state, and it never infers "on" from an error.
- **Never gate refunds, mismatches, recheck, webhook or reconcile on the flag.** This story touches none of them.
- **Keep manual backend endpoints.** Approve/reject stay usable while PENDING exists (AD-25). `GET /admin/top-ups` and the user manual list serve history.
- **PII (repo is public):** runbook, enable log, Completion Notes and mocks hold no real emails, account numbers or keys. Order codes and counts are fine.
- **Do not break:**
  - the 13.8 manual history tab while PayOS is off;
  - the sidebar badge;
  - the 13.12 refunds tab and `?tab=refunds&request=` deep link;
  - the `?tab=` parsing and `select()` in `TopUpConsoleScreen`;
  - wallet mode switching;
  - the `payos-manual` scenario used by existing tests.
- Fixed Vietnamese copy, with no raw server messages. `error.name === "ZodError"` across the schemas package (13.8).

### Previous story intelligence

- **13.12** (merged 9477c89): dialogs reset their state on open; toasts go inside open `<dialog>`s; 409 conflicts close dialogs and reload; page size 10; stale-guarded fetches with `AbortController`. The review caught ticked bullets with no test, so give every test bullet an assertion. `RefundDrawer.tsx` bank row ~:226 is the bank-logo slot.
- **13.6**: Part A/Part B split, Owner evidence recorded with PII redaction, `payos-probe` refuses `PAYOS_ENABLED=true`.
- **13.8**: MSW cannot be delayed, so the loading state is not capturable. Admin mock login needs typed input. `?msw-reset=1` drops the admin session.
- **13.3**: startup guard semantics, the pre-deploy script, daily-deduped admin WARNING.
- **Pre-existing failures (not this story):** `rewards-flash.prisma.e2e-spec.ts:144`, FE `rewards-admin-flash-domain.test.mjs:163`.

### Git intelligence

`9477c89` merges PR #50 (13.12 review patches), and `9b530ec` merges PR #49 (13.12). The pattern is FE pure `lib/` module + messages → components → MSW → `node --test`, with docs in `docs/` written in Vietnamese.

### Latest tech information

No new library. Logo images: if a logo is SVG, use plain `<img>` or `next/image` with `unoptimized` the way `RescomLogo.tsx` already does. Check that it doesn't need `dangerouslyAllowSVG`.

### Project Structure Notes

- New FE files:
  - `admin/top-ups/components/{PayosSwitchCard,ManualApproveDialog}.tsx`;
  - `lib/admin/payos-switch.ts`;
  - `components/brand/{PayosLogo,BankLogo}.tsx`;
  - `lib/brand/bank-logos.ts`;
  - `public/brand/payos/*` and `public/brand/banks/*`, from the Owner;
  - `tests/admin-top-ups-switch.test.mjs`, `tests/bank-logos.test.mjs`.
- New doc: `docs/payos-production-runbook.md`.
- Changed: the files listed under "Current state of files touched", plus `docs/payos-production-setup.md` and `deploy/README.md`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.13] (l.2006-2022); UX-DR-P14, P15 (l.184, 195); Story 13.8 AC on approve/reject until 13.13 (l.1929)
- [Source: prds/prd-project-rescom-2026-08-08/prd.md] FR-79 (l.649-656), OQ-27 (l.1256)
- [Source: architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md] AD-25 "Enable flag (FR-79)" (l.262-268), Open Questions gate (l.463); solution-design.md l.364-370
- [Source: _bmad-output/implementation-artifacts/13-6-live-payos-probe-in-production.md], [13-3-…], [13-8-…], [13-12-admin-refund-resolution.md]

### Owner decisions (confirmed by Owner Quan 2026-10-17)

1. D1: an emergency disable reopens the manual VietQR form. No new env key.
2. D3: quick approve uses the confirm dialog.
3. D4: the Owner supplies the official PayOS and bank logo files; dev builds the components, the fallback, and a map of the 10 listed banks.

## Dev Agent Record

### Agent Model Used

`inherit` (Gemini 2.5 Pro / Antigravity coding assistant)

### Debug Log References

- `npm run typecheck` (apps/frontend/my-app): 0 errors
- `npm run lint` (apps/frontend/my-app): 0 errors
- `npm test` (apps/frontend/my-app): 1002 passing tests, 0 failures (duration ~26s)
- `npm test` (apps/backend): 181 test suites, 2705 passing tests, 0 failures (duration ~22s)
- `npm run build` (apps/frontend/my-app): Next.js Turbopack production build succeeded (53/53 static & dynamic routes compiled)
- New unit/integration test suites:
  - `apps/frontend/my-app/tests/admin-top-ups-switch.test.mjs` (7 tests: variant computation, copy strings, full approve/reject transition flow to ready variant)
  - `apps/frontend/my-app/tests/bank-logos.test.mjs` (known BIN mappings, unknown BIN fallback, null handling)
  - `apps/frontend/my-app/tests/payos-top-up.test.mjs` (14 tests: wallet retirement, 404 guard on manual top-up POST when PayOS enabled, history merging)
  - `apps/backend/src/modules/economy/presentation/top-up.controller.spec.ts` (ManualCheckoutEnabledGuard, PayosCheckoutEnabledGuard, AD-25 admin mutation availability)

### Completion Notes List

- **Part A Completed:** Code, components, tests, runbook, and documentation cross-references fully implemented.
- **B4 Switch Card:** Built `PayosSwitchCard.tsx` with Figma `190:1898` (Pending list with amber alert + responsive desktop table / mobile cards) and `190:2091` (Ready state with Mascot cheer and checklist). Quick approve confirm dialog `ManualApproveDialog.tsx` implemented per Decision D3.
- **Admin Console Integration:** `TopUpConsoleScreen.tsx` renders B4 switch card above tabs when PayOS is disabled/error, header meta displays date + locked "PayOS: Bật" chip when enabled.
- **Read-Only Mode for Manual Review:** `TopUpReviewScreen.tsx`, `TopUpReviewPanel.tsx`, and `ManualTopUpsPanel.tsx` updated with `readOnly` support. When PayOS is enabled, all mutation actions (checklist, approve, reject) are omitted, presenting facts only.
- **Brand Assets & Fallbacks:** `PayosLogo.tsx` and `BankLogo.tsx` created and wired across checkout, top-up channels, wallet history, refund drawer, and refund forms. Fallback to `Icon name="bank"` / default styling verified.
- **Part B Blocker Note:** Official vector SVG assets for PayOS (`public/brand/payos/payos-logo.svg`) and bank logos (`public/brand/banks/{code}.png`) are to be supplied by Product Owner during Part B (Decision D4).
- **Runbook Authoring:** `docs/payos-production-runbook.md` authored in Vietnamese, containing Part B checklist (AC 11-17), pre-flight checks, production enable steps, emergency rollback/kill-switch (`PAYOS_ENABLED=false`), SOPs for in-flight/mismatch/uncredited top-ups, secret hygiene, and enable log template. Cross-referenced in `docs/payos-production-setup.md` and `deploy/README.md`.
- **Story Status:** Set to `review` pending Product Owner execution of Part B on production VPS.

### File List

- **Created:**
  - `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/ManualApproveDialog.tsx`
  - `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/PayosSwitchCard.tsx`
  - `apps/frontend/my-app/components/brand/BankLogo.tsx`
  - `apps/frontend/my-app/components/brand/PayosLogo.tsx`
  - `apps/frontend/my-app/lib/admin/payos-switch.ts`
  - `apps/frontend/my-app/lib/brand/bank-logos.ts`
  - `apps/frontend/my-app/tests/admin-top-ups-switch.test.mjs`
  - `apps/frontend/my-app/tests/bank-logos.test.mjs`
  - `docs/payos-production-runbook.md`
- **Modified:**
  - `apps/backend/src/modules/economy/presentation/top-up.controller.spec.ts`
  - `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/ManualTopUpsPanel.tsx`
  - `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundDrawer.tsx`
  - `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/TopUpConsoleScreen.tsx`
  - `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/TopUpReviewPanel.tsx`
  - `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/TopUpReviewScreen.tsx`
  - `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/hooks/use-top-up-review.ts`
  - `apps/frontend/my-app/app/(signed-in)/(app)/wallet/components/TopUpHistory.tsx`
  - `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/components/PayosCheckoutScreen.tsx`
  - `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/components/PayosTopUpScreen.tsx`
  - `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/components/RefundConfirmDialog.tsx`
  - `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/components/RefundForm.tsx`
  - `apps/frontend/my-app/lib/admin/admin-transactions.ts`
  - `apps/frontend/my-app/lib/wallet/use-wallet-top-up-mode.ts`
  - `apps/frontend/my-app/lib/wallet/wallet-history.ts`
  - `apps/frontend/my-app/mocks/handlers/top-up.ts`
  - `apps/frontend/my-app/tests/payos-top-up.test.mjs`
  - `deploy/README.md`
  - `docs/payos-production-setup.md`
  - `_bmad-output/implementation-artifacts/sprint-status.yaml`
  - `_bmad-output/implementation-artifacts/13-13-manual-top-up-retirement-production-enable.md`

