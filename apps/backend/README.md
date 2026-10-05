# RESCOM Backend Service

Tài liệu hướng dẫn cài đặt, cấu hình và khởi chạy dịch vụ Backend cho dự án **RESCOM** (Research & Community Platform).

---

## 🛠 Yêu cầu tiên quyết (Prerequisites)

Trước khi khởi chạy backend, hãy đảm bảo máy tính của bạn đã cài đặt:

* **Node.js**: v18.x trở lên
* **npm**: v9.x trở lên
* **Docker** & **Docker Compose**: để khởi chạy PostgreSQL container

---

## 🚀 Các bước cài đặt & Khởi chạy (Quick Start)

### Bước 1: Khởi động Database với Docker Compose

Database PostgreSQL của dự án được cấu hình sẵn trong file [docker-compose.yml](file:///Users/quan/HocTap/Vibecode/project-rescom/docker-compose.yml) ở thư mục gốc dự án.

Mở terminal từ thư mục gốc của dự án:

```bash
# Khởi động Postgres container chạy ngầm
docker compose up -d
```

> **Lưu ý:** PostgreSQL container được map port máy Host là **`5433`** (`5433:5432`).
> Lệnh này cũng chạy MinIO (lưu trữ file) và ClamAV (quét virus), xem mục [Chạy stack thật ở local](#-chạy-stack-thật-ở-local-fe--be-tắt-mock).

---

### Bước 2: Cấu hình Biến môi trường (Environment Variables)

Di chuyển vào thư mục backend:

```bash
cd apps/backend
```

Kiểm tra hoặc tạo file `.env` tại [apps/backend/.env](file:///Users/quan/HocTap/Vibecode/project-rescom/apps/backend/.env) với chuỗi kết nối tới Postgres:

```env
# PostgreSQL connection string cho môi trường Local Docker
DATABASE_URL="postgresql://rescom_admin:rescom_password@localhost:5433/rescom_db?schema=public"
```

---

### Bước 3: Cài đặt Dependencies

Tại thư mục `apps/backend`, cài đặt các gói phụ thuộc:

```bash
npm install
```

---

### Bước 4: Khởi tạo Database Schema với Prisma

Sau khi cơ sở dữ liệu Postgres đã hoạt động:

1. **Sinh Prisma Client**:
   ```bash
   npx prisma generate
   ```

2. **Đồng bộ Schema vào Database** (chọn **một** trong hai cách):
   ```bash
   # Cách chuẩn: áp dụng toàn bộ lịch sử migration (CI, staging, production)
   npm run prisma:migrate:deploy

   # Hoặc (chỉ Dev mode): đồng bộ trực tiếp schema rồi áp dụng các ràng buộc
   # mà schema.prisma không biểu diễn được
   npm run prisma:db-push
   ```

   > **Lưu ý về `db push`:** Prisma 6 không mô tả được partial unique index
   > (`survey_attempts_one_active_per_account`, `survey_attempts_one_completion_per_account`),
   > các CHECK constraint (vd. `forms_estimated_duration_minutes_range`) và
   > mệnh đề `NULLS NOT DISTINCT` của `ledger_accounts_user_id_account_class_currency_key`.
   > Vì vậy **không chạy `npx prisma db push` đơn lẻ**: script `prisma:db-push`
   > chạy `prisma db push` rồi `prisma db execute --file prisma/sql/post-push-invariants.sql`.
   > File SQL này idempotent, có thể chạy lại bất kỳ lúc nào.
   >
   > Migration `20260927040000_reconcile_db_push_tables` tạo 16 bảng trước đây chỉ
   > được tạo bởi `db push` (forms, form_versions, responses, survey_attempts, …)
   > và khẳng định lại các ràng buộc trên, nên `migrate deploy` trên database rỗng
   > cho kết quả đầy đủ. Migration này cũng idempotent trên database đã dựng bằng `db push`.
   > Khi thay đổi schema, tạo migration mới bằng `npx prisma migrate dev --name <tên>`.

---

### Bước 5 (tuỳ chọn): Seed dữ liệu demo go-live

```bash
npx prisma migrate deploy   # luôn chạy trước: seed cần đủ bảng (vd. user_profiles)
npm run seed                # tự build @rescom/schemas trước (preseed)
```

**Thứ tự bắt buộc:** `npx prisma migrate deploy` rồi mới `npm run seed`. Nếu database còn thiếu migration (vd. chưa
có bảng `user_profiles`, Prisma P2021), seed dừng với thông báo yêu cầu chạy `npx prisma migrate deploy` trước.

Script `src/scripts/seed.ts` khởi tạo Nest application context và gọi **các service thật**
(đăng ký, nạp điểm + Admin duyệt, tạo/đăng khảo sát → Escrow → hàng chờ kiểm duyệt, Admin duyệt/từ chối,
làm khảo sát Internal/External, feedback, đóng khảo sát) nên Ledger, Outbox và thông báo luôn nhất quán.
Dữ liệu tiếng Việt: 2 Admin, 3 Publisher, 15 Respondent, 9 khảo sát ở đủ trạng thái
(PUBLISHED, EXTERNAL, MODERATION_QUEUE, bị từ chối, DRAFT, đóng bởi chủ sở hữu). Cần 2 Admin vì Admin
không được tự duyệt khảo sát hay yêu cầu nạp điểm của chính mình.

* **Idempotent:** seed chỉ xét dữ liệu do seed tạo: tài khoản seed (theo email) và khảo sát seed của đúng
  Publisher seed (khảo sát External theo Idempotency-Key, Internal theo tiêu đề). Dữ liệu tester thêm sau
  (khảo sát mới của Publisher seed, nạp điểm, tài khoản khác) không ảnh hưởng.
  * Đủ tài khoản và khảo sát seed: bỏ qua.
  * Database đã seed trước khi có Admin thứ hai: chỉ tạo thêm tài khoản `SEED_ADMIN2_EMAIL`, không đụng dữ liệu khác.
  * Mỗi lần chạy đều điền hồ sơ onboarding (tên hiển thị, năm sinh, trường, năm học, mục tiêu) cho tài khoản seed,
    qua cùng service với `PATCH /users/me/profile`. Seed chỉ điền ô còn trống, nên sửa đổi của tester được giữ
    nguyên, và database seed trước khi có hồ sơ sẽ được bổ sung.
  * Thiếu tài khoản hoặc khảo sát seed: dừng và liệt kê phần thiếu. Thường do lần seed trước dừng giữa chừng;
    đổi tên hoặc xoá khảo sát seed cũng gây ra tình trạng này (khi đó không cần seed lại). Ledger chỉ ghi thêm
    nên seed dở dang không chạy tiếp được: chỉ với database local của riêng bạn, chạy
    `npx prisma migrate reset --skip-seed` rồi seed lại. `npx prisma migrate reset` (không có `--skip-seed`)
    cũng tự chạy seed.
* **Production:** từ chối chạy khi `NODE_ENV=production` trừ khi đặt `SEED_ALLOW_PRODUCTION=true`.
* **Tài khoản:** `SEED_ADMIN_EMAIL` (mặc định `admin@rescom.test`), `SEED_ADMIN2_EMAIL` (mặc định
  `admin2@rescom.test`), `SEED_ADMIN_PASSWORD` (dùng chung cho 2 Admin), `SEED_DEMO_PASSWORD` (dùng chung cho
  Publisher/Respondent). Biến nào không đặt thì mật khẩu được sinh ngẫu nhiên.
* **File mật khẩu:** email + mật khẩu được ghi vào `.seed-credentials.local.md` (quyền 600, đã gitignore; đổi đường
  dẫn bằng `SEED_CREDENTIALS_FILE`) ngay trước khi đăng ký tài khoản (trạng thái "registering accounts"), ghi lại
  sau khi tạo xong tài khoản và khi seed xong, nên seed lỗi giữa chừng (kể cả lúc đang đăng ký) vẫn giữ được mật
  khẩu đã sinh. Khi chỉ thêm Admin thứ hai, tài khoản này được ghi nối vào cuối file, các mật khẩu
  cũ giữ nguyên.
* **Chưa xử lý:** chưa có Outbox dispatcher nên các event (`InternalRewardRequested`, `Admin*`, …) ở trạng thái
  `PENDING`; điểm của khảo sát External nằm ở `PENDING` 48 giờ như luật nghiệp vụ.

---

## 🧪 Chạy stack thật ở local (FE + BE, tắt mock)

1. **Hạ tầng** (thư mục gốc dự án): `docker compose up -d`
   * Postgres `localhost:5433`.
   * MinIO: S3 API `http://localhost:9000`, console `http://localhost:9001` (`minioadmin` / `minioadmin`).
     Service một lần `minio-init` tạo bucket private `rescom-private-storage` (chạy lại không sao).
     MinIO Inc. đã ngừng phát hành image (`minio/minio` không còn trên Docker Hub và quay.io), nên compose dùng
     bản fork cộng đồng `pgsty/minio`, pin theo tag + digest.
   * Upload từ trình duyệt PUT thẳng vào presigned URL của MinIO. CORS được bật cho `http://localhost:3000` bằng
     `MINIO_API_CORS_ALLOW_ORIGIN` trong `docker-compose.yml` (MinIO chỉ có CORS cấp server, không có theo bucket).
   * ClamAV `localhost:3310`: lần chạy đầu cần vài phút để tải dữ liệu virus. Trước khi `docker ps` báo `healthy`,
     việc quét file sẽ thất bại (fail-closed).
2. **Biến môi trường backend:** `cp apps/backend/.env.example apps/backend/.env`. Giá trị mẫu đã khớp compose
   (`DATABASE_URL`, `STORAGE_*`, `MALWARE_*`).
3. **Schema:** trong `apps/backend`, chạy `npx prisma migrate deploy` (chỉ áp dụng migration có sẵn, không xoá dữ liệu).
4. **Dữ liệu demo (tuỳ chọn):** `npm run seed` (xem Bước 5).
5. **Backend:** `npm run start:dev` (cổng 4000).
6. **Frontend:** trong `apps/frontend/my-app`, chạy `NEXT_PUBLIC_API_MOCKING=disabled npm run dev` (hoặc đặt
   `NEXT_PUBLIC_API_MOCKING=disabled` trong `.env.local`). FE gọi `/api/*`, Next proxy sang `RESCOM_API_URL`
   (mặc định `http://localhost:4000`).
7. Mở **http://localhost:3000**, không dùng `http://127.0.0.1:3000`: cookie OAuth intent gắn với host
   `localhost` nên đăng nhập Google sẽ lỗi.

> ⚠️ **Không chạy `npx prisma migrate dev`, `npx prisma db push` hay `npm run prisma:db-push` trên database dùng
> chung** (vd. `rescom_db` đã seed cho nhóm test). `migrate dev` có thể đòi reset (xoá sạch dữ liệu) khi thấy schema
> lệch, `db push` có thể xoá cột hoặc bảng. Muốn thử migration thì tạo một database riêng.

> **Rate limit:** qua proxy Next, mọi trình duyệt dùng chung một IP. Bucket `auth` (mặc định 10 lần/phút/IP) chỉ áp
> cho đăng ký, đăng nhập và Google OAuth; `/auth/me`, `/auth/csrf`, `/auth/refresh`, `/auth/logout` thuộc bucket
> `default`, và request đã đăng nhập được đếm theo từng user. Nếu cả nhóm test đăng nhập nhiều, tăng
> `AUTH_RATE_LIMIT_MAX_REQUESTS` trong `.env` (xem `.env.example`).

---

## 📊 Quản lý Database với Prisma Studio

Dự án đã cấu hình Prisma Studio khởi chạy tại port **`5555`** trong [prisma.config.ts](file:///Users/quan/HocTap/Vibecode/project-rescom/apps/backend/prisma.config.ts).

Khởi động giao diện quản lý dữ liệu:

```bash
npx prisma studio
```

Truy cập giao diện Web UI tại: [http://localhost:5555](http://localhost:5555)

---

## 🛠 Bảng tra cứu lệnh thường dùng (Command Reference)

| Lệnh | Mô tả |
| :--- | :--- |
| `docker compose up -d` | Khởi động Postgres, MinIO (+ tạo bucket) và ClamAV |
| `docker compose down` | Dừng và xóa các container (dữ liệu trong volume vẫn giữ) |
| `npx prisma generate` | Sinh lại Prisma Client từ `schema.prisma` |
| `npm run prisma:migrate:deploy` | Áp dụng toàn bộ migration (`prisma migrate deploy`) |
| `npm run prisma:db-push` | Dev: `prisma db push` + `prisma/sql/post-push-invariants.sql` |
| `npx prisma migrate dev` | Tạo file migration mới khi thay đổi schema |
| `npx prisma studio` | Khởi chạy GUI quản lý Database (Port 5555) |
| `npm run seed` | Seed dữ liệu demo go-live (idempotent, xem Bước 5) |
| `npm run test:e2e -- test/publisher-results.prisma.e2e-spec.ts` | IR.4a trên PostgreSQL thật: tự tạo + migrate DB nháp `rescom_publisher_results_test` (đổi bằng `PUBLISHER_RESULTS_TEST_DATABASE_URL`, tên phải kết thúc `_test`/`_check`; không bao giờ trỏ vào `rescom_db`) |

---

## 🔐 Yêu cầu vận hành trước pilot (Ops checklist)

* **Ít nhất 2 tài khoản ADMIN đang hoạt động** (quyết định code review E8-D3, 2026-09-26): Admin không thể tự kiểm duyệt khảo sát do chính mình đăng (`403 MODERATION_SELF_REVIEW_FORBIDDEN`) và không thể tự duyệt yêu cầu nạp điểm của mình (Story 6.6). Nếu chỉ có một Admin, khảo sát của Admin đó sẽ không bao giờ được duyệt. Hãy nâng quyền cho ít nhất hai người dùng (`role = ADMIN`, `status = ACTIVE`) trong cơ sở dữ liệu trước khi chạy pilot.
* **`PARTICIPATION_RATE_LIMIT_POLICY_VERSION` là bắt buộc ở production** (quyết định E8-D4): tên phiên bản chính sách giới hạn tần suất được ghi vào mọi phản hồi 429 và mục FraudLog. `participation-rate-limit-v1` chỉ dùng cho bộ giá trị mặc định; nếu thay đổi bất kỳ giá trị `PARTICIPATION_*` nào, hãy đặt tên phiên bản mới. Các giá trị giới hạn vẫn đang chờ phê duyệt (PRD Open Question 16). Xem `.env.example`.

---

## ⏱ Vận hành scheduler (Story IR.2b)

Scheduler chạy **trong process API**, sau cờ `SCHEDULER_ENABLED` (mặc định `false`; không bao giờ tự chạy khi `NODE_ENV=test`). Chỉ bật trên **đúng một** replica. Mỗi job giữ lease trong bảng `scheduler_job_leases` (owner + fencing token BIGINT), nên lỡ có hai process cũng không xử lý trùng; mọi hiệu ứng còn có khóa idempotency riêng.

| Job | Nhịp | Việc làm | Khóa idempotency |
|---|---|---|---|
| `outbox-dispatch` | mỗi tick (`SCHEDULER_TICK_SECONDS`, 15 s) | Giao `InternalRewardRequested` cho handler `economy.internal-reward-settlement`; retry backoff 30 s·2^(n−1) (tối đa 1 h, ±20 %), dead letter sau `OUTBOX_MAX_ATTEMPTS` (8). Loại event chưa có handler giữ nguyên PENDING. | `processed_handlers (handler, event)` + `internal-reward:{responseId}` |
| `pending-release` | 5 phút | Chuyển điểm Pending đủ 48 h sang Khả dụng | `release-pending:{attemptId}` |
| `starter-expiry` | 1 giờ | Hủy điểm khởi đầu quá 30 ngày (hoặc mở khóa bù) | `starter-expiry:{userId}` |
| `reservation-expiry` | 5 phút | Đóng lượt làm quá 30 phút + 2 phút thành ABANDONED/EXPIRED | chuyển trạng thái có điều kiện |
| `deadline-close` | 5 phút | Đóng khảo sát quá hạn 32 phút (close kind `DEADLINE`), hoàn ký quỹ dư, báo `ESCROW_RELEASED` | `close-refund:{formId}:c{n}` |
| `storage-cleanup` | 1 giờ | Dọn file upload hết hạn | máy trạng thái `StoredObject` |

* **Theo dõi:** `GET /system/health` có `scheduler.{enabled,status}`; `GET /system/metrics` (ADMIN) có trạng thái từng job và backlog Outbox (`pending`, `retrying`, `deadLetter`, `unsubscribedPending`). Log: `SCHEDULER_JOB_RUN`, `SCHEDULER_STALE_LEASE`, `OUTBOX_RETRY_SCHEDULED`, `OUTBOX_DEAD_LETTERED`…
* **Re-drive dead letter:** `GET /admin/outbox/dead-letters` (ADMIN, không trả payload) rồi `POST /admin/outbox/events/:eventId/redrive` (body `{}`, CSRF): event về PENDING, `attempts = 0`, giữ nguyên id/khóa; có ghi audit `OUTBOX_EVENT_REDRIVEN`. Không có "skip".
* **Đường dự phòng thủ công** vẫn chạy: `POST /economy/rewards/release-matured` (có `after` = `nextCursor`), `POST /economy/starter-points/expire`, `POST /economy/rewards/internal/:responseId`, `POST /forms/:id/close`.
* **Trước khi rollback image về bản trước IR.2b:** đặt `SCHEDULER_ENABLED=false`; khảo sát đã đóng do hạn (`closeKind = DEADLINE`) hoặc đủ mẫu (`QUOTA`) có thể hiển thị như không mở lại được trên image cũ.
* Các job chạy song song (mỗi job một lease, không job nào chạy chồng chính nó), nên job dài không làm chậm `outbox-dispatch`. Lượt chạy mà mọi mục đều lỗi được ghi `FAILED` (backoff, `degraded` sau 3 lần). `last_error` chỉ chứa tên lỗi + mã, không lưu message thô. Khi tắt server, job đang chạy dừng sau mục hiện tại và nhả lease trước khi Prisma ngắt kết nối. Production mà tắt scheduler sẽ log lỗi `SCHEDULER_DISABLED_IN_PRODUCTION`; session DB không phải UTC sẽ log `DB_SESSION_TIMEZONE_NOT_UTC`.
* Khi `SCHEDULER_ENABLED=false` (local dev): không có release 48 h, không đóng theo hạn, không dọn upload — dùng các endpoint thủ công ở trên.

---

## ✉️ Email (Story IR.4b phần B, plan 5.4)

Email chỉ gửi cho 4 loại thông báo quan trọng (`TOPUP_SUCCESS`, `TOPUP_REJECTED`, `ACCOUNT_LOCKED`, `ACCOUNT_UNLOCKED`) và link đặt lại mật khẩu. Nội dung tiếng Việt, không lặp lại số điểm hay lý do (người nhận xem trong Rescom).

| `EMAIL_DELIVERY_MODE` | Ý nghĩa |
|---|---|
| `capture` (mặc định ngoài production) | Giữ thư trong bộ nhớ process, không gửi ra ngoài (local/test). |
| `smtp` | Gửi qua SMTP chuẩn (nodemailer, AD-23). Local dùng Mailpit; pilot dùng nhà cung cấp có SMTP. |
| `disabled` | Không gửi, không xếp hàng email. |

* **Mailpit (test nội bộ, mặc định trong `.env.example`):** `docker compose up -d mailpit`; `.env.example` đã đặt `EMAIL_DELIVERY_MODE=smtp`, `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_REQUIRE_TLS=false`. Xem mọi thư (thông báo, link đặt lại mật khẩu) ở **Mailpit UI http://localhost:8025** (chỉ bind 127.0.0.1).
* **Thông báo → email:** khi thông báo loại quan trọng được tạo (không phải bản trùng), cùng một transaction ghi một Outbox event `NotificationEmailRequested` (payload chỉ có id). Handler `notifications.email-delivery` của dispatcher IR.2b gửi thư, nên **cần `SCHEDULER_ENABLED=true`** để email thông báo đi. Mỗi thông báo có một dòng `email_deliveries` (không lưu địa chỉ, tiêu đề, nội dung): `SENDING` được ghi trước khi gửi; lỗi tạm thời (`FAILED` với mã `RETRYABLE:`) được dispatcher thử lại; lỗi vĩnh viễn hoặc kết quả mơ hồ (timeout sau `DATA`, crash giữa chừng → `UNCONFIRMED`) **không bao giờ gửi lại** (AD-10). Yêu cầu email cũ hơn 24 giờ bị `SKIPPED` (`STALE_EVENT`) để bật dispatcher sau thời gian dài không làm "xả" thư cũ.
* **Dữ liệu seed / backlog:** các thông báo và Outbox event có sẵn trong DB (kể cả từ seed trước thay đổi này) không có event `NotificationEmailRequested`, nên **không bao giờ sinh email**. Seed chạy lại sau thay đổi này sẽ xếp email cho địa chỉ `@rescom.test` (chỉ tới Mailpit/capture).
* **Đặt lại mật khẩu:** gửi trực tiếp qua `EmailSenderPort` sau khi commit (không qua Outbox, token gốc không được lưu ở đâu), không chờ kết quả gửi. Link: `EMAIL_APP_BASE_URL` (mặc định origin đầu tiên của `FRONTEND_ORIGINS`) + `/reset-password?token=…`, hết hạn sau 30 phút, dùng một lần (đặt lại xong thì mọi link khác của tài khoản bị hủy; link mới không hủy link cũ). Giới hạn: 3 link/giờ cho mỗi (tài khoản, IP) và 10 link/giờ cho mỗi tài khoản; link gửi email lỗi vẫn bị tính. Sau lưới proxy Next.js không đặt `TRUST_PROXY_HOPS` thì mọi trình duyệt chung một IP. Token đã dùng hoặc hết hạn quá 7 ngày bị job `password-reset-cleanup` (6 giờ/lần) xóa. Tài khoản chỉ đăng nhập Google hoặc đang bị khóa không nhận gì (trang quên mật khẩu đã hướng dẫn dùng Google).
* **Bí mật:** `SMTP_USERNAME`/`SMTP_PASSWORD` chỉ qua biến môi trường; log không bao giờ chứa địa chỉ người nhận, tiêu đề, nội dung, token hay thông tin SMTP. Production từ chối khởi động với `capture`/`disabled`, thiếu thông tin SMTP, `SMTP_REQUIRE_TLS=false` hoặc `EMAIL_APP_BASE_URL` không phải HTTPS. Nhà cung cấp email là đơn vị xử lý dữ liệu cá nhân mới (AD-21): phải vào danh mục trước production.

---

## 📁 Cấu trúc thư mục Backend

```text
apps/backend/
├── prisma/
│   ├── schema.prisma    # Cấu hình Schema, Model, Enum của Database
│   ├── migrations/      # Lịch sử migration (`prisma migrate deploy`)
│   └── sql/post-push-invariants.sql  # Ràng buộc cần áp dụng sau `db push`
├── prisma.config.ts     # Cấu hình Prisma Config & Studio Port
├── .env                 # File biến môi trường (DATABASE_URL)
├── package.json         # Khai báo thư viện & dependencies
└── README.md            # Tài liệu hướng dẫn setup backend
```
