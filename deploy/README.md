# Hướng dẫn deploy RESCOM (1 VPS)

Toàn bộ hệ thống chạy trên một VPS bằng Docker Compose:

```
Trình duyệt ──HTTPS──> Caddy ──> Next.js (frontend, /api/* rewrite) ──> NestJS (backend) ──> Postgres
                         └─────> MinIO (s3.<domain>, upload file qua presigned URL)      └──> ClamAV
```

- Caddy tự xin và gia hạn chứng chỉ HTTPS (Let's Encrypt). Chỉ Caddy mở cổng 80/443.
- Backend tự chạy `prisma migrate deploy` mỗi lần khởi động.
- Frontend build với `NEXT_PUBLIC_API_MOCKING=hybrid`: 14 endpoint chưa làm (disputes, AI, …) vẫn
  dùng dữ liệu minh hoạ, phần còn lại gọi backend thật.

Giá trị dùng trong tài liệu: domain app `rescom.io.vn`, domain file `s3.rescom.io.vn`,
thư mục trên VPS `/opt/rescom`. Thay `<user>` và `<IP-VPS>` bằng thông tin SSH của bạn.

---

## Phần 1 — Deploy lần đầu

### 1.1. Chuẩn bị

| Cần có | Ghi chú |
|---|---|
| VPS Ubuntu, ≥ 4 GB RAM | ClamAV + build Next.js tốn RAM |
| Domain trên Cloudflare | `rescom.io.vn` |
| Tài khoản Brevo | Gửi email (SMTP). Domain phải ở trạng thái **Verified** |
| OAuth client trên Google Auth Platform | Đăng nhập Google |

### 1.2. DNS trên Cloudflare

Tạo 2 bản ghi **A**, cùng trỏ về IP VPS, để **DNS only (mây xám)**:

| Name | Content | Proxy |
|---|---|---|
| `@` | IP VPS | DNS only |
| `s3` | IP VPS | DNS only |

> Không bật mây cam: Caddy cần nhận trực tiếp request để xin chứng chỉ, và `TRUST_PROXY_HOPS=2`
> được tính cho đường đi không qua Cloudflare. Bật proxy sẽ làm rate-limit nhận sai IP.

Bản ghi email của Brevo (TXT `brevo-code`, DKIM, DMARC) và Cloudflare Email Routing (MX, SPF) thêm
theo hướng dẫn của từng dịch vụ. Domain chỉ được có **một** bản ghi SPF, gộp lại thành:

```
v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all
```

### 1.3. Google OAuth

Trong Google Cloud Console → **Google Auth Platform**:

- **Branding**: Authorized domains thêm `rescom.io.vn`.
- **Audience**: External, trạng thái **Testing**, thêm Gmail của thành viên team vào **Test users**
  (chỉ những tài khoản này đăng nhập Google được).
- **Clients** → Web application:
  - Authorized JavaScript origins: `https://rescom.io.vn`
  - Authorized redirect URIs: `https://rescom.io.vn/api/auth/google/callback`

### 1.4. Chuẩn bị VPS

SSH vào VPS rồi chạy:

```bash
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER
```

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```

Thoát SSH rồi đăng nhập lại để quyền `docker` có hiệu lực.

### 1.5. Lấy code

```bash
sudo mkdir -p /opt/rescom && sudo chown $USER /opt/rescom && git clone -b develop https://github.com/qxh1145/project-rescom.git /opt/rescom
```

Tạo alias cho lệnh compose (chạy một lần):

```bash
echo "alias rescom='docker compose -f /opt/rescom/deploy/docker-compose.prod.yml --env-file /opt/rescom/deploy/.env.prod'" >> ~/.bashrc && source ~/.bashrc
```

Các lệnh `rescom ...` bên dưới đều dùng alias này.

### 1.6. File cấu hình `deploy/.env.prod`

File này chứa toàn bộ secret, **bị gitignore** và không bao giờ được commit.

1. Trên máy của bạn: `cp deploy/.env.prod.example deploy/.env.prod`, rồi điền mọi `CHANGE_ME`.
2. Sinh secret (chạy một lần, copy kết quả vào file):

   ```bash
   echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"; for k in JWT_SECRET AUTH_SECRET_PROTECTION_KEY COMPLETION_CODE_HMAC_SECRET STORAGE_CAPABILITY_SECRET; do echo "$k=$(openssl rand -base64 48)"; done; echo "STORAGE_ACCESS_KEY_ID=rescom$(openssl rand -hex 4)"; echo "STORAGE_SECRET_ACCESS_KEY=$(openssl rand -hex 24)"
   ```

3. Những chỗ hay sai:

   | Biến | Đúng |
   |---|---|
   | `DATABASE_URL` | `postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@postgres:5432/<POSTGRES_DB>?schema=public&options=-c%20timezone%3DUTC` — host là `postgres`, cổng `5432`, user/mật khẩu **khớp** 2 dòng trên |
   | `POSTGRES_PASSWORD` | chỉ dùng hex (`openssl rand -hex`), vì nó nằm trong URL |
   | `AUTH_FRONTEND_SUCCESS_URL` | `https://rescom.io.vn/auth/callback` (không có `/api`) |
   | `AUTH_FRONTEND_ERROR_URL` | `https://rescom.io.vn/auth/error` |
   | `GOOGLE_REDIRECT_URI` | `https://rescom.io.vn/api/auth/google/callback` (có `/api`) |
   | `TOPUP_BANK_BIN` | đúng mã BIN ngân hàng (MB Bank `970422`, Vietcombank `970436`) |
   | `SMTP_SECURE` / `SMTP_REQUIRE_TLS` | `false` / `true` (cổng 587 STARTTLS) |
   | Mọi giá trị | không có dấu cách thừa ở cuối dòng |

4. Upload lên VPS:

   ```bash
   scp deploy/.env.prod <user>@<IP-VPS>:/opt/rescom/deploy/.env.prod
   ```

   ```bash
   ssh <user>@<IP-VPS> "chmod 600 /opt/rescom/deploy/.env.prod"
   ```

> **Không dán secret vào chat, issue hay tin nhắn.** Cần cho người khác xem file thì in bản đã che:
>
> ```bash
> sed -E 's/^(DATABASE_URL|[A-Z_]*(PASSWORD|SECRET|KEY))=.*/\1=***/' deploy/.env.prod
> ```
>
> Secret nào đã lộ thì phải tạo lại.

### 1.7. Build và chạy

Trên VPS:

```bash
cd /opt/rescom && rescom up -d --build
```

Lần đầu mất khoảng 10–15 phút. Theo dõi:

```bash
rescom ps
```

```bash
rescom logs -f backend
```

Backend chạy được khi log có dòng Nest khởi động xong và không có lỗi env/migration.
`minio-init` hiện `Exited (0)` là bình thường (nó chỉ tạo bucket rồi thoát).

### 1.8. Tạo dữ liệu và tài khoản test

```bash
rescom exec -e SEED_ALLOW_PRODUCTION=true backend npm run seed
```

Mật khẩu các tài khoản seed được ghi vào file trong container. Lấy ra ngay và cất ở nơi an toàn
(file sẽ mất khi container được tạo lại):

```bash
rescom exec backend cat .seed-credentials.local.md
```

### 1.9. Kiểm tra

- [ ] `https://rescom.io.vn` mở được, có ổ khoá HTTPS
- [ ] Đăng ký tài khoản mới
- [ ] "Quên mật khẩu" → nhận được email đặt lại mật khẩu (kiểm tra cả hộp thư Spam)
- [ ] Đăng nhập bằng email/mật khẩu và bằng Google
- [ ] Tạo khảo sát, upload file (kiểm tra cả `s3.rescom.io.vn`)
- [ ] Đăng nhập admin, duyệt khảo sát và top-up

---

## Phần 2 — Vận hành sau khi deploy

Mọi lệnh chạy **trên VPS**.

### 2.1. Lệnh hay dùng

| Việc | Lệnh |
|---|---|
| Xem trạng thái các container | `rescom ps` |
| Xem log backend | `rescom logs -f --tail 200 backend` |
| Xem log frontend / Caddy | `rescom logs -f --tail 200 frontend` · `rescom logs -f --tail 200 caddy` |
| Khởi động lại backend | `rescom restart backend` |
| Dừng toàn bộ | `rescom down` (**không** thêm `-v`, sẽ xoá dữ liệu) |
| Chạy lại toàn bộ | `rescom up -d` |
| Xem branch/commit đang chạy | `git -C /opt/rescom branch --show-current && git -C /opt/rescom log --oneline -1` |
| Dung lượng ổ đĩa | `df -h` · `docker system df` |

### 2.2. Cập nhật code mới

Push code lên GitHub, rồi trên VPS:

```bash
cd /opt/rescom && git pull && rescom up -d --build && docker image prune -f
```

- `.env.prod` không bị ảnh hưởng (gitignored).
- Web gián đoạn vài giây đến 1 phút khi container được thay.
- Migration mới được áp dụng tự động khi backend khởi động.
- Nếu lần cập nhật có thư mục mới trong `apps/backend/prisma/migrations/` → **backup DB trước**
  (mục 2.5).

### 2.3. Đổi branch

```bash
cd /opt/rescom && git fetch && git checkout <tên-branch> && git pull && rescom up -d --build
```

> Migration chỉ chạy tiến, không lùi. Quay về branch cũ hơn thì DB vẫn giữ cấu trúc mới và code cũ
> có thể lỗi. Nên chỉ deploy từ một branch cố định (ví dụ `develop` hoặc `main`).

### 2.4. Đổi cấu hình `.env.prod`

Sửa trên VPS (`nano /opt/rescom/deploy/.env.prod`) hoặc sửa trên máy rồi `scp` lại, sau đó:

```bash
rescom up -d
```

Compose tự tạo lại container có env thay đổi. **Không đổi** `AUTH_SECRET_PROTECTION_KEY` và
`POSTGRES_PASSWORD` sau khi đã có dữ liệu: dữ liệu đã mã hoá hoặc DB sẽ không mở được.

### 2.5. Backup database

Backup thủ công (nên làm trước mỗi lần cập nhật có migration):

```bash
mkdir -p ~/db-backups && rescom exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > ~/db-backups/db-$(date +%F-%H%M).sql.gz
```

Khôi phục từ một file backup (**ghi đè dữ liệu hiện tại**, dừng backend trước):

```bash
rescom stop backend
```

```bash
rescom exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
```

```bash
gunzip -c ~/db-backups/<file>.sql.gz | rescom exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
```

```bash
rescom start backend
```

Backup tự động hằng đêm ra ngoài VPS (DB + file MinIO): dùng `deploy/backup.sh`, cần cài `rclone`
và cấu hình remote `RCLONE_REMOTE` trước. Hướng dẫn cron nằm ở đầu file script.

### 2.6. Rollback khi bản mới lỗi

```bash
cd /opt/rescom && git log --oneline -5
```

```bash
git checkout <commit-đang-chạy-ổn> && rescom up -d --build
```

Chỉ an toàn khi bản lỗi **không có migration mới**. Nếu có: rollback code như trên rồi khôi phục DB
từ backup trước khi deploy (mục 2.5).

Xong việc thì quay lại branch: `git checkout develop`.

### 2.7. Xử lý sự cố thường gặp

| Hiện tượng | Kiểm tra |
|---|---|
| Backend restart liên tục | `rescom logs --tail 100 backend` — thường là lỗi env (thiếu biến, sai định dạng) hoặc sai `DATABASE_URL` |
| Lỗi `authentication failed` với Postgres | User/mật khẩu trong `DATABASE_URL` không khớp `POSTGRES_*`. Nếu đã đổi mật khẩu sau lần chạy đầu, Postgres vẫn giữ mật khẩu cũ |
| Web không có HTTPS / lỗi chứng chỉ | DNS chưa trỏ đúng IP hoặc đang bật mây cam; xem `rescom logs caddy` |
| Đăng nhập Google báo `redirect_uri_mismatch` | Redirect URI trên Google khác `GOOGLE_REDIRECT_URI` |
| Đăng nhập Google báo `access_denied` | Gmail chưa nằm trong **Test users** |
| Không nhận được email | Domain chưa Verified trên Brevo, SMTP key sai, hoặc thiếu SPF/DKIM; xem log backend |
| Upload file lỗi CORS / 403 | `STORAGE_ENDPOINT` phải là `https://s3.rescom.io.vn`; DNS `s3` phải trỏ đúng VPS |
| Build bị kill / hết RAM | Kiểm tra swap: `free -h` |
| Ổ đĩa đầy | `docker image prune -f` và `docker builder prune -f` |
