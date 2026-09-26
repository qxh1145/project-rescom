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

2. **Đồng bộ Schema vào Database**:
   ```bash
   # Đồng bộ trực tiếp schema vào database (Dev mode)
   npx prisma db push

   # Hoặc tạo & chạy migration chính thức:
   npx prisma migrate dev --name init
   ```

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
| `docker compose up -d` | Khởi động Postgres container |
| `docker compose down` | Dừng và xóa Postgres container |
| `npx prisma generate` | Sinh lại Prisma Client từ `schema.prisma` |
| `npx prisma db push` | Đồng bộ nhanh Schema sang DB |
| `npx prisma migrate dev` | Tạo file migration mới khi thay đổi schema |
| `npx prisma studio` | Khởi chạy GUI quản lý Database (Port 5555) |

---

## 🔐 Yêu cầu vận hành trước pilot (Ops checklist)

* **Ít nhất 2 tài khoản ADMIN đang hoạt động** (quyết định code review E8-D3, 2026-09-26): Admin không thể tự kiểm duyệt khảo sát do chính mình đăng (`403 MODERATION_SELF_REVIEW_FORBIDDEN`) và không thể tự duyệt yêu cầu nạp điểm của mình (Story 6.6). Nếu chỉ có một Admin, khảo sát của Admin đó sẽ không bao giờ được duyệt. Hãy nâng quyền cho ít nhất hai người dùng (`role = ADMIN`, `status = ACTIVE`) trong cơ sở dữ liệu trước khi chạy pilot.
* **`PARTICIPATION_RATE_LIMIT_POLICY_VERSION` là bắt buộc ở production** (quyết định E8-D4): tên phiên bản chính sách giới hạn tần suất được ghi vào mọi phản hồi 429 và mục FraudLog. `participation-rate-limit-v1` chỉ dùng cho bộ giá trị mặc định; nếu thay đổi bất kỳ giá trị `PARTICIPATION_*` nào, hãy đặt tên phiên bản mới. Các giá trị giới hạn vẫn đang chờ phê duyệt (PRD Open Question 16). Xem `.env.example`.

---

## 📁 Cấu trúc thư mục Backend

```text
apps/backend/
├── prisma/
│   └── schema.prisma    # Cấu hình Schema, Model, Enum của Database
├── prisma.config.ts     # Cấu hình Prisma Config & Studio Port
├── .env                 # File biến môi trường (DATABASE_URL)
├── package.json         # Khai báo thư viện & dependencies
└── README.md            # Tài liệu hướng dẫn setup backend
```
