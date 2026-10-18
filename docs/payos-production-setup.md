# Owner checklist: payOS production probe (Story 13.6)

Owner chạy trên VPS. Đây là giao dịch thật 10.000 VNĐ: **thanh toán từ tài khoản ngân hàng Owner**. Không chia sẻ Client ID, API Key, Checksum Key, số tài khoản đầy đủ hoặc log chưa che thông tin. `PAYOS_ENABLED=false` cho tới Story 13.13.

Production chạy `deploy/docker-compose.hostinger.yml` với `--env-file .env.prod`, service `backend`, trong `/opt/rescom/deploy`. File compose nội suy `${POSTGRES_USER:?}`…, nên **mọi lệnh compose phải có `--env-file .env.prod`**. Mở shell VPS và đặt alias một lần:

```bash
cd /opt/rescom/deploy
DC="docker compose -f docker-compose.hostinger.yml --env-file .env.prod"
$DC config --services   # phải thấy backend; nếu không, dừng và xác nhận stack đang deploy
```

| Bước | Thao tác và kết quả mong đợi | Done (date) |
|---|---|---|
| 0 | Release `develop` → `main`, Vercel production deploy từ `main`; VPS backup DB, pull, build, **migrate**, restart (lệnh 0). Mong đợi `migrate deploy` áp dụng các migration 13.x, backend healthy, `PAYOS_ENABLED=false`. | |
| 1 | Tạo payment channel payOS gắn tài khoản ngân hàng Owner; sao chép Client ID, API Key, Checksum Key vào nơi bảo mật. Ghi 4 số cuối tài khoản nhận tiền, không ghi khóa vào checklist. | |
| 2 | Sửa `.env.prod` và restart (lệnh 2). Mong đợi backend chạy không lỗi env. `.env.prod` chỉ ở VPS, không commit. | |
| 3 | Xác nhận Vercel production có `RESCOM_EDGE_KEY` và Deployment Protection không chặn `POST /api/*`. Chạy confirm-webhook (lệnh 3). Mong đợi exit 0, URL `https://app.rescom.io.vn/api/economy/top-ups/payos/webhook`, account name, chỉ 4 số cuối tài khoản; webhook thử trả 200 và log `payOS webhook for unknown order` (không ghi tiền). Chưa chạy probe khi confirm thất bại. | |
| 4 | Chạy probe (lệnh 4). Mở `checkoutUrl` và **trả tiền bằng tài khoản ngân hàng Owner trong 5 phút**. Mong đợi `status=SUCCESSFUL`, `pointsCredited=50`, `creditJournalExists=true`, exit 0. Nếu 409 top-up đang xử lý: huỷ trong app hoặc chờ hết hạn. | |
| 5 | Thu stdout probe và log (lệnh 5). Mong đợi `payOS webhook credited` khớp orderCode/topUpId, `payOS webhook capture` đã che thông tin, dòng `SCHEDULER_JOB_RUN` của `payos-reconcile` không có `creditedCount > 0` trong khoảng thanh toán. Nếu reconciliation ghi tiền trước webhook: ghi nhận và hỏi Owner có lặp giao dịch thật 10.000 VNĐ không; không coi là chứng cứ webhook. Không sửa ledger/hoàn tiền; 50 Points để lại tài khoản Owner. | |
| 6 | Tắt capture và restart (lệnh 6). Mong đợi backend chạy bình thường, capture tắt. Checkout vẫn đóng tới Story 13.13. | |

## Lệnh

**0. Release và deploy backend.** VPS giữ bản `docker-compose.hostinger.yml` đã sửa local; cất nó trước khi pull rồi trả lại. Image không tự migrate khi start: phải chạy `migrate deploy` trước `up`. Không rebuild cả stack, không dùng `--remove-orphans`.

```bash
cd /opt/rescom/deploy
mkdir -p /root/backups && $DC exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > /root/backups/db-$(date +%F-%H%M).sql.gz
cp docker-compose.hostinger.yml /root/backups/docker-compose.hostinger.yml.local
git checkout -- docker-compose.hostinger.yml
cd /opt/rescom && git fetch origin && git checkout main && git pull --ff-only origin main
cp /root/backups/docker-compose.hostinger.yml.local /opt/rescom/deploy/docker-compose.hostinger.yml
cd /opt/rescom/deploy
$DC build backend
$DC run --rm --no-deps backend npx prisma migrate deploy
$DC up -d --no-deps backend
$DC exec backend node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>{console.log(r.status);process.exit(r.ok?0:1)})"
```

**2. Env payOS.** Trong `nano .env.prod` đặt `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`, `TOPUP_REFUND_MAILBOX=trananhquan1104.work@gmail.com`, `PAYOS_WEBHOOK_CAPTURE=true`, giữ `PAYOS_ENABLED=false`.

```bash
cd /opt/rescom/deploy && nano .env.prod
$DC up -d --no-deps backend && $DC logs --tail 100 backend
```

**3. Confirm webhook.**

```bash
$DC exec backend node dist/apps/backend/src/scripts/payos-confirm-webhook.js
```

Nếu thất bại, kiểm tra route tới được backend. Lệnh này phải trả **401** (chữ ký sai nhưng route tới được), không phải 404/403:

```bash
curl -i -X POST https://app.rescom.io.vn/api/economy/top-ups/payos/webhook -H 'content-type: application/json' -d '{}'
```

**4. Probe.**

```bash
$DC exec -e PROBE_USER_EMAIL=<owner-email> backend node dist/apps/backend/src/scripts/payos-probe.js
```

**5. Log chứng cứ.**

```bash
$DC logs backend --since 15m | grep -E 'payOS webhook (credited|capture)|SCHEDULER_JOB_RUN.*payos-reconcile'
```

**6. Tắt capture.** Trong `nano .env.prod` đặt `PAYOS_WEBHOOK_CAPTURE=false` hoặc xoá dòng, giữ `PAYOS_ENABLED=false`.

```bash
cd /opt/rescom/deploy && nano .env.prod
$DC up -d --no-deps backend && $DC logs --tail 50 backend
```

## Gửi chứng cứ về dev agent

- Stdout probe gồm topUpId, orderCode, `pointsCredited`, GET response đã che thông tin và các dòng `CHECK`; tránh gửi checkoutUrl.
- Hai dòng log `payOS webhook credited`, `payOS webhook capture` (kiểm tra thông tin cá nhân đã che trước khi gửi).
- Dòng `SCHEDULER_JOB_RUN` của `payos-reconcile` trong khoảng thanh toán, gồm `creditedCount`; nếu không có, báo rõ thay vì suy đoán.
- Ngày hoàn tất từng bước, lỗi nếu có.

## Quyết định FR-77 (AC 8)

Nếu dòng `CHECK transaction[...] counterAccountNumberPresent=false` (hoặc `counterAccountName`/`counterAccountBankId` vắng): Owner **phải quyết định trước khi bắt đầu Story 13.10** có đổi FR-77 không (PRD đã có nhánh "unverified destination"). Ghi quyết định vào `prd.md` FR-77 thành dòng amendment có ngày, và vào story 13.6. Nếu có đủ: ghi "present; no FR-77 change".

## Tài liệu vận hành

Khi hệ thống đã sẵn sàng bàn giao và hoàn tất toàn bộ các tính năng của Epic 13, Product Owner và đội ngũ DevOps thực hiện quy trình kích hoạt production theo:
- **[Sổ tay vận hành payOS Production (Story 13.13)](./payos-production-runbook.md)**: Hướng dẫn chi tiết kiểm tra tiền điều kiện, các bước bật cờ `PAYOS_ENABLED=true`, xử lý hàng đợi nạp tiền thủ công, SOPs sự cố, quy trình hoàn tác (kill-switch) và mẫu biên bản nghiệm thu.

