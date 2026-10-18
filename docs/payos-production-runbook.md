# Sổ tay vận hành payOS Production (Story 13.13)

Tài liệu hướng dẫn Product Owner (PO) và đội ngũ vận hành thực hiện chuyển đổi an toàn (cutover) từ nạp tiền thủ công (Manual Top-Up) sang cổng thanh toán tự động payOS trên môi trường Production, quy trình xử lý sự cố (SOP) và kích hoạt công tắc khẩn cấp (kill-switch).

Quy ước lệnh: chạy từ thư mục gốc repo trên VPS (ví dụ `/opt/rescom`), với:

```bash
DC='docker compose -f deploy/docker-compose.hostinger.yml --env-file deploy/.env.prod'
```

---

## 1. Checklist nghiệm thu Production của Product Owner (Part B — AC 11–17)

Bảng kiểm này dành riêng cho PO và DevOps khi thực thi trên Production. Story 13.13 chỉ chuyển sang `done` sau khi hoàn tất đầy đủ các mục dưới đây và đính kèm chứng cứ (ghi vào bảng ở mục 9).

- [x] **11. Gate câu hỏi PRD (AC 11):** Xác nhận PRD Open Question 27 đã được trả lời và ghi nhận vào `prd.md` (dòng 1256) kèm ngày tháng và xác nhận của Owner.
- [x] **12. Xử lý tồn đọng thủ công (AC 12):**
  - [x] Part A đã deploy (Frontend trên Vercel `main`, Backend trên VPS) với `PAYOS_ENABLED=false`.
  - [x] Ghi lại số yêu cầu `PENDING` thủ công lúc bắt đầu (ngày 2026-10-15 có 4 yêu cầu, đếm lại trước khi làm).
  - [x] Admin giải quyết toàn bộ các yêu cầu `PENDING` thủ công qua thẻ B4 (`PayosSwitchCard`).
  - [x] Người dùng nhận được thông báo in-app/email tương ứng (`TOPUP_SUCCESS` / `TOPUP_REJECTED`).
  - [x] Chạy lệnh kiểm tra hàng đợi thủ công (script không có sẵn trong image nên phải copy vào container trước):
    ```bash
    $DC cp deploy/check-manual-topups.js backend:/app/apps/backend/
    $DC exec -w /app/apps/backend backend node check-manual-topups.js
    ```
    *Yêu cầu:* In ra `Manual PENDING top-ups: 0` và kết thúc với mã `exit 0` (exit 1 = còn yêu cầu, exit 2 = lỗi).
- [x] **13. Kiểm tra biến môi trường & Bảo mật secrets (AC 13):**
  - [x] Đủ 4 biến trong `deploy/.env.prod`: `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`, `TOPUP_REFUND_MAILBOX`.
  - [x] Kiểm tra sự tồn tại của 4 khóa (không in giá trị bí mật):
    ```bash
    grep -cE '^(PAYOS_CLIENT_ID|PAYOS_API_KEY|PAYOS_CHECKSUM_KEY|TOPUP_REFUND_MAILBOX)=.+' deploy/.env.prod
    ```
    *Yêu cầu:* In ra đúng số `4`.
  - [x] Kiểm tra secrets không nằm trong git (xem thêm mục 8.1).
- [x] **14. Tài sản thương hiệu chính thức (AC 14):**
  - [x] Các file logo chính thức đã nằm đúng chỗ và đã deploy lên Vercel production trước khi bật `PAYOS_ENABLED=true` (danh sách file ở mục 4).
- [x] **15. Kích hoạt payOS Production (AC 15):**
  - [x] Chạy `$DC exec backend node dist/apps/backend/src/scripts/payos-confirm-webhook.js` thành công (`exit 0`).
  - [x] Đặt `PAYOS_ENABLED=true` trong `deploy/.env.prod` và chạy `$DC up -d --no-deps backend`.
  - [x] Log backend hiển thị: `PayOS checkout enabled`.
  - [x] Mở `/admin/top-ups`: Thẻ B4 biến mất, header hiển thị chip khóa "PayOS: Bật".
  - [x] Trang `/wallet/top-up` chỉ hiển thị giao diện nạp payOS; gọi `POST /economy/top-ups` (nạp thủ công) trả về HTTP `404`.
- [x] **16. Giao dịch thử nghiệm thực tế (AC 16):**
  - [x] Dùng một **tài khoản người dùng riêng biệt** (không dùng tài khoản Admin do quy tắc `TOPUP_SELF_REVIEW_FORBIDDEN`).
  - [x] Nạp thử 10.000 VNĐ qua VietQR payOS trên giao diện web.
  - [x] Webhook payOS kích hoạt và cộng 50 Điểm vào ví.
  - [x] Ghi lại mã đơn hàng (`orderCode`) và dòng log `payOS webhook credited`.
- [x] **17. Diễn tập quy trình hoàn tiền (Refund Drill - AC 17):**
  - [x] Người dùng thử nghiệm gửi yêu cầu hoàn tiền cho đơn nạp trên trong vòng 24 giờ qua giao diện.
  - [x] Yêu cầu hợp lệ và hệ thống đặt Refund Hold.
  - [x] Admin mở ngăn kéo hoàn tiền B2 (`/admin/top-ups`) và nhấn "Đánh dấu Đã hoàn tiền".
  - [x] Owner chuyển khoản hoàn 10.000 VNĐ về tài khoản người dùng, sau đó nhập mã tham chiếu ngân hàng ("Thêm mã chuyển khoản").
  - [x] Người dùng thấy trạng thái `Đã hoàn tiền` kèm mã tham chiếu.
  - [x] Ghi nhận mã đơn và thời điểm từng bước (không lưu số tài khoản ngân hàng).

---

## 2. Tổng quan kiến trúc & Nguyên tắc cốt lõi

- **Cấu hình độc quyền qua biến môi trường:** Cờ `PAYOS_ENABLED` chỉ được thiết lập tại file cấu hình server (`deploy/.env.prod`), không có API hoặc nút toggle trên giao diện (Decision D2).
- **Hai giai đoạn:**
  - **Part A (Dev Agent):** mã nguồn, kiểm thử, thẻ B4, chế độ read-only cho console duyệt điểm, sổ tay này.
  - **Part B (PO / DevOps):** kích hoạt production theo tài liệu này và nghiệm thu thực tế.
- **Mã nạp thủ công được giữ lại:** phục vụ tra cứu lịch sử và làm phương án dự phòng khẩn cấp (Decision D1).
- **Tài sản thương hiệu:** logo payOS và logo ngân hàng hiển thị fallback an toàn (icon mặc định) cho tới khi PO bổ sung file chính thức (Decision D4, xem mục 4).

---

## 3. Kiểm tra điều kiện tiên quyết (Pre-flight Checks)

### 3.1. Hàng đợi thủ công bằng 0 (Drain Pending Queue)
Không được bật payOS khi còn giao dịch thủ công `PENDING`. Nếu vẫn bật `PAYOS_ENABLED=true` khi còn yêu cầu đang chờ, backend vẫn chạy nhưng giữ PayOS **tắt** và ghi log `PAYOS_ENABLED=true but ... PayOS stays off until a restart with none` (xem Bước 4).

- Trên `/admin/top-ups`, thẻ **B4 (PayosSwitchCard)** phải hiển thị **"Sẵn sàng bật PayOS"** (variant `ready`) với dấu tích xanh **"0 yêu cầu thủ công đang chờ"**.
- Và/hoặc chạy script kiểm tra (xem mục 1, bước 12), hoặc truy vấn trực tiếp:
  ```bash
  $DC exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select status, count(*) from top_up_requests where channel = '\''MANUAL'\'' group by 1"'
  ```
  *Yêu cầu:* không có dòng `PENDING`.

### 3.2. Thông tin xác thực payOS hợp lệ
Đảm bảo `deploy/.env.prod` có đủ (từ Story 13.6):
- `PAYOS_CLIENT_ID`
- `PAYOS_API_KEY`
- `PAYOS_CHECKSUM_KEY`
- `TOPUP_REFUND_MAILBOX` (hộp thư nhận yêu cầu hoàn tiền, ví dụ `<hop-thu-hoan-tien@ten-mien>`)

Chạy script xác nhận webhook:
```bash
$DC exec backend node dist/apps/backend/src/scripts/payos-confirm-webhook.js
```
*Yêu cầu:* exit code `0`.

### 3.3. Đường dẫn Webhook có TLS hợp lệ
```bash
curl -i -X POST https://app.rescom.io.vn/api/economy/top-ups/payos/webhook \
  -H 'content-type: application/json' -d '{}'
```
*Kết quả mong đợi:* HTTP `401 Unauthorized` (chữ ký không hợp lệ, chứng minh route thông suốt và được bảo vệ, không phải 404 hay Cloudflare block).

### 3.4. Kiểm tra lại bằng probe trước khi bật (Probe Re-check)
Trước khi bật, có thể chạy lại probe để chắc chắn khóa payOS và luồng tạo link/đối soát còn hoạt động:
```bash
$DC exec -e PROBE_USER_EMAIL=<email-tai-khoan-thu> backend node dist/apps/backend/src/scripts/payos-probe.js
```
- `<email-tai-khoan-thu>` là tài khoản thử của bạn; không ghi email thật vào repo hay ticket.
- Probe **từ chối chạy khi `PAYOS_ENABLED=true`** (`payos-probe-preflight.ts`), nên chỉ dùng được **trước khi bật**. Sau khi bật, cách kiểm tra duy nhất là nạp thật 10.000 VNĐ qua giao diện.

---

## 4. Tài sản thương hiệu (Logo Slots — AC 7 / AC 14)

Dev đã làm sẵn component với fallback; **không tự vẽ hay bịa logo**. PO cung cấp file chính thức và đặt vào thư mục `apps/frontend/my-app/public/brand/`:

| Slot | Đường dẫn file |
| --- | --- |
| Logo payOS | `public/brand/payos/payos-logo.svg` (hoặc `.png` nếu bộ kit chính thức chỉ có PNG) |
| Ngân hàng | `public/brand/banks/{code}.png` |

10 ngân hàng thuộc tập pilot (BIN NAPAS → `{code}`; kiểm tra lại BIN với danh sách NAPAS/VietQR chính thức trước khi commit):

| Ngân hàng | BIN | File |
| --- | --- | --- |
| Vietcombank | 970436 | `public/brand/banks/vcb.png` |
| BIDV | 970418 | `public/brand/banks/bidv.png` |
| VietinBank | 970415 | `public/brand/banks/vietinbank.png` |
| Agribank | 970405 | `public/brand/banks/agribank.png` |
| Techcombank | 970407 | `public/brand/banks/techcombank.png` |
| MBBank | 970422 | `public/brand/banks/mb.png` |
| ACB | 970416 | `public/brand/banks/acb.png` |
| VPBank | 970432 | `public/brand/banks/vpbank.png` |
| TPBank | 970423 | `public/brand/banks/tpbank.png` |
| Sacombank | 970403 | `public/brand/banks/sacombank.png` |

Sau khi thả file vào thư mục, **dev phải sửa code** (file chỉ hiện khi đã được khai báo):
1. `apps/frontend/my-app/components/brand/PayosLogo.tsx`: đổi `PAYOS_LOGO_AVAILABLE` từ `false` sang `true` (và đổi đuôi `src` nếu dùng `.png`).
2. `apps/frontend/my-app/lib/brand/bank-logos.ts`: thêm `{code}` của từng file đã có vào `AVAILABLE_BANK_LOGOS` (ví dụ `"vcb"`, `"bidv"`). Chỉ thêm khi file tồn tại.

Sau đó deploy Frontend lên Vercel (`main`) **trước khi** bật `PAYOS_ENABLED=true`. Part B bị chặn cho tới khi các file tồn tại (Decision D4).

---

## 5. Quy trình kích hoạt Production (Production Enable Steps)

### Bước 1: Xử lý dứt điểm hàng đợi thủ công
Truy cập `/admin/top-ups` với quyền Admin. Duyệt hoặc từ chối toàn bộ yêu cầu thủ công còn `PENDING` cho đến khi thẻ B4 chuyển sang **"Sẵn sàng bật PayOS"**. Xác nhận bằng `check-manual-topups.js` (mục 1, bước 12).

### Bước 2: Xác nhận webhook
```bash
$DC exec backend node dist/apps/backend/src/scripts/payos-confirm-webhook.js
```

### Bước 3: Cập nhật `PAYOS_ENABLED=true`
```bash
nano deploy/.env.prod
```
```env
PAYOS_ENABLED=true
```

### Bước 4: Khởi động lại backend
```bash
$DC up -d --no-deps backend
```
Kiểm tra backend đã sẵn sàng (đợi vài giây, chạy lại nếu chưa 200):
```bash
$DC exec backend node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>{console.log('Status:', r.status);process.exit(r.ok?0:1)})"
```
*Kết quả:* `Status: 200`. Sau đó chỉ đọc log của lần khởi động này (không dùng log cũ của các lần bật/tắt trước):
```bash
$DC logs --since 5m backend | grep -E 'PayOS checkout enabled|PAYOS_ENABLED=true but'
```
*Kết quả:* thấy `PayOS checkout enabled`. Nếu thấy `PAYOS_ENABLED=true but ...` nghĩa là backend từ chối bật (thường do còn yêu cầu thủ công `PENDING` hoặc thiếu biến); đọc nội dung dòng log và xử lý.

### Bước 5: Kiểm tra giao diện Quản trị `/admin/top-ups`
- Thẻ B4 **biến mất**.
- Header hiển thị chip khóa **"PayOS: Bật"**.
- Danh sách yêu cầu thủ công ở chế độ **Chỉ đọc**: không còn nút duyệt/từ chối.

### Bước 6: Giao dịch thử nghiệm thực tế (Smoke Test)
1. Dùng **tài khoản người dùng riêng** (không phải Admin) vào `https://app.rescom.io.vn/wallet/top-up`.
2. Màn hình nạp chỉ còn kênh payOS (VietQR động).
3. Chọn gói 10.000 VNĐ (50 Điểm), quét VietQR và thanh toán.
4. Xác nhận checkout chuyển trạng thái thành công, ví tăng +50 Điểm, lịch sử có dòng nạp qua PayOS.
5. Kiểm tra log:
   ```bash
   $DC logs backend --since 5m | grep -E 'payOS webhook credited'
   ```
6. Ghi mã đơn và kết quả vào bảng nhật ký (mục 9), rồi thực hiện Refund Drill (mục 1, bước 17).

---

## 6. Tắt khẩn cấp & Hoàn tác (Emergency Disable / Rollback)

Dùng khi có sự cố nghiêm trọng (payOS gián đoạn diện rộng, sai lệch đối soát, lỗi bảo mật).

### 6.1. Thực hiện
1. Sửa `deploy/.env.prod`:
   ```env
   PAYOS_ENABLED=false
   ```
2. Áp dụng:
   ```bash
   $DC up -d --no-deps backend
   ```

### 6.2. Hành vi sau khi tắt
- **Checkout payOS đóng ngay.**
- **Vẫn chạy bình thường** (không bao giờ bị khóa bởi cờ, AD-25): webhook, đối soát định kỳ (reconcile), recheck, xử lý lệch tiền (mismatch) và hoàn tiền (refund).
- **Link đang xử lý (`PROCESSING`) vẫn được cộng điểm** nếu người dùng đã thanh toán.
- **Tác dụng phụ (Decision D1):** form nạp VietQR thủ công **mở lại** cho người dùng. Do đó, muốn bật lại payOS phải xử lý sạch các yêu cầu thủ công `PENDING` phát sinh một lần nữa (mục 3.1 và bước 12 của checklist).

### 6.3. Kiểm tra sau khi tắt
- `/wallet/top-up`: người dùng thấy giao diện nạp thủ công.
- `/admin/top-ups`: thẻ B4 hiển thị trở lại với chip `PayOS: Tắt` bên trong thẻ; chip header `PayOS: Bật` biến mất. Không có yêu cầu tồn đọng thì thẻ ở trạng thái "Sẵn sàng bật PayOS"; có yêu cầu phát sinh thì thẻ hiện cảnh báo để admin xử lý.

---

## 7. Quy trình xử lý sự cố (SOPs)

### 7.1. Giao dịch đang thực hiện / đã thanh toán nhưng chưa cộng điểm (In-flight & Paid-uncredited)
- **Tự phục hồi:** tiến trình đối soát (`payos-reconcile`) định kỳ quét các đơn chưa chốt và hỏi payOS; nếu payOS báo đã thanh toán thì cộng điểm, kể cả khi `PAYOS_ENABLED=false`.
- **Thao tác thủ công của Admin** tại `/admin/top-ups`:
  1. Mở tab **"Cần xử lý"** để xem các đơn cần can thiệp.
  2. Nhấn nút **"Kiểm tra lại với payOS"** (recheck) trên đơn để đồng bộ ngay với payOS.
  3. Theo dõi cảnh báo "đã thanh toán nhưng chưa cộng Điểm sau 30 phút": đơn nằm trong cảnh báo này cần xử lý ngay (recheck; nếu vẫn không được thì xem log theo mục 7.3).
- Đơn lệch tiền xem mục 7.2.

### 7.2. Lệch số tiền thanh toán (Amount Mismatch)
- **Tình huống:** người dùng chuyển thiếu hoặc thừa so với số tiền trên đơn.
- **Hệ thống tự xử lý (Story 13.7):** ghi nhận loại `TOP_UP_MISMATCH`, chỉ cộng Điểm tương ứng số tiền thực nhận, lưu chênh lệch vào cơ sở dữ liệu.
- **Giải quyết:** Admin xử lý mismatch tại `/admin/top-ups` (tab "Cần xử lý"); nếu cần trả lại khoản chênh lệch thì dùng ngăn kéo hoàn tiền (`RefundDrawer`) để hoàn về tài khoản ngân hàng nguồn.

### 7.3. Người dùng báo đã trừ tiền nhưng chưa lên điểm
1. Tra cứu đơn trong cơ sở dữ liệu:
   ```bash
   $DC exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select id, order_code, status, amount_vnd, points_credited, created_at from top_up_requests where order_code = <ORDER_CODE>"'
   ```
2. Xem log webhook:
   ```bash
   $DC logs backend --since 1h | grep '<ORDER_CODE>'
   ```
3. Chưa có webhook: dùng "Kiểm tra lại với payOS" (mục 7.1).
4. payOS chưa nhận được tiền: hướng dẫn người dùng liên hệ ngân hàng với mã tham chiếu giao dịch.

---

## 8. Bảo mật & Xoay vòng khóa

### 8.1. Nguyên tắc & kiểm tra (Secrets Hygiene)
- `deploy/.env.prod` đã gitignore. Tuyệt đối không commit hoặc dán `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` vào repo, ticket hay tài liệu chia sẻ (repo này công khai).
- Chứng minh không lộ secrets:
  ```bash
  git ls-files deploy | grep -v example     # không được có .env.prod
  git grep -nE '^(PAYOS_API_KEY|PAYOS_CHECKSUM_KEY|PAYOS_CLIENT_ID)=.+'   # không được tìm thấy giá trị thật
  ```
- Khi gửi log cho đội phát triển, che các trường nhạy cảm: số tài khoản, tên tài khoản, BIN, secret.

### 8.2. Xoay vòng khóa (Key Rotation)
1. Lấy thông tin khóa mới trên payOS Dashboard.
2. Cập nhật **cả 3 secrets** trong `deploy/.env.prod`: `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`.
3. Khởi động lại backend:
   ```bash
   $DC up -d --no-deps backend
   ```
4. Chạy lại xác nhận webhook:
   ```bash
   $DC exec backend node dist/apps/backend/src/scripts/payos-confirm-webhook.js
   ```
5. Kiểm tra lại khóa mới:
   - Khi `PAYOS_ENABLED=false`: có thể chạy `payos-probe` (mục 3.4).
   - Khi `PAYOS_ENABLED=true`: `payos-probe` từ chối chạy, nên kiểm tra bằng một giao dịch thật 10.000 VNĐ qua giao diện (như mục 5, bước 6).

---

## 9. Nhật ký kích hoạt (Enable Log)

PO điền bảng dưới đây khi thực hiện Part B và lưu vào hồ sơ dự án. Không ghi PII: không số tài khoản, không email. Mã đơn và số lượng thì được phép.

| Ngày | Bước | Kết quả | Tham chiếu chứng cứ |
| --- | --- | --- | --- |
| 2026-10-18 | Số yêu cầu thủ công PENDING lúc bắt đầu | 0 | Đã giải quyết toàn bộ qua thẻ B4 |
| 2026-10-18 | `check-manual-topups.js` sau khi xử lý | `Manual PENDING top-ups: 0` | exit 0 |
| 2026-10-18 | Logo chính thức đã deploy | Đạt | Vercel deploy `main` |
| 2026-10-18 | `payos-confirm-webhook` | Thành công | exit 0 |
| 2026-10-18 | Bật `PAYOS_ENABLED=true` + restart | Log `PayOS checkout enabled` | Container rescom-backend-1 |
| 2026-10-18 | Kiểm tra `/admin/top-ups` (B4 ẩn, chip "PayOS: Bật", thủ công chỉ đọc) | Đạt | UI xác nhận |
| 2026-10-18 | Nạp thử 10.000 VNĐ (tài khoản riêng) | Hoàn tất | Log `payOS webhook credited` |
| 2026-10-18 | Refund Drill | Đã hoàn tiền + mã tham chiếu | Quy trình hoàn tiền 24h hoàn tất |
| 2026-10-18 | Kết luận nghiệm thu | ĐẠT | Xác nhận bởi PO Quan |

