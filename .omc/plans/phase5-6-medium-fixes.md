# Plan — sửa lỗi MEDIUM Phase 5–6 (2026-09-27)

Đã đối chiếu với working tree hiện tại (sau đợt sửa HIGH): 24 CONFIRMED, 1 PARTIAL (C3). Chưa sửa gì.
Mỗi mục: lỗi → cách sửa. [Q#] = cần bạn quyết định (phương án đề xuất ghi trước).

## WP1 · Quản lý khảo sát & kết quả (Phase 5) + backend forms
| ID | Lỗi | Cách sửa |
|---|---|---|
| M1 | Hộp thoại đóng ghi "hoàn 0 điểm" với backend thật (escrowLocked mặc định 0) | escrowLocked nullable; null → "Đóng & hoàn điểm" không kèm số. Backend thêm escrowLocked vào detail DTO (WP1-BE) |
| M2 | Danh sách không bao giờ hiện "Mở lại"/"Đủ mẫu" (summary DTO thiếu closeKind, completedCompletions) | [Q1] (a) Backend thêm closeKind, completedCompletions, escrowLocked vào FormSummaryDto (schema + forms.service + repository + test) và FE dùng; tạm thời CLOSED + closeKind null vẫn hiện "Mở lại" để trang reopen tự kiểm tra |
| M3 | Nút Tạm dừng/Tiếp tục luôn lỗi (backend không có route) | [Q2] (a) Ẩn nút sau cờ `PAUSE_SUPPORTED=false` |
| M4 | Xuất file tách cột mất câu trả lời "Khác" | Thêm cột "[Khác]" cho câu có allowOther |
| M5 | Ảnh bằng chứng khiếu nại không được gửi | [Q3] (a) Bỏ ô tải ảnh cho tới khi có contract |
| M6 | Danh sách chỉ lấy 100 khảo sát, số liệu thiếu | Tải hết các trang (có giới hạn) |
| M7 | Không rút lại được khảo sát đang chờ duyệt / bản nháp v2 đang giữ ký quỹ (backend cho phép) | [Q4] (a) Thêm "Rút lại & hoàn điểm" cho Chờ duyệt và bản nháp v>1; mock chỉ 409 khi chưa có phiên bản nào được đăng |

## WP2 · Tạo khảo sát / Form Builder (Phase 5)
| ID | Lỗi | Cách sửa |
|---|---|---|
| C1 | Cho đặt thời lượng >30 phút, backend 422 chỉ báo "thử lại" | Giới hạn MAX_PUBLISHABLE_DURATION_MINUTES + checkSurveyFitsReservationWindow khi validate; map mã lỗi; mock kiểm tra |
| C2 | "Giá gợi ý" hiện khung đã giảm (8–16) nhưng ô nhập kiểm tra khung gốc (10–20) | [Q5] (a) Gợi ý = khung thưởng người làm nhận (10–20) + dòng "bạn trả 8–16" |
| C3 | 5 mã lỗi khi đăng chưa có câu thông báo; điểm thưởng sửa được ở bản v>1 (backend cấm) | Map 5 mã; khoá ô điểm thưởng khi là phiên bản mới |
| C4 | "Tiếp tục" ở Xem trước bỏ qua kiểm tra và bản chưa lưu | Quay về builder `?continue=1` (chạy validate + lưu) rồi mới sang đăng |
| C5 | AI lỗi → mỗi lần thử lại tạo thêm bản nháp rỗng, báo sai lỗi | Chuyển ngay sang `/forms/:id/builder/ai` sau khi tạo; lỗi AI báo là lỗi AI |
| C6 | Mất mạng lúc tạo khảo sát Google Forms → có thể khoá ký quỹ 2 lần | [Q6] (a) Backend nhận header Idempotency-Key cho POST /forms/external; FE lưu 1 key cho mỗi bản nháp wizard (phần backend nằm ở WP1) |
| P2 | Đăng được câu hỏi còn tiêu đề mặc định "Câu hỏi chưa có tiêu đề" | Khi đăng: chặn tiêu đề mặc định/rỗng, chỉ rõ câu nào |

## WP3 · Admin (Phase 6)
| ID | Lỗi | Cách sửa |
|---|---|---|
| A1 | Bấm Esc lúc đang xử lý → hộp thoại "biến mất", lỗi bị mất, nút như chết (5 hộp thoại) | Dialog thêm prop `dismissible`; truyền `!busy` ở 5 hộp thoại |
| A2 | Ô tìm người dùng hứa "tên, mã #" nhưng backend chỉ tìm email | [Q7] (a) Sửa placeholder "Tìm theo email", mock chỉ tìm email |
| A3 | Panel người dùng ghi "không có FraudLog / chưa có hồ sơ" khi chỉ là thiếu dữ liệu | undefined → "—"/ẩn mục |
| A4 | Link từ Tổng quan/khiếu nại không mở đúng mục | Đọc `?id=` ở disputes và top-ups; RespondentCard dùng `?id=` |
| A5 | Panel người dùng có thể trộn dữ liệu 2 người | Chỉ gộp khi cùng id |
| A6 | "Tải thêm" giao dịch lặp dòng; mốc "Hôm nay" đổi giữa các trang | Cố định from/to lúc tải trang đầu, bỏ trùng theo id, contract dạng cursor |
| B1 | Chấp nhận khiếu nại: mock hoàn vào ký quỹ, backend hoàn vào Khả dụng | [Q8] (a) Theo backend: hoàn vào Khả dụng của người đăng, sửa câu chữ |
| B2 | Hoàn điểm khi người làm không có điểm đang giữ → sinh điểm từ không khí | Từ chối 409 trước khi thay đổi gì |
| P3 | Tổng ký quỹ admin: 1.994 (Tổng quan) ≠ 240 (Giao dịch) | Một hàm `mockEscrowTotal()` dùng chung |

## Cách làm
3 agent song song theo WP (file không chồng nhau; chỉ WP3 sửa `components/ui/Dialog.tsx`; phần backend M1/M2/C6 ở WP1).
Sau đó: tsc, eslint, `npm test`, jest backend (forms + schemas), review riêng, kiểm tra trình duyệt. Không commit.

## Follow-up (để đợt sau, user duyệt commit trước — 2026-09-27)
Từ review backend sau khi tính ký quỹ theo lô:
1. GET /forms tải mọi payout journal của trang (≈100k key với trang 100 khảo sát × 500 lượt) → cộng tổng bằng SQL (SUM theo form) hoặc lưu form_id trên ledger journal.
2. `OR startsWith` không dùng được unique index idempotency_key → index `text_pattern_ops` hoặc lọc theo form_id.
3. close/reopen: đọc thêm sau khi commit lỗi → 500 giả; bọc try/catch, trả escrowLocked null.
4. Test Postgres đối chiếu getHeldEscrowByForm == getFundingPosition (có reopen + reversal).
LOW: FormCreationKeyTakenException chưa map (500); đổi secret HMAC → SURVEY_CHANGED sai lý do; mã hoàn thành lặp lại khi xoá nháp rồi tạo lại cùng key (thêm formId vào seed); đếm completions 2 lần/list; comment DTO lỗi thời; canonicalJson bỏ Date.
