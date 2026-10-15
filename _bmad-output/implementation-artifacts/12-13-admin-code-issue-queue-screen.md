---
baseline_commit: 254854a
---
# Story 12.13: Admin Code-Issue Queue Screen

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Admin,
I want a queue of faulty-code reports with clear resolve actions,
so that users get a replacement, a refund, or an explanation within the target of one business day.

## Acceptance Criteria

1. **Entry and list.** Given an Admin in the Admin console, when they open **Báo cáo mã lỗi**, the list loads. The page is `/admin/code-issues`, reached from a new AdminSidebar entry placed between Flash Sale and Thống kê voucher, and hidden in pilot builds like the other Rewards entries. The list:
   - shows reports oldest first, with voucher, brand, reason, note, points, user, age, ticket status, and report status;
   - has the filters Đang mở (default), Đã xử lý, and Tất cả;
   - paginates with the contract `limit`/`offset` (FR-75).
2. **Detail.** Clicking a row opens a right-side drawer. The drawer:
   - fetches the report fresh (`GET /admin/rewards/code-issues/:id`);
   - shows the redemption reference (`RDM-…`), the price paid, the ticket status, the user's reason and full note, and, for a resolved report, the resolution: outcome, who, when, the refund reference, and the note;
   - offers **Thay mã**, **Hoàn {N} điểm**, and **Từ chối** only while the report is `OPEN`;
   - disables **Thay mã** when `canReplace` is false and shows the text of `replaceBlockedReason`.
3. **Confirmations.** Each action opens a confirmation that explains its effect:
   - replacement uses one stock unit and one code;
   - refund returns exactly `pricePoints` and cannot be undone;
   - rejection requires a note of 1–500 characters after trimming, and the user will see that note.

   While the request is in flight, the dialog cannot be dismissed. A failed request keeps the dialog open with the typed note.
4. **States and feedback.** Loading, empty (per filter), list-error, and already-resolved states are handled. A successful resolve shows a success toast, closes the drawer, and refreshes the list and the open count. A failed resolve shows its message and its backend error code (`Mã lỗi: …`) inside the dialog. A failed list refresh with data on screen shows an error toast with **Tải lại**.
5. **Mock and design.** The screen works against the Story 12.12 mock in full-mock and hybrid modes. It follows Figma page **28 · Admin – Báo cáo mã lỗi**, adapted to the frozen 12.10 contract (decision Option A, Quan 2026-10-14). No code value is ever rendered.

Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 → Story 12.13 (FR-75, BR-22). Contract: `packages/schemas/src/rewards/rewards-admin.schema.ts` L71–142, frozen. Mock and FE service: Story 12.12 (merged in PR #28, `fe1b7e8`). Design: Figma `mkudD5Ngi5RPyIAVxCcxXi`, page node `150:2`.

## Tasks / Subtasks

- [x] **Task 0: Branch and baseline.** The branch `feat/12-13-admin-code-issue-queue-screen` exists. It was cut from `origin/develop` @ `254854a` (12.12 merged, PR #28), with no upstream. Run `git status --short --branch` before the first edit. Scope: `apps/frontend/my-app` only. **No backend, no `packages/schemas`, and no mock-rule change.** The 12.12 mock is the reference. If the mock is wrong, stop and report; do not patch the contract.
- [x] **Task 1: Pure view module** (AC 1–4). New file `lib/admin/rewards-code-issues-view.ts`. All screen logic goes here so that it can be tested without rendering, like `lib/admin/rewards-vouchers-view.ts`. It must not import from `mocks/`.
  - [x] 1.1 Labels:
    - `CODE_ISSUE_ADMIN_REASON_LABELS`, the Figma admin labels: `CODE_INVALID` "Mã không hợp lệ", `STORE_REFUSED` "Cửa hàng từ chối", `CODE_ALREADY_USED` "Mã báo đã dùng", `OTHER` "Khác". The user-side `CODE_ISSUE_REASON_LABELS` in `lib/rewards/my-vouchers.ts` stays for the user portal; Figma uses shorter admin labels. The raw code is shown under the label.
    - `PRICE_SOURCE_LABELS`: `FLASH` "Flash", `PROMO` "Promo", `BASE` "Base". Flash uses the sale tone.
    - Ticket status to `{ tone, label }`: `UNUSED` "Chưa dùng" green, `EXPIRING` "Sắp hết hạn" danger, `USED` "Đã dùng" neutral, `EXPIRED` "Hết hạn" neutral. The contract has no `expiresAt`, so "Còn 78 ngày" is not possible.
    - Report status to `{ tone, label }`: `OPEN` "Đang mở" amber (points tone), `REPLACED` "Đã thay mã" green, `REFUNDED` "Đã hoàn điểm" blue, `REJECTED` "Đã từ chối" neutral. Use the existing `TagTone` values of `components/ui/Tag.tsx`.
  - [x] 1.2 SLA, display only. The backend has no SLA, so this is FE logic:
    - Working hours are Mon–Fri 08:00–17:00 Asia/Ho_Chi_Minh, with no holiday calendar. Add `// ponytail: no public-holiday calendar; add one when Ops supplies the list`.
    - `slaDueAt(createdAtIso)`: if `createdAt` falls inside working hours, the start is `createdAt`; otherwise the start is 08:00 of the next working day. The due time is the same clock time on the next working day after the start.
    - Examples, which become tests:
      - Tue 13/10 09:02 ⇒ Wed 14/10 09:02 (the Figma example);
      - Fri 10:00 ⇒ Mon 10:00;
      - Fri 18:30 ⇒ start Mon 08:00 ⇒ due Tue 08:00;
      - Sat 11:00 ⇒ due Tue 08:00;
      - Mon 07:59 ⇒ start Mon 08:00 ⇒ due Tue 08:00;
      - 17:00 exactly counts as outside working hours.
    - Compute in VN time with the `vietnamDateTimeParts` helper of `lib/format/date-time.ts`, or a fixed +07:00 offset (Vietnam has no DST). Do not depend on the machine time zone, because tests run on any TZ.
    - `formatWait(ms)`: ≥ 1 day ⇒ "N ngày M giờ" ("N ngày" when M = 0); ≥ 1 h ⇒ "N giờ"; otherwise "N phút" (at least 1). Floor every unit. Examples: "1 ngày 15 giờ", "21 giờ".
    - `openSlaView(issue, nowMs)` ⇒ `{ age, overdue, line, dueAt }`. `age = formatWait(now − createdAt)`. `line` is "Quá hạn {formatWait(now − due)}" when overdue, else "Còn {formatWait(due − now)}". `overdue` is `now >= due`.
    - `resolvedSlaView(issue)` ⇒ `{ took: formatWait(resolvedAt − createdAt), at: formatShortDateTime(resolvedAt), late: "trễ hạn {formatWait(resolvedAt − due)}" | null }`.
  - [x] 1.3 List helpers:
    - `PAGE_SIZE = 20`, the contract default; the page-size Select is dropped.
    - `pageRangeText(list, status)`: "Hiển thị {a}–{b} trong {total} báo cáo", plus " đã xử lý" for RESOLVED. On the OPEN tab, append " · dòng nền đỏ đã quá 1 ngày làm việc" only when a visible row is overdue.
    - `pageCount(total)` and `clampOffset(offset, total)`. Clamping steps back one page when a resolve empties the last page.
    - `tabLabel(filter, list | null)`:
      - Đang mở always shows `summary.open` ("Đang mở · 6");
      - the active non-OPEN tab shows its `total`;
      - the other tabs show no count;
      - while loading (`list` null), no tab shows a count.
  - [x] 1.4 `REPLACE_BLOCKED_COPY: Record<AdminCodeIssueReplaceBlockedReason, string>`. The single value follows the backend priority; there is no list of reasons (Option A). The copy:
    - `SHARED_CODE`: "Voucher dùng mã chung, mã mới sẽ giống mã cũ."
    - `TICKET_EXPIRED`: "Ticket đã hết hạn — mã mới cũng không dùng được."
    - `NO_STOCK`: "Hết tồn kho."
    - `NO_CODE`: "Lô mã đã hết mã chưa phát."

    The red block title is "Không thể thay mã". Its tail reads "Nhập thêm mã ở Quản lý voucher, hoặc hoàn điểm cho user." for `NO_STOCK`/`NO_CODE`, and "Hãy hoàn điểm hoặc từ chối kèm hướng dẫn." for the other two. The tooltip on the disabled button uses the same reason sentence.
  - [x] 1.5 Note rules: `noteState(outcome, raw)` ⇒ `{ trimmedLength, valid, counter: "N/500", overBy, helper }`.
    - REJECT is valid for 1–500 characters after trimming.
    - REPLACE and REFUND are valid for 0–500.
    - Helpers (Figma 28-3c2):
      - REJECT empty: "Nhập lý do để gửi cho user — bắt buộc."
      - over the limit: "Tối đa 500 ký tự — hãy rút gọn {overBy} ký tự." (the counter turns red);
      - REJECT ok: "User sẽ thấy nội dung này. Không ghi thông tin nội bộ.";
      - REPLACE/REFUND: "Chỉ Admin thấy ghi chú này."
    - `resolveBody(outcome, raw)` returns `AdminResolveCodeIssueDto`. The note is trimmed, and the key is omitted when the note is empty for REPLACE/REFUND.
  - [x] 1.6 `resolveErrorView(error, issue)` ⇒ `{ title, body, code, suggest?: "REFUND" | "REFUND_OR_REJECT", showResult?: true }`, from Figma 28-3e, adapted (no batch file names and no times the contract lacks). Read the code through `isApiError(error) && error.code` (`lib/api/api-error.ts`).
    - `NO_REPLACEMENT_AVAILABLE`: "Không còn mã để thay" / "Voucher vừa hết tồn kho hoặc hết mã chưa phát. Chưa có thay đổi nào. Hãy hoàn điểm cho user hoặc nhập thêm mã." Suggest REFUND.
    - `REPLACEMENT_NOT_SUPPORTED`: "Voucher này không hỗ trợ thay mã" / "{brand.name} dùng mã chung cho mọi user — mã mới sẽ giống mã cũ. Hãy hoàn điểm, hoặc từ chối kèm hướng dẫn sử dụng." Suggest REFUND_OR_REJECT.
    - `TICKET_EXPIRED`: "Ticket đã hết hạn" / "Mã mới cũng sẽ không dùng được — hãy hoàn {pricePoints} điểm cho user." Suggest REFUND.
    - `CODE_ISSUE_ALREADY_RESOLVED`: "Báo cáo đã được xử lý" / "Một Admin khác vừa xử lý báo cáo này. Thao tác của bạn không được áp dụng — điểm không bị hoàn thêm." Set `showResult`.
    - `TICKET_REFUNDED` (not in Figma): "Lượt đổi đã được hoàn điểm" / "Lượt đổi này đã được hoàn điểm trước đó. Chưa có thay đổi nào." Set `showResult`.
    - `CODE_ISSUE_NOT_FOUND`: "Không tìm thấy báo cáo" / "Báo cáo không còn tồn tại. Danh sách sẽ được tải lại."
    - Network, `kind === "network"`, or 5xx: "Chưa gửi được" / "Mất kết nối khi gửi. Ghi chú vẫn được giữ — bấm Thử lại. Gửi lại an toàn, báo cáo không bị xử lý hai lần." Code `NETWORK_ERROR`. The retry is safe because the backend answers the same outcome on a resolved report with a 200 no-op (12.10/12.12). Do **not** add an `Idempotency-Key` header: the contract has none.
    - Anything else, including 400/403: "Chưa xử lý được báo cáo" / "Chưa có thay đổi nào được lưu. Thử lại." The code is `error.code ?? "UNKNOWN"`.
  - [x] 1.7 `successToast(outcome, issue)` (Figma 28-4f, with RDM instead of RPT):
    - REPLACE: "Đã thay mã cho {reference}" / "User {userLabel} đã nhận mã mới và thông báo in-app."
    - REFUND: "Đã hoàn {pricePoints} điểm cho user {userLabel}" / "{reference} đã đóng · điểm về ví Khả dụng."
    - REJECT: "Đã từ chối {reference}" / "User nhận lý do từ chối và có thể báo lại."
- [x] **Task 2: Route, guard, nav** (AC 1):
  - [x] 2.1 New `app/(signed-in)/(admin)/admin/code-issues/page.tsx`. Copy the shape of `voucher-stats/page.tsx`:
    - `metadata.title` "Báo cáo mã lỗi | Rescom Admin";
    - `if (PILOT_BUILD) notFound();`, as this exact string, because `tests/pilot-scope.test.mjs` L53 matches it;
    - render `<CodeIssuesScreen />`.
  - [x] 2.2 `lib/pilot-scope.ts` `PILOT_HIDDEN_ROUTES`: add `{ route: "/admin/code-issues", guard: "(signed-in)/(admin)/admin/code-issues/page.tsx" }` next to the other Rewards admin entries. Add `"/admin/code-issues"` to the `proxy.ts` `config.matcher` list (pilot-scope L79 asserts that the matcher equals the list). Story 12.11 Task 2.2/7.2 will later move it to `REWARDS_ROUTES`.
  - [x] 2.3 `components/layout/admin/admin-nav.ts`: inside the existing `...(PILOT_BUILD ? [] : [...])` Rewards spread, between Flash Sale and Thống kê voucher, add `{ href: "/admin/code-issues", label: "Báo cáo mã lỗi", icon: "alert-circle" as const }`. `public/icons/alert-circle.svg` exists. Add no `queue` key (see Dev Notes, "Sidebar badge").
- [x] **Task 3: Data hooks** (AC 1, 2). New `app/(signed-in)/(admin)/admin/code-issues/hooks/use-admin-code-issues.ts`, in the pattern of `flash-sales/hooks/use-admin-flash-sales.ts`:
  - `useAdminCodeIssues(status, offset)` calls `useApiQuery(\`admin:code-issues:${status}:${offset}\`, signal => listAdminCodeIssues({ status, limit: PAGE_SIZE, offset }, signal))`.
  - `useAdminCodeIssue(id | null)` calls `useApiQuery(id ? \`admin:code-issue:${id}\` : null, signal => getAdminCodeIssue(id!, signal))`.
  - Use only the 12.12 service `lib/admin/rewards-code-issues-service.ts`. Do not add another fetch path.
- [x] **Task 4: Screen** (AC 1, 4, 5). New `app/(signed-in)/(admin)/admin/code-issues/components/CodeIssuesScreen.tsx` (client):
  - [x] 4.1 Layout:
    - `AdminPage` with title "Báo cáo mã lỗi" and meta "Mục tiêu xử lý: 1 ngày làm việc kể từ lúc gửi";
    - one stat card "Đang mở": `summary.open`, with the detail "Cũ nhất: chờ {formatWait(now − oldestOpenAt)}", or "Không có báo cáo chờ" when the value is null;
    - ARIA tabs (pattern `disputes/components/DisputeTabs.tsx`) with `tabLabel` text;
    - the table.

    The other three KPI cards, the search box, and the page-size Select are dropped (Option A, see Dev Notes).
  - [x] 4.2 Table. Use a raw `<table>` in the `FlashSalesScreen.tsx` L93–112 style. Columns, in Figma order:
    1. Voucher: `voucher.title`, and below it "{brand.name} · {reference}".
    2. Lý do: label, and the code below it in a caption.
    3. Ghi chú: truncated, with the full note in `title`; "—" when null.
    4. Điểm: `pricePoints` in the points colour, and the price-source label below it.
    5. User: `userLabel`.
    6. On OPEN rows, "Thời gian chờ ↑" with a clock icon, the age, and the SLA line. On resolved rows, "Xử lý sau": took, at, and late. On the ALL tab the header is "Thời gian", and each row uses its own form.
    7. Ticket: Tag.
    8. Báo cáo: Tag.
    9. Chevron.

    An overdue OPEN row gets the `bg-danger-soft` background, a 4 px `bg-danger` bar at the left, and `text-danger-strong` for the age and SLA line (theme tokens in `app/globals.css`; Figma `color-danger-bg`/`danger-text`). The whole row opens the drawer, and so does Enter/Space on a focusable row button. Do not make the `<tr>` itself clickable without keyboard support.
  - [x] 4.3 Pagination. Below the table, show `pageRangeText`, then "‹", the page buttons, and "›", each 36×36 `Button` (variant secondary or ghost; the current page has `aria-current="page"`). Changing the tab resets the offset to 0.
  - [x] 4.4 Clock. A `nowMs` state refreshes every 60 s with `setInterval`, skipped while `document.hidden`. Use the `FlashSalesScreen` approach; the list payload has no `serverTime`. Do not use `useServerNow`, which lives in the user app tree.
  - [x] 4.5 States:
    - **Loading**: skeleton rows with `animate-pulse` (`aria-busy` on the table region) and tabs without counts.
    - **Error with no data** (Figma 28-4c): `Mascot` "offline", "Không tải được danh sách báo cáo", "Kết nối tới máy chủ bị gián đoạn. Dữ liệu báo cáo không bị thay đổi.", a **Thử lại** button (`reload`), and "Mã lỗi: {code ?? 'REPORTS_LOAD_FAILED'}".
    - **Error while data is shown** (a reload failed): keep the rows and push the error toast "Không làm mới được danh sách" / "Dữ liệu có thể đã cũ. Bấm để tải lại." with the action **Tải lại**.
    - **Empty OPEN** (Figma 28-4b): `Mascot` "cheer", "Không còn báo cáo nào đang mở", "Mọi báo cáo mã lỗi đã được xử lý. Báo cáo mới sẽ hiện ở đây.", and the button "Xem báo cáo đã xử lý", which switches the tab. Drop Figma's "kèm số đếm trên menu bên trái": there is no badge.
    - **Empty RESOLVED**: "Chưa có báo cáo nào được xử lý".
    - **Empty ALL**: "Chưa có báo cáo mã lỗi nào".
  - [x] 4.6 Toasts. No Toast primitive exists. Add a small `CodeIssueToasts.tsx` in this feature folder:
    - bottom-right, fixed, 420 px wide;
    - success: `role="status"`, auto-hides after 5 s;
    - error: `role="alert"`, stays until closed or its action is used;
    - at most 3, newest at the bottom; each has a close button with `aria-label="Đóng"`.
    - Styles from Figma 28-4f, mapped to existing theme tokens (`app/globals.css`; no new token): success `bg-tone-teal-bg` + `border-tone-teal-accent` + `text-tone-teal-ink`; error `bg-danger-soft` + `border-danger`.

    Mark it `// ponytail: feature-local toast; promote to components/ui when a second screen needs one`.
- [x] **Task 5: Drawer** (AC 2, 4). New `components/CodeIssueDrawer.tsx`:
  - [x] 5.1 Container. Use `Dialog` (`components/ui/Dialog.tsx`), `width={560}`, `labelledBy="code-issue-drawer-title"`, and right-anchored on desktop via `className`, e.g. `lg:mr-0 lg:my-0 lg:h-dvh lg:max-h-dvh lg:rounded-r-none`. The `lg:` variants win over the base `m-auto`, as in `CodeIssueSheet`'s `max-lg:` override. Do not add a Drawer primitive or change `Dialog`. Verify the placement in the browser. The close button is an `IconButton` with the `x` icon and `aria-label="Đóng"`. Focus returns to the row button when the drawer closes; the native `<dialog>` does this when focus started there, so verify it.
  - [x] 5.2 Data. Show the list row immediately, then replace it with `useAdminCodeIssue(id)` data, which carries a fresh `canReplace`. While the detail loads, the action buttons are disabled. If the detail fails: a 404 shows "Không tìm thấy báo cáo" plus a reload of the list; other errors show an `Alert` and **Thử lại**.
  - [x] 5.3 Header:
    - `reference` (H2, the title id);
    - the status Tag;
    - for OPEN, a danger Tag "Quá hạn {…}" when overdue;
    - the line "Gửi {dd/MM/yyyy HH:mm} · user {userLabel}".
  - [x] 5.4 Body sections, in order:
    1. **SLA banner (OPEN only).** Overdue: danger, "Quá hạn {x} · hạn xử lý {dd/MM HH:mm}". Otherwise: info, "Còn {x} · hạn xử lý {dd/MM HH:mm}". Both have the sub-line "Mục tiêu 1 ngày làm việc kể từ lúc gửi. Báo cáo gửi ngoài giờ được tính từ 08:00 ngày làm việc kế tiếp."
    2. **Voucher card.** `voucher.title`, `brand.name`, and a "Flash Sale" chip when `priceSource === "FLASH"`.
    3. **"THÔNG TIN ĐỔI ĐIỂM"** key/value rows:
       - "Mã tham chiếu": `reference` plus a copy `IconButton` (`navigator.clipboard.writeText`, `aria-label="Sao chép mã tham chiếu"`);
       - "Loại giá": `PRICE_SOURCE_LABELS` and "Đã trừ {pricePoints} điểm";
       - "Ticket": the ticket status label;
       - "Mã voucher": lock icon, "Đã ẩn", and "Không hiển thị giá trị mã với Admin".
    4. **"BÁO CÁO CỦA USER".** "Lý do: {label}", a neutral chip with the code, and a subtle box "Ghi chú của user" with the full note in “…”, or "User không để lại ghi chú.".
    5. **Replace availability (OPEN only).** When `canReplace` is true: a green banner "Có thể thay mã". When false: the red "Không thể thay mã" block (Task 1.4). For `NO_STOCK`/`NO_CODE` it also has the link "Mở Quản lý voucher ›" to `/admin/vouchers/{voucher.id}` (same hidden route group).
    6. **"KẾT QUẢ XỬ LÝ" (resolved only, read-only).** First the banner "Đã xử lý · chỉ xem" / "Không còn thao tác Thay mã / Hoàn điểm / Từ chối." Then:
       - "Kết quả" = status label;
       - "Người xử lý" = `resolvedBy.name`;
       - "Thời điểm" = `resolvedAt`;
       - "Xử lý sau {took}", plus " · trễ hạn …" when late, or " · trong hạn 1 ngày làm việc";
       - REFUNDED: "Mã hoàn điểm" = `resolution.refundReference`, and "Hoàn {pricePoints} điểm về ví Khả dụng";
       - REPLACED: "Mã mới" = "Đã ẩn";
       - the note: for REJECTED, "Ghi chú gửi user" with the quoted `resolutionNote`; for the others, "Ghi chú nội bộ" (when not null).
  - [x] 5.5 Footer (OPEN only), 48 px buttons:
    - left: "Từ chối" (`variant="ghost"`);
    - right: "Hoàn {pricePoints} điểm" (`variant="outline"`, icon `refund`) and "Thay mã" (`variant="primary"`, icon `refresh`).

    When `canReplace` is false, "Thay mã" gets `disabled`, `aria-describedby` pointing at the red block, and `title` = the reason sentence.
- [x] **Task 6: Resolve dialog** (AC 3, 4). New `components/ResolveCodeIssueDialog.tsx`. Base it on `disputes/components/ConfirmDecisionDialog.tsx`: one component, `outcome` prop. It renders `Dialog` `width={480}` with `dismissible={!busy}`, and is opened on top of the drawer; native `showModal` stacks it.
  - [x] 6.1 Copy (Figma 28-3a/b/c, adapted; no stock numbers, batch files or dates, which the contract lacks):
    - **REPLACE**:
      - title "Thay mã cho {reference}?";
      - subtitle "User {userLabel} · {voucher.title} · {brand.name}";
      - box "Điều sẽ xảy ra":
        - "Dùng 1 đơn vị tồn kho và cấp 1 mã mới chưa phát.";
        - "Mã cũ không được phát lại cho người khác.";
        - "Ticket giữ hạn dùng và chuyển về “Chưa dùng”. User nhận thông báo in-app “Báo cáo đã được xử lý”.";
      - optional note "Ghi chú nội bộ · không bắt buộc", placeholder "VD: Lô t10 lỗi định dạng, đã báo đối tác";
      - buttons "Huỷ" / "Thay mã".
    - **REFUND**:
      - title "Hoàn {pricePoints} điểm cho user {userLabel}?";
      - subtitle "{reference} · {voucher.title} · giá {PRICE_SOURCE_LABELS}";
      - box:
        - "+{pricePoints} điểm về ví Khả dụng của user — đúng số điểm đã trừ.";
        - "Ghi bút toán đảo cho giao dịch {reference}.";
        - "Tồn kho không được trả lại.";
        - "Ticket chuyển sang “Đã hoàn điểm”. User nhận thông báo in-app.";
        - **"Không thể hoàn tác."** (bold);
      - optional internal note (same as REPLACE; the backend sends no REFUND note to the user);
      - buttons "Huỷ" / "Hoàn {pricePoints} điểm".
    - **REJECT**:
      - title "Từ chối báo cáo {reference}?";
      - subtitle "Không thay mã, không hoàn điểm.";
      - box:
        - "Ticket giữ nguyên, user dùng tiếp được và có thể báo lại nếu vẫn lỗi.";
        - "User sẽ thấy nguyên văn lý do bên dưới trong thông báo.";
      - required `Textarea` "Lý do từ chối", with a red "* bắt buộc" and placeholder "Giải thích vì sao báo cáo không được chấp nhận và user nên làm gì tiếp…";
      - buttons "Huỷ" / "Từ chối báo cáo".
  - [x] 6.2 Note field. Use `Textarea` with `maxLength` **unset**, so that the over-limit state of Figma 28-3c2 can show, plus the `noteState` helper and counter. The confirm button is disabled while `!valid`.
  - [x] 6.3 Busy state (Figma 28-3d):
    - the confirm button shows a `Spinner` plus "Đang gửi…";
    - Huỷ, the close X, and the textarea are disabled;
    - `dismissible={false}`;
    - the status line reads "Đang gửi… Không đóng cửa sổ. Nếu mất mạng, bấm lại an toàn — mỗi báo cáo chỉ được xử lý một lần.";
    - a ref guard blocks a second submit (double click).
  - [x] 6.4 On success:
    1. close the dialog and the drawer;
    2. push `successToast`;
    3. `reload()` the list, clamping the offset when needed (the open count updates from `summary`).
  - [x] 6.5 On failure:
    - keep the dialog open and the note intact;
    - render `resolveErrorView` in an `Alert tone="danger"` with title, body, and "Mã lỗi: {code}";
    - the confirm button becomes **Thử lại**, with the same outcome and note.
    - When `suggest` is set, show a secondary button that closes this dialog and opens the suggested one ("Hoàn điểm" / "Từ chối").
    - When `showResult` is set, the button **Xem kết quả** closes the dialog, reloads the detail (the drawer turns read-only and shows the outcome, `resolvedBy.name` and time, i.e. Figma 28-4d) and reloads the list.
    - On `CODE_ISSUE_NOT_FOUND`, close both and reload the list.
- [x] **Task 7: Tests** (AC 1–5). New `tests/rewards-admin-code-issues-view.test.mjs`. Use `node --test`, importing `.ts` through the type-stripping loader preamble of `tests/rewards-admin-vouchers-view.test.mjs`.
  - [x] 7.1 SLA: every example of Task 1.2, run under `TZ=UTC` semantics (construct ISO strings with `+07:00`); `formatWait` boundaries (59 min, 1 h, 23 h 59, 24 h, 39 h ⇒ "1 ngày 15 giờ"); the overdue boundary `now = due − 1 ms` vs `= due`; `resolvedSlaView` late vs on time.
  - [x] 7.2 Labels: all four reasons, price sources, ticket statuses, report statuses, and blocked reasons are exhaustive (keys equal the contract enums, read from `@rescom/schemas` `.options`).
  - [x] 7.3 Note rules: REJECT with "", "   ", 1 char, 500, and 501 chars; REPLACE with ""; trimming; `resolveBody` omits an empty note; every `resolveBody` result parses with `adminResolveCodeIssueSchema`.
  - [x] 7.4 `resolveErrorView`: each code of Task 1.6, a network `ApiError`, a 500, an unknown code, and a non-ApiError. Build them with the real `ApiError` class.
  - [x] 7.5 List helpers: `tabLabel` (loading, OPEN, RESOLVED active, ALL active); `pageRangeText` (1–6 of 6 with an overdue suffix; 11–20 of 32 resolved); `clampOffset` after the last item of the last page is resolved.
  - [x] 7.6 Integration against the 12.12 mock: import the MSW `handlers` and use `getResponse`, as `tests/rewards-admin-code-issues.test.mjs` does. Feed the seeded list into the view helpers and assert:
    - 6 OPEN rows, oldest first (Phúc Long first);
    - for each OPEN row, the blocked copy matches `replaceBlockedReason`;
    - a REFUND success toast uses the seeded `pricePoints`.
  - [x] 7.7 Static checks, reading the source files:
    - the page has `if (PILOT_BUILD) notFound();`;
    - `admin-nav.ts` has the entry inside the PILOT_BUILD spread;
    - no file under `app/(signed-in)/(admin)/admin/code-issues/` imports from `mocks/` (also covered by `no-direct-mocks.test.mjs`);
    - no screen file reads a `.code` property of an issue: `grep` for `replacementCode`, or `issue.code` / `item.code`.
  - [x] 7.8 Existing suites stay green with **no count changes**: `pilot-scope` (route and matcher added), `route-diff`, `hybrid-mocking` (still 44), `contract-callsites`, `rewards-admin-code-issues`. The drawer's `/admin/vouchers/{id}` link lives inside a pilot-hidden page, so the `pilot-scope` link sweep (pilot-visible files only) must not flag it; if it does, report it instead of weakening the guard.
- [x] **Task 8: Verification** (AC 5). Run in `apps/frontend/my-app` and record the commands and pass counts in the Completion Notes:
  - [x] 8.1 `npm test`, `npm run typecheck`, and `npm run lint`.
  - [x] 8.2 **Manual browser check (required; 12.6 skipped it and stayed open).** Run `NEXT_PUBLIC_API_MOCKING=enabled npm run dev` and log in as the mock admin `admin@rescom.vn` (password in `mocks/data/auth.ts`). Then, in order:
    1. Sidebar entry and active state.
    2. Tabs and counts; RESOLVED page 2; ALL.
    3. Overdue rows red.
    4. Drawer for Highlands (replaceable), Coffee House (`NO_CODE`, link), Gong Cha (`SHARED_CODE`), and Phúc Long (`TICKET_EXPIRED`).
    5. A resolved drawer of each outcome.
    6. Thay mã on Highlands; then the toast; the open count goes 6 → 5; the user portal ticket shows a new code.
    7. Hoàn điểm with the "Không thể hoàn tác" copy; the toast; the user history shows `RFD-`.
    8. Từ chối with an empty note (disabled), then 501 characters (red counter), then a valid note.
    9. Forced errors via `?msw=rewards-resolve-already-resolved`, `-no-replacement`, `-not-supported`, `-ticket-expired` (reset with `?msw=default`; the value persists in localStorage).
    10. `?msw=slow` (loading), `?msw=api-error` (error state), and `?msw=api-offline` (network error in the dialog, then retry).
    11. Keyboard only: Tab to a row, Enter opens the drawer, Esc closes it, and focus returns; Esc is blocked while sending.

    Record what was and was not checked, honestly.
  - [x] 8.3 Pilot check. `NEXT_PUBLIC_PILOT_BUILD=true NEXT_PUBLIC_API_MOCKING=disabled npm run build`, then `node scripts/check-pilot-bundle.mjs`. Optionally `npm start`: `/admin/code-issues` must return 404 and the sidebar must have no entry. If the build cannot run, say so; do not tick it.

### Review Findings

Code review 2026-10-15 (Blind Hunter + Edge Case Hunter + Acceptance Auditor, Sonnet). Task 8.2 browser check still open (known, not re-listed).

- [x] [Review][Patch] Row uses `<tr role="button">`, which strips table semantics; put a real focusable row button in the first cell (Task 4.2, focus return 5.1) [app/(signed-in)/(admin)/admin/code-issues/components/CodeIssuesScreen.tsx:61]
- [x] [Review][Patch] Tabs lack the DisputeTabs keyboard model (roving tabindex + ArrowLeft/ArrowRight) (Task 4.1) [app/(signed-in)/(admin)/admin/code-issues/components/CodeIssuesScreen.tsx:52]
- [x] [Review][Patch] Overdue age/SLA text uses `text-danger`, spec requires `text-danger-strong` (Task 4.2; also drawer SLA banner) [app/(signed-in)/(admin)/admin/code-issues/components/CodeIssuesScreen.tsx:61]
- [x] [Review][Patch] Pagination buttons are `size="sm"` (40 px) not 36x36, and "‹"/"›" have no aria-label (Task 4.3) [app/(signed-in)/(admin)/admin/code-issues/components/CodeIssuesScreen.tsx:62]
- [x] [Review][Patch] Skeleton region has `aria-label` on a role-less div (ignored by AT) [app/(signed-in)/(admin)/admin/code-issues/components/CodeIssuesScreen.tsx:54]
- [x] [Review][Patch] Drawer footer buttons miss `refund`/`refresh` icons and 48 px size (`size="base"`) (Task 5.5) [app/(signed-in)/(admin)/admin/code-issues/components/CodeIssueDrawer.tsx:76]
- [x] [Review][Patch] Drawer visuals off spec: "Có thể thay mã" banner is info not green; "Mã voucher" row lacks lock icon; "Thời gian chờ ↑" header lacks clock icon (Task 5.4, 4.2) [app/(signed-in)/(admin)/admin/code-issues/components/CodeIssueDrawer.tsx:74]
- [x] [Review][Patch] Detail 404 button reads "Thử lại" but closes drawer and reloads list; label it as a list reload (Task 5.2) [app/(signed-in)/(admin)/admin/code-issues/components/CodeIssueDrawer.tsx:69]
- [x] [Review][Patch] Clipboard copy: `void navigator.clipboard.writeText` gives no feedback and leaves an unhandled rejection / TypeError when clipboard is unavailable [app/(signed-in)/(admin)/admin/code-issues/components/CodeIssueDrawer.tsx:72]
- [x] [Review][Patch] Resolve dialog copy: "Không thể hoàn tác." not bold; REJECT "* bắt buộc" not red (Task 6.1) [app/(signed-in)/(admin)/admin/code-issues/components/ResolveCodeIssueDialog.tsx:38]
- [x] [Review][Patch] Toast effect depends on `items`, so every push re-arms all success timers and older toasts outlive 5 s (Task 4.6) [app/(signed-in)/(admin)/admin/code-issues/components/CodeIssueToasts.tsx:6]
- [x] [Review][Patch] Test gaps vs Task 7: 7.7 lacks the `.code`/`replacementCode` grep (title overclaims); 7.4 lacks unknown-code-with-status, 400/403, `suggest`/`showResult` asserts; 7.5 overdue `pageRangeText` full string and `clampOffset` last-page case; 7.6 blocked copy only truthy, not matched to reason [tests/rewards-admin-code-issues-view.test.mjs:68]
- [x] [Review][Patch] Tasks 1–7 checkboxes unticked although implemented; tick after fixes [_bmad-output/implementation-artifacts/12-13-admin-code-issue-queue-screen.md:41]
- [x] [Review][Defer] Pagination renders one button per page with no windowing [app/(signed-in)/(admin)/admin/code-issues/components/CodeIssuesScreen.tsx:62] — deferred, not required by spec; add windowing when backlog exceeds ~10 pages
- [x] [Review][Defer] Tab/page change blanks list, pagination and tab counts until the new key loads [lib/api/use-api-query.ts:41] — deferred, pre-existing useApiQuery key semantics

## Dev Notes

### Scope boundaries (read first)

- **In:** the route, guard, and nav entry; the view module; hooks; the screen, drawer, resolve dialog, and feature-local toasts; tests; the browser and pilot checks.
- **Out:**
  - any contract, schema, backend, or mock-rule change (12.12 owns the mock; 12.10 owns the contract);
  - de-mocking and `REWARDS_ENABLED` (12.11 Part D moves the route into `REWARDS_ROUTES`);
  - a sidebar count badge (see below);
  - search, the SLA KPIs (overdue, due soon, average handling), the outcome breakdown, voucher value and dates, stock and batch numbers, the RPT report id, and the report count per ticket (Option A);
  - mock user notifications on resolve (12.12 Out);
  - a mobile layout (the Admin console is desktop 1440; below `lg` the drawer falls back to a centred dialog).
- **Gates:** none new. Production enable stays with 12.11 / OQ-24.

### Figma 28 → contract adaptation (Option A, decided 2026-10-14)

| Figma | Screen does |
|---|---|
| `RPT-1013-01` report id everywhere | `reference` (`RDM-…`) everywhere: title, toasts, row |
| 4 KPI cards | 1 card "Đang mở" from `summary.open` + `oldestOpenAt` |
| Tab counts on all tabs; "Đã xử lý: 32 · thay mã 14…" subtitle | Đang mở count always; the active tab's `total`; static subtitle |
| Search "Tìm RPT, RDM hoặc #user"; 200 px Select; page-size Select | dropped; fixed `limit` 20 |
| Ticket "Còn 78 ngày", "Hạn dùng 31/12/2026", "Ngày đổi", voucher "50.000đ", Flash session, "Giá gốc 250" | ticket status label; "Đã trừ {pricePoints} điểm"; price-source label |
| Blocked block lists every true reason, priority expired → shared → stock → codes, names `OUT_OF_STOCK`/`NO_CODES` | one `replaceBlockedReason` (backend priority shared → expired → stock → code; names `NO_STOCK`/`NO_CODE`) |
| "tồn kho 63 → 62", "lô highlands-50k-t10.csv" in dialogs and drawer | generic sentences without numbers or file names |
| "Mọi request mang idempotency key = id báo cáo + hành động" | no header; the same-outcome replay of the backend makes a retry safe |
| Reject copy "Ticket quay về “Chưa dùng”" and "trên ticket" | REJECT does not change the ticket (12.10/12.12), and the user-side ticket contract has no note; the note reaches the user only through the `CODE_ISSUE_RESOLVED` notification (`code-issue-notification.handler.ts` L49–52) |
| "Mã cũ bị vô hiệu" | the backend claims a new code and keeps the old one bound to the redemption, so it is never re-issued: "Mã cũ không được phát lại cho người khác." |
| Sidebar group label "ĐỔI QUÀ (MỚI)", Flash "Đang chạy" pill, red open-count badge | not built (no group support in `ADMIN_NAV`; badge see below) |
| Toast position: the rules say bottom right, the component text says top right | bottom right (the rules frame wins) |
| AC "failure toasts use the backend error codes" | business errors are inline in the dialog with "Mã lỗi: {code}" (Figma 28-3e says the dialog must stay open with the input kept); toasts are used for success and for list-refresh failure |

### Sidebar badge

The badge counts come from `GET /admin/queue-counts` (`adminQueueCountsSchema` in `@rescom/schemas`, backend `admin-overview.controller.ts`). A `codeIssues` key would change the shared schema and the backend, which is outside this FE-only story. The open count is shown on the tab and the stat card instead. Open point 1.

### Existing code to reuse (do not reinvent)

| Need | Use |
|---|---|
| API calls | `lib/admin/rewards-code-issues-service.ts` (12.12; already PILOT_BUILD-guarded) |
| Fetch state | `useApiQuery` in `lib/api/use-api-query.ts` (`{ data, error, loading, reload }`; reload keeps the data; `key: null` skips) |
| Errors | `ApiError`/`isApiError` in `lib/api/api-error.ts` (`kind`, `status`, `code`) |
| Page header | `components/layout/admin/AdminPage.tsx` (`title, meta, actions`) |
| Nav | `components/layout/admin/admin-nav.ts` (`ADMIN_NAV`, `isAdminNavActive` already handles sub-paths) |
| Pilot hiding | `lib/pilot-scope.ts` `PILOT_HIDDEN_ROUTES` + `proxy.ts` matcher + page guard |
| Dialog / confirm pattern | `components/ui/Dialog.tsx`; `admin/disputes/components/ConfirmDecisionDialog.tsx`; user-side `rewards/components/CodeIssueSheet.tsx` (note field and `dismissible={!submitting}`) |
| Tabs | `admin/disputes/components/DisputeTabs.tsx` (ARIA tabs with counts) |
| Primitives | `Button` (`primary`, `outline`, `ghost`, `secondary`, `danger`), `IconButton`, `Tag`/`TagTone`, `Chip`, `Alert`, `Textarea`, `Spinner`, `Icon` (svgs in `public/icons`: `alert-circle`, `refresh`, `refund`, `copy`, `lock`, `clock`, `chevron-left`, `chevron-right`, `x`) |
| Mascots | `components/brand/Mascot.tsx` (`cheer`, `offline`) |
| Dates | `lib/format/date-time.ts` (`formatShortDateTime`, `formatDayMonth`, `formatTime`, `vietnamDateTimeParts`); `formatFullDate` in `lib/rewards/voucher-display.ts` |
| Countdown-free clock | `FlashSalesScreen.tsx` (30 s `setInterval`, skipped when hidden) |
| Table style | `FlashSalesScreen.tsx` L93–112 |

There is **no** shared Toast, Pagination, Drawer, EmptyState, or Skeleton. Build only what this screen needs, feature-local, inline where it is a few lines.

### Contract facts (frozen, from 12.10/12.12)

- The list is always `createdAt ASC` for every filter. `summary` counts OPEN over all reports, whatever the filter. The query defaults are `status=OPEN`, `limit=20`, and `offset=0`; `limit` is at most 50.
- `canReplace` is false for every non-OPEN report, and `replaceBlockedReason` is then `null`. Do not show the red block on resolved reports.
- `resolution.refundReference` is present only for REFUNDED. `resolvedBy.name` is the admin **email** for live resolves; the seeds use "Admin Hùng". Show it as given.
- Resolve success is **200** and returns the updated `adminCodeIssueSchema`. Repeating the same outcome ⇒ 200 with the stored result (safe retry). A different outcome ⇒ 409 `CODE_ISSUE_ALREADY_RESOLVED`.
- Error codes: 400 `VALIDATION_ERROR`; 401; 403 `FORBIDDEN_RESOURCE` or `REWARDS_ADMIN_CAPABILITY_REQUIRED`, and a missing CSRF; 404 `CODE_ISSUE_NOT_FOUND`; 409 `CODE_ISSUE_ALREADY_RESOLVED`, `NO_REPLACEMENT_AVAILABLE`, `REPLACEMENT_NOT_SUPPORTED`, `TICKET_EXPIRED`, `TICKET_REFUNDED`.
- REFUND is allowed on an expired ticket. Stock and the code are not returned.
- No payload carries a code value. Never add one to the UI.

### Mock facts (12.12) used in the browser check

- The seed has 6 OPEN reports, in order: Phúc Long (`TICKET_EXPIRED`, 120 PROMO), Highlands (replaceable, 150 FLASH), Lotteria (STORE_REFUSED), KFC (CODE_ALREADY_USED), The Coffee House (`NO_CODE`), and Gong Cha (`SHARED_CODE`). There are also 32 resolved reports (14 replaced, 11 refunded, 7 rejected).
- Ages are relative to the seed time, so overdue rows depend on the current clock. Check the overdue logic in the unit tests, not by eye.
- The forced scenarios touch only the resolve route. `slow`, `api-error`, and `api-offline` apply to all admin routes.
- Gotchas for the Chrome automation tab (12.2):
  - it reports `document.hidden = true`, which pauses the 60 s clock (force `hidden = false` if needed);
  - the window cannot be resized, so check the 1440 layout via an injected fixed iframe.

### Testing standards

- `node --test`, with no jsdom or React rendering in this repo. UI behaviour is proven through the pure `*-view.ts` module, the MSW handlers, and static source checks.
- Do not use `test.skip` or `.only`, and write no placeholder tests.
- Build `ApiError` instances with the real class. Parse every fixture with the shared Zod schemas.

### Project Structure Notes

- New:
  - `app/(signed-in)/(admin)/admin/code-issues/page.tsx`;
  - `…/code-issues/components/{CodeIssuesScreen,CodeIssueDrawer,ResolveCodeIssueDialog,CodeIssueToasts}.tsx`;
  - `…/code-issues/hooks/use-admin-code-issues.ts`;
  - `lib/admin/rewards-code-issues-view.ts`;
  - `tests/rewards-admin-code-issues-view.test.mjs`.
- Changed: `components/layout/admin/admin-nav.ts`, `lib/pilot-scope.ts`, `proxy.ts`.
- New exports use `adminCodeIssue*`/`codeIssue*` names, never `reward*`, which collides with survey rewards (12.1).
- The Next.js here (16.3) differs from training data (`apps/frontend/my-app/AGENTS.md`). Copy the page shape from the sibling `voucher-stats/page.tsx`, and read `node_modules/next/dist/docs/` before using any Next API not already used by the sibling pages.

### Previous story intelligence

- **12.12** (`fe1b7e8`, PR #28) built the mock, service, and allowlists for these exact routes. Its review lesson: test against state that actually changes, not a replay no-op.
- **12.6**: the manual browser check and the pilot build were skipped, so the story stayed `in-progress`. Do them here (Task 8.2/8.3), or report honestly.
- **12.5/12.6** set the screen patterns: `useApiQuery` hooks, a raw table, inline `Alert` errors, `Dialog` with `dismissible={!busy}`, a reload after mutations, and logic in `lib/admin/*-view.ts`.
- **12.4**: the user-side `CodeIssueSheet` and `codeIssueStatusView`. The user portal shows the outcome on the ticket, which is useful for the cross-portal browser check.
- **12.10**: decisions 3A (REPLACE resets usage) and 1A (a refunded ticket hides its code on the backend). REJECT note text reaches the user by notification only.

### Git intelligence

- `254854a` Merge PR #28 (12.12); `fe1b7e8` 12.12, which touched the mock data, handlers, service, allowlists, and tests, and no UI; `45983a3` PR #27 (12.10). `admin-nav.ts`, `pilot-scope.ts`, and `proxy.ts` were last changed by 12.5/12.6. 12.11 will rewrite their Rewards parts, so keep the diff to one entry each.

### Latest tech information

- No new dependency. Next 16.3, React 19.2, Tailwind theme tokens, `lucide-react` is installed but the screens use `components/ui/Icon` with `public/icons` svgs (keep that). Native `<dialog>` with `showModal` stacks nested modals in the top layer, and Esc closes only the topmost one.

### Open points for Quan (do not block; solo owner)

1. **Sidebar open-count badge** (Figma shows a red "6"). It needs a `codeIssues` key in `adminQueueCountsSchema` and in the backend `GET /admin/queue-counts`. Default: no badge in 12.13. Add it in 12.11 or in a small follow-up story.
2. **SLA working hours** are assumed to be Mon–Fri 08:00–17:00 VN, with no holidays (FE display only). Confirm the end hour and whether public holidays matter.
3. **AC 4 wording**: business errors show inline in the dialog with the backend code, not as toasts (Figma 28-3e). Say so if a failure toast is also wanted.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12, Stories 12.10, 12.12, 12.13, 12.11]
- [Source: `_bmad-output/implementation-artifacts/12-12-admin-code-issue-queue-contract-msw-mock.md`, Dev Notes "Figma 28 vs the frozen contract", Open point 1 (Option A)]
- [Source: `_bmad-output/implementation-artifacts/12-11-rewards-integration-without-mocks-enable-gate.md` Task 2.2, 7.2, 7.3]
- [Source: `packages/schemas/src/rewards/rewards-admin.schema.ts` L71–142; `packages/schemas/src/rewards/redemption.schema.ts` L26–40]
- [Source: `apps/backend/src/modules/rewards/presentation/admin-rewards-code-issues.controller.ts`; `application/rewards-admin-code-issues.service.ts` L111–260; `application/code-issue-notification.handler.ts` L42–60]
- [Source: `apps/frontend/my-app/{lib/admin/rewards-code-issues-service.ts, lib/api/use-api-query.ts, lib/api/api-error.ts, lib/pilot-scope.ts, proxy.ts, components/layout/admin/{admin-nav.ts,AdminShell.tsx,AdminPage.tsx}, components/ui/Dialog.tsx, lib/rewards/my-vouchers.ts, lib/format/date-time.ts}`; `app/(signed-in)/(admin)/admin/{flash-sales,voucher-stats,disputes}/…`; `tests/{pilot-scope,rewards-admin-code-issues,rewards-admin-vouchers-view,no-direct-mocks}.test.mjs`]
- [Source: Figma `mkudD5Ngi5RPyIAVxCcxXi` page 28 (`150:2`): list 28-1a `150:3`, 28-1b `151:196`; drawer 28-2a `155:406`, 28-2b `155:753`, 28-2c `156:822`; specs `156:1262`, `156:1308`; dialogs 28-3a `157:1120`, 28-3b `157:1482`, 28-3c `157:1836`, 28-3c2 `157:2147`, 28-3d `158:1766`, errors 28-3e `158:1898`; states 28-4a `160:1874` … 28-4f `160:4267`]

## Dev Agent Record

### Agent Model Used

Gemini 3.8 Flash (Medium)

### Debug Log References

### Completion Notes List

- Implemented admin queue, route guard/nav, fresh detail drawer, resolve confirmation, feature-local toasts and pure view helpers.
- `node --test tests/rewards-admin-code-issues-view.test.mjs`: 7/7 pass; `npm test`: 902/902 pass; `npm run typecheck`: pass; `npm run lint`: pass (existing unrelated warning in rewards-admin-flash.test.mjs).
- `NEXT_PUBLIC_PILOT_BUILD=true NEXT_PUBLIC_API_MOCKING=disabled npm run build`: pass; `node scripts/check-pilot-bundle.mjs`: 120 assets clean.
- Browser check (Task 8.2), 2026-10-15, Chrome via Claude in Chrome, `NEXT_PUBLIC_API_MOCKING=enabled npm run dev`:
  - Checked OK: 1 sidebar entry/active; 2 tabs + counts, RESOLVED page 2 ("21–32 trong 32"), ALL (38); 3 overdue rows red; 4 drawers Highlands (green "Có thể thay mã"), Coffee House (NO_CODE + link), Gong Cha (SHARED_CODE), Phúc Long (TICKET_EXPIRED), Thay mã disabled with title/aria-describedby, right-anchored, footer 48 px; 5 resolved drawers REFUNDED/REJECTED/REPLACED; 6 Thay mã Highlands → busy state, toast, open 6→5; 7 Hoàn điểm KFC (bold "Không thể hoàn tác."), toast, drawer shows RFD-2610-6DF5; 8 Từ chối empty (disabled) / 501 (red counter) / valid → toast; 9 all four forced resolve errors with code + suggest buttons (switch to REFUND works); 10 `slow` skeleton + aria-busy, `api-error` error state; 11 Tab focus to row button, Enter opens drawer, closing returns focus to the row button.
  - Fixed during the check: pagination buttons rendered 40 px (`h-9` lost to `h-10`; now `h-9!`); focus did not return to the row after close (drawer unmounts the `<dialog>` without `close()`; screen now refocuses the opener).
  - NOT checked: user-portal ticket new code (6) and user history `RFD-` (7) — user side not opened; `api-offline` error inside the dialog (10) — scenario is read only at page load, so it could not be switched mid-dialog (covered by unit test); Esc close and Esc-blocked-while-sending (11) — the automation's synthetic Esc fires `cancel` but no `close` even on a plain `<dialog>`, so it is not a valid test. Quan to check these by hand.
  - Remaining items checked by hand by Quan, 2026-10-15: user-portal new code and `RFD-` history, `api-offline` error in the dialog with retry, Esc close/focus return and Esc blocked while sending.

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- apps/frontend/my-app/app/(signed-in)/(admin)/admin/code-issues/page.tsx
- apps/frontend/my-app/app/(signed-in)/(admin)/admin/code-issues/hooks/use-admin-code-issues.ts
- apps/frontend/my-app/app/(signed-in)/(admin)/admin/code-issues/components/CodeIssuesScreen.tsx
- apps/frontend/my-app/app/(signed-in)/(admin)/admin/code-issues/components/CodeIssueDrawer.tsx
- apps/frontend/my-app/app/(signed-in)/(admin)/admin/code-issues/components/ResolveCodeIssueDialog.tsx
- apps/frontend/my-app/app/(signed-in)/(admin)/admin/code-issues/components/CodeIssueToasts.tsx
- apps/frontend/my-app/lib/admin/rewards-code-issues-view.ts
- apps/frontend/my-app/tests/rewards-admin-code-issues-view.test.mjs
- apps/frontend/my-app/components/layout/admin/admin-nav.ts
- apps/frontend/my-app/lib/pilot-scope.ts
- apps/frontend/my-app/proxy.ts
- _bmad-output/implementation-artifacts/12-13-admin-code-issue-queue-screen.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-10-15: Task 8.2 browser check complete (automated + Quan manual); status → review.
- 2026-10-15: Code review: 13 patches applied (a11y row button, roving tabs, tokens/icons/sizes, copy, toast timers, clipboard, 404 label, tests 7.4–7.7); `npm test` 904/904, typecheck pass, lint 0 errors. 2 deferred. Task 8.2 still open.
- 2026-10-14: Admin code-issue queue implemented and automated checks passed; browser verification pending.

- 2026-10-14: Story created (create-story). Figma 28 adapted to the frozen 12.10 contract (Option A); Open points 1–3 for Quan.
