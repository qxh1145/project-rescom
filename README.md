# RESCOM — Nền tảng Khảo sát & Nghiên cứu Khoa học

Dự án RESCOM (Research & Community Survey Platform) được triển khai theo kiến trúc:
- **Frontend:** Next.js 15 App Router — deploy trên **Vercel** (`https://www.rescom.io.vn`).
- **Backend:** NestJS, TypeScript — containerized Docker trên **Hostinger VPS** (`https://api.rescom.io.vn`).
- **Database:** PostgreSQL 15 — Docker trên VPS Hostinger (`201.18.212.192`).
- **Reverse Proxy & SSL:** Caddy v2 (Tự động cấp phát Let's Encrypt TLS).
- **Storage:** MinIO / Cloudflare R2 (S3-compatible).

---

## MỤC LỤC

1. [Hướng dẫn Deploy Backend VPS & Kết nối Frontend (Vercel)](docs/DEPLOY_BACKEND_AND_CONNECT_FE.md)
2. [Thông tin Hạ tầng & Cấu hình Database](#1-thông-tin-hạ-tầng--cấu-hình-database)
3. [Hướng dẫn Kết nối Database từ Máy Cá nhân](#2-hướng-dẫn-kết-nối-database-từ-máy-cá-nhân)
   - [Cách 1: DBeaver / TablePlus / GUI Tool (Khuyên dùng)](#cách-1-dbeaver--tableplus--gui-tool-khuyên-dùng)
   - [Cách 2: Sử dụng Prisma Studio Web UI](#cách-2-sử-dụng-prisma-studio-web-ui)
   - [Cách 3: Chạy Prisma Studio từ Máy Local](#cách-3-chạy-prisma-studio-từ-máy-local)
4. [Quy trình Thao tác & Chỉnh sửa Dữ liệu An toàn](#3-quy-trình-thao-tác--chỉnh-sửa-dữ-liệu-an-toàn)
5. [Quy trình Triển khai & Quản lý Schema Migration (Deploy DB)](#4-quy-trình-triển-khai--quản-lý-schema-migration-deploy-db)
6. [Backup & Khôi phục Dữ liệu (Backup & Restore)](#5-backup--khôi-phục-dữ-liệu-backup--restore)
7. [Quản lý Dịch vụ Docker trên VPS](#6-quản-lý-dịch-vụ-docker-trên-vps)

---

## 1. Thông tin Hạ tầng & Cấu hình Database

### Môi trường Production (VPS Hostinger)
- **VPS IP:** `201.18.212.192`
- **SSH User:** `root`
- **Thư mục triển khai:** `/opt/rescom/deploy`
- **File môi trường production:** `/opt/rescom/deploy/.env.prod`

### Thông số kết nối Database (PostgreSQL 15)
- **Container Name:** `rescom-postgres-1`
- **Host nội bộ VPS:** `127.0.0.1` (Chỉ bind localhost trên VPS để bảo vệ an toàn tối đa, không mở trực tiếp ra internet)
- **Cổng:** `5432`
- **Database:** `rescom_db`
- **User:** `rescom_admin`
- **Password:** Được lưu trong file `.env.prod` trên VPS (`POSTGRES_PASSWORD`).

---

## 2. Hướng dẫn Kết nối Database từ Máy Cá nhân

Vì cơ sở dữ liệu được cấu hình an toàn (chỉ lắng nghe kết nối từ `127.0.0.1` của VPS), bạn cần kết nối thông qua **SSH Tunnel**.

### Cách 1: DBeaver / TablePlus / GUI Tool (Khuyên dùng)

#### Bước 1: Mở SSH Tunnel trên máy cá nhân
Chạy lệnh sau trên Terminal máy Mac/Linux của bạn để tạo tunnel ngầm kết nối cổng `5432` trên máy của bạn với PostgreSQL trên VPS:
```bash
ssh -f -N -L 5432:127.0.0.1:5432 root@201.18.212.192
```
*(Nếu cổng `5432` trên máy bạn bị trùng do đang chạy PostgreSQL local, đổi sang cổng `5433`: `ssh -f -N -L 5433:127.0.0.1:5432 root@201.18.212.192`)*

#### Bước 2: Cấu hình trong DBeaver
1. Mở **DBeaver** ➔ Tạo kết nối mới ➔ Chọn **PostgreSQL**.
2. **Tab SSH:** **BỎ TÍCH** mục *"Use SSH Tunnel"* (vì máy bạn đã có tunnel chạy ngầm ở Bước 1, tránh lỗi giải mã khóa SSHJ trên macOS).
3. **Tab Main:**
   - **Host:** `127.0.0.1` (hoặc `localhost`)
   - **Port:** `5432` (hoặc `5433` nếu đổi ở bước trên)
   - **Database:** `rescom_db`
   - **Username:** `rescom_admin`
   - **Password:** `<POSTGRES_PASSWORD_TỪ_.ENV.PROD>`
4. Nhấn **Test Connection** ➔ Báo `Connected` thành công ➔ Nhấn **Finish**.

---

### Cách 2: Sử dụng Prisma Studio Web UI

Prisma Studio là giao diện trực quan trên nền web đi kèm với Prisma ORM.

#### Bước 1: Mở tunnel cổng 5555
Chạy lệnh sau trên Terminal máy cá nhân:
```bash
ssh -f -N -L 5555:localhost:5555 root@201.18.212.192
```

#### Bước 2: Truy cập trình duyệt
Mở trình duyệt truy cập:
👉 **`http://localhost:5555`**

#### Trường hợp Prisma Studio chưa chạy hoặc bị tắt trên VPS:
Bạn SSH vào VPS và kích hoạt Prisma Studio bằng lệnh:
```bash
ssh root@201.18.212.192 "docker compose -f /opt/rescom/deploy/docker-compose.hostinger.yml --env-file /opt/rescom/deploy/.env.prod exec -d backend npx prisma studio --port 5555 --hostname 0.0.0.0"
```

---

### Cách 3: Chạy Prisma Studio từ Máy Local

Bạn có thể tận dụng mã nguồn và Prisma CLI trên máy local để xem DB production mà không cần phụ thuộc vào container trên VPS:

1. Mở SSH tunnel cổng 5432 (như Cách 1).
2. Tại máy local, đứng ở thư mục dự án chạy:
```bash
cd apps/backend
DATABASE_URL="postgresql://rescom_admin:<PASSWORD>@127.0.0.1:5432/rescom_db?schema=public" npx prisma studio
```
3. Truy cập `http://localhost:5555` trên trình duyệt.

---

## 3. Quy trình Thao tác & Chỉnh sửa Dữ liệu An toàn

### Quy trình sửa data trong DBeaver
1. Điều hướng: `rescom_db` ➔ `Schemas` ➔ `public` ➔ `Tables`.
2. Mở bảng cần thao tác ➔ Chọn tab **Data**.
3. Dùng thanh Filter ở đầu cột để tìm dòng dữ liệu cần sửa.
4. Double-click vào ô cần sửa và nhập giá trị mới.
5. Nhấn **Save** (icon đĩa mềm) hoặc **`Cmd + S`** (Mac) / `Ctrl + S` (Windows) để commit thay đổi.

### Các ràng buộc cốt lõi cần lưu ý
- **Cột ID (Khóa chính):** Tuyệt đối **không sửa cột `id`** (UUID) vì đang được các bảng khác liên kết khóa ngoại (Foreign Keys).
- **Cột Mật khẩu (`passwordHash`):** Mật khẩu bắt buộc là chuỗi hash bcrypt (bắt đầu bằng `$2b$10$...`). Không gõ plain text vào ô này.
  - *Mẹo đổi mật khẩu:* Có thể copy chuỗi `passwordHash` của tài khoản mẫu (ví dụ mật khẩu `Password123456!`) dán vào tài khoản cần reset.
- **Các trường Enum (Role, Status):** Bắt buộc phải viết **IN HOA CHÍNH XÁC** theo định nghĩa trong `schema.prisma`:
  - `User.role`: `ADMIN`, `PUBLISHER`, `RESPONDENT`
  - `User.status`: `ACTIVE`, `PENDING_VERIFICATION`, `SUSPENDED`
  - `Survey.status`: `DRAFT`, `PENDING_REVIEW`, `PUBLISHED`, `CLOSED`
- **Ví điểm thưởng (`LedgerAccount`):** Cột `balance` thể hiện số dư điểm. Sửa trực tiếp cột này để thay đổi số dư hiển thị khi kiểm thử.
- **Cột kiểu JSONB:** Double-click để mở trình soạn thảo JSON riêng của DBeaver, kiểm tra đúng định dạng JSON trước khi lưu.

---

## 4. Quy trình Triển khai & Quản lý Schema Migration (Deploy DB)

Mỗi khi bạn thay đổi cấu trúc bảng trong `apps/backend/prisma/schema.prisma`, hãy tuân theo quy trình chuẩn sau:

### Bước 1: Tạo Migration ở Môi trường Development (Local)
```bash
cd apps/backend
npx prisma migrate dev --name <ten_thay_doi>
```
Lệnh này sẽ sinh ra thư mục migration mới trong `apps/backend/prisma/migrations/`.

### Bước 2: Commit và Đẩy Code lên Git
```bash
git add apps/backend/prisma/migrations
git commit -m "feat(db): update schema for <tính_năng>"
git push origin <branch>
```

### Bước 3: Áp dụng Migration lên Production VPS
SSH vào VPS và chạy lệnh migrate deploy:
```bash
ssh root@201.18.212.192 "docker compose -f /opt/rescom/deploy/docker-compose.hostinger.yml --env-file /opt/rescom/deploy/.env.prod exec backend npx prisma migrate deploy"
```
*Lưu ý: Không bao giờ dùng `prisma migrate dev` hoặc `prisma db push` trên production để tránh làm mất dữ liệu người dùng.*

---

## 5. Backup & Khôi phục Dữ liệu (Backup & Restore)

### Tạo bản Backup (Dump Database)
Chạy lệnh sau từ máy cá nhân để xuất toàn bộ database từ VPS về máy:
```bash
ssh root@201.18.212.192 "docker exec rescom-postgres-1 pg_dump -U rescom_admin rescom_db" > ~/rescom_backup_$(date +%Y%m%d_%H%M%S).sql
```

### Khôi phục Dữ liệu (Restore Database)
Khi cần khôi phục dữ liệu từ file backup về database trên VPS:
```bash
cat ~/duong_dan_file_backup.sql | ssh root@201.18.212.192 "docker exec -i rescom-postgres-1 psql -U rescom_admin -d rescom_db"
```

---

## 6. Quản lý Dịch vụ Docker trên VPS

Các lệnh thường dùng trên VPS Hostinger (`ssh root@201.18.212.192`):

```bash
cd /opt/rescom/deploy

# Xem trạng thái các container
docker compose -f docker-compose.hostinger.yml --env-file .env.prod ps

# Xem log thời gian thực của backend
docker compose -f docker-compose.hostinger.yml --env-file .env.prod logs -f backend

# Xem log database
docker compose -f docker-compose.hostinger.yml --env-file .env.prod logs -f postgres

# Khởi động lại một dịch vụ
docker compose -f docker-compose.hostinger.yml --env-file .env.prod restart backend

# Nâng cấp toàn bộ dịch vụ sau khi cập nhật file cấu hình
docker compose -f docker-compose.hostinger.yml --env-file .env.prod up -d
```
