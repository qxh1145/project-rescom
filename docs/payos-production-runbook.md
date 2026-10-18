# Sổ tay vận hành payOS Production (Story 13.13)

Tài liệu hướng dẫn Product Owner (PO) và đội ngũ vận hành thực hiện chuyển đổi an toàn (cutover) từ nạp tiền thủ công (Manual Top-Up) sang cổng thanh toán tự động payOS trên môi trường Production, quy trình xử lý sự cố (SOP) và kích hoạt công tắc khẩn cấp (kill-switch).

---

## 1. Tổng quan kiến trúc & Nguyên tắc cốt lõi

- **Cấu hình độc quyền qua biến môi trường:** Cờ tính năng `PAYOS_ENABLED` chỉ được thiết lập tại file cấu hình server (`.env.prod`), không có API hoặc nút toggle trên giao diện người dùng (bảo vệ theo Decision D2).
- **Quy trình hai giai đoạn (Part A & Part B):**
  - **Part A (Dev Agent):** Đã hoàn tất toàn bộ mã nguồn, kiểm thử, component B4 switch card, chế độ read-only cho console duyệt điểm, và sổ tay vận hành.
  - **Part B (PO / DevOps):** Thực hiện quy trình kích hoạt production theo tài liệu này và kiểm tra nghiệm thu thực tế.
- **Mã nguồn thủ công được lưu giữ:** Logic nạp tiền thủ công vẫn được giữ trong backend nhằm phục vụ tra cứu lịch sử và làm phương án dự phòng khẩn cấp (Decision D1).
- **Tài sản thương hiệu (Brand Assets):** Logo payOS và logo các ngân hàng NAPAS hiển thị fallback an toàn (icon mặc định) và sẽ được PO bổ sung file vector SVG chính thức vào thư mục `public/brand/payos/` và `public/brand/banks/` (Decision D4).

---

## 2. Checklist nghiệm thu Production của Product Owner (Part B — AC 11–17)

Bảng kiểm này dành riêng cho Product Owner (PO) và DevOps khi thực thi trên môi trường Production. Story 13.13 chỉ chuyển sang `done` sau khi hoàn tất đầy đủ các mục dưới đây và đính kèm chứng cứ:

- [ ] **11. Gate câu hỏi PRD (AC 11):** Xác nhận PRD Open Question 27 đã được trả lời và ghi nhận vào `prd.md` (dòng 1256) kèm ngày tháng và xác nhận của Owner.
- [ ] **12. Xử lý tồn đọng thủ công (AC 12):**
  - [ ] Part A đã deploy (Frontend trên Vercel `main`, Backend trên VPS) với `PAYOS_ENABLED=false`.
  - [ ] Admin giải quyết toàn bộ các yêu cầu nạp tiền `PENDING` thủ công qua thẻ B4 (`PayosSwitchCard`).
  - [ ] Người dùng nhận được thông báo in-app/email tương ứng (`TOPUP_SUCCESS` / `TOPUP_REJECTED`).
  - [ ] Chạy lệnh kiểm tra hàng đợi thủ công:
    ```bash
    $DC exec -w /app/apps/backend backend node check-manual-topups.js
    ```
    *Yêu cầu:* In ra `Manual PENDING top-ups: 0` và kết thúc với mã `exit 0`.
- [ ] **13. Kiểm tra biến môi trường & Bảo mật secrets (AC 13):**
  - [ ] Đủ 4 biến trong `deploy/.env.prod`: `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`, `TOPUP_REFUND_MAILBOX`.
  - [ ] Lệnh kiểm tra sự tồn tại của 4 khóa (không in giá trị bí mật):
    ```bash
    grep -cE '^(PAYOS_CLIENT_ID|PAYOS_API_KEY|PAYOS_CHECKSUM_KEY|TOPUP_REFUND_MAILBOX)=.+' deploy/.env.prod
    ```
    *Yêu cầu:* In ra đúng số `4`.
  - [ ] Kiểm tra secrets không bị commit vào git repository:
    ```bash
    git ls-files deploy | grep -v example  # không được chứa .env.prod
    git grep -nE '^(PAYOS_API_KEY|PAYOS_CHECKSUM_KEY|PAYOS_CLIENT_ID)=.+' # không tìm thấy giá trị thật
    ```
- [ ] **14. Tài sản thương hiệu chính thức (AC 14):**
  - [ ] PO cung cấp file vector SVG chính thức cho logo payOS: `public/brand/payos/payos-logo.svg`.
  - [ ] PO cung cấp logo ngân hàng NAPAS: `public/brand/banks/{code}.png` (hoặc `.svg`).
  - [ ] Triển khai lên Vercel production trước khi kích hoạt `PAYOS_ENABLED=true`.
- [ ] **15. Kích hoạt payOS Production (AC 15):**
  - [ ] Chạy `$DC exec backend node dist/apps/backend/src/scripts/payos-confirm-webhook.js` thành công (`exit 0`).
  - [ ] Đặt `PAYOS_ENABLED=true` trong `deploy/.env.prod` và chạy `$DC up -d --no-deps backend`.
  - [ ] Log backend hiển thị: `PayOS checkout enabled`.
  - [ ] Mở `/admin/top-ups`: Thẻ B4 biến mất, header hiển thị chip khóa "PayOS: Bật".
  - [ ] Trang `/wallet/top-up` chỉ hiển thị giao diện nạp payOS; gọi `POST /economy/top-ups` trả về lỗi HTTP `404`.
- [ ] **16. Giao dịch thử nghiệm thực tế (AC 16):**
  - [ ] Dùng một **tài khoản người dùng riêng biệt** (không dùng tài khoản Admin do quy tắc `TOPUP_SELF_REVIEW_FORBIDDEN`).
  - [ ] Nạp thử 10.000 VNĐ qua VietQR payOS trên giao diện web.
  - [ ] Webhook payOS kích hoạt và cộng 50 Điểm ngay lập tức vào ví.
  - [ ] Ghi lại mã đơn hàng (`orderCode`) và dòng log `payOS webhook credited`.
- [ ] **17. Diễn tập quy trình hoàn tiền (Refund Drill - AC 17):**
  - [ ] Người dùng thử nghiệm gửi yêu cầu hoàn tiền cho đơn nạp trên trong vòng 24 giờ qua giao diện.
  - [ ] Hệ thống tự động đặt trạng thái giữ chờ hoàn tiền (Refund Hold).
  - [ ] Admin mở ngăn kéo hoàn tiền B2 (`/admin/top-ups`) và nhấn "Đánh dấu Đã hoàn tiền".
  - [ ] Owner thực hiện lệnh chuyển khoản ngân hàng hoàn 10.000 VNĐ về tài khoản người dùng, sau đó nhập mã tham chiếu ngân hàng ("Thêm mã chuyển khoản").
  - [ ] Người dùng nhận trạng thái `Đã hoàn tiền` kèm mã tham chiếu giao dịch.
  - [ ] Ghi nhận biên bản hoàn tất (không lưu trữ số tài khoản ngân hàng).

---

## 3. Kiểm tra điều kiện tiên quyết (Pre-flight Checks)

Trước khi thực hiện kích hoạt trên VPS Production, PO/DevOps cần kiểm tra các điều kiện sau:

### 3.1. Hàng đợi thủ công bằng 0 (Drain Pending Queue)
Không được kích hoạt payOS khi còn giao dịch thủ công đang chờ duyệt (`PENDING`).
Kiểm tra trên giao diện `/admin/top-ups`:
- Thẻ chuyển đổi **B4 (PayosSwitchCard)** phải hiển thị trạng thái **"Sẵn sàng bàn giao"** (Variant `ready`) với mascot Cheer và dấu tích xanh "0 yêu cầu chuyển khoản chờ duyệt".
- Hoặc kiểm tra trực tiếp qua câu lệnh SQL trên VPS:
  ```bash
  $DC exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
    "SELECT COUNT(*) AS pending_manual FROM \"TopUpRequest\" WHERE status = 'PENDING' AND method = 'MANUAL';"
  ```
  *Kết quả bắt buộc phải là `pending_manual = 0`.*

### 3.2. Thông tin xác thực payOS hợp lệ (Credentials Validation)
Đảm bảo các biến môi trường trong `.env.prod` đã được cấu hình đầy đủ từ Story 13.6:
- `PAYOS_CLIENT_ID`
- `PAYOS_API_KEY`
- `PAYOS_CHECKSUM_KEY`
- `TOPUP_REFUND_MAILBOX` (ví dụ: `trananhquan1104.work@gmail.com`)

Chạy script kiểm tra kết nối và webhook xác thực:
```bash
cd /opt/rescom/deploy
DC="docker compose -f docker-compose.hostinger.yml --env-file .env.prod"
$DC exec backend node dist/apps/backend/src/scripts/payos-confirm-webhook.js
```
*Yêu cầu:* Lệnh kết thúc với exit code `0`, hiển thị đúng tên tài khoản và 4 số cuối tài khoản nhận tiền.

### 3.3. Đường dẫn Webhook có TLS hợp lệ
Đảm bảo URL webhook công khai có thể tiếp nhận request từ payOS:
```bash
curl -i -X POST https://app.rescom.io.vn/api/economy/top-ups/payos/webhook \
  -H 'content-type: application/json' -d '{}'
```
*Kết quả mong đợi:* HTTP `401 Unauthorized` (chữ ký không hợp lệ, chứng minh route thông suốt và được bảo vệ, không phải 404 hay 403 Cloudflare block).

---

## 4. Quy trình kích hoạt Production (Production Enable Steps)

Thực hiện tuần tự các bước sau:

### Bước 1: Xử lý dứt điểm hàng đợi thủ công (Duyệt hoặc từ chối)
Truy cập `/admin/top-ups` với quyền Admin. Duyệt (Approve) hoặc từ chối (Reject) toàn bộ các yêu cầu nạp tiền thủ công còn tồn đọng cho đến khi thẻ B4 chuyển sang variant **"Sẵn sàng bàn giao"**.

### Bước 2: Cập nhật biến môi trường `PAYOS_ENABLED=true`
Mở file cấu hình production trên VPS:
```bash
cd /opt/rescom/deploy
nano .env.prod
```
Tìm dòng `PAYOS_ENABLED` và đổi giá trị:
```env
PAYOS_ENABLED=true
```
Lưu file (`Ctrl + O`, `Enter`, `Ctrl + X`).

### Bước 3: Khởi động lại service backend
Áp dụng cấu hình mới mà không làm gián đoạn các service khác:
```bash
$DC up -d --no-deps backend
$DC logs --tail 50 backend
```
Kiểm tra backend đã sẵn sàng:
```bash
$DC exec backend node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>{console.log('Status:', r.status);process.exit(r.ok?0:1)})"
```
*Kết quả:* `Status: 200`.

### Bước 4: Kiểm tra giao diện Quản trị `/admin/top-ups`
1. Tải lại trang `/admin/top-ups`.
2. Quan sát:
   - Thẻ chuyển đổi B4 (`PayosSwitchCard`) **hoàn toàn biến mất**.
   - Header hiển thị chip trạng thái khóa: **"PayOS: Bật"** kèm icon ổ khóa (`Icon name="lock"`).
   - Danh sách yêu cầu chuyển khoản thủ công chuyển sang chế độ **Chỉ đọc (Read-only)**: các nút Duyệt/Từ chối bị ẩn, modal xem chi tiết không hiển thị thao tác duyệt.

### Bước 5: Thực hiện giao dịch thử nghiệm thực tế (Smoke Test)
1. Sử dụng tài khoản người dùng thực tế đăng nhập vào `https://app.rescom.io.vn/wallet/top-up`.
2. Kiểm tra màn hình nạp tiền:
   - Kênh nạp hiển thị mặc định qua **payOS** (tích hợp mã VietQR động, không còn hướng dẫn nạp thủ công).
3. Chọn gói nạp tối thiểu (ví dụ: 10.000 VNĐ tương ứng 50 Điểm).
4. Tiến hành quét mã VietQR và thanh toán 10.000 VNĐ từ ứng dụng ngân hàng.
5. Xác nhận:
   - Màn hình checkout tự động chuyển trạng thái thành công trong vòng vài giây sau khi chuyển khoản.
   - Số dư ví người dùng tăng ngay lập tức (+50 Điểm).
   - Bảng lịch sử giao dịch ghi nhận dòng `Nạp Điểm qua PayOS` với tone màu xanh (`TOP_UP_PAYOS`).
   - Kiểm tra log backend:
     ```bash
     $DC logs backend --since 5m | grep -E 'payOS webhook credited'
     ```

---

## 5. Kế hoạch hoàn tác & Công tắc khẩn cấp (Rollback & Kill-Switch)

Nếu phát hiện sự cố nghiêm trọng (ví dụ: lỗi gián đoạn dịch vụ payOS diện rộng, sai sót đối soát, hoặc lỗi bảo mật), thực hiện quy trình hạ cờ khẩn cấp:

### 5.1. Kích hoạt Rollback
1. Truy cập VPS và chỉnh sửa `.env.prod`:
   ```bash
   cd /opt/rescom/deploy
   nano .env.prod
   ```
   Đặt lại:
   ```env
   PAYOS_ENABLED=false
   ```
2. Khởi động lại service backend:
   ```bash
   $DC up -d --no-deps backend
   ```

### 5.2. Kiểm tra sau khi Rollback
- Màn hình `/wallet/top-up` của người dùng: Route tạo đơn payOS sẽ trả về `404 PAYOS_CHECKOUT_DISABLED` hoặc giao diện người dùng chuyển về phương thức thủ công (tùy cấu hình feature flag).
- Trang `/admin/top-ups`:
  - Thẻ B4 chuyển đổi hiển thị trở lại.
  - Chip trạng thái trên header hiển thị `PayOS: Tắt`.
  - Nếu không có yêu cầu tồn đọng, thẻ hiển thị mascot Cheer "Sẵn sàng bàn giao". Nếu có yêu cầu phát sinh, thẻ hiển thị danh sách cảnh báo amber để admin xử lý tiếp.

---

## 6. Quy trình xử lý sự cố & Tình huống đặc biệt (SOPs)

### 6.1. Giao dịch đang thực hiện trong lúc chuyển đổi (In-flight Payments)
- **Tình huống:** Người dùng đã quét mã thanh toán payOS ngay trước thời điểm tắt flag, hoặc tiền ngân hàng đã trừ nhưng webhook bị trễ trong lúc backend restart.
- **Cơ chế tự phục hồi:**
  - Định kỳ mỗi 5 phút, tiến trình cron `payos-reconcile` tự động quét các đơn nạp tiền ở trạng thái `PENDING` và gọi API payOS để đối soát.
  - Nếu payOS báo trạng thái `PAID`, hệ thống sẽ tự động cộng điểm (`TOP_UP_PAYOS`) vào ví người dùng ngay cả khi `PAYOS_ENABLED=false`.
- **Thao tác thủ công khẩn cấp:** Người dùng hoặc Admin có thể nhấn nút **"Kiểm tra lại giao dịch"** (`POST /economy/top-ups/payos/{id}/recheck`) trên trang chi tiết đơn nạp để đồng bộ ngay lập tức.

### 6.2. Lệch số tiền thanh toán (Amount Mismatch SOP)
- **Tình huống:** Người dùng chuyển thiếu hoặc thừa tiền so với số tiền trên đơn nạp (ví dụ đơn 100.000 VNĐ nhưng chuyển 50.000 VNĐ hoặc 120.000 VNĐ).
- **Hệ thống xử lý tự động (Story 13.7):**
  - Giao dịch được ghi nhận với loại `TOP_UP_MISMATCH`.
  - Hệ thống chỉ cộng số Điểm tương ứng với số tiền thực nhận vào tài khoản người dùng.
  - Ghi nhận thông tin chênh lệch vào cơ sở dữ liệu.
- **Xử lý hoàn tiền:** Admin sử dụng ngăn kéo hoàn tiền (`RefundDrawer`) tại `/admin/top-ups` để hoàn trả khoản chênh lệch về tài khoản ngân hàng nguồn của người dùng nếu có khiếu nại.

### 6.3. Xử lý yêu cầu nạp tiền không nhận được điểm (Uncredited Top-Up)
Khi người dùng báo đã trừ tiền ngân hàng nhưng tài khoản chưa lên điểm sau 15 phút:
1. Tra cứu mã đơn hàng (`orderCode` hoặc `topUpId`) trong cơ sở dữ liệu:
   ```bash
   $DC exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
     "SELECT id, \"orderCode\", status, amount, \"pointsCredited\", \"createdAt\" FROM \"TopUpRequest\" WHERE \"orderCode\" = <ORDER_CODE>;"
   ```
2. Kiểm tra log webhook tương ứng:
   ```bash
   $DC logs backend --since 1h | grep '<ORDER_CODE>'
   ```
3. Nếu webhook chưa tới: gọi endpoint recheck thủ công hoặc hướng dẫn người dùng nhấn "Kiểm tra lại" tại giao diện trang nạp.
4. Nếu payOS chưa nhận được tiền: hướng dẫn người dùng liên hệ ngân hàng với mã tham chiếu giao dịch (FT Code).

---

## 7. Quản trị thông tin bảo mật & Thay đổi khóa (Secrets Hygiene & Key Rotation)

### 7.1. Nguyên tắc bảo mật
- Tuyệt đối không commit file `.env.prod` hoặc ghi `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` vào git repo, ticket trao đổi, hay tài liệu chia sẻ.
- Trong mọi trích xuất log gửi cho đội ngũ phát triển, bắt buộc phải che các trường nhạy cảm: `accountNumber`, `accountName`, `bin`, `webhook_secret`.

### 7.2. Quy trình xoay vòng khóa (Key Rotation)
Khi cần đổi API Key hoặc Checksum Key trên cổng payOS:
1. Đăng nhập payOS Dashboard, tạo cặp khóa mới hoặc lấy thông tin khóa cập nhật.
2. Chỉnh sửa `.env.prod` trên VPS với cặp khóa mới.
3. Cập nhật `PAYOS_CHECKSUM_KEY` và `PAYOS_API_KEY`.
4. Khởi động lại service backend:
   ```bash
   $DC up -d --no-deps backend
   ```
5. Chạy script xác nhận webhook để đảm bảo khóa mới hoạt động thông suốt:
   ```bash
   $DC exec backend node dist/apps/backend/src/scripts/payos-confirm-webhook.js
   ```

---

## 8. Mẫu biên bản nghiệm thu kích hoạt (Enable Log Template)

Sau khi hoàn tất kích hoạt trên Production, PO lập biên bản nghiệm thu theo mẫu dưới đây và lưu trữ vào hồ sơ dự án:

```markdown
# Biên bản kích hoạt payOS Production (Story 13.13 - Part B)

- **Thời gian thực hiện:** [YYYY-MM-DD HH:mm:ss]
- **Người thực hiện (Operator):** [Họ và tên / Vai trò]
- **Môi trường:** Production (https://app.rescom.io.vn)
- **Số lượng yêu cầu thủ công tồn đọng trước khi bật:** [0]
- **Mã đơn hàng giao dịch thử nghiệm (Smoke Test Order Code):** [ORDER_CODE]
- **Số tiền thử nghiệm:** 10.000 VNĐ (50 Điểm)
- **Thời gian điểm vào ví:** [Ngay lập tức qua Webhook / ... giây]
- **Kiểm tra giao diện Admin (/admin/top-ups):**
  - [x] Thẻ B4 PayosSwitchCard đã ẩn hoàn toàn.
  - [x] Header hiển thị chip "PayOS: Bật" (có khóa).
  - [x] Bảng duyệt thủ công ở chế độ chỉ đọc (Read-only).
- **Kiểm tra giao diện Người dùng (/wallet/top-up):**
  - [x] Tạo đơn nạp payOS thành công với VietQR.
  - [x] Giao dịch nạp tiền thành công và cộng đúng điểm.
- **Bổ sung tài sản thương hiệu (Brand Assets):**
  - [ ] Đã đưa logo chính thức SVG vào public/brand/payos/ và public/brand/banks/
- **Kết luận:** [ĐẠT NGHIỆM THU / YÊU CẦU ĐIỀU CHỈNH]
- **Chữ ký xác nhận PO:** [Đã ký / Xác nhận qua email]
```
