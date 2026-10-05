# Plan: làm đủ backend rồi mới tắt mock (mục tiêu: team test nội bộ), 2026-10-01

Nguồn: review readiness ngày 2026-10-01 gồm 6 agent audit và một lần chạy thật FE + BE trên DB dựng từ migrations. Mọi mục bên dưới
đã được đối chiếu lại với code. Không sửa gì cho tới khi được duyệt. Không commit.

**Quyết định của bạn (2026-10-01):**
- Mục tiêu: team test nội bộ.
- Không ẩn màn nào. Giữ `NEXT_PUBLIC_API_MOCKING=enabled` cho tới cổng G.
- Quyết định này thay cho phần phạm vi của IR.1. IR.4a Q1 (analytics) và Q3 (version detail) chuyển thành **làm**.

**Vòng 2:**
- **Q1:** nhóm PRD đang hoãn **tiếp tục dùng mock**, tức chế độ lai (hybrid) ở cổng G. Nhóm này gồm 12 endpoint:
  - khiếu nại 8.5 (3);
  - Epic 10: độ tin cậy, xét chất lượng admin, chất lượng khảo sát (4);
  - AI Epic 3 (3);
  - streak, hạng, bảng xếp hạng 7.4–7.6 (2).
- **Q2:** export **mở** khi test nội bộ. Trước pilot phải chặn lại nếu OQ-6 chưa chốt.
- **Q3:** khảo sát đủ mẫu thì **backend tự đóng** (phương án A của 2.3).
- **Q4:** **chỉ duyệt Phase 0–1**, làm xong thì dừng để bạn kiểm tra.
- Câu hỏi mở của story: dùng phương án mặc định của IR.2a Q1–Q8 và IR.4b Q5–Q7, báo lại cuối phase. IR.2a Q1 mặc định bỏ
  `publisherName` vì `User` không có tên hiển thị và email là PII.

**Quy tắc chung cho mọi endpoint mới:**
- Schema dùng chung nằm trong `@rescom/schemas`; FE service và BE controller import cùng một schema, có contract test.
- Dùng envelope `{data,error,meta}` và mã lỗi ổn định. Hợp đồng lưới giữ theo schema FE hiện có; chỉ đổi khi schema FE sai với dữ liệu thật.
- MSW handler giữ lại và phải parse được bằng chính schema chung (parity).
- Endpoint mới dùng phân trang cursor, theo kiến trúc.
- Thứ tự migration theo epics.md: IR.2a → IR.2b → IR.4b email / IR.4a deadline.

## Kiểm kê: 34 handler chỉ có trong MSW (script `route-diff`, đối chiếu MSW với `@Controller`)
- **2 mock-only, giữ nguyên:** `POST /auth/google/mock-complete`, `GET /mock/demo-accounts`.
- **1 cặp pause/resume:** `POST /forms/:id/{pause,resume}`. `PAUSE_SUPPORTED=false`; IR.4a AC6 xoá client và mock.
- **12 endpoint đã có story:**
  - IR.2a (4): `GET /surveys/:id`, `GET /attempts/:id`, `GET /attempts/:id/outcome`, `POST /attempts/:id/cancel`.
  - IR.4a (4): `GET /forms/:id/{progress,responses,analytics,versions/:versionId}`.
  - IR.4b (4): `GET/PATCH /users/me/profile`, `GET /admin/overview`, `GET /admin/queue-counts`.
- **19 endpoint chưa có story:**
  - consent: `GET/POST /integrity/consent`
  - reliability: `GET /integrity/reliability/me`
  - engagement: `GET /engagement/{me,leaderboard}`
  - disputes: `POST /forms/:id/attempts/:aid/disputes`, `GET /admin/disputes`, `POST /admin/disputes/:id/resolve`
  - admin quality: `GET /admin/quality-reviews`, `POST /admin/quality-reviews/:responseId/decision`
  - fraud log: `GET /admin/fraud-log`
  - ledger: `GET /admin/ledger/{journals,summary}`
  - publisher quality: `GET /forms/:id/quality`
  - AI: `/forms/:id/ai/{conversation,messages,suggest-block}`
  - `POST /forms/audience-estimate`
  - `POST /auth/password/forgot` (hiện cũng chưa có trang đặt lại mật khẩu)
- **Sau quyết định Q1, 19 endpoint trên chia làm hai:**
  - **Giữ mock (12):** disputes (3), reliability, admin quality (2), publisher quality, AI (3), engagement (2).
  - **Cần làm backend (7):** consent (2), fraud log, ledger (2), audience-estimate, forgot-password.
  - Tổng cần làm backend: 12 (đã có story IR) + 7 = 19 endpoint. Xoá thêm cặp pause/resume.

---

## Phase 0: nền để test được bằng stack thật (S–M, làm trước tiên)

### 0.1 Rate limit `auth` chặn cả `/auth/me`, cả site văng Lỗi 500 (MỚI)
- **Xác nhận:**
  - `apps/backend/src/common/security/security.module.ts:30-41`: bucket `auth` (10 request/60 s) áp cho **mọi** handler của
    AuthController, gồm `me`, `csrf`, `refresh`, `logout`.
  - Tracker mặc định là `req.ip`. Qua proxy Next, mọi người dùng chung IP loopback (proxy không thêm `X-Forwarded-For`).
  - `apps/frontend/my-app/lib/session/session-status.ts:20-26,54-55`: 429 bị coi là "error" nên chuyển tới `/server-error`.
  - Đã tái hiện trên stack thật: sau khoảng 10 lượt tải trang mỗi phút, mọi trang đều ra Lỗi 500.
  - Test không bắt được vì `NODE_ENV=test` nâng giới hạn lên 10000 (`security.module.ts:15-22`).
  - Làm nặng thêm: `GET /auth/csrf` xoay token ở mỗi lần gọi (`session.service.ts:237-242`). Nhiều tab sẽ làm mất token của nhau,
    phải thử lại, và mỗi lần thử lại lại tốn thêm lượt của bucket.
- **Sửa (A, đề xuất):**
  - Bucket `auth` chỉ áp cho login, register, bắt đầu và liên kết Google. Bỏ qua `me`, `csrf`, `refresh`, `logout`
    (chúng vẫn thuộc bucket `default`).
  - Viết `getTracker` riêng: request đã có session thì đếm theo session/user id, request ẩn danh vẫn đếm theo IP.
  - FE: 429 ở `/auth/me` được coi là lỗi tạm thời, thử lại theo `Retry-After`, hoặc chuyển `/rate-limited`, không chuyển `/server-error`.
  - Thêm e2e chạy với giới hạn thật.
- **Phương án B:** chỉ nâng `AUTH_RATE_LIMIT_MAX_REQUESTS` trong `.env` dev. Đây chỉ là băng dính: vấn đề chung IP vẫn còn.

### 0.2 Đồng bộ `schema.prisma` với migrations ở phần ledger (phải làm trước mọi migration mới)
- **Xác nhận:** diff giữa DB dựng từ migrations và `schema.prisma` chỉ lệch ở 3 chỗ:
  - FK `ledger_journals_reverses_journal_id_fkey` là RESTRICT trong migrations nhưng SET NULL trong schema;
  - 2 index `ledger_entries_{account_id,journal_id}_idx` có trong DB nhưng không có trong schema.
  - Nếu chạy `prisma migrate dev` để sinh migration cho Phase 1+, Prisma sẽ tự thêm lệnh xoá 2 index và nới FK.
- **Sửa:** thêm `onDelete: Restrict, onUpdate: Restrict` và 2 `@@index` vào `schema.prisma`. Kiểm tra: diff giữa DB và schema phải rỗng.

### 0.3 Seed và môi trường local: CẬP NHẬT 2026-10-01
- **Seed đã có sẵn.** Bạn và phiên "Dữ liệu khởi động golive" đã viết `apps/backend/src/scripts/seed.ts` cùng `seed-data.ts`
  (chạy bằng `npm run seed`). Seed tạo 1 admin, 3 publisher, 15 respondent, 9 khảo sát, gọi service thật. Mình **không viết seed riêng**.
- **Review (chỉ đọc), dữ liệu trong `rescom_db` nhất quán:**
  - ledger cân đối, số dư cache khớp tổng bút toán, không có số dư âm;
  - scoring policy ở chế độ SHADOW;
  - không có timestamp vô lý.
- **Sửa trong seed, làm sau khi bạn báo seed xong (bạn đã duyệt):**
  1. `detectPriorSeed` (seed.ts:210-221) chỉ đếm form do seed tạo, và coi "đủ tài khoản seed" là SKIP. Hiện nó đếm mọi form của
     publisher seed, nên tester tạo thêm form là seed báo "Partial seed" rồi khuyên `migrate reset`, tức mất dữ liệu test.
  2. Thêm admin thứ hai (`SEED_ADMIN2_EMAIL`), vì admin không được tự duyệt.
  3. Ghi file credentials ngay sau khi tạo user, không đợi tới bước cuối.
  4. Sau khi có endpoint profile (1.2): ghi `displayName`, `school`, `schoolYear`, `goal` cho tài khoản seed.
- **Ghi chú cho IR.2b:** sau khi seed, `rescom_db` có 121 outbox event PENDING; hiệu ứng của chúng (thưởng, thông báo) đã được áp dụng
  inline. Dispatcher phải bỏ qua an toàn các event này: không cộng điểm lần hai, không gửi trùng thông báo hay email.
- **Phần còn lại của 0.3:** đổi compose sang MinIO + ClamAV, sửa DB URL trong `.env.example`. Làm sau khi bạn xong với
  `.env.example` và `README`, vì hai file này đang có thay đổi của phiên seed.

#### (Bản gốc 0.3, thay bằng mục trên)
- **Xác nhận:**
  - `rescom_db` trống (0 user) và chưa có seed. Admin chỉ tạo được bằng SQL; cần ≥ 2 admin vì admin không được tự duyệt.
  - `.env.example` ghi DB URL `postgres:postgres@…/rescom`, không khớp compose (`rescom_admin`/`rescom_db`).
  - Compose chạy LocalStack :4566, trong khi `.env.example` và tài liệu dùng MinIO :9000. `.env` thiếu toàn bộ `STORAGE_*` và `MALWARE_*`.
- **Sửa:**
  - Viết `prisma/seed.ts`, chạy lại nhiều lần không sao: 2 admin, 1 publisher đã onboarding và có sẵn điểm (nạp điểm qua lệnh ledger
    thật, không ghi thẳng vào DB), 2 respondent đã onboarding. Mật khẩu đọc từ `SEED_PASSWORD`, không hardcode.
  - Sửa DB URL trong `.env.example`.
  - Compose: thay LocalStack bằng MinIO (pin phiên bản) và giữ ClamAV. Thêm script tạo bucket và CORS. Viết hướng dẫn chạy stack thật
    trong README.

### 0.4 Cổng route-diff
- **Sửa:** biến script route-diff (MSW handler so với `@Controller`) thành test trong `npm test`.
  - Test in ra danh sách còn thiếu.
  - Tới cổng G, danh sách chỉ được còn 2 handler mock-only.

---

## Phase 1: người trả lời làm được khảo sát (M–L)

### 1.1 IR.2a (story `ir-2a-respondent-read-endpoints-survey-runner.md`, ready-for-dev)
- **Xác nhận** trên stack thật: `POST /surveys/:id/attempts` trả 201, nhưng `GET /attempts/:id` trả 404, màn hình báo
  "Không tìm thấy lượt làm này". Suất bị giữ 30 phút; bấm lại thì nhận 409 `CONFLICTING_ACTIVE_ATTEMPT` và quay về đúng trang chết đó.
  Người mới không mở khoá được 100 điểm khởi đầu.
- **Làm:** 4 endpoint của IR.2a.
  - `GET /attempts/:id` trả kèm định nghĩa form của **phiên bản đã ghim** (API-05).
  - Runner thôi gọi `/public/forms/:id`. Route đó hiện trả bản mới nhất thay vì bản đã ghim, và trả 403 khi `requireAuth`.
  - `publisherName` lấy từ `displayName` của 1.2.

### 1.2 Profile (IR.4b phần A, kéo lên sớm vì đang mất dữ liệu)
- **Xác nhận:** `PATCH /users/me/profile` trả 404 nhưng lỗi bị nuốt (`use-onboarding-flow.ts:170-175`). Tên hiển thị, trường,
  năm học và mục tiêu không được lưu. Bấm "Sửa" hồ sơ bị bắt nhập lại tên và mục tiêu, và vẫn không lưu được.
- **Làm:** IR.4b phần A, gồm migration các cột profile và `GET/PATCH /users/me/profile`.

### 1.3 Integrity consent (chưa có story)
- **Xác nhận:**
  - `GET/POST /integrity/consent` trả 404; FE bỏ qua lỗi. Thông báo đồng ý hiện lại ở mọi lần bắt đầu khảo sát.
  - Chưa từng có dòng nào được ghi vào `IntegrityConsent` (model đã có).
- **Làm:** đọc và ghi `IntegrityConsent` theo phiên bản thông báo.

### 1.4 Sửa nhỏ ở FE
- Đổi `PUBLIC_FORM_ACCESS_DISABLED` thành `PUBLIC_ACCESS_DISABLED` (`participation-messages.ts:26`).
- Khi nhập mã hoàn thành, 429 `RATE_LIMIT_EXCEEDED` phải hiện đúng thông báo giới hạn tốc độ.
- Xoá route cũ `/forms/[id]/respond` và các file chỉ route đó dùng: `use-onboarding-guard`, `PortalShell`, `NotificationBell`,
  `ResetDemoModal`, `SurveyFeedbackPrompt`, `activation.attemptPath`. Chuyển `lib/mock` vào `mocks/`.
- Test đi kèm các file trên được chuyển theo hoặc xoá.

**Kiểm tra Phase 1** trên stack thật, không bật mock:
- In-Rescom: bắt đầu → trả lời → nộp → kết quả → đánh giá.
- Google Forms: bắt đầu → nhập mã → điểm chờ.
- Huỷ lượt làm, rồi làm lại.
- Mở khoá 100 điểm sau khảo sát đầu tiên.

---

## Phase 2: việc chạy theo thời gian và các trường wizard đang bị bỏ (L)

### 2.1 IR.2b (story `ir-2b-in-process-scheduler-outbox-dispatcher.md`)
- **Xác nhận:**
  - Không có scheduler và không có Outbox dispatcher. Điểm "Chờ 48h" không bao giờ chuyển sang Khả dụng; mock đang tự release ở mỗi
    lần đọc ví, nên lỗi bị che.
  - Điểm khởi đầu không hết hạn sau 30 ngày. Khảo sát không tự đóng khi hết hạn và không được hoàn ký quỹ.
- **Làm:** theo IR.2b.
  - Scheduler chạy trong process, có cờ bật/tắt và lease trong PostgreSQL.
  - Outbox dispatcher.
  - 4 job: release điểm chờ, hết hạn điểm khởi đầu, hết hạn lượt giữ suất, đóng khảo sát và hoàn ký quỹ khi hết hạn.
  - Thêm cột `forms.deadline_at`.
  - FE wizard gửi `deadlineAt`: hiện hạn 14 ngày người dùng chọn bị bỏ, danh sách ghi "không giới hạn thời gian".

### 2.2 Chủ đề khảo sát (MỚI, chưa có story)
- **Xác nhận:** wizard có ô "Chủ đề", nhưng `create-wizard.ts:102` cố ý không gửi trường này; DB không có cột, và thẻ trên Khám phá
  không hiện chủ đề.
- **Làm:**
  - Thêm cột `forms.topic` (nullable, giá trị theo `TOPIC_OPTIONS`) vào create/draft schema.
  - Trả `topic` trong feed và DTO của form.
  - Tìm kiếm trên Khám phá theo cả chủ đề.

### 2.3 Khảo sát đủ mẫu (MỚI)
- **Xác nhận:** backend chỉ ẩn khảo sát đủ mẫu khỏi Khám phá, status vẫn là `PUBLISHED`. FE chỉ hiện "Đủ mẫu" khi status là `CLOSED`
  (`manage-status.ts:44-46`), nên publisher vẫn thấy "Đang chạy".
- **Sửa (A, đề xuất):** tự đóng khi đủ mẫu, trong cùng giao dịch nộp bài cuối.
  - Enum `FormCloseKind` hiện chỉ có `OWNER`, `ADMIN`, `MODERATION`. Cần thêm giá trị `QUOTA`, đặt chung migration với `DEADLINE`
    của IR.2b.
  - Ký quỹ dư (nếu có) được hoàn qua lệnh close.
- **Phương án B:** chỉ sửa FE: `PUBLISHED` và completed ≥ expected thì hiện "Đủ mẫu".

---

## Phase 3: publisher xem tiến độ và kết quả (IR.4a, M–L)
- **Xác nhận:**
  - `GET /forms/:id/progress`, `/responses`, `/analytics` và `/versions/:versionId` đều trả 404.
  - Trang kết quả báo nhầm "khảo sát đã bị xoá": `results-messages.ts:11` coi mọi 404 là khảo sát không tồn tại.
  - `GET /forms/:id` không trả lý do bị từ chối (dữ liệu có sẵn ở `SurveyModerationDecision`).
- **Làm:**
  - Làm đúng IR.4a với Q1 (analytics) = làm và Q3 (version detail) = làm.
    - progress có bucket theo thời gian; chuỗi "lượt mở" cần thêm dữ liệu view, đã ghi trong story.
    - responses dùng cursor.
    - analytics tính ở server, có giới hạn quét.
  - Bổ sung `rejection{reason,refundAmount,decidedAt}`, `submittedAt` và `closedAt` vào `GET /forms/:id`.
  - FE: tách `NOT_FOUND` (route không tồn tại) khỏi `FORM_NOT_FOUND`.
  - Xoá client và mock của pause/resume.
- **Export:** nút "Xuất dữ liệu" sẽ xuất dữ liệu thật ngay khi có `/responses`. PRD để export sau OQ-6. Cần quyết định (Q3).

---

## Phase 4: admin (M–L)
- **4.1** IR.4b phần C: `GET /admin/overview` (đây là trang đích sau khi admin đăng nhập, hiện chỉ hiện lỗi) và `GET /admin/queue-counts`.
- **4.2** `GET /admin/fraud-log`, đọc bảng `FraudLog` có sẵn: lọc theo user/type/ngày, gom theo tài khoản.
- **4.3** `GET /admin/ledger/{journals,summary}`, đọc sổ cái có sẵn: keyset `before=<createdAt>:<id>`, thẻ tổng.
- **4.4** Khiếu nại:
  - Dữ liệu có sẵn: báo thiếu mã và khoá do nhập sai mã, trong `SurveyAttempt.missingCodeReportedAt` và `failedCodeVerifications`.
    Phần này làm được ngay. Route reset giới hạn nhập mã đã có sẵn, sẽ gắn vào đây.
  - Khiếu nại của publisher trên lượt Google Forms đang chờ 48h cần model dispute và dispute hold trong ledger (Story 8.5, hiện hoãn),
    kéo theo FR-54 (trừ hoặc hoàn điểm). Khối lượng lớn, xem Q1.
- **4.5** `GET/POST /admin/quality-reviews`: xem Q1.
- **4.6** FE map thêm `FORBIDDEN_RESOURCE` (backend gửi mã này; FE hiện chỉ map `FORBIDDEN`).
  - Nơi sửa: `top-up-admin-messages.ts`, `disputes-messages.ts`.
  - Bổ sung `lockReason` vào DTO user cho admin.

---

## Phase 5: tài khoản, email, còn lại (M–L)
- **5.1** Engagement (`/engagement/me`, `/engagement/leaderboard`): streak, hạng, bảng xếp hạng. Có bảng `GamificationStat` nhưng chưa có
  service nào. Cần chốt OQ-1 (phạm vi bảng xếp hạng) và OQ-3 (thời gian chờ của Trusted Researcher). Xem Q1.
- **5.2** `GET /integrity/reliability/me`: xem Q1.
- **5.3** Email, IR.4b phần B: `EmailSenderPort` qua Outbox. Với test nội bộ dùng adapter local ghi ra log/file; chọn nhà cung cấp để trước pilot.
- **5.4** Quên và đặt lại mật khẩu:
  - Làm `POST /auth/password/forgot`, không để lộ email nào tồn tại.
  - Thêm token đặt lại dùng một lần và trang `/reset-password` (FE chưa có trang này). Cần 5.3.
- **5.5** `POST /forms/audience-estimate`: đếm hồ sơ khớp tiêu chí, làm tròn và đặt ngưỡng tối thiểu để không lộ nhóm nhỏ.
- **5.6** Tín hiệu "phiên bị thay thế":
  - Hiện backend chỉ phát `AUTH_SESSION_REVOKED`, và cookie bị xoá ngay ở lần lỗi đầu, nên dialog 15e không bao giờ hiện.
  - Sửa: lưu lý do revoke và phát mã riêng `AUTH_SESSION_REPLACED`; FE chuyển `/login?reason=session-replaced`.

## Phase 6: AI và chất lượng khảo sát (xem Q1)
- **AI** (`/forms/:id/ai/*`, Epic 3 đang hoãn; pilot chưa có máy chủ AI theo AD-23):
  - Mỗi lần "chat mới" hiện tạo ra một bản nháp mồ côi, vì `AiChatScreen` gọi `POST /forms` trước khi gọi AI.
  - Sửa luôn: chỉ tạo bản nháp sau khi AI trả lời.
- **Chất lượng khảo sát** `GET /forms/:id/quality` (Epic 10, FR-62).

## Phase 7: tải tệp (M)
- **Xác nhận:**
  - URL presigned mang `x-amz-checksum-crc32=AAAAAA==`, tức checksum của body rỗng; đã tái hiện offline. Nguyên nhân là S3Client
    thiếu `requestChecksumCalculation: 'WHEN_REQUIRED'` (`s3-object-storage.service.ts:24-32`).
  - Runner hiện "Câu hỏi tải tệp chưa hỗ trợ" và `validateAnswer` luôn báo lỗi (`survey-form.ts:219-220`), trong khi builder vẫn cho
    thêm câu này (`builder-catalog.ts:42`). Khảo sát có câu tải tệp bắt buộc sẽ không ai nộp được.
- **Sửa:**
  - Thêm `requestChecksumCalculation` và `responseChecksumValidation` = `WHEN_REQUIRED`.
  - Smoke test thật: presign → PUT → finalize → ClamAV, trên MinIO của 0.3.
  - Runner hỗ trợ upload: dùng `storageCapability` từ lúc bắt đầu, gửi `answers` dạng record như internal-submission schema.
  - Proxy Next timeout 30 s, nên cần kiểm tra cả file lớn.

---

## Theo quyết định Q1: 4.4, 4.5, 5.1, 5.2 và Phase 6 GIỮ MOCK
- **Không làm backend cho:**
  - khiếu nại publisher và admin;
  - xét chất lượng admin, chất lượng khảo sát, độ tin cậy;
  - AI;
  - streak, hạng, bảng xếp hạng.
- **Vẫn làm:** sửa lỗi FE "chat AI mới tạo bản nháp mồ côi". Ở chế độ lai, `POST /forms` là thật, còn AI là mock.
- **Hệ quả cần biết khi test nội bộ:**
  - Các màn trên hiện **dữ liệu giả** nằm cạnh dữ liệu thật: thẻ streak/hạng trên `/account` và các ca khiếu nại, xét chất lượng
    ở trang admin.
  - Thao tác trên các màn này (resolve khiếu nại, duyệt chất lượng) không ảnh hưởng sổ cái thật.
  - Respondent thật bị khoá do nhập sai mã 3 lần sẽ không mở khoá được từ UI, vì màn khiếu nại đang dùng mock. Cách vòng: admin gọi
    `POST /admin/completion-code-limits/reset` bằng API.
  - Badge admin (`queue-counts` thật) đếm khiếu nại và chất lượng = 0, trong khi các trang mock vẫn có ca giả.

## Cổng G: chuyển sang chế độ lai (hybrid)
0. **Cơ chế hybrid**, làm ở cổng G khi đã biết chính xác danh sách:
   - Thêm `NEXT_PUBLIC_API_MOCKING=hybrid` cùng một allowlist nhóm endpoint được mock (12 endpoint ở Q1). MSW chỉ đăng ký các handler
     trong allowlist; mọi request khác đi tới backend thật.
   - Các handler được giữ phải chạy được với **session thật**: không phụ thuộc `mocks/db/session`, và không đòi form hay attempt tồn
     tại trong mock DB. Phải kiểm tra lại từng handler.
1. Test route-diff: ngoài 2 handler mock-only chỉ còn đúng 12 endpoint nằm trong allowlist Q1.
2. Chạy lại toàn bộ journey trên stack thật như lần review:
   - respondent: in-Rescom và Google Forms;
   - publisher: builder, wizard, tiến độ, kết quả;
   - admin: 8 mục menu;
   - ví: điểm chờ → khả dụng (bằng scheduler).
3. Tất cả test phải xanh: jest backend, e2e (kể cả Postgres), `node --test` FE, typecheck, lint.
4. Đổi `NEXT_PUBLIC_API_MOCKING=hybrid` trong `.env.example` và `.env.local`. Giữ `enabled` (mock toàn bộ) cho test và demo.
   Env Vercel để sau, cho tới khi có staging.
5. **Đã làm (2026-10-01):** allowlist cuối cùng là 3 MOCK_ONLY + 14 DEFERRED_KEEP_MOCK (thay cho con số 2 + 12 ở trên: thêm
   `PUT /storage/mock-uploads/:id` và 2 route AI của bản sửa Phase 6).
   - `hybrid`: `MswProvider` khởi động MSW; `mocks/browser.ts` chỉ dùng `hybridHandlers` (`mocks/handlers/index.ts`, lọc
     theo `ROUTE_ALLOWLIST.DEFERRED_KEEP_MOCK`). Request khác đi qua rewrite `/api`. `isApiMockingEnabled` = false nên
     tài khoản demo và Google mock tắt; scenario `?msw=` bị bỏ qua.
   - 14 handler không đọc mock session (`mocks/hybrid.ts`: `HYBRID_MEMBER`, `HYBRID_ADMIN`), không đòi form/attempt có
     trong mock DB; chất lượng khảo sát và khiếu nại publisher trả dữ liệu demo theo id; CSRF vẫn bắt buộc khi ghi. Admin
     route không kiểm role (trang admin đã có `SessionGate requireAdmin`).
   - Badge "Dữ liệu minh hoạ" (`components/ui/DemoDataTag.tsx`) trên thẻ hồ sơ `/account`, chuỗi ngày, hạng, độ tin cậy,
     bảng xếp hạng, admin khiếu nại, admin chất lượng, tab chất lượng khảo sát, khiếu nại publisher, chat AI.
   - Test: `tests/route-diff.test.mjs` (3/14, ngoài allowlist đều có `@Controller`), `tests/hybrid-mocking.test.mjs`.
   - `.env.example` và `.env.local` = `hybrid`. Mục 2 (chạy lại journey trên stack thật) và e2e Postgres của mục 3 chưa làm.

## Ngoài phạm vi (làm trước pilot, không cần cho test nội bộ)
- IP người dùng bị gộp qua Vercel → Cloudflare. AD-23 cần sửa lại.
- OAuth callback chuyển về host FE `/api/auth/google/callback`.
- Hardening env production: 7 điểm bị từ chối, và chưa chặn secret placeholder.
- Epic 11: Dockerfile, Caddy, CI.
- Health/readiness endpoint.
- Nhà cung cấp CAPTCHA.
- Nhà cung cấp email.
- VietQR và tài khoản ngân hàng thật.

## Cách làm
- **Mỗi phase:**
  - Viết code bằng executor (opus), chia theo nhóm file không chồng nhau.
  - Review bằng code-reviewer riêng, sau đó sửa các điểm review nêu ra.
  - Cuối phase chạy tsc, eslint, `npm test`, e2e liên quan, rồi smoke trên stack thật: DB nháp `rescom_readiness_check` sau khi
    migrate, hoặc DB seed.
- Làm tuần tự Phase 0 → 7. Phase 3–6 có thể chạy song song khi Phase 1–2 đã xong, vì dùng chung migration chain.
- Không commit trừ khi bạn yêu cầu. Không đổi `.env.local` trước cổng G.
