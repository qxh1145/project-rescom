# Figma screen inventory

File `mkudD5Ngi5RPyIAVxCcxXi` ("Rescom – Design System & Screens"). The MCP page list only
shows Cover; screen pages are reachable by id `55:3`–`55:21` (`55:2` is a divider).
Frame ids below are what to pass to `get_design_context`. D = desktop 1440, M = mobile 390.

| Page | Name | Frames | Status |
|---|---|---|---|
| 55:3 | 1 · Đăng nhập / Đăng ký | 62:106 D, 62:427 M | Done (`/login`) |
| 55:4 | 2 · Onboarding một trang (cũ) | 62:470 D, 62:903 M-err, 62:1377 M | **Superseded by page 12** — skip |
| 55:5 | 3 · Khám phá (Marketplace) | 62:582 D, 62:1250 M, 62:848 M-empty | Phase 3 |
| 55:6 | 4 · Làm khảo sát trong RESCOM | 62:158 D, 62:732 M, 62:1019 M-submit-fail | Phase 3 |
| 55:7 | 5 · Google Forms + mã hoàn thành | 62:2 D, 62:359 M, 62:784 wrong code, 62:67 locked | Phase 3 |
| 55:8 | 6 · Hoàn thành & đánh giá | 62:1761 D, 62:2047 M | Phase 3 |
| 55:9 | 7 · Ví điểm | 62:225 D, 62:1052 M | Phase 4 |
| 55:10 | 8 · Trạng thái component & token | 62:1477 | Token/state reference (Phase 0) |
| 55:11 | 9 · Người đăng – tạo khảo sát Google Forms | 63:2400 chọn cách tạo M; 62:3679/62:4017 bước 1; 63:266/63:1161 bước 2; 63:1768/63:1991 bước 3; 63:2147 không đủ điểm; 62:2708/62:3015 đã gửi duyệt | Phase 5 |
| 55:12 | 10 · Người đăng – quản lý & theo dõi | 63:127/63:1300 khảo sát của tôi; 62:2565/62:3292 theo dõi; 63:1392/63:1843 mở lại; 62:1720 khiếu nại M; 63:3709/63:4534 câu trả lời; 63:2033 chi tiết M; 62:3771/62:3932 xuất file | Phase 5 |
| 55:13 | 11 · Admin (desktop only) | 62:4070 tổng quan; 62:3406 duyệt KS; 62:2868 từ chối KS; 63:369 duyệt nạp; 62:1609 khiếu nại; 63:2212 người dùng; 62:2195 FraudLog; 63:1629 giao dịch | Phase 6 |
| 55:14 | 12 · Onboarding mới (1 câu / màn) | 63:5069/63:5185 chào mừng; 12.1 63:2366/63:2449 tên; 12.2 62:1212/62:1585 năm sinh; 12.3 62:2521/62:2838 giới tính; 12.4 63:3622/63:4038 tỉnh; 12.5 63:3013/63:3077 nghề; 12.6 63:4484/63:4829 trường; 12.7 63:5892/63:6069 năm học; 12.8 63:1917/63:2105 ngành; 12.9 62:3825/62:3983 thu nhập; 12.10 63:50/63:1565/63:1097 sở thích; 12.11 62:3097/62:3519 mục tiêu; 62:1927/62:1998 hoàn tất | Phase 2 |
| 55:15 | 13 · Form Builder kéo thả | 63:4221 trống D; 72:78 đang kéo D; 62:3204 AI chat D; 62:2333 AI chat + nháp D; 63:690 nháp AI D; 63:4901 xem trước D; 62:3562 AI M; 62:2904 chat M; 63:1229 thêm câu M; 69:78 đổi thứ tự M | Phase 5 |
| 55:16 | 14 · Đồng ý dữ liệu · Nạp điểm · Thông báo | 62:954/62:1163 thông báo dữ liệu; 62:2806 chọn gói M; 62:3623/62:3873 chuyển khoản; 62:2968/62:3154 chờ duyệt; 62:1837/62:2117 thông báo | Phase 3 (consent), Phase 4 |
| 55:17 | 15 · Tài khoản | 63:3405 đăng ký D; 63:4184 đăng ký M; 63:3990 email tồn tại; 63:1973 quên MK; 63:2089 đã gửi link; 63:2192 liên kết Google; 63:3000/63:3064 bị đăng xuất; 63:1877 điểm sắp hết hạn; 63:483/63:1426 tài khoản; 63:2469 hồ sơ M | Phase 1, Phase 4 |
| 55:18 | 16 · Chuỗi, hạng, bảng xếp hạng | 63:3114/63:4078 bảng xếp hạng; 63:4629 chuỗi M; 63:4981 hạng M | Phase 4 |
| 55:19 | 17 · Chất lượng dữ liệu | 63:4702 đánh giá KS D; 63:5939 phiên bản D; 63:3676 điểm đang giữ M; 63:5117 độ tin cậy M; 63:3276 admin xét chất lượng | Phase 3–6 |
| 55:20 | 18 · Trang lỗi hệ thống | 404 63:5152/63:5232; 500 63:6177/63:6216; offline 63:5262/63:6029; rate-limit 63:6102/63:6141; 403 63:4453/63:4674; bảo trì 63:4865/63:5036; đủ người 63:6252/63:6287 | Phase 1 |
| 55:21 | 19 · Bộ mascot (21 biểu cảm) | 70:446 | Asset source (Phase 0) |

Where Figma has only one breakpoint for a screen, the other is derived from the sibling
screens' patterns and marked ASSUMED in code.
