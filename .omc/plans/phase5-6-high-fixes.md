# Plan — sửa 7 lỗi HIGH (review Phase 5–6, 2026-09-27)

Tất cả đã được đối chiếu lại với code. Không sửa gì cho tới khi được duyệt.

## H1 · Khoá tài khoản bắt buộc lý do → 5 e2e backend fail
- Xác nhận: `packages/schemas/src/users/admin-users.schema.ts` (superRefine) + các `.send({ status: 'LOCKED' })` ở
  `apps/backend/test/admin-users.e2e-spec.ts:465,525`, `admin-users.error-envelope.e2e-spec.ts:66,92`, `admin-audit-logs.e2e-spec.ts:299`.
- Sửa (phương án A, đề xuất): giữ bắt buộc lý do; thêm `reason` ≥10 ký tự vào 5 lời gọi; thêm 1 assertion lý do vào audit metadata;
  sửa comment lỗi thời `lib/admin/users-service.ts`, `users-view.ts`; chạy jest schemas + e2e admin-users/audit-logs.
- Phương án B: bỏ bắt buộc ở schema (chỉ frontend bắt buộc) — không cần sửa test.

## H2 · Khiếu nại thiếu mã: cộng điểm hai lần (mock)
- Xác nhận: `mocks/data/admin-disputes.ts` `settleReport` CREDIT_RESPONDENT không kiểm tra attempt đã COMPLETED/đã có thưởng, không trừ ký quỹ.
- Sửa: trong resolve, từ chối 409 `DISPUTE_ATTEMPT_ALREADY_REWARDED` nếu attempt COMPLETED hoặc `rewardOutcomeOf` ≠ null;
  trừ `escrowLocked` của form (409 `INSUFFICIENT_BALANCE` nếu thiếu) và ghi journal ký quỹ tương ứng; thêm mã lỗi vào
  `lib/admin/disputes-service.ts` + `disputes-messages.ts`; hiển thị trạng thái attempt hiện tại (không phải snapshot) trong CaseDetail. Test.

## H3 · Wizard Google Forms: điều kiện "Trường" bị bỏ âm thầm
- Xác nhận: `lib/forms/create-wizard.ts` `toBackendTargetingJson` xoá `schools`, nhưng `criteriaCount`/tóm tắt vẫn tính.
- Sửa (A, đề xuất): ẩn ô chọn Trường ở bước 2 cho tới khi backend hỗ trợ; bỏ `schools` khỏi count/validate/tóm tắt.
- Phương án B: giữ ô nhưng ghi "Chưa áp dụng lọc", không tính vào điều kiện bắt buộc, không hiện trong tóm tắt.

## H4 · Khảo sát bị từ chối: frontend coi là DRAFT, backend là CLOSED (closeKind MODERATION)
- Xác nhận: `form-moderation.commands.ts:128` `close('MODERATION')`; `lib/forms/manage-status.ts` chỉ đọc `rejection` ở nhánh DRAFT.
- Sửa: `statusViewOf` → CLOSED + `closeKind === "MODERATION"` ⇒ REJECTED (vẫn nhận DRAFT+rejection cũ để tương thích);
  mock (`admin-moderation.ts` reject, seed `forms.ts` qua hàm export, builder `formDrafts`) chuyển sang CLOSED + closeKind MODERATION + `rejection`;
  "Sửa & gửi lại":
  - EXTERNAL: wizard đọc `?from=<id>` và điền sẵn từ `GET /forms/:id` (hiện đang bỏ qua).
  - INTERNAL (A, đề xuất): tạo bản sao — `POST /forms` rồi `PATCH /forms/:newId/draft` với definition cũ — rồi mở builder của bản mới
    (backend không cho sửa form CLOSED). Phương án B: ẩn nút với khảo sát in-Rescom, chỉ hiện lý do.
  - Đồng bộ luôn `formDrafts` khi admin duyệt/từ chối (review MEDIUM liên quan trực tiếp: builder form kẹt "Chờ duyệt").

## H5 · Link "Khiếu nại về câu trả lời này" → 404
- Xác nhận: `ResponseAnswers.tsx:135` trỏ `/forms/:id/complaints?responseId=`; chỉ có `complaints/[attemptId]`, và luồng khiếu nại chỉ
  hỗ trợ lượt Google Forms đang chờ 48h (backend không có route khiếu nại cho câu trả lời in-Rescom).
- Sửa: bỏ link khỏi trang câu trả lời (desktop + mobile). Ghi ASSUMED gap vào docs.

## H6 · Mobile mất nút Đóng / Mở lại / Xuất ở tab Tiến độ
- Xác nhận: `FormWorkspace.tsx:102` ẩn `HeaderActions` ở tab progress; `MobileStatusActions` nằm trong `ProgressBody` chỉ render khi
  `GET /forms/:id/progress` (ASSUMED) thành công.
- Sửa: render `MobileStatusActions` ngoài phần phụ thuộc progress, chỉ dùng `form`; tab progress lỗi/đang tải vẫn có hành động.

## H7 · "Mở lại với vN" mở lại bằng phiên bản chưa duyệt
- Xác nhận: `VersionsScreen.tsx:176` → `/forms/:id/reopen?version=`; backend từ chối `FORM_NOT_REOPENABLE` / `VERSION_NOT_APPROVED`.
- Sửa: đổi thành "Gửi duyệt v{N}" → `/forms/:id/builder/publish` (backend `POST /forms/:id/publish` đưa bản nháp vào hàng duyệt);
  mock reopen kiểm tra `currentVersion.isPublished`, sửa seed CLOSED+draft; message theo `details.reason`.

## Cách làm
- 3 agent song song theo nhóm file không chồng nhau: (a) H1 backend/schema + H2 disputes; (b) H3 + H4 + H7 (forms create/manage/mocks);
  (c) H5 + H6 (forms results/progress UI). Sau đó: tsc, eslint, `npm test`, jest schemas + e2e admin, review riêng, kiểm tra trình duyệt.
- Không commit.
