---
baseline_commit: 30fb28c
---
# Story 13.8: Admin Top-Up Console

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Admin,
I want one place to see every top-up, re-check payments, and export records,
so that I can support users and reconcile against the bank.

## Acceptance Criteria

1. **Tabs with count badges.** Given the fixed Figma page 30 frame B1 (`188:2`), when the Admin opens `/admin/top-ups`, the page header reads "Nạp điểm" with the subtitle "PayOS tự cộng Điểm · hoàn tiền thủ công, hạn 3 ngày làm việc", and shows tabs with pill count badges. This story ships two tabs: "Giao dịch PayOS" (default; badge = all PayOS top-ups) and "Lịch sử thủ công (cũ)" (badge = all manual top-ups). "Yêu cầu hoàn tiền" (13.12) and "Cần xử lý" (13.9) are **not rendered** (UX-DR-P11).
2. **PayOS list.** "Giao dịch PayOS" lists PayOS top-ups newest first with columns Mã giao dịch (`orderCode`), Người dùng (name line + email), Số tiền, Điểm, Trạng thái (13.7 `TopUpStatusChip`), Thời gian (`createdAt`), paged with "Hiển thị a–b trong N giao dịch". Filters: a status select ("Tất cả trạng thái" + the 6 PayOS statuses), a date range (default: first day of the current month to today, `Asia/Ho_Chi_Minh` days, on `createdAt`), and a search box "Tìm mã giao dịch hoặc email" (all-digit input = exact `orderCode`; otherwise case-insensitive email substring). No bank account field (`counterAccount*`) is ever returned or shown (FR-78, NFR-31).
3. **Manual tab.** "Lịch sử thủ công (cũ)" shows the existing manual top-ups. While any manual `PENDING` row exists, the existing approve/reject actions (current "Duyệt nạp điểm" queue, segments, review panel, reject dialog) stay available unchanged until Story 13.13 retires them. When PayOS is effectively on, the tab shows the read-only note "Chỉ đọc. Nạp thủ công (chuyển khoản + Admin duyệt) đã ngừng khi bật PayOS. Không duyệt mới, không hoàn tiền cho các giao dịch này."
4. **Re-check.** Every PayOS row (any status) offers "Kiểm tra lại với payOS", which calls the Story 13.5 `RecheckTopUp` endpoint and shows a toast: credited / still unpaid / mismatch; a provider failure shows a retryable error toast. The list and the badges reload after the call (UX-DR-P21).
5. **CSV export.** "Xuất CSV" exports PayOS top-ups for the chosen date range with columns code, user email, amount, Points, status and `paidAt` (plus the reconciliation columns fixed in Dev Notes "Decision D3"), and never any bank account number or holder name (Story 13.12 adds refund columns). Only ADMIN can export; each export writes an admin-audit event (FR-78, UX-DR-P20).
6. **States + mobile.** Loading, empty-filter ("Không có giao dịch khớp bộ lọc" / "Thử đổi trạng thái, khoảng ngày hoặc từ khoá tìm kiếm.") and error ("Không tải được danh sách giao dịch" / "Kết nối tới máy chủ bị gián đoạn. Dữ liệu giao dịch không bị thay đổi.") match Figma frames `188:407`, `188:678`, `188:848`; the page has a minimal mobile layout (390 px: filters stack, rows become cards, no horizontal page scroll).

## Tasks / Subtasks

- [x] **Task 0: Preconditions** (memory rule: one branch per story).
  - [x] `git status --short --branch`. Branch `feat/13-8-admin-top-up-console` was created 2026-10-15 from `origin/develop` `ea832bd` (contains 13.7). Its upstream is `origin/develop`; push with `git push -u origin feat/13-8-admin-top-up-console`.
  - [x] **Story 13.5 merged** into `develop` (PR #41, `30fb28c`); this branch was fast-forwarded to it on 2026-10-16. Verified in code: `POST :id/recheck` in `admin-top-up.controller.ts:96` (`CsrfGuard`, `ParseUUIDPipe`, `x-correlation-id`; controller already injects `PayosTopUpService`), `payosRecheckResultSchema` (`payos-top-up.schema.ts:132`), port `findPayosById` / `recordAdminAudit(event: TopUpAdminAuditEvent)` (`payos-top-up-repository.port.ts:130-137`, event type at l.63), `TOP_UP_AUDIT_EVENT_TYPES.RECHECKED` (`top-up.schema.ts:178`).
- [x] **Task 1: Shared contracts** (AC: 1, 2, 5) — `packages/schemas/src/economy/payos-top-up.schema.ts` (+ spec), export via `economy/index.ts`.
  - [x] `adminPayosTopUpSchema`: `{ id, orderCode, userId, userEmail: string|null, amountVnd, points, pointsCredited: int|null, amountPaidVnd: int|null, status: payosTopUpStatusSchema, createdAt, paidAt, expiresAt, cancelledAt }` (ISO strings / nullable). **No** `counterAccount*`, `checkoutUrl`, `paymentLinkId`, `providerReference`. Add a spec test that the parsed object has exactly these keys (`.strict()`).
  - [x] `listAdminPayosTopUpsQuerySchema` (`.strict()`, coerce): `limit` (default `TOP_UP_LIST_DEFAULT_LIMIT`, max `TOP_UP_LIST_MAX_LIMIT`), `offset` (≤ `MAX_PAGINATION_OFFSET`), `status?`, `from?`/`to?` as `YYYY-MM-DD` date keys (refine `from <= to`), `q?` (trim, 1–100 chars). `adminPayosTopUpListSchema` = `{ items, total, limit, offset, hasMore }` (same shape as `adminTopUpRequestListSchema`).
  - [x] `adminTopUpTabCountsSchema` = `{ payos: int≥0, manual: int≥0 }`. 13.9/13.12 add their keys later.
  - [x] `exportAdminPayosTopUpsSchema` (`.strict()` body): `from`, `to` required date keys, `from <= to`, span ≤ 366 days. Constant `PAYOS_TOP_UP_EXPORT_MAX_ROWS = 10_000`.
  - [x] `economy/top-up.schema.ts`: add `EXPORTED: 'AdminTopUpExported'` to `TOP_UP_AUDIT_EVENT_TYPES` and `topUpExportAuditEventPayloadSchema` = `{ schemaVersion: 1, action: 'TOPUP_EXPORTED', auditCategory: 'MODERATION_ADMIN_ACTION', exportId: uuid, adminId, from, to, rowCount, correlationId: nullable, occurredAt }`. No emails, no amounts, no PII.
- [x] **Task 2: Backend read + counts** (AC: 1, 2) — economy module.
  - [x] `payos-top-up-repository.port.ts` + `prisma-payos-top-up.repository.ts` + `in-memory-payos-top-up.repository.ts`: `listForAdmin({ status?, fromUtc?, toUtcExclusive?, orderCode?, emailContains?, limit, offset })` → `{ items: { topUp: PayosTopUp, userEmail: string|null }[], total }` with `channel = 'PAYOS'`, `orderBy createdAt desc, id desc`. Prisma: explicit `select` of the DTO columns + `user: { select: { email: true } }` — never `include` the full row, so `counterAccount*` cannot leak. Email search uses `user.email contains, mode: 'insensitive'` (`ponytail:` comment: sequential scan on users; add a trigram index if admin search gets slow). `countByChannel()` → `{ payos, manual }` (one `groupBy` on `channel`).
  - [x] `payos-top-up.service.ts`: `listForAdmin(query)` parses with the shared schema, turns date keys into UTC bounds with `vietnamStartOfDay` (`packages/schemas/src/admin/admin-ledger.schema.ts:124`; `to` is inclusive → `< start of to+1 day`), routes `q` (`/^\d{1,10}$/` → `orderCode`, else email), maps to `adminPayosTopUpSchema`. `tabCounts()`.
  - [x] `admin-top-up.controller.ts` (class already has `SessionAuthGuard, RolesGuard, @Roles('ADMIN')`): `GET payos` and `GET tab-counts`, both `@Header('Cache-Control', 'no-store')`, `createSuccessEnvelope`. Declare them **above** the `:id` routes. Inject `PayosTopUpService` (13.5 already does for recheck). Leave `GET /` (manual), `:id/approve`, `:id/reject` untouched.
- [x] **Task 3: Backend CSV export** (AC: 5).
  - [x] `apps/backend/src/common/http/csv.ts` (new, no dependency): `toCsv(header: string[], rows: (string|number|null)[][]): string` — UTF-8 BOM, CRLF, every field quoted with `"` doubled, `null` → empty, and a cell that starts with `= + - @ \t \r` gets a leading `'` (formula-injection guard). Unit test `csv.spec.ts` (quotes, commas, newlines, `=HYPERLINK(...)`, and a numeric `-1` written unprefixed because the guard applies to strings only).
  - [x] Repository `listForExport({ fromUtc, toUtcExclusive, limit })` (same explicit select, `createdAt asc`), fetches `PAYOS_TOP_UP_EXPORT_MAX_ROWS + 1` to detect overflow.
  - [x] Service `exportForAdmin({ from, to, adminId, correlationId })`: parse; overflow → `400 TOPUP_EXPORT_TOO_LARGE` `{ maxRows }` (no audit, no file); otherwise write the `AdminTopUpExported` audit through 13.5's `recordAdminAudit` (idempotency key `admin-audit:topup-export:${exportId}`, `exportId = randomUUID()`, `aggregateType: 'TopUpExport'`, `aggregateId: exportId`) **before** returning the CSV; an audit write failure fails the request (no CSV without audit). An empty range still exports a header-only file and is audited (`rowCount 0`).
  - [x] Controller `POST payos/export` with `CsrfGuard, JsonOnlyGuard`, `@HttpCode(200)`, body via `ZodValidationPipe(exportAdminPayosTopUpsSchema, 'VALIDATION_ERROR', 'body')`, `x-correlation-id` like approve. Respond with `@Res({ passthrough: true })` headers `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="rescom-payos-topups-{from}-{to}.csv"`, `Cache-Control: no-store`, and return the string (no envelope). Pattern for `@Res`: `apps/backend/src/modules/auth/presentation/auth.controller.ts`.
- [x] **Task 4: FE service + pure rules** (AC: 1, 2, 4, 5) — `apps/frontend/my-app/lib/admin/`.
  - [x] `lib/api/client.ts`: add an `as: "blob"` option to `apiRequest` (same CSRF/retry/error path; on success return `{ blob: await res.blob(), fileName }` parsed from `Content-Disposition`). Do not fork a second fetch wrapper.
  - [x] `payos-top-up-admin-service.ts`: `listAdminPayosTopUps(query, signal)`, `getAdminTopUpTabCounts(signal)`, `recheckPayosTopUp(id)` (`POST /admin/top-ups/:id/recheck` → `payosRecheckResultSchema`), `exportPayosTopUps({ from, to })` (blob). Shared schemas only.
  - [x] `payos-top-up-admin.ts` (pure, `node --test`): `defaultDateRange(now)` (VN month start → VN today, via `vietnamDateKey` in `lib/format/date-time.ts`), `toListQuery(filters, page)`, `normalizeSearch(q)`, `recheckToast(result)` → `{ tone, title, body }`: `CREDITED` success "Đã cộng Điểm" / "payOS xác nhận đã thanh toán, Điểm đã vào ví người dùng."; `STILL_UNPAID` info "Chưa ghi nhận thanh toán" / "payOS chưa nhận được tiền cho giao dịch này."; `MISMATCH` warning "Sai số tiền" / "Số tiền thực nhận khác yêu cầu — cần xử lý."; copy is `ASSUMED (design)`. `payosStatusOptions()` labels from 13.7 `topUpChip(status, "PAYOS")` (`lib/wallet/top-up-history.ts`), never redeclared.
  - [x] `payos-top-up-admin-messages.ts`: `TOPUP_PROVIDER_UNAVAILABLE` (503, "Không kết nối được payOS. Thử lại sau." retryable), `TOPUP_NOT_FOUND`, `TOPUP_EXPORT_TOO_LARGE` ("Quá {maxRows} giao dịch — thu hẹp khoảng ngày."), `VALIDATION_ERROR`, 403, network.
- [x] **Task 5: FE screen** (AC: 1–6) — `app/(signed-in)/(admin)/admin/top-ups/`.
  - [x] `page.tsx` renders a new `TopUpConsoleScreen` (`AdminPage` title "Nạp điểm" + subtitle in `meta`). Tab in `?tab=payos|manual` (default `payos`); keep the manual `?id=` selection param working. Rename nav label in `components/layout/admin/admin-nav.ts` from "Duyệt nạp điểm" to "Nạp điểm" (Figma sidebar); keep `queue: "topUps"`.
  - [x] `TopUpTabs.tsx`: ARIA tablist modeled on `admin/disputes/components/DisputeTabs.tsx` (roving tabindex, arrows/Home/End, `aria-controls`), but with the Figma pill badge; badges from `getAdminTopUpTabCounts`, reloaded after recheck and approve/reject.
  - [x] `PayosTopUpsPanel.tsx`: filter bar (search `TextField` with 300 ms debounce, `Select` status, two native `<input type="date">` for the range, "Xuất CSV" outlined `Button` on the right), table, pager. Every filter change resets to page 1. Row click / chevron opens `PayosTopUpDrawer`. Table → stacked cards below `md`.
  - [x] `PayosTopUpDrawer.tsx`: side drawer (`Dialog` with the drawer classes from `admin/code-issues/components/CodeIssueDrawer.tsx`) showing the row facts (code, email, amount, received amount when non-null, Points, credited Points, status chip, created/paid/expired/cancelled times) and "Kiểm tra lại với payOS" (busy state, one call at a time). 13.9 (B3) and 13.12 (B2) extend this drawer; nothing about refund or mismatch actions here.
  - [x] Toasts: move `admin/code-issues/components/CodeIssueToasts.tsx` to `components/ui/Toasts.tsx` (its own `ponytail:` comment asks for this when a second screen needs it), update the code-issues import, delete the old file.
  - [x] Export: uses the panel's current date range (not status/search); `download(blob, fileName)` pattern from `app/(signed-in)/(app)/forms/[id]/export/components/ExportDialog.tsx:33`; button busy while exporting; errors as toast.
  - [x] `ManualTopUpsPanel.tsx`: wraps the existing `TopUpReviewScreen` body (`TopUpQueueTable`, `TopUpReviewPanel`, `RejectTopUpDialog`, `use-top-up-review.ts`) without behavior change; shows the AC3 read-only note when `getPayosAvailability()` (`lib/wallet/payos-top-up-service.ts`) says `payosEnabled`. Keep `refreshCounts()` (sidebar badge) after approve/reject.
  - [x] States: skeleton rows (loading), empty-filter, error with `Mã lỗi: TOPUPS_LOAD_FAILED · {time}` and retry, per Figma.
- [x] **Task 6: MSW** (AC: all) — `mocks/handlers/admin-top-ups.ts`, `mocks/data/admin-top-ups.ts`, `mocks/data/top-up.ts`.
  - [x] Mirror Task 2/3 routes + 13.5 recheck: `GET /admin/top-ups/payos` (flatten `payosTopUps` across users, join email from the mock user store, apply filters), `GET /admin/top-ups/tab-counts`, `POST /admin/top-ups/:id/recheck` (deterministic: `PROCESSING` → `STILL_UNPAID`, seeded "paid" row → `CREDITED` + ledger credit, `AMOUNT_MISMATCH` → `MISMATCH`; 503 via `applyScenario`), `POST /admin/top-ups/payos/export` (CSV text, `Content-Disposition`, 400 over cap). Each starts with `applyScenario("admin")` + `requireMockAdmin()`; POSTs check `missingCsrf`.
  - [x] Seed ≥ 12 PayOS rows across ≥ 3 users and all 6 statuses (enough for 2 pages at page size 10). Bump `SCHEMA_VERSION` in `mocks/db/store.ts` (12 → 13) only if a stored shape changes.
  - [x] Run `tests/route-diff.test.mjs`; these routes are backend-served (no allowlist entry).
- [ ] **Task 7: Tests**
  - [x] Schemas: `payos-top-up.schema.spec.ts` (admin DTO strict keys, query bounds/refines, export span 366/367 days), `top-up.schema.spec.ts` (export audit payload).
  - [x] Backend unit: service spec — filters, `q` routing (digits vs email), VN day bounds at the `to` edge, MANUAL rows never listed, counts, export overflow (no audit), audit written with `rowCount`, audit failure → no CSV; `csv.spec.ts`.
  - [x] Backend e2e `apps/backend/test/top-up-payos-admin-console.e2e-spec.ts`: 401 no session, 403 PUBLISHER/RESPONDENT on all four routes, 403 export without CSRF, list never contains `counterAccount` keys even when the seed row has them, CSV headers + no account number/holder name string anywhere in the body, one `AdminTopUpExported` Outbox row per export.
  - [x] FE `tests/admin-top-ups-console.test.mjs`: `defaultDateRange` (month start, VN midnight edge), `toListQuery`, `normalizeSearch`, `recheckToast` per result, messages, service schema parsing, `Content-Disposition` filename parsing. (Mock handler filters/cap are not unit-tested: the handler imports `@/` aliases that `node --test` cannot resolve; covered by the mock-mode visual check.) Existing `admin-top-ups.test.mjs` passes unchanged.
  - [x] Run: `npm test --workspace @rescom/schemas`; backend `npm test --workspace backend -- top-up csv`, `npm run test:e2e --workspace backend -- top-up`, `npm run build --workspace backend`; FE `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` in `apps/frontend/my-app`.
  - [x] Visual check in mock mode at 1440 and 390: PayOS tab default/loading/empty-filter/error, drawer + each toast, export, manual tab with PENDING rows and with PayOS on. Compare with Figma `188:2`, `188:407`, `188:678`, `188:848`, `188:1435`.

### Review Findings

Code review 2026-10-16 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). No AC violations. 0 decision-needed, 13 patch, 0 defer, 8 dismissed. All 13 patches applied 2026-10-16; schemas/backend unit (94), backend e2e top-up (35), backend build, FE typecheck/lint/test (940) green.

- [x] [Review][Patch] [med] Numeric `q` above the Int32 max (e.g. `9999999999`) is sent to Prisma as `orderCode` (`Int?` column) → 500 instead of empty result; cap at 2_147_483_647 or fall back to email search [apps/backend/src/modules/economy/application/payos-top-up.service.ts:95]
- [x] [Review][Patch] Pager stranded: on page > 1, a recheck under a status filter can empty the page → empty-state with no pager; clamp `page` to the last page when `items` is empty and `total > 0` [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/PayosTopUpsPanel.tsx:33]
- [x] [Review][Patch] `from > to` shows the "Kết nối tới máy chủ bị gián đoạn / TOPUPS_LOAD_FAILED" server error with a useless retry; show a distinct invalid-range message [PayosTopUpsPanel.tsx:35]
- [x] [Review][Patch] Search debounce runs `update({ q })` on mount and whenever `q` is unchanged → duplicate fetch and resets a page the user picked within 300 ms; skip when `q` is unchanged [PayosTopUpsPanel.tsx:32]
- [x] [Review][Patch] Error line calls `new Date()` in render, so "Mã lỗi … {time}" changes on every re-render; store the failure time [PayosTopUpsPanel.tsx:59]
- [x] [Review][Patch] Pager renders one button per page with no window (500+ buttons at scale); use prev/next + a window around the current page [PayosTopUpsPanel.tsx:64]
- [x] [Review][Patch] Shared toast hard-codes the action label "Tải lại" but the recheck failure uses it to retry the recheck (AC4 retryable toast); add an `actionLabel`. `info` (STILL_UNPAID) never auto-dismisses; auto-dismiss `info` like `success` [apps/frontend/my-app/components/ui/Toasts.tsx:16]
- [x] [Review][Patch] Client-side `ZodError` (export span > 366 days, list query parse) maps to the generic "Không thể xử lý yêu cầu" / connection error; map it to the range message [apps/frontend/my-app/lib/admin/payos-top-up-admin-messages.ts:3]
- [x] [Review][Patch] Tab-count request failure leaves badges at "…" forever; render "—" on error [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/TopUpConsoleScreen.tsx:15]
- [x] [Review][Patch] `topUpExportAuditEventPayloadSchema` is only used by its spec; the service builds the audit payload unvalidated, so the "no PII" guarantee is not enforced on the real payload; parse the payload with it [apps/backend/src/modules/economy/application/payos-top-up.service.ts:139]
- [x] [Review][Patch] CSV formula guard misses a leading `\n` (OWASP list); add it to the regex [apps/backend/src/common/http/csv.ts:8]
- [x] [Review][Patch] `attachmentFileName` was inserted between the `apiRequest` JSDoc and `apiRequest`, so the doc now describes the wrong function [apps/frontend/my-app/lib/api/client.ts:150]
- [x] [Review][Patch] Task 7 claims FE tests cover "mock handler filters/cap", but `admin-top-ups-console.test.mjs` has none; add a mock handler filter test or correct the task note [apps/frontend/my-app/tests/admin-top-ups-console.test.mjs]
- [x] [Review][Patch] Visual check: recheck toasts were hidden behind the modal `<dialog>` drawer (top layer), so success/info toasts auto-dismissed unseen (AC4); toasts now render inside the drawer while it is open [PayosTopUpDrawer.tsx, PayosTopUpsPanel.tsx]
- [x] [Review][Patch] Visual check: drawer showed raw `20000` for Số tiền / Số tiền nhận; now `formatVnd` [PayosTopUpDrawer.tsx]
- [x] [Review][Patch] Visual check: 390 px page scrolled sideways (919 px) because absolutely positioned `sr-only` nav-badge text escaped the non-positioned `overflow-x-auto` nav; nav is now `relative` [apps/frontend/my-app/components/layout/admin/AdminShell.tsx:74]
- [x] [Review][Patch] Visual check: manual tab at 390 px overflowed (637 px) because the single-column grid used an `auto` track; now `grid-cols-[minmax(0,1fr)]` [TopUpReviewScreen.tsx:46]
- [x] [Review][Defer] Manual queue segmented control ("Chờ duyệt · 2 / Đã duyệt / Đã từ chối") overflows 390 px by 7 px [TopUpReviewScreen.tsx] — deferred, pre-existing

## Dev Notes

### Scope boundary (read first)

In scope: the two-tab `/admin/top-ups` console, admin PayOS list/search/filter, tab counts, recheck button + toast (13.5 owns the endpoint), CSV export + audit, minimal top-up drawer. **Out of scope:** "Cần xử lý" tab, the B3 mismatch drawer, the "Chưa cộng Điểm 50 phút" row highlight and uncredited alerts (13.9); "Yêu cầu hoàn tiền" tab, B2 drawer, refund chips (Đang yêu cầu hoàn tiền / Từ chối hoàn tiền / Đã hoàn tiền for refunds) and refund CSV columns (13.12); B4 banner, retiring approve/reject, the PayOS on/off chip (13.13); the recheck backend (13.5). Do not render placeholders for out-of-scope tabs.

### Figma B1 (verified 2026-10-15 via Figma MCP, file `mkudD5Ngi5RPyIAVxCcxXi`, page 30 `178:3`)

- Frames: `188:2` default, `188:407` loading, `188:678` empty-filter, `188:848` error, `188:1435` manual (cũ); `188:1025`/`188:1260` belong to 13.12/13.9. No B1 mobile frame exists (mobile frames on the page are refund-only) → "minimal mobile layout" is our call: stacked filters + row cards.
- Header "Nạp điểm" + subtitle; tabs "Giao dịch PayOS 128 · Yêu cầu hoàn tiền 3 · Cần xử lý 3 · Lịch sử thủ công (cũ) 46" as pills; filter row: search, "Tất cả trạng thái" select, date range "01/10 – 15/10/2026", "Xuất CSV" outlined green button at the right; table rows end in a chevron; numbered pager, 10 per page.
- Figma does **not** draw the recheck button on B1 rows. Decision D1 below.
- The manual frame draws a fully read-only table (Kết quả, Người duyệt). This contradicts AC3 while PENDING rows exist; AC wins: keep today's queue UI. "Người duyệt" is not shown (the manual DTO exposes `adminId`, not a name) — record the deviation in Completion Notes.
- The admin chip text in Figma ("Đang xử lý") differs from 13.7's PayOS chip ("Đang chờ thanh toán"). Reuse 13.7's `topUpChip` for one vocabulary; note the deviation.
- The epics (l.169) say UI stories wait for the designer fix pass. The pending fix items (6 cards, refund destination, mismatch SLA, read-only B4) do not touch B1's PayOS tab; B1 frames above were re-read on 2026-10-15 for this story.

### Decisions taken in this story (D1–D3 confirmed by Owner Quan 2026-10-15; D4–D6 defaults)

- **D1 — recheck location.** Row click/chevron opens a minimal drawer that holds "Kiểm tra lại với payOS". This satisfies "each PayOS row offers" without a new column, matches the Figma chevron, and is the drawer 13.9/13.12 extend.
- **D2 — date field.** List filter and CSV range both use `createdAt` in `Asia/Ho_Chi_Minh` days (what the "Thời gian" column shows). All statuses are exported; `paidAt` is empty when unpaid.
- **D3 — CSV columns.** `orderCode, userEmail, amountVnd, amountPaidVnd, points, pointsCredited, status, createdAt, paidAt` (times ISO 8601 with `+07:00`). `amountPaidVnd` and `pointsCredited` are added to the AC set because bank reconciliation needs the received amount and mismatch credits differ from the requested Points. No `counterAccount*`, no `providerReference`.
- **D4 — export is `POST` with CSRF**, because it writes an audit row; a cookie GET could be triggered cross-site and spam the audit trail.
- **D5 — export cap** 10,000 rows → `400 TOPUP_EXPORT_TOO_LARGE`; range ≤ 366 days.
- **D6 — tab counts** are channel totals regardless of filters (Figma 128 / 46). The sidebar "Nạp điểm" badge stays the manual PENDING count from `GET /admin/queue-counts`; 13.9 decides whether mismatches join it.

### Current state of files touched (read each before editing)

- `apps/backend/src/modules/economy/presentation/admin-top-up.controller.ts` — `@Controller(['admin/top-ups','api/admin/top-ups'])`, class guards `SessionAuthGuard, RolesGuard`, `@Roles('ADMIN')`; `GET /` manual list (`listTopUpRequestsQuerySchema`, service defaults status to `PENDING`), `POST :id/approve` (`CsrfGuard`, `x-correlation-id`), `POST :id/reject` (`CsrfGuard, JsonOnlyGuard`). 13.5 adds `POST :id/recheck` and injects `PayosTopUpService`. Preserve all of it.
- `…/infrastructure/prisma-top-up.repository.ts` — every manual query is pinned to `channel: 'MANUAL'` and `toEntity` rejects non-MANUAL rows; the manual tab therefore never sees PayOS rows. Do not touch.
- `…/application/ports/payos-top-up-repository.port.ts` — `findByOrderCode`, `findOwned`, `listByUser` (13.7), plus 13.5's `findPayosById`, `enqueueAdminAlert`, `recordAdminAudit` (verified merged). Model the export audit call on `PayosTopUpService.recheck` (`payos-top-up.service.ts:456`, the `audit(...)` closure). Add the admin list/count/export methods here, implement in both repositories.
- `…/application/top-up.service.ts:352-394` — `buildAuditEvent` shape for admin-audit Outbox rows (`producer: 'economy-service'`, `idempotencyKey: 'admin-audit:…'`). Audit events have no consumer; the Outbox row is the record (AD-16).
- `apps/backend/prisma/schema.prisma` `TopUpRequest` (l.1011) — holds `counterAccountBankId/BankName/Name/Number`; index `[channel, status, createdAt]` covers the list. No migration needed in this story.
- FE `app/(signed-in)/(admin)/admin/top-ups/` — `page.tsx` → `<Suspense><TopUpReviewScreen/>`; components `TopUpReviewScreen`, `TopUpQueueTable` (status segments `topUpStatusTabs`), `TopUpReviewPanel`, `RejectTopUpDialog`; hook `use-top-up-review.ts` (calls `refreshCounts()` from `useAdminCounts()`). Service `lib/admin/top-up-admin-service.ts` (`ADMIN_TOP_UP_PAGE_SIZE = TOP_UP_LIST_MAX_LIMIT`), helpers `lib/admin/top-up-admin.ts` (`requesterName` — reuse for the PayOS "Người dùng" name line), messages `lib/admin/top-up-admin-messages.ts`.
- `components/layout/admin/AdminShell.tsx` gates with `<SessionGate requireAdmin>`; `admin-nav.ts:17` nav entry.
- `lib/api/client.ts:149` `apiRequest` — JSON only today (`Accept: application/json`, reads `{ data }`); the blob option must keep the CSRF retry and `ApiError` mapping.
- `components/wallet/TopUpStatusChip.tsx`, `lib/wallet/top-up-history.ts` `topUpChip` — import, do not copy.

### API contract (after this story)

All under `/admin/top-ups` (also `/api/admin/top-ups`), ADMIN only, session cookie:
- `GET /payos?limit&offset&status&from&to&q` → `adminPayosTopUpListSchema`.
- `GET /tab-counts` → `{ payos, manual }`.
- `POST /payos/export` `{ from, to }` (CSRF) → `text/csv` attachment; 400 `VALIDATION_ERROR` | `TOPUP_EXPORT_TOO_LARGE`.
- `POST /:id/recheck` (13.5, merged, CSRF, no body) → `{ topUpId, result: 'CREDITED'|'STILL_UNPAID'|'MISMATCH', status, amountPaidVnd }`; 404 `TOPUP_NOT_FOUND` unknown/non-PAYOS; 503 `TOPUP_PROVIDER_UNAVAILABLE` (retryable; mapped in `common/http/http-exception.filter.ts`); 500 when payOS returns another `orderCode` or applying the snapshot fails (audit result `FAILED`) → FE generic error toast, no auto-retry. Each call writes `AdminTopUpRechecked` (results incl. `PROVIDER_UNAVAILABLE`/`FAILED`). E2E reference: `apps/backend/test/top-up-payos-recheck.e2e-spec.ts`.
- Unchanged: `GET /` (manual), `POST /:id/approve`, `POST /:id/reject`.

### Guardrails

- **PII boundary.** `counterAccount*` never leaves the repository for any 13.8 route, CSV included; tests assert it. Bank details stay for the 13.12 refund drawer only.
- **No money logic here.** Recheck moves money only inside 13.5's `CreditTopUp`; 13.8 adds no ledger writes.
- **CSV safety.** Formula-injection guard on every text cell (emails can start with `=`/`+`/`-`/`@`); BOM so Excel reads Vietnamese; `no-store`.
- **Audit before data.** No CSV leaves the server without its `AdminTopUpExported` row.
- **Route order.** Static `payos`, `tab-counts`, `payos/export` before any `:id` route; `ParseUUIDPipe` on `:id` routes rejects `payos` anyway, but keep the order explicit.
- **Do not break manual review.** `admin-top-ups.test.mjs`, the approve/reject e2e specs and the sidebar badge behave exactly as today.
- **Mock layer.** Screens call services only (`no-direct-mocks.test.mjs`).

### Previous story intelligence (13.7, merged PR #40 `ea832bd`)

- Built `TopUpStatusChip` in `components/wallet/` specifically so 13.8 imports it.
- Review lessons that apply here: don't keep stale responses when filters/ids change (abort the previous `useApiQuery` request, clear data on key change); don't render the same element id twice; use `z.output` types for parsed queries in controllers (`ListPayosTopUpsQuery` was `z.input` and broke `tsc`); deterministic mock seeds (an in-memory sequence reset on reload produced duplicate `orderCode`s).
- Tests are `node:test` over pure `lib/` modules; no component render tests. Keep logic out of components.
- 13.5 spec: recheck writes an audit row on every call (also on 503); it is idempotent in money, not in audit rows. The FE must not auto-retry recheck.

### Git intelligence

`ea832bd` merge 13.7 (FE wallet + owner PayOS list), `8c05738` merge 13.4 (webhook + `CreditTopUp`), `a269ea4` merge 13.3. Pattern: one shared-schema change + port/both repos/service/controller + e2e spec per backend slice; FE = service + pure rules + messages in `lib/`, components under the route folder, MSW handler+data pair.

### Project Structure Notes

- New BE: `apps/backend/src/common/http/csv.ts` (+ spec), `apps/backend/test/top-up-payos-admin-console.e2e-spec.ts`.
- New FE: `lib/admin/payos-top-up-admin-service.ts`, `lib/admin/payos-top-up-admin.ts`, `lib/admin/payos-top-up-admin-messages.ts`, `components/ui/Toasts.tsx` (moved), `admin/top-ups/components/{TopUpConsoleScreen,TopUpTabs,PayosTopUpsPanel,PayosTopUpDrawer,ManualTopUpsPanel}.tsx`, `tests/admin-top-ups-console.test.mjs`.
- Changed: schemas `economy/{payos-top-up,top-up}.schema.ts` (+ specs, index), economy port/repos/service/controller, `lib/api/client.ts`, `admin-nav.ts`, `admin/top-ups/page.tsx`, code-issues toast import, MSW admin top-up handler/data.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.8] (l.1918-1932); UX-DR-P11, P20, P21 (l.181, 189-190); Epic 13 UX note (l.169)
- [Source: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md#FR-78] (l.627-643), FR-79 (l.645-652), NFR-31 (l.1282)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md#AD-25] (l.212-280; recheck l.252), audit ownership (l.329)
- [Source: project-rescom-13-5 worktree `_bmad-output/implementation-artifacts/13-5-reconciliation-job-alerts-admin-recheck.md`] Tasks 1, 3, 4, 7 (recheck contract, `findPayosById`, `recordAdminAudit`)
- [Source: _bmad-output/implementation-artifacts/13-7-wallet-top-up-screens.md] (chip, review findings)
- Figma `mkudD5Ngi5RPyIAVxCcxXi` frames `188:2`, `188:407`, `188:678`, `188:848`, `188:1435`

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Visual check 2026-10-16 (mock mode, 1440 + 390, Figma `188:2`, `188:848`, `188:1435`): default, empty-filter, error, invalid range, drawer, all four recheck toasts (CREDITED / STILL_UNPAID / MISMATCH / provider error with "Thử lại"), CSV export (download `rescom-payos-topups-<from>-<to>.csv`), manual tab with PENDING rows + read-only note. No horizontal scroll at 390 on the PayOS tab. Loading skeleton not captured: MSW answers from the service worker instantly and `page.route` cannot delay it.
- Restyled to Figma B1: underline tabs, filters + table in one card, search icon, bold order code without `#`, right-aligned amount, centered error state with the `offline` mascot, pager `‹ 1 2 3 … N ›`. Kept deviations: two native date inputs instead of one range dropdown (no picker dependency); "Người dùng" shows the email prefix because the admin DTO has no display name; the manual tab keeps today's queue UI (AC3).

- Shared schemas, admin PayOS list/count/export with audit-before-CSV, console tabs/drawer/manual queue, MSW routes and tests implemented.
- Verified: workspace typecheck, lint, unit tests, production build; backend top-up e2e 35/35; diff check.
- Figma deviations: manual approval remains available for PENDING (AC3); reviewer name omitted (DTO provides adminId only); PayOS status chip wording reused from Story 13.7.
- Pending: visual verification at 1440/390 against five Figma frames; no browser tooling available.

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List

- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/modules/economy/application/exceptions/economy.exceptions.ts`
- `apps/backend/src/modules/economy/application/payos-top-up.service.spec.ts`
- `apps/backend/src/modules/economy/application/payos-top-up.service.ts`
- `apps/backend/src/modules/economy/application/ports/payos-top-up-repository.port.ts`
- `apps/backend/src/modules/economy/infrastructure/in-memory-payos-top-up.repository.ts`
- `apps/backend/src/modules/economy/infrastructure/prisma-payos-top-up.repository.ts`
- `apps/backend/src/modules/economy/presentation/admin-top-up.controller.ts`
- `apps/backend/test/top-up-payos-checkout.e2e-spec.ts`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/code-issues/components/CodeIssueToasts.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/code-issues/components/CodeIssuesScreen.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/TopUpReviewScreen.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/page.tsx`
- `apps/frontend/my-app/components/layout/admin/admin-nav.ts`
- `apps/frontend/my-app/lib/api/client.ts`
- `apps/frontend/my-app/mocks/handlers/index.ts`
- `apps/frontend/my-app/mocks/scenarios.ts`
- `apps/frontend/my-app/tests/rewards-admin-code-issues-view.test.mjs`
- `packages/schemas/src/economy/payos-top-up.schema.ts`
- `packages/schemas/src/economy/top-up.schema.spec.ts`
- `packages/schemas/src/economy/top-up.schema.ts`
- `apps/backend/src/common/http/csv.spec.ts`
- `apps/backend/src/common/http/csv.ts`
- `apps/backend/src/modules/economy/application/payos-top-up-admin.service.spec.ts`
- `apps/backend/test/top-up-payos-admin-console.e2e-spec.ts`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/ManualTopUpsPanel.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/PayosTopUpDrawer.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/PayosTopUpsPanel.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/TopUpConsoleScreen.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/TopUpTabs.tsx`
- `apps/frontend/my-app/components/ui/Toasts.tsx`
- `apps/frontend/my-app/lib/admin/payos-top-up-admin-messages.ts`
- `apps/frontend/my-app/lib/admin/payos-top-up-admin-service.ts`
- `apps/frontend/my-app/lib/admin/payos-top-up-admin.ts`
- `apps/frontend/my-app/mocks/data/admin-payos-top-ups.ts`
- `apps/frontend/my-app/mocks/handlers/admin-payos-top-ups.ts`
- `apps/frontend/my-app/tests/admin-top-ups-console.test.mjs`
- `packages/schemas/src/economy/payos-top-up-admin.schema.spec.ts`

### Change Log

- 2026-10-16: Implemented admin PayOS console, CSV audit, mock routes and regression checks; visual review pending.
