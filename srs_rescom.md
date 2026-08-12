# **Software Requirements Specification (SRS)**

# RESCOM — Nền Tảng Cộng Đồng Hỗ Trợ Trao Đổi Khảo Sát Học Thuật

---

| Thông tin tài liệu |  |
| :---- | :---- |
| **Tên dự án** | RESCOM (Research \+ Community) |
| **Phiên bản** | 1.0 |
| **Ngày cập nhật** | 07/08/2026 |
| **Nhóm thực hiện** | Rescom Team — FPT University Da Nang |
| **Trạng thái** | Draft |

---

## Mục Lục

1. Giới Thiệu  
2. Mô Tả Tổng Quan Hệ Thống  
3. Functional Requirements — Yêu Cầu Chức Năng  
4. Non-Functional Requirements — Yêu Cầu Phi Chức Năng  
5. Specific Requirements — Yêu Cầu Đặc Tả  
6. User Stories

---

## 1\. Giới Thiệu

### 1.1 Mục Đích Tài Liệu

Tài liệu này mô tả đầy đủ các yêu cầu phần mềm của hệ thống **RESCOM** — một nền tảng website cộng đồng hỗ trợ sinh viên trao đổi khảo sát học thuật. Tài liệu được tổng hợp từ 6 tài liệu brief ý tưởng của nhóm phát triển và phục vụ làm nền tảng thiết kế, phát triển, kiểm thử hệ thống.

### 1.2 Phạm Vi Hệ Thống

**RESCOM** là nền tảng website trung gian, vận hành theo mô hình kinh tế chia sẻ hai chiều (two-sided marketplace), kết nối:

- **Người tạo khảo sát (Publisher):** Sinh viên có nhu cầu thu thập dữ liệu sơ cấp cho assignment, đồ án, khóa luận, nghiên cứu khoa học.  
- **Người làm khảo sát (Respondent):** Sinh viên sẵn sàng hoàn thành khảo sát để tích lũy điểm thưởng.

Hệ thống vận hành trên nguyên tắc cốt lõi: **"Nhận hỗ trợ — Đóng góp lại"**, đảm bảo tính công bằng và minh bạch thông qua Point System (hệ thống điểm thưởng).

### 1.3 Định Nghĩa & Thuật Ngữ

| Thuật ngữ | Định nghĩa |
| :---- | :---- |
| **Publisher** | Người tạo và đăng khảo sát trên hệ thống |
| **Respondent** | Người làm khảo sát để nhận điểm |
| **Point / Điểm** | Đơn vị trao đổi nội bộ; 1 điểm \= 200 VNĐ |
| **Survey Feed** | Danh sách khảo sát cá nhân hóa hiển thị cho Respondent |
| **Targeted Matching** | Cơ chế phân phối khảo sát đến đúng đối tượng dựa trên hồ sơ nhân khẩu học |
| **Completion Code** | Mã xác nhận hoàn thành dùng cho form bên ngoài (Google Forms) |
| **Time Barrier** | Cơ chế đo thời gian làm bài để chống gian lận |
| **Frozen Points** | Điểm đóng băng — chưa thể sử dụng cho đến khi mở khóa |
| **Point Escrow** | Điểm bị khóa khi Publisher đăng khảo sát, chờ giải phóng sau mỗi lượt hoàn thành hợp lệ |
| **Pending Balance** | Điểm đang chờ đối soát (48 giờ) sau khi Respondent hoàn thành khảo sát |
| **Available Balance** | Điểm khả dụng, có thể sử dụng ngay |
| **MVP** | Minimum Viable Product — Sản phẩm khả dụng tối thiểu |

## 2\. Mô Tả Tổng Quan Hệ Thống

### 2.1 Bối Cảnh & Vấn Đề

Trong bối cảnh giáo dục đại học, hơn **2 triệu sinh viên** (Bộ GD&ĐT, 2024\) phải thực hiện nghiên cứu, assignment, khóa luận — đòi hỏi thu thập dữ liệu sơ cấp qua khảo sát. Phương thức hiện tại gặp 5 vấn đề cốt lõi:

| \# | Vấn đề | Biểu hiện |
| :---- | :---- | :---- |
| 1 | **Khó tiếp cận đúng đối tượng** | 60.6% sinh viên không thể lọc đúng nhóm đáp viên mục tiêu |
| 2 | **Chất lượng dữ liệu rác** | 76.0% từng nhận phản hồi qua loa, thiếu trung thực |
| 3 | **Áp lực deadline & bài đăng trôi** | 68.3% gặp khó khăn vì cận deadline chưa đủ mẫu |
| 4 | **Trao đổi thiếu công bằng** | Không có cơ chế ràng buộc — người nhận hỗ trợ không cần đóng góp lại |
| 5 | **Khó xác nhận hoàn thành** | Không phân biệt được ai đã thực sự làm khảo sát |

> *Dữ liệu từ khảo sát nội bộ nhóm phát triển: n=105 sinh viên, tháng 5/2026*

### 2.2 Tầm Nhìn & Giải Pháp

RESCOM giải quyết những vấn đề trên bằng cách xây dựng **nền tảng kinh tế chia sẻ hai chiều**:

\[Respondent làm khảo sát\] \--\> \[Nhận điểm\] \--\> \[Dùng điểm đăng khảo sát của mình\]

         |                                                    |

         \+-------------- \[Publisher phân phối khảo sát\] \<---+

Cơ chế này đảm bảo:

- **Công bằng:** Ai muốn nhận hỗ trợ phải đóng góp trước  
- **Minh bạch:** Mọi giao dịch điểm được ghi log bất biến (Double-Entry Ledger)  
- **Chất lượng:** Targeted Matching \+ Anti-Fraud đảm bảo dữ liệu sạch

### 2.3 Đối Tượng Người Dùng

| Nhóm | Mô tả | Nhu cầu chính |
| :---- | :---- | :---- |
| **B2C — Core** | Sinh viên đại học cần thu thập dữ liệu (Publisher) | Đủ mẫu đúng hạn, đúng đối tượng, dữ liệu sạch |
| **B2C — Active** | Sinh viên làm khảo sát tích điểm (Respondent) | Ghi nhận công sức, hệ thống công bằng |
| **B2B — Expand** | CLB, giảng viên, khoa/trường, nhóm nghiên cứu | Dashboard nâng cao, quản lý khảo sát theo tổ chức |

### 2.4 Hệ Cấp Độ Người Dùng

| Cấp độ | Điều kiện | Quyền lợi |
| :---- | :---- | :---- |
| **New User** | Mới đăng ký | 100 điểm đóng băng |
| **Verified Member** | Hoàn thành 2 khảo sát onboarding | Mở khóa 100 điểm; tham gia đầy đủ platform |
| **Active Contributor** | Hoàn thành \>= 20 khảo sát | Ưu tiên hiển thị trong feed |
| **Trusted Researcher** | Hoàn thành \>= 100 khảo sát | Tăng độ tin cậy, giảm Pending Time |
| **Community Ambassador** | Hoàn thành \>= 300 khảo sát | Đặc quyền cộng đồng |

---

## 3\. Functional Requirements

### FR-01: Xác Thực & Quản Lý Tài Khoản

| ID | Yêu Cầu |
| :---- | :---- |
| FR-01.1 | Hệ thống cho phép người dùng đăng ký bằng email \+ mật khẩu |
| FR-01.2 | Hệ thống hỗ trợ đăng nhập nhanh bằng Google Account (OAuth) |
| FR-01.3 | Mỗi tài khoản chỉ được đăng nhập trên một thiết bị (single-session) |
| FR-01.4 | Hệ thống tự động tặng 100 điểm ở trạng thái đóng băng ngay khi đăng ký |
| FR-01.5 | Nếu tài khoản không hoạt động trong 30 ngày kể từ đăng ký, điểm khởi đầu hết hiệu lực |

### FR-02: Onboarding & Mở Khóa Điểm

| ID | Yêu Cầu |
| :---- | :---- |
| FR-02.1 | Người dùng mới phải hoàn thành Khảo sát nhân khẩu học hệ thống (khảo sát onboarding số 1\) |
| FR-02.2 | Người dùng phải hoàn thành thêm 1 khảo sát bất kỳ từ Survey Feed (khảo sát onboarding số 2\) |
| FR-02.3 | Sau khi hoàn thành 2 khảo sát onboarding, 100 điểm đóng băng được chuyển sang Available Balance |
| FR-02.4 | Khảo sát nhân khẩu học onboarding thu thập: độ tuổi, giới tính, tỉnh/thành phố, nghề nghiệp, ngành học, thu nhập, sở thích |

### FR-03: Hồ Sơ Người Dùng & Targeted Matching

| ID | Yêu Cầu |
| :---- | :---- |
| FR-03.1 | Mỗi người dùng có hồ sơ nhân khẩu học: ngành học, năm học, độ tuổi, giới tính, khu vực |
| FR-03.2 | Khi Publisher đăng khảo sát, hệ thống cho phép thiết lập tiêu chí đối tượng (giới tính, tuổi, ngành, trường, khu vực) |
| FR-03.3 | Hệ thống tự động đối chiếu tiêu chí với hồ sơ Respondent để ưu tiên hiển thị đúng người |
| FR-03.4 | Publisher có thể mở rộng tiêu chí nếu không đủ người phù hợp 100% |

### FR-04: Đăng Khảo Sát Từ Nền Tảng Bên Ngoài (Google Forms)

| ID | Yêu Cầu |
| :---- | :---- |
| FR-04.1 | Publisher nhập link form ngoài, mã hoàn thành tĩnh, số lượng mẫu, mức điểm/mẫu, deadline, thời gian ước tính |
| FR-04.2 | Hệ thống tự động tính và khóa tổng điểm Escrow \= số mẫu x điểm/mẫu |
| FR-04.3 | Nếu Publisher không đủ Available Balance, hệ thống chặn đăng bài và gợi ý đi làm khảo sát |
| FR-04.4 | Sau khi publish thành công, khảo sát xuất hiện trên Survey Feed cho đúng nhóm đối tượng |
| FR-04.5 | Mức điểm thưởng tuân theo bảng giá theo thời gian: \<5 phút: 5-10đ; 5-10 phút: 10-20đ; 10-15 phút: 15-25đ; \>15 phút: 20-40đ |

### FR-05: Cơ Chế Xác Nhận Hoàn Thành — Completion Code

| ID | Yêu Cầu |
| :---- | :---- |
| FR-05.1 | Khi Respondent bấm "Bắt đầu làm", hệ thống ghi nhận startTime phía server |
| FR-05.2 | Hệ thống mở link Google Forms ở tab mới và hiển thị tab anchor chứa ô nhập mã \+ đồng hồ đếm ngược |
| FR-05.3 | Nút Submit bị vô hiệu hóa cho đến khi hết thời gian đếm ngược (dựa trên thời gian ước tính) |
| FR-05.4 | Respondent nhập mã hoàn thành; backend kiểm tra: mã đúng \+ thời gian thực tế \>= thời gian ước tính |
| FR-05.5 | Nếu hợp lệ: điểm cộng vào Pending Balance (chờ 48h đối soát), điểm Escrow của Publisher giảm tương ứng |
| FR-05.6 | Mỗi tài khoản chỉ được hoàn thành mỗi khảo sát đúng 1 lần |
| FR-05.7 | Hệ thống giới hạn số lần nhập sai mã tối đa; vượt quá thì khóa phiên làm |

### FR-06: Anti-Fraud — Cơ Chế Chống Gian Lận

| ID | Yêu Cầu |
| :---- | :---- |
| FR-06.1 | Time Barrier: Hệ thống đo thời gian từ startTime đến lúc submit mã; từ chối nếu thời gian thực \< thời gian tối thiểu |
| FR-06.2 | Mọi attempt bị reject được ghi vào FraudLog (không xóa) |
| FR-06.3 | Trong 48 giờ đối soát, Publisher có thể báo cáo phản hồi rác/trùng; Admin thu hồi điểm về Escrow |
| FR-06.4 | Frozen Starting Points (100 điểm) chống tài khoản ảo: bắt buộc hoàn thành 2 khảo sát trước khi sử dụng |
| FR-06.5 | Hệ thống giới hạn tần suất làm khảo sát để tránh bot |

### FR-07: Survey Feed & Marketplace

| ID | Yêu Cầu |
| :---- | :---- |
| FR-07.1 | Survey Feed hiển thị khảo sát đang ACTIVE và khớp với hồ sơ nhân khẩu học của Respondent |
| FR-07.2 | Khảo sát đã hoàn thành hoặc đang làm dở bị ẩn/làm mờ |
| FR-07.3 | Mỗi card khảo sát hiển thị: điểm thưởng, thời gian làm ước tính, số slot còn lại |
| FR-07.4 | Feed được phân nhóm: phù hợp nhất, ngắn/dễ làm, gần deadline, điểm cao, cùng trường, cùng ngành, mới đăng |
| FR-07.5 | Respondent có thể dùng bộ lọc nâng cao để tìm khảo sát phù hợp |

### FR-08: Hệ Thống Điểm & Ví Điểm (Point Ledger)

| ID | Yêu Cầu |
| :---- | :---- |
| FR-08.1 | Mọi biến động điểm đều được ghi log bất biến theo mô hình Double-Entry Ledger |
| FR-08.2 | Ví điểm hiển thị: Available Balance, Pending Balance, Frozen Balance, lịch sử giao dịch |
| FR-08.3 | Hệ thống dùng ACID transactions \+ Row-Level Locking để chống race condition |
| FR-08.4 | Điểm trong Pending Balance sau 48 giờ không bị khiếu nại sẽ chuyển sang Available Balance |
| FR-08.5 | Khi khảo sát kết thúc mà còn slot trống, hệ thống tự hoàn điểm Escrow còn dư về Publisher |

### FR-09: Nạp Điểm (Top-Up)

| ID | Yêu Cầu |
| :---- | :---- |
| FR-09.1 | Người dùng có thể nạp tiền mặt để đổi lấy điểm (1 điểm \= 200 VNĐ) |
| FR-09.2 | Mức nạp tối thiểu mỗi lần: 100 điểm (tương đương 20.000 VNĐ) |
| FR-09.3 | Giao dịch nạp điểm là một chiều: không hoàn tiền, không chuyển nhượng sang tài khoản khác |
| FR-09.4 | Ở giai đoạn MVP, việc nạp/rút tiền thực được xử lý thủ công bởi Admin qua tài khoản ngân hàng |

### FR-10: Dashboard Theo Dõi Tiến Độ

| ID | Yêu Cầu |
| :---- | :---- |
| FR-10.1 | Mỗi khảo sát Publisher tạo có Dashboard riêng |
| FR-10.2 | Dashboard hiển thị: lượt hoàn thành, số responses còn thiếu, điểm đã dùng, điểm còn lại trong Escrow |
| FR-10.3 | Dashboard hiển thị: deadline đếm ngược, thời gian làm trung bình, tỷ lệ drop-off |
| FR-10.4 | Dashboard hiển thị trạng thái khảo sát: Đang chạy / Tạm dừng / Đã đóng / Hết điểm / Quá hạn |
| FR-10.5 | Với khảo sát form bên ngoài, Dashboard chỉ phản ánh lượt hoàn thành được xác nhận qua Rescom |

### FR-11: Feedback System

| ID | Yêu Cầu |
| :---- | :---- |
| FR-11.1 | Sau khi hoàn thành khảo sát, Respondent có thể để lại đánh giá ngắn cho Publisher |
| FR-11.2 | Feedback đánh giá: độ rõ ràng câu hỏi, độ dài, tính chính xác mô tả, lỗi kỹ thuật, trải nghiệm làm |
| FR-11.3 | Respondent có thể ghi chú góp ý tự do |
| FR-11.4 | Nếu nhiều Respondent phản ánh khảo sát có vấn đề, hệ thống giảm ưu tiên hiển thị hoặc yêu cầu Publisher chỉnh sửa |

### FR-12: Quản Trị (Admin)

| ID | Yêu Cầu |
| :---- | :---- |
| FR-12.1 | Admin có thể xem và xử lý khiếu nại từ Publisher về phản hồi rác |
| FR-12.2 | Admin có thể thu hồi điểm về Escrow nếu khiếu nại hợp lệ |
| FR-12.3 | Admin phê duyệt giao dịch nạp/rút tiền mặt thủ công (giai đoạn MVP) |
| FR-12.4 | Admin có khả năng xem FraudLog và xử lý vi phạm |

---

## 4\. Non-Functional Requirements

### NFR-01: Hiệu Năng (Performance)

| ID | Yêu Cầu |
| :---- | :---- |
| NFR-01.1 | Thời gian phản hồi API trung bình \< 500ms trong điều kiện tải bình thường |
| NFR-01.2 | Hệ thống phải xử lý đúng kết quả khi có hàng trăm request đồng thời vào ví điểm (chống race condition) |
| NFR-01.3 | Survey Feed tải trong \< 2 giây với danh sách \<= 50 khảo sát |
| NFR-01.4 | Caching In-Memory cho Time Barrier để giảm database hits |

### NFR-02: Bảo Mật (Security)

| ID | Yêu Cầu |
| :---- | :---- |
| NFR-02.1 | Authentication dùng stateless JWT lưu trong HTTP-Only Cookie |
| NFR-02.2 | Áp dụng CORS, Helmet, express-rate-limit để bảo vệ API |
| NFR-02.3 | Không tin tưởng frontend: startTime được ghi phía server, không nhận từ client |
| NFR-02.4 | Mọi giao dịch điểm dùng ACID transactions để đảm bảo tính nhất quán dữ liệu |
| NFR-02.5 | FraudLog không bao giờ bị xóa (append-only) |
| NFR-02.6 | Dữ liệu nhân khẩu học người dùng được bảo vệ, chỉ dùng cho mục đích matching |

### NFR-03: Độ Tin Cậy (Reliability)

| ID | Yêu Cầu |
| :---- | :---- |
| NFR-03.1 | Hệ thống đảm bảo số dư điểm không bao giờ bị nhân bản hoặc mất (Point Ledger không thể sai lệch) |
| NFR-03.2 | Auto-Refund Cron tự động chạy để hoàn điểm khi khảo sát hết hạn |
| NFR-03.3 | Pending Balance tự động chuyển sang Available Balance sau 48 giờ nếu không có khiếu nại |
| NFR-03.4 | Uptime hệ thống \>= 99% trong giờ cao điểm học kỳ |

### NFR-04: Khả Năng Bảo Trì (Maintainability)

| ID | Yêu Cầu |
| :---- | :---- |
| NFR-04.1 | Kiến trúc Monorepo với Frontend và Backend tách biệt hoàn toàn |
| NFR-04.2 | Sử dụng ORM (Prisma) để quản lý schema database, tránh SQL thuần |
| NFR-04.3 | Validation dùng Zod dùng chung cả Frontend và Backend |
| NFR-04.4 | Code được viết theo convention rõ ràng, có comments cho các nghiệp vụ phức tạp |

### NFR-05: Khả Năng Mở Rộng (Scalability)

| ID | Yêu Cầu |
| :---- | :---- |
| NFR-05.1 | Database PostgreSQL hỗ trợ Connection Pooling (Neon/Supabase ở production) |
| NFR-05.2 | Kiến trúc có thể mở rộng thêm Internal Form Builder ở giai đoạn 2 mà không cần refactor lớn |
| NFR-05.3 | Có thể scale sang mô hình B2B (tài khoản tổ chức) ở giai đoạn 3 |

### NFR-06: Khả Năng Sử Dụng (Usability)

| ID | Yêu Cầu |
| :---- | :---- |
| NFR-06.1 | Giao diện hiện đại, tối giản, thân thiện — hướng đến sinh viên Gen Z |
| NFR-06.2 | Luồng tạo khảo sát theo dạng Stepper 3 bước rõ ràng |
| NFR-06.3 | Hiển thị thanh tiến độ responses cho Publisher, tạo động lực tham gia sớm cho Respondent |
| NFR-06.4 | CSAT (Customer Satisfaction Score) mục tiêu \> 4.0 / 5.0 |
| NFR-06.5 | Activation Rate (tỷ lệ mở khóa điểm) mục tiêu \> 80% |
| NFR-06.6 | Completion Rate (tỷ lệ nộp mã thành công) mục tiêu \> 75% |

### NFR-07: Tuân Thủ & Pháp Lý (Compliance)

| ID | Yêu Cầu |
| :---- | :---- |
| NFR-07.1 | Điểm không được định vị là tiền tệ và không được mua bán giữa các tài khoản |
| NFR-07.2 | Dữ liệu khảo sát chỉ được sử dụng cho mục đích học thuật, có cam kết bảo mật rõ ràng |
| NFR-07.3 | Nền tảng không định vị là "bán responses" mà là dịch vụ hỗ trợ phân phối khảo sát |

---

## 5\. Specific Requirements

### 5.1 Quy Trình Vận Hành Tổng Thể

#### Luồng A — Onboarding (Người dùng mới)

Đăng ký tài khoản

      |

      v

Nhận 100 điểm Frozen

      |

      v

Làm Khảo sát nhân khẩu học hệ thống (số 1\)

      |

      v

Làm 1 khảo sát bất kỳ từ Feed (số 2\)

      |

      v

Hệ thống mở khóa 100 điểm \--\> Available Balance

      |

      v

Tài khoản hoạt động đầy đủ

#### Luồng B — Respondent làm khảo sát

Đăng nhập \--\> Xem Survey Feed (đã lọc theo hồ sơ)

      |

      v

Chọn khảo sát \--\> Bấm "Bắt đầu làm"

      |

      v

Hệ thống ghi startTime (server-side)

Link Google Forms mở tab mới | Tab anchor hiện đồng hồ đếm ngược \+ ô nhập mã

      |

      v

Làm xong form \--\> Lấy Completion Code

      |

      v

Nhập mã vào tab anchor Rescom

      |

      v

Backend kiểm tra: Mã đúng? Thời gian đủ? Chưa làm lần nào?

      |-- Không hợp lệ \--\> Ghi FraudLog, từ chối

      |-- Hợp lệ \--\> Điểm vào Pending Balance (48h)

                 \--\> Publisher mất điểm Escrow tương ứng

#### Luồng C — Publisher đăng khảo sát

Chọn "Tạo khảo sát"

      |

      v

Stepper Bước 1: Dán link form \+ nhập Completion Code \+ thời gian ước tính

      |

      v

Stepper Bước 2: Chọn tiêu chí đối tượng (ngành, năm, tuổi, giới tính, khu vực)

      |

      v

Stepper Bước 3: Nhập số mẫu cần \+ mức điểm/mẫu

      |

      v

Hệ thống tính: Tổng Escrow \= số mẫu x điểm/mẫu

Kiểm tra Available Balance \>= Tổng Escrow?

      |-- Không đủ \--\> Chặn, gợi ý làm khảo sát kiếm thêm điểm

      |-- Đủ \--\> Trừ điểm, khóa Escrow, kích hoạt khảo sát lên Marketplace

                    |

                    v

             Theo dõi qua Dashboard

             Khi hết hạn mà chưa đủ mẫu \--\> Auto-Refund điểm dư

### 5.2 Cấu Trúc Điểm Thưởng

| Thời gian hoàn thành | Điểm tối thiểu | Điểm tối đa |
| :---- | :---- | :---- |
| \< 5 phút | 5 điểm | 10 điểm |
| 5 – 10 phút | 10 điểm | 20 điểm |
| 10 – 15 phút | 15 điểm | 25 điểm |
| \> 15 phút | 20 điểm | 40 điểm |

> Hệ thống tự động đề xuất mức thưởng phù hợp; Publisher không được đặt thấp hơn mức tối thiểu hoặc vượt mức tối đa.

### 5.3 Bảng Hỏi Onboarding (Khảo Sát Nhân Khẩu Học Hệ Thống)

**Phần 1 — Nhân khẩu học cơ bản:**

- Độ tuổi: \<18 / 18–22 / 23–25 / \>25  
- Giới tính: Nam / Nữ / Khác  
- Khu vực (toàn quốc / theo miền / theo tỉnh-thành)

**Phần 2 — Học vấn & Nghề nghiệp:**

- Nghề nghiệp: Học sinh/Sinh viên / Nhân viên / Freelancer / Quản lý / Khác  
- Khối ngành: Kinh tế/Marketing / Truyền thông / CNTT / Ngôn ngữ / Khác

**Phần 3 — Tài chính:**

- Mức thu nhập/trợ cấp hàng tháng: \<3tr / 3–5tr / 5–10tr / \>10tr VNĐ

**Phần 4 — Sở thích & Phong cách sống:**

- Đa chọn từ 17 lĩnh vực: Thời trang, Công nghệ, AI, Tài chính, Giáo dục, Sức khỏe, Du lịch, v.v.

### 5.4 Phạm Vi MVP (Giai Đoạn 1\)

| Tính năng | Trạng thái MVP |
| :---- | :---- |
| Đăng ký / Đăng nhập (email \+ Google) | Co |
| Hồ sơ nhân khẩu học | Co |
| Ví điểm (Point Ledger — Double Entry) | Co |
| Frozen Starting Points (100 điểm) | Co |
| Khảo sát onboarding hệ thống | Co |
| Đăng khảo sát từ link ngoài \+ Completion Code | Co |
| Survey Marketplace Feed (có lọc) | Co |
| Time Barrier (Anti-Fraud) | Co |
| Point Escrow khi đăng bài | Co |
| Pending Balance 48h \+ khiếu nại Publisher | Co |
| Dashboard cơ bản | Co |
| Feedback cơ bản | Co |
| Nạp tiền thủ công qua Admin | Co |
| Internal Form Builder | Giai đoạn 2 |
| API thanh toán tự động | Giai đoạn 2 |
| Tính năng B2B tổ chức | Giai đoạn 3 |

### 5.5 Lộ Trình Phát Triển

| Giai đoạn | Trọng tâm |
| :---- | :---- |
| **Giai đoạn 1 — MVP** | Peer-to-Peer tại ĐH FPT Đà Nẵng. Form ngoài \+ Completion Code \+ Time Barrier \+ Pending 48h \+ rút tiền thủ công |
| **Giai đoạn 2 — Hoàn thiện** | Internal Form Builder \+ forced-attention mechanics \+ API thanh toán tự động \+ Boost khảo sát \+ Dashboard nâng cao |
| **Giai đoạn 3 — Mở rộng** | B2B cho giảng viên/tổ chức \+ mở rộng địa lý toàn quốc \+ phân tích dữ liệu \+ xuất Excel/SPSS |

### 5.6 Tech Stack Dự Kiến

| Layer | Công nghệ |
| :---- | :---- |
| **Frontend** | Next.js, TypeScript, App Router, Tailwind CSS, shadcn/ui, Redux Toolkit \+ RTK Query, Framer Motion |
| **Backend** | Node.js, Express (^5.2.1), ES Modules |
| **ORM** | Prisma ORM |
| **Validation** | Zod (dùng chung FE & BE) |
| **Auth** | Stateless JWT, HTTP-Only Cookie |
| **Security** | CORS, Helmet, express-rate-limit |
| **Caching** | In-Memory Cache (Map/lru-cache) cho Time Barrier |
| **Database** | PostgreSQL (Docker Compose local, Neon/Supabase production) |
| **Frontend Hosting** | Vercel |
| **Backend Hosting** | Railway hoặc Render |

---

## 6\. User Stories

### Nhóm 1 — Respondent (Người làm khảo sát)

---

**US-R01: Đăng ký & Onboarding**

> *Là một sinh viên mới, tôi muốn đăng ký tài khoản RESCOM và hoàn thành quy trình onboarding để có thể bắt đầu tham gia nền tảng.*

**Acceptance Criteria:**

- Tôi có thể đăng ký bằng email/mật khẩu hoặc tài khoản Google  
- Sau đăng ký, tôi thấy 100 điểm ở trạng thái "Đóng băng" trong ví  
- Tôi được yêu cầu làm khảo sát nhân khẩu học hệ thống đầu tiên  
- Sau đó tôi phải chọn và làm thêm 1 khảo sát bất kỳ từ danh sách  
- Khi hoàn thành cả 2, 100 điểm đóng băng chuyển sang "Khả dụng"  
- Tôi nhận thông báo "Tài khoản đã kích hoạt thành công"

---

**US-R02: Xem & Lọc Khảo Sát Phù Hợp**

> *Là một Respondent, tôi muốn thấy danh sách khảo sát được lọc theo hồ sơ của tôi để tôi không mất thời gian với những khảo sát không phù hợp.*

**Acceptance Criteria:**

- Survey Feed chỉ hiển thị khảo sát phù hợp với ngành, tuổi, giới tính, khu vực của tôi  
- Tôi thấy rõ điểm thưởng và thời gian làm ước tính của mỗi khảo sát  
- Các khảo sát đã hoàn thành bị ẩn hoặc làm mờ  
- Tôi có thể lọc theo nhiều tiêu chí: điểm cao, gần deadline, ngắn/dễ làm  
- Feed được cập nhật realtime khi có khảo sát mới

---

**US-R03: Làm Khảo Sát & Nhận Điểm**

> *Là một Respondent, tôi muốn làm khảo sát và nhận điểm một cách minh bạch để cảm thấy công sức được ghi nhận xứng đáng.*

**Acceptance Criteria:**

- Khi bấm "Bắt đầu làm", link Google Forms mở tab mới; tab Rescom hiện đồng hồ đếm ngược  
- Nút submit bị khóa cho đến khi hết thời gian đếm ngược  
- Sau khi submit form, tôi lấy mã từ trang cảm ơn của Google Forms  
- Tôi nhập mã vào tab Rescom và bấm "Xác nhận hoàn thành"  
- Nếu hợp lệ, tôi nhận thông báo "Hoàn thành\! X điểm đang chờ đối soát (48h)"  
- Sau 48h, điểm chuyển vào Available Balance của tôi

---

**US-R04: Xem Lịch Sử Ví Điểm**

> *Là một Respondent, tôi muốn xem rõ lịch sử điểm để biết mình kiếm được từ đâu và đã tiêu bao nhiêu.*

**Acceptance Criteria:**

- Tôi thấy Available Balance, Pending Balance, Frozen Balance trên màn hình chính ví  
- Mỗi giao dịch điểm có: thời gian, loại (nhận/tiêu), số điểm, khảo sát liên quan  
- Lịch sử điểm không thể bị xóa hay chỉnh sửa

---

### Nhóm 2 — Publisher (Người tạo khảo sát)

---

**US-P01: Đăng Khảo Sát Từ Google Forms**

> *Là một sinh viên cần thu thập dữ liệu, tôi muốn đăng khảo sát Google Forms lên RESCOM để tiếp cận đúng nhóm đối tượng mục tiêu của tôi.*

**Acceptance Criteria:**

- Tôi điền form 3 bước: (1) Link \+ mã hoàn thành \+ thời gian ước tính; (2) Tiêu chí đối tượng; (3) Số mẫu \+ mức điểm/mẫu  
- Hệ thống hiển thị tổng điểm Escrow cần khóa và số dư hiện tại  
- Nếu không đủ điểm, tôi thấy thông báo gợi ý làm khảo sát để kiếm thêm  
- Sau khi publish, khảo sát xuất hiện trong Feed của đúng nhóm đối tượng tôi chọn  
- Tôi thấy Dashboard theo dõi tiến độ realtime

---

**US-P02: Theo Dõi Tiến Độ Khảo Sát**

> *Là một Publisher, tôi muốn theo dõi tiến độ thu thập responses để chủ động điều chỉnh chiến lược phân phối trước deadline.*

**Acceptance Criteria:**

- Dashboard hiển thị: lượt hoàn thành / tổng mẫu cần, tỷ lệ %  
- Hiển thị deadline đếm ngược theo giờ  
- Hiển thị thời gian làm trung bình của Respondents  
- Hiển thị tỷ lệ người bấm nhưng bỏ nửa chừng (drop-off rate)  
- Hiển thị điểm đã dùng và điểm Escrow còn lại  
- Tôi thấy feedback tổng hợp từ Respondents

---

**US-P03: Báo Cáo Phản Hồi Rác**

> *Là một Publisher, khi tôi phát hiện phản hồi rác trong dữ liệu Google Sheets, tôi muốn khiếu nại để thu hồi điểm đã trả cho Respondent không nghiêm túc.*

**Acceptance Criteria:**

- Trong 48h sau khi Respondent hoàn thành, tôi thấy nút "Báo cáo Data Rác"  
- Tôi chọn lượt hoàn thành cụ thể và ghi rõ lý do  
- Admin xem xét và quyết định trong thời gian hợp lý  
- Nếu khiếu nại hợp lệ, điểm Escrow được hoàn về; Respondent mất điểm Pending tương ứng

---

**US-P04: Nạp Điểm Khi Cận Deadline**

> *Là một sinh viên cận deadline nhưng chưa đủ điểm, tôi muốn nạp tiền để có điểm ngay lập tức phân phối khảo sát của mình.*

**Acceptance Criteria:**

- Tôi chọn số điểm cần nạp (tối thiểu 100 điểm \= 20.000 VNĐ)  
- Hệ thống hiển thị thông tin tài khoản ngân hàng Admin  
- Sau khi chuyển khoản, tôi gửi xác nhận cho Admin  
- Admin kiểm tra và cộng điểm vào Available Balance trong thời gian hợp lý  
- Tôi thấy thông báo xác nhận và điểm cập nhật trong ví

---

### Nhóm 3 — Admin

---

**US-A01: Xử Lý Khiếu Nại Data Rác**

> *Là Admin, tôi muốn xem xét và xử lý các khiếu nại từ Publisher về phản hồi rác để đảm bảo tính công bằng của hệ thống.*

**Acceptance Criteria:**

- Tôi thấy danh sách khiếu nại đang chờ xử lý  
- Mỗi khiếu nại có: thông tin Publisher, Respondent, lượt hoàn thành, lý do báo cáo  
- Tôi có thể chấp nhận (thu hồi điểm) hoặc từ chối khiếu nại  
- Hệ thống tự động điều chỉnh điểm tương ứng sau quyết định của Admin  
- Cả Publisher và Respondent nhận thông báo về kết quả xử lý

---

**US-A02: Duyệt Giao Dịch Nạp Điểm**

> *Là Admin, tôi muốn kiểm tra và duyệt các giao dịch nạp điểm của người dùng để đảm bảo tính chính xác trước khi cộng điểm.*

**Acceptance Criteria:**

- Tôi thấy danh sách giao dịch nạp tiền đang chờ duyệt với thông tin đầy đủ  
- Tôi có thể xác nhận giao dịch sau khi kiểm tra chuyển khoản thực tế  
- Sau xác nhận, điểm được cộng vào Available Balance của người dùng  
- Người dùng nhận thông báo "Nạp điểm thành công"

---

**US-A03: Giám Sát FraudLog**

> *Là Admin, tôi muốn xem FraudLog để phát hiện và xử lý các tài khoản có hành vi gian lận lặp lại.*

**Acceptance Criteria:**

- Tôi có thể lọc FraudLog theo: tài khoản, thời gian, loại vi phạm  
- Hệ thống đánh dấu tài khoản có nhiều attempt gian lận  
- Tôi có thể khóa tài khoản vi phạm nghiêm trọng  
- FraudLog không bao giờ bị xóa — chỉ được đọc

---

## Phụ Lục — Ma Trận Truy Xuất Yêu Cầu

| User Story | Functional Requirement liên quan |
| :---- | :---- |
| US-R01 | FR-01, FR-02, FR-08 |
| US-R02 | FR-03, FR-07 |
| US-R03 | FR-05, FR-06, FR-08 |
| US-R04 | FR-08 |
| US-P01 | FR-03, FR-04, FR-08, FR-10 |
| US-P02 | FR-10 |
| US-P03 | FR-06, FR-12 |
| US-P04 | FR-09, FR-12 |
| US-A01 | FR-06, FR-12 |
| US-A02 | FR-09, FR-12 |
| US-A03 | FR-06, FR-12 |

---

*Tài liệu này được tổng hợp từ 6 brief ý tưởng của nhóm Rescom. Mọi thay đổi về yêu cầu cần được cập nhật đồng thời vào tài liệu này.*

