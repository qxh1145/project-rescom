# RESCOM Solution Design & Onboarding Guide

Chào mừng bạn đến với team RESCOM! Tài liệu này sẽ giải thích cách hệ thống hoạt động, lý do vì sao chúng ta chọn kiến trúc hiện tại, và các nguyên tắc (rules) bạn cần tuân thủ khi viết code.

## 1. Tổng quan hệ thống (The Big Picture)

RESCOM là một **Marketplace Khảo Sát Học Thuật** gồm Frontend (Vercel), Backend (VPS) và một máy AI riêng biệt. Hệ thống được quản lý trong một **Monorepo sử dụng Turborepo**.

### Tại sao lại là Monorepo?
Chúng ta có một thành phần cực kỳ quan trọng: **Form Definition JSON**. 
- Frontend Form Builder tạo ra file JSON này.
- Frontend Form Renderer đọc JSON này để vẽ giao diện.
- Backend dùng JSON này để validate dữ liệu lưu vào DB.
- AI Server sinh ra JSON này từ câu lệnh.

Nếu Frontend và Backend giữ 2 schema khác nhau, hệ thống sẽ sụp đổ. Do đó, `packages/form-schema` ra đời. Cả thư mục `apps/web` (Next.js) và `apps/api` (NestJS) đều import thư viện dùng chung này. Khi bạn sửa schema ở `packages/form-schema`, Type Checker sẽ báo lỗi ngay lập tức ở cả FE và BE nếu có sự cố.

## 2. Kiến trúc Data & Database

### The Point Ledger (Sổ cái)
Hệ thống điểm của RESCOM vận hành giống hệt ngân hàng:
- Tuyệt đối **KHÔNG** làm chuyện này: `user.points += 20`
- Thay vào đó, tạo 2 bản ghi: `Debit Account A 20`, `Credit Account B 20`.
- Ledger là append-only (chỉ thêm mới, không sửa, không xóa).
Khi code các luồng liên quan tới điểm (hoàn thành khảo sát, publish khảo sát), **bắt buộc phải bọc trong DB Transaction (Prisma `$transaction`)**.

### Redis cho Caching
Mặc dù hiện tại Backend chỉ chạy 1 container, chúng ta vẫn dùng Redis từ đầu (thay vì in-memory cache) cho các tính năng:
- Time Barrier (đo thời gian làm khảo sát để chống bot).
- Rate limiting.
Lý do: Nếu sau này scale lên 2-3 container, dùng in-memory sẽ bị lỗi (state không đồng bộ). Redis giúp hệ thống sẵn sàng scale.

## 3. Background Jobs
Các tác vụ chạy ngầm như *Chuyển điểm Pending -> Available* hay *Auto-refund* hiện tại được chạy trực tiếp trong process của NestJS (dùng `@nestjs/schedule`). 
Lý do: Giữ kiến trúc đơn giản cho giai đoạn GO LIVE. Tuy nhiên, khi code job, hãy viết logic độc lập (service function) để sau này dễ dàng tách sang một worker container (như BullMQ) nếu cần.

## 4. Giao tiếp với AI
Máy tính AI (Ollama) nằm ở mạng nội bộ VPN (Tailscale) kết nối với VPS Backend.
- **Rule 1:** Frontend KHÔNG BAO GIỜ gọi thẳng AI. Nó phải gọi Backend, rồi Backend mới gọi AI.
- **Rule 2:** AI là tính năng *không bắt buộc (optional dependency)*. Code của bạn phải bọc try-catch và có timeout. Nếu máy AI bị tắt, API tạo form tự động sẽ báo lỗi lịch sự, nhưng các chức năng khác (login, xem khảo sát) vẫn PHẢI hoạt động bình thường.

## 5. Kiến trúc Clean Architecture trong NestJS

Chúng ta áp dụng **Clean Architecture** (Dependency Rule). Mỗi module trong Backend (VD: `modules/surveys`) sẽ chia làm 4 thư mục:
- `domain/`: Chứa Entities, Types, và các Business Rules thuần túy. KHÔNG được import gì từ NestJS hay Prisma vào đây.
- `application/`: Chứa Use Cases (logic điều phối) và định nghĩa Interface (Ports). Phụ thuộc vào `domain/`.
- `infrastructure/`: Chứa class implementation cho Repository kết nối với Prisma hoặc gọi các API bên ngoài. Phụ thuộc vào `application/`.
- `presentation/`: Chứa Controllers hoặc GraphQL Resolvers. Gọi các Use Case trong `application/`.

**Rule tối thượng:** Chiều phụ thuộc (`imports`) chỉ được hướng từ ngoài vào trong. Lớp bên trong tuyệt đối không được gọi lớp bên ngoài.

## 6. Quy trình phát triển hàng ngày

1. Mở code trong thư mục `rescom-monorepo`.
2. Khi đổi Prisma schema, nhớ run migrate.
3. Khi thêm câu hỏi mới vào Form, bắt buộc update trong `packages/form-schema` trước.
4. Tuân thủ `[ADOPTED]` Invariants trong file `ARCHITECTURE-SPINE.md` và nguyên tắc Clean Architecture.
