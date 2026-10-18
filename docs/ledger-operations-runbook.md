# Sổ tay vận hành sổ cái (Story 14.4)

Hướng dẫn Admin dùng tab **"Vận hành"** tại `/admin/transactions` → **Vận hành** để chạy các thao tác dự phòng của sổ cái, thay cho gọi API bằng `curl`. Chỉ Admin dùng được; người dùng khác nhận lỗi 403.

Nguyên tắc chung:

- Mọi thao tác ghi đều hiện hộp xác nhận nêu rõ tác động. Chỉ thao tác sau khi đã đọc.
- Các thao tác đều an toàn khi chạy lại: không bao giờ trả thưởng hai lần, không tạo bút toán mới ngoài những gì nêu bên dưới.
- Việc kiểm tra toàn vẹn chỉ chạy khi nhấn nút, không tự chạy khi mở tab.

---

## 1. Kiểm tra toàn vẹn sổ cái

- **Khi nào dùng:** sau sự cố (restart giữa chừng, lỗi ghi sổ), khi người dùng báo số dư không khớp lịch sử, hoặc định kỳ theo quy trình của đội.
- **Cách chạy:** nhấn **"Chạy kiểm tra"**. Chỉ đọc, không thay đổi dữ liệu.
- **Kết quả:**
  - Tổng số dư toàn hệ thống và cờ **tổng các bút toán bằng 0**. Sổ ghi kép đúng thì tổng luôn bằng 0.
  - Danh sách tài khoản có **số dư hiển thị khác tổng các bút toán** của nó (tối đa 100 tài khoản, sắp theo mã tài khoản). Mỗi dòng gồm chủ tài khoản (mã rút gọn như `#7F3A`, hoặc "Hệ thống"), loại số dư (Khả dụng, Chờ 48h, Ký quỹ…), số dư hiển thị và số dư tính từ bút toán.
  - Danh sách trống: "Không có tài khoản nào lệch số dư."
- **Khi tổng khác 0:** các bút toán đã không cân bằng. **Đối soát không sửa được lỗi này** (xem mục 2). Dừng thao tác ghi, báo đội kỹ thuật kiểm tra sổ cái trước khi làm gì tiếp.
- **Khi danh sách bị cắt ở 100:** đối soát các dòng đã hiện rồi chạy kiểm tra lại để xem tiếp.

## 2. Kiểm tra số dư / Đối soát một tài khoản

- **"Kiểm tra số dư"** (chỉ đọc): so sánh số dư hiển thị với tổng bút toán của đúng tài khoản đó và báo khớp hay lệch.
- **"Đối soát"** (ghi):
  - Tính lại số dư hiển thị bằng tổng các bút toán. **Không tạo bút toán mới.** Chỉ sửa số dư khi nó thực sự lệch.
  - Kết quả hiện dạng `số dư cũ → số dư đã sửa`.
  - Sau khi đối soát thành công, hệ thống tự chạy lại kiểm tra toàn vẹn một lần để cập nhật danh sách.
  - Chạy lại trên tài khoản đã khớp thì không đổi gì.
- **Giới hạn:** đối soát chỉ sửa số dư hiển thị. Nếu bút toán sai thì phải xử lý bằng bút toán đảo ngược (ngoài phạm vi sổ tay này).

## 3. Chạy lại trả thưởng

- **Khi nào dùng:** một bài trả lời nội bộ (Internal) hoặc một lượt làm Google Forms (External) đã đủ điều kiện nhưng người làm chưa nhận thưởng (ví dụ lần trả thưởng trước bị lỗi giữa chừng).
- **Cách chạy:** chọn loại mã (**Bài trả lời (Internal)** hoặc **Lượt làm (External)**), nhập mã dạng UUID, nhấn **"Chạy lại"** rồi xác nhận. Mã sai định dạng bị chặn ngay trên form, không gửi đi.
- **Hệ thống làm gì:** nếu chưa có khoản thưởng thì trả từ **Ký quỹ của khảo sát**; nếu đã có thì chỉ trả về kết quả cũ. Không trả hai lần. Số Điểm và người nhận do máy chủ tự xác định, Admin chỉ cung cấp mã.
- **Kết quả:** trạng thái (Đã cộng vào Khả dụng · Đang chờ 48 giờ · Đang tạm giữ kiểm tra · Bỏ qua — lượt làm của khách), số Điểm, tài khoản nhận, mã bút toán, thời điểm. "Chưa có kết quả trả thưởng." nghĩa là chưa có kết quả để trả về cho lượt làm External này.
- **Lỗi thường gặp:** không tìm thấy mã; mục chưa đủ điều kiện (chưa nộp / chưa hoàn thành); Ký quỹ của khảo sát không đủ; một thao tác khác trên sổ cái đang chạy (thử lại sau vài giây).

## 4. Giải phóng Điểm chờ đã đủ 48 giờ

- **Khi nào dùng:** các khoản thưởng nằm ở **Chờ 48h** quá 48 giờ nhưng chưa sang **Khả dụng**, ví dụ khi tiến trình định kỳ `pending-release` chưa chạy hoặc bị lỡ. Tiến trình này quét cùng một danh sách; chỉ lần chạy từ tab này mới được ghi nhật ký kiểm toán.
- **Cách chạy:** nhập giới hạn tuỳ chọn (số nguyên từ 1 đến 500, để trống = tối đa 100), nhấn **"Giải phóng"** rồi xác nhận. Giới hạn sai bị chặn ngay trên form.
- **Hệ thống làm gì:** chuyển tối đa số khoản đó sang Khả dụng. Khoản đang bị khiếu nại được giữ lại.
- **Kết quả:** đã xử lý, đã giải phóng, đang khiếu nại (giữ lại), lỗi, mốc 48 giờ, và còn khoản chưa xử lý hay không.
- **"Chạy tiếp":** khi còn khoản chưa xử lý, nhấn **"Chạy tiếp"** để chạy lô kế với cùng giới hạn; lô này cũng cần xác nhận. Nếu báo "Không tiếp tục được lượt trước", chạy lại từ đầu bằng **"Giải phóng"**.

---

## 5. Nhật ký kiểm toán

Mỗi thao tác ghi thành công tạo một dòng trong nhật ký, xem tại `/admin/audit-log`:

| Thao tác | Hành động trong nhật ký | Nhãn |
|---|---|---|
| Đối soát | `LEDGER_ACCOUNT_RECONCILED` | Đối soát tài khoản sổ cái |
| Chạy lại trả thưởng | `REWARD_REDRIVEN` | Chạy lại trả thưởng |
| Giải phóng / Chạy tiếp | `PENDING_REWARDS_RELEASED` | Giải phóng Điểm chờ 48 giờ |

Người thực hiện là Admin đang đăng nhập. Thao tác bị từ chối (lỗi) không ghi dòng nào. Chi tiết ghi kèm: mã tài khoản và số dư trước/sau (đối soát); loại, mã, trạng thái và số Điểm (chạy lại trả thưởng); giới hạn và các số đếm của lô (giải phóng). Không ghi thông tin cá nhân.

**Lưu ý:** dòng nhật ký được ghi sau khi thao tác đã hoàn tất, không nằm cùng giao dịch. Nếu việc ghi nhật ký lỗi, màn hình báo lỗi dù thao tác đã được thực hiện. Vì mọi thao tác đều an toàn khi chạy lại, hãy chạy lại thao tác đó; lần chạy lại sẽ ghi nhật ký.

## 6. Liên quan

- Màn hình: `/admin/transactions` → **Vận hành**.
- Sự cố nạp tiền payOS: [Sổ tay vận hành payOS Production](payos-production-runbook.md), mục 7.
