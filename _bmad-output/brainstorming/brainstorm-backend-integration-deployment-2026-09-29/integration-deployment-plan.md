# Kế hoạch tích hợp Frontend–Backend và triển khai Pilot RESCOM

**Ngày lập:** 2026-09-29  
**Mục tiêu:** Thay thế mock ở các hành trình ra mắt bằng backend thật, chứng minh hệ thống qua local và staging, sau đó triển khai production theo mô hình dark deploy và pilot giới hạn.  
**Nguyên tắc kiểm soát:** Mỗi giai đoạn chỉ được qua cổng khi có bằng chứng chạy được; trạng thái story hoặc health check đơn lẻ không được xem là bằng chứng hoàn tất.

## 1. Khuyến nghị điều hành

RESCOM nên tạo một epic **Integration Readiness** độc lập, triển khai song song hoặc trước Epic 11. Epic 11 giải quyết đóng gói và hạ tầng, nhưng không chứng minh frontend và backend khớp hợp đồng khi tắt mock. Tiêu chí thành công trung tâm của epic mới là các hành trình nghiệp vụ quan trọng chạy xuyên suốt với mock bị vô hiệu hóa.

Khuyến nghị thực thi:

1. Chốt một vertical slice đầu tiên gồm shell, email auth và demographics để tạo vòng lặp tích hợp local nhanh.
2. Kiểm kê toàn bộ lời gọi frontend, ánh xạ sang controller/schema backend và phân loại từng hợp đồng là `verified`, `assumed` hoặc `mock-only`.
3. Giữ mọi request từ trình duyệt ở dạng tương đối `/api`; dùng `app.rescom.com.vn` làm origin xác thực chuẩn. UI chạy trên Vercel và Vercel thực hiện external rewrite `/api` đến public API edge/Cloudflare, sau đó qua Caddy trên GCE đến NestJS ở private port 4000. Google OAuth callback dùng URL cùng origin `app.rescom.com.vn/api/...` và đi qua đúng chuỗi rewrite này.
4. Chuyển đổi theo từng domain/hành trình, không tắt toàn bộ mock cùng lúc. Có thể dùng hybrid mock theo domain trong giai đoạn chuyển tiếp, nhưng staging và production phải tắt `NEXT_PUBLIC_API_MOCKING` tại build time.
5. Chỉ đưa lên staging sau khi local real-stack chứng minh được hành trình respondent hoàn chỉnh và hành trình publisher tạo ledger entry thật.
6. Đóng gói API thành image Node 22 multi-stage, chạy non-root, gắn tag commit SHA bất biến, không chứa secret và chỉ chạy đúng một API replica trong pilot.
7. Triển khai theo thứ tự: local integration → staging cô lập → production dark deploy → cohort giới hạn → general pilot.
8. Chỉ go-live khi đã diễn tập rollback image, restore backup/PITR, smoke hành trình nghiệp vụ và có quyết định go/no-go có ký nhận bằng chứng.

## 2. Phạm vi

### 2.1 Trong phạm vi

- Kiểm kê và đóng băng hợp đồng API mà frontend thực sự gọi.
- Loại bỏ hoặc thay thế các consumer trực tiếp của `mockRepository` trong shell, notification, feedback, onboarding guard và trang respondent legacy.
- Tích hợp các hành trình ra mắt: auth, demographics, marketplace, survey summary, attempt, form được pin theo attempt, completion nội bộ và tùy chọn bên ngoài, reward/wallet, top-up, notification, publisher forms, publishing/escrow, moderation và analytics được duyệt phạm vi.
- Same-origin browser API qua `/api`, cookie/session, CSRF exact-origin và OAuth callback cùng host; UI nằm trên Vercel, còn Caddy chỉ phục vụ backend trên GCE.
- Local real-stack, seed persona xác định, contract/integration/E2E/concurrency test và smoke test.
- Image production backend, Caddy backend reverse proxy, liveness/readiness, migration có kiểm soát, CI/CD, release manifest và rollback; frontend không được đóng gói hoặc phục vụ bởi Caddy.
- Staging cô lập và production theo đích AD-23: browser → `app.rescom.com.vn` trên Vercel `sin1` → external rewrite cùng origin `/api` → public API edge/Cloudflare → Caddy trên một GCE VM → NestJS private port 4000; dữ liệu dùng Cloud SQL private IP và private GCS bucket qua S3 API, file được quét bởi ClamAV.
- Quan sát vận hành: structured log có correlation, Sentry có release ID và PII scrubbing, uptime, cảnh báo DB/disk/ClamAV, backup và restore drill.
- Dark deploy, pilot cohort giới hạn, go/no-go và hậu kiểm sau ra mắt.

### 2.2 Ngoài phạm vi hiện tại

- Multi-replica scaling.
- Redis.
- AI host và mọi entry point AI; UI liên quan phải được ẩn khi Epic 3 còn hoãn.
- Advanced integrity engine.
- Chuyển dữ liệu mock thành dữ liệu người dùng production.
- Mở rộng analytics ngoài phần đã được xác nhận cho pilot.
- Tự động hóa đầy đủ progressive cohort, synthetic journey nâng cao, dashboard phong phú và portability rehearsal; đây là hạng mục có thể làm sau.
- Đổi từ AD-23 GCP sang generic VPS mà không có quyết định kiến trúc mới.

## 3. Giả định và ràng buộc

| Mã | Giả định/ràng buộc | Hệ quả triển khai |
|---|---|---|
| A01 | Origin xác thực chuẩn là `app.rescom.com.vn`. | Browser chỉ thấy và gọi `/api`; Vercel external rewrite chuyển request đến public API edge/Cloudflare → Caddy trên GCE → NestJS private port 4000. OAuth callback và cookie giữ cùng frontend host context. |
| A02 | Pilot chỉ chạy một API replica. | Chỉ định duy nhất một scheduler owner; chưa thiết kế multi-replica. |
| A03 | PostgreSQL và object storage dùng giao diện portable. | Không khóa logic ứng dụng vào một nhà cung cấp; portability thực hành ở G7. |
| A04 | Production không nhận dữ liệu mock. | Tạo tài khoản test riêng và seed tổng hợp tách biệt theo môi trường. |
| A05 | Mọi schema change chạy qua `prisma migrate deploy`. | Không chạy migration thủ công từ laptop; pipeline chịu trách nhiệm. |
| A06 | Rollback schema không dùng blind down migration. | Ưu tiên expand-contract, forward fix hoặc restore đã review. |
| A07 | ClamAV fail-closed. | Upload phải bị chặn khi scanner lỗi và phải phát cảnh báo quan sát được. |
| A08 | Staging mô phỏng domain và proxy topology của production. | Mô phỏng đầy đủ frontend Vercel → external rewrite `/api` → public API edge/Cloudflare → backend Caddy → Nest private port; kiểm thử cookie, CSRF, OAuth và client IP trước production. |
| A09 | Secret không nằm trong Git hoặc image layer. | Dùng secret store/biến triển khai và có quy trình rotation. |
| A10 | Hai tài khoản admin hoạt động trước kiểm thử moderation. | Bảo đảm kiểm thử quy tắc cấm tự duyệt survey của chính mình. |
| A11 | `NEXT_PUBLIC_API_MOCKING` là biến build-time. | Phải build artifact staging/production với mock tắt; không dựa vào thay đổi runtime. |
| A12 | Các hợp đồng `assumed` chưa phải cam kết triển khai. | Mỗi gap cần owner, milestone, test và quyết định trước G1. |

## 4. Chín luồng công việc

| WS | Luồng công việc | Mục tiêu | Chủ trì đề xuất | Đầu ra chính |
|---|---|---|---|---|
| WS1 | Contract inventory | Một sổ hợp đồng chuẩn, truy vết từ frontend đến controller/schema | Integration Lead | Inventory, gap register, coverage report |
| WS2 | Integration foundation | Vòng lặp local real-stack, proxy `/api`, seed và mock toggle | Frontend Lead + Backend Lead | Local stack, config, persona seed |
| WS3 | Vertical journeys | Chuyển từng hành trình sang backend thật | Product Engineering Leads | Journey evidence, E2E và acceptance record |
| WS4 | Auth boundary | Same-origin session, CSRF, OAuth và client IP đáng tin | Security/Auth Owner | Auth test pack, origin/callback config |
| WS5 | Deployment packaging | Image production, health probes, compose và Caddy | Platform Engineer | Immutable image, compose, proxy config |
| WS6 | Cloud infrastructure | Staging/production cô lập, DB private, bucket private, ClamAV | Cloud/Platform Owner | Hạ tầng và runbook |
| WS7 | Delivery pipeline | Verify, build, scan, migrate, deploy, smoke, promote/rollback | DevOps Owner | CI/CD pipeline, release manifest |
| WS8 | Operational readiness | Log, Sentry, alert, backup/restore và incident ownership | SRE/Operations Owner | Dashboards, alerts, drill evidence |
| WS9 | Launch governance | Freeze, go/no-go, cohort, smoke và hậu kiểm | Release Manager | Checklist, quyết định và pilot report |

## 5. Kế hoạch theo cổng G0–G7

### G0 — Quyết định và quyền sở hữu

**Mục tiêu:** Chốt hành trình launch, kiến trúc đích, phạm vi và người chịu trách nhiệm.

**Công việc**

- Chỉ định Integration Lead, Release Manager và owner cho frontend, backend, auth/security, platform/cloud, QA và operations.
- Chốt danh sách hành trình pilot theo thứ tự ưu tiên nêu tại mục 6.
- Xác nhận AD-23 là đích triển khai. Nếu chọn generic VPS, tạo architecture change mô tả trách nhiệm backup, database, storage và operations.
- Chốt origin `app.rescom.com.vn`, quy tắc relative `/api`, topology browser → Vercel UI → external rewrite `/api` → public API edge/Cloudflare → Caddy backend trên GCE → NestJS private port 4000, và nguyên tắc same-host OAuth callback.
- Chốt phạm vi analytics và quyết định có đưa external completion, consent/telemetry vào pilot hay không.
- Lập danh sách secret, credential và dữ liệu placeholder phải bị chặn trước launch.
- Chỉ định hai admin riêng biệt cho moderation và bộ tài khoản synthetic theo persona.

**Phụ thuộc:** Không.  
**Chủ trì:** Product Owner, Architect, Integration Lead.  
**Bàn giao:** Scope baseline, owner map, decision log, launch-journey list, architecture confirmation.  
**Exit gate:** Mọi quyết định ảnh hưởng hợp đồng hoặc hạ tầng có owner và hạn; không còn phạm vi pilot mơ hồ.

### G1 — Kiểm kê và đóng băng hợp đồng

**Mục tiêu:** Biết chính xác frontend gọi gì và backend đáp ứng đến đâu.

**Công việc**

- Kiểm kê từng endpoint frontend thực sự gọi, kể cả consumer trực tiếp `mockRepository`.
- Ánh xạ từng call sang backend controller và schema dùng chung.
- Ghi access mode: public, session, CSRF hoặc quyền vai trò.
- Phân loại `verified`, `assumed`, `mock-only`; cấm trạng thái không rõ.
- Đưa các gap trọng yếu vào sổ tại mục 7; chỉ định owner, milestone, acceptance test.
- Kiểm kê cơ học mọi route progress, complaints, admin disputes và quality còn reachable; route nào không thuộc pilot phải được ẩn hoặc build-time exclude một cách tường minh tại G1, không được để trạng thái ngầm định.
- Chốt schema request/response/error, status code, idempotency và pagination nếu có.
- Tạo contract coverage report từ frontend path; đặt ngưỡng không còn call launch-critical thiếu ánh xạ.
- Quyết định loại bỏ, ẩn hoặc build-time exclude các mock-only route.

**Phụ thuộc:** G0.  
**Chủ trì:** Integration Lead; Frontend Lead và Backend Lead đồng sở hữu.  
**Bàn giao:** Canonical contract register, gap register, shared-schema map, coverage report.  
**Exit gate:** 100% call thuộc hành trình pilot được ánh xạ; mọi `assumed` có owner và milestone; các route progress, complaints, admin disputes và quality reachable đã được kiểm kê cơ học hoặc ẩn rõ ràng; không còn mock-only route có thể truy cập trong build pilot.

### G2 — Nền tảng real-stack local

**Mục tiêu:** Tạo vòng lặp phát triển nhanh với frontend và backend thật.

**Công việc**

- Cấu hình frontend giữ relative `/api` trong mọi môi trường.
- Thiết lập local proxy, session cookie, CSRF exact-origin và same-host callback tương đương hành vi của topology đích, trong đó browser chỉ gọi `/api` dù backend ở hop riêng.
- Xây cơ chế hybrid per-domain mock toggle để chuyển đổi có kiểm soát; hiển thị banner môi trường/mock rõ ràng.
- Tạo seed command xác định cho respondent, publisher, hai admin và tài khoản smoke.
- Chứng minh shell + email auth + demographics bằng backend thật.
- Đo baseline unit, integration, E2E hiện tại; bổ sung contract test cho slice đầu tiên.
- Xác định build-time và runtime variables; xác nhận không có secret trong source/image.
- Kiểm tra migration count, DB prerequisite và chạy `prisma migrate deploy` trong luồng local tương đương pipeline.

**Phụ thuộc:** G1 đủ cho slice đầu tiên.  
**Chủ trì:** Frontend Lead, Backend Lead, QA Lead.  
**Bàn giao:** Local real-stack guide, seed command, config sample không chứa secret, test baseline, auth/demographics evidence.  
**Exit gate:** Developer mới có thể chạy slice auth/demographics không qua MSW; session, CSRF và post-login routing xác định hoạt động; unhandled MSW request không âm thầm lọt sang backend thật.

### G3 — Chấp nhận vertical slice khi tắt mock

**Mục tiêu:** Hoàn thành bằng chứng nghiệp vụ đầu-cuối trước khi đầu tư cutover.

**Công việc**

- Chuyển theo thứ tự: marketplace → survey summary → attempt lifecycle → pinned form → completion → reward/wallet/notification → publisher/publishing → moderation → analytics được duyệt.
- Với mỗi flow, kiểm thử các trạng thái áp dụng: success, unauthorized, forbidden, validation, conflict, rate-limit, session expiry, offline, idempotency và empty state.
- Chạy concurrency test cho reserve/start attempt.
- Kiểm tra form read luôn bị pin theo attempt, không bị thay đổi bởi phiên bản survey mới.
- Xác thực time barrier cho external completion bằng clock controls nếu flow này thuộc pilot.
- Xác thực ledger invariant: reward/top-up tạo entry thật, không cập nhật balance bằng shortcut.
- Xác thực publisher draft idempotency, escrow và insufficient-balance.
- Xác thực moderation bằng hai admin, bao gồm self-review protection.
- Loại bỏ consumer `mockRepository` còn lại trong phạm vi launch.

**Phụ thuộc:** G2; endpoint gap tương ứng phải được xử lý.  
**Chủ trì:** Product Engineering Leads; QA Lead xác nhận bằng chứng.  
**Bàn giao:** Journey test pack, contract results, ledger/concurrency evidence, mock-consumer closure list.  
**Exit gate:** Ít nhất một hành trình respondent hoàn chỉnh chạy không MSW và một hành trình publisher hoàn chỉnh tạo ledger entry thật; toàn bộ hành trình pilot đã định không còn phụ thuộc mock.

### G4 — Đóng gói và hạ tầng staging

**Mục tiêu:** Có artifact tái lập và staging cô lập giống production.

**Công việc**

- Tạo image Node 22 multi-stage, non-root, tag commit SHA bất biến; scan image và chứng minh không nhúng secret.
- Tạo production compose cho backend, Caddy reverse proxy và private backend network trên GCE; không public port NestJS 4000. Frontend UI được deploy riêng trên Vercel, không chạy trong compose và không do Caddy phục vụ.
- Tách liveness và readiness; readiness phân biệt lỗi API với dependency.
- Chỉ định một scheduler owner cho một API replica.
- Provision staging với database, bucket, OAuth client/secret, domain và synthetic accounts riêng; cấm dữ liệu production.
- Cấu hình private bucket, presigned URL lifecycle và ClamAV network; kiểm thử fail-closed.
- Cấu hình PostgreSQL private, connection limit và backup trước khi có pilot data.
- Cấu hình trusted proxy để rate limit nhận đúng real client IP xuyên suốt Vercel external rewrite → public API edge/Cloudflare → Caddy → NestJS.
- Thiết lập pipeline: verify → build SHA image → scan → push → backup check → backward-compatible migrate → deploy một replica → readiness → smoke → promote hoặc rollback.
- Sinh release manifest gồm image, schema và config versions.

**Phụ thuộc:** G3 cho artifact ứng dụng; G0 architecture confirmation.  
**Chủ trì:** Platform/Cloud Owner, DevOps Owner.  
**Bàn giao:** Image, compose, Caddy config, staging, CI/CD, release manifest, infrastructure runbook.  
**Exit gate:** Staging tái tạo đúng domain/proxy topology browser → Vercel UI → external rewrite `/api` → public API edge/Cloudflare → Caddy backend → NestJS private port 4000; deploy và rollback previous backend image chạy bằng quy trình đã ghi; DB/bucket không public; migration chỉ chạy qua pipeline kiểm soát.

### G5 — Staging UAT và sẵn sàng production

**Mục tiêu:** Chứng minh ứng dụng, vận hành và phục hồi trước cutover.

**Công việc**

- Build staging với `NEXT_PUBLIC_API_MOCKING` tắt và kiểm tra không còn mock route reachable.
- Chạy toàn bộ journey matrix trên synthetic accounts.
- Kiểm thử Google OAuth callback qua canonical same-host `/api` và toàn bộ chuỗi Vercel rewrite → public API edge/Cloudflare → Caddy → NestJS, bao gồm session persistence và cookie behavior.
- Kiểm thử CSRF bằng exact allowed origins; xác nhận không dùng wildcard CORS với credentials.
- Kiểm thử upload: presign, upload, scan, finalize; giả lập storage/ClamAV lỗi và xác nhận fail-closed + alert.
- Thiết lập structured logs có correlation, Sentry release ID/PII scrubbing và trace cho critical flows.
- Thiết lập uptime, synthetic login, DB connection/disk alarms và ClamAV health alert.
- Diễn tập backup/PITR restore; ghi RTO/RPO quan sát được từ drill thay vì giả định.
- Diễn tập deploy previous image và xác nhận tương thích schema; chọn forward fix hoặc reviewed restore cho sự cố dữ liệu.
- Chạy performance baseline phù hợp một replica và current abuse profile.
- Kiểm tra không còn default credential, placeholder bank data hoặc production secret sai nguồn.
- Tổ chức UAT và lập gói bằng chứng go/no-go.

**Phụ thuộc:** G4.  
**Chủ trì:** QA Lead, Operations Owner, Security/Auth Owner, Release Manager.  
**Bàn giao:** UAT report, security/auth evidence, restore/rollback drill report, observability evidence, go-live checklist.  
**Exit gate:** Tất cả Must item đạt; không có lỗi launch-critical mở; restore và rollback đã chạy thành công; người trực incident và rotation procedure đã được chỉ định.

### G6 — Dark deploy và pilot giới hạn

**Mục tiêu:** Đưa production lên an toàn, quan sát trước rồi mở cho cohort nhỏ.

**Công việc**

- Thiết lập freeze window và họp go/no-go dựa trên bằng chứng G5.
- Backup check và xác nhận rollback artifact còn sẵn trước deploy.
- Chạy controlled migration bằng `prisma migrate deploy`.
- Dark deploy production một replica; kiểm tra TLS health endpoint, liveness/readiness và dependency probes.
- Chạy smoke bằng tài khoản production test chuyên dụng; không dùng dữ liệu người dùng thật và không đưa mock records vào production.
- Xác nhận shell/auth, respondent journey, publisher ledger, moderation và alerting.
- Mở cohort giới hạn; theo dõi error, session loss, latency, rate limit, DB connection/disk, ClamAV và business failures.
- Thực hiện rollback ngay khi vượt điều kiện dừng đã duyệt; không cố sửa trực tiếp trong freeze window nếu rollback an toàn hơn.
- Sau thời gian quan sát đạt tiêu chí, ra quyết định mở general pilot.

**Phụ thuộc:** G5 và go decision.  
**Chủ trì:** Release Manager; DevOps và Operations thực thi; Product Owner quyết định cohort.  
**Bàn giao:** Production release record, smoke evidence, cohort report, incident/rollback record nếu có.  
**Exit gate:** Limited cohort hoàn tất không có sự cố launch-critical; business journeys và observability ổn định; general pilot được phê duyệt rõ ràng.

### G7 — Hậu kiểm và portability

**Mục tiêu:** Ổn định sau launch và giảm rủi ro vận hành dài hạn.

**Công việc**

- Tổng kết pilot: gap hợp đồng, lỗi journey, incident, support signal và hiệu quả cổng kiểm soát.
- Đóng các workaround/hybrid mock còn lại; xác nhận AI entry point vẫn ẩn.
- Lập lịch restore drill định kỳ, secret rotation, dependency/image update và kiểm tra rollback artifact retention.
- Kiểm tra portability của PostgreSQL/S3 interface; lập kế hoạch rehearsal automation nếu có giá trị.
- Đánh giá nhu cầu synthetic journeys tự động, cohort flags, dashboard nâng cao và scaling; không tự động mở rộng replica/Redis ngoài phạm vi.
- Cập nhật release/runbook từ bằng chứng thực tế.

**Phụ thuộc:** G6.  
**Chủ trì:** Operations Owner, Architect, Product Owner.  
**Bàn giao:** Pilot retrospective, remediation backlog, updated runbooks, portability assessment.  
**Exit gate:** Không còn remediation launch-critical chưa có owner; lịch vận hành định kỳ được nhận trách nhiệm; quyết định giai đoạn tiếp theo được ghi nhận.

## 6. Kế hoạch chi tiết theo hành trình người dùng

### 6.1 Shell và email authentication

- Thay nguồn mock của session, notification shell và onboarding guard bằng API thật.
- Dùng relative `/api`; kiểm tra login, logout, refresh/navigation, session expiry và unauthorized redirect.
- Xác thực cookie cùng origin, CSRF token/origin và thông báo lỗi rõ ràng khi offline/rate-limited.
- Bằng chứng hoàn tất: login tồn tại qua navigation, logout hủy session, session hết hạn được xử lý không mất trạng thái âm thầm.

### 6.2 Google OAuth

- Đăng ký callback trên canonical frontend host qua `/api`.
- Kiểm tra intent, callback, cookie, CSRF/state và post-login routing trên staging topology.
- Không cho qua G5 nếu local hoạt động nhưng staging subdomain làm mất cookie/session.
- Bằng chứng hoàn tất: OAuth thành công và các trường hợp callback sai/expired/denied trả về trạng thái có thể xử lý.

### 6.3 Demographics và onboarding

- Ánh xạ schema frontend–backend bằng shared Zod schema nếu có trong inventory.
- Kiểm thử empty/partial profile, validation, save conflict và deterministic routing sau login.
- Loại bỏ direct mock repository ở onboarding guard.
- Bằng chứng hoàn tất: profile hợp lệ điều hướng đúng; profile thiếu dữ liệu vào đúng bước bổ sung.

### 6.4 Marketplace và survey summary

- Seed tập survey xác định để kiểm tra eligibility, danh sách rỗng và survey không còn khả dụng.
- Hoàn thiện và xác minh `GET /surveys/:id`.
- Kiểm thử public/session/forbidden theo contract, dữ liệu stale và rate limit.
- Bằng chứng hoàn tất: respondent chỉ thấy survey đủ điều kiện và mở được summary thật.

### 6.5 Attempt lifecycle và pinned form

- Hoàn thiện `GET /attempts/:id`, `POST /attempts/:id/cancel`, `GET /attempts/:id/outcome` và endpoint đọc form được pin theo attempt.
- Kiểm thử start, reserve, read, resume, cancel và outcome; thêm concurrency test cho reservation.
- Kiểm thử unauthorized, forbidden, not-found, conflict, expired/session expiry và idempotent retry.
- Bằng chứng hoàn tất: attempt không bị cấp trùng; resume giữ đúng form version; cancel/outcome nhất quán.

### 6.6 Internal submission

- Dùng shared schema để xác thực answer client/server.
- Kiểm thử câu trả lời hợp lệ, thiếu/sai kiểu, duplicate submit, offline retry và conflict.
- Xác nhận submission thành công chuyển attempt sang trạng thái đúng và kích hoạt transaction event cần thiết.
- Bằng chứng hoàn tất: không có answer không hợp lệ lọt qua; retry không tạo completion/reward trùng.

### 6.7 External completion tùy chọn

- Chỉ triển khai nếu G0 xác nhận thuộc pilot.
- Dùng clock controls để xác minh time barrier; kiểm thử callback/return, expired attempt và replay.
- Quyết định consent endpoints nếu telemetry được đưa vào phạm vi.
- Bằng chứng hoàn tất: completion trước thời gian bị từ chối; completion hợp lệ chỉ được ghi nhận một lần.

### 6.8 Reward, wallet, top-up và notification

- Xác minh reward và top-up bằng ledger entries; cấm shortcut sửa balance trực tiếp.
- Kiểm thử duplicate event/idempotency, insufficient state, empty wallet và transaction ordering.
- Xác minh top-up approval có audit log và đúng admin accountability.
- Xác minh notification bắt nguồn từ transaction/outbox semantics; thay direct mock consumer.
- Bằng chứng hoàn tất: tổng ledger giải thích được số dư; retry không nhân đôi reward/top-up/notification.

### 6.9 Publisher forms và publishing

- Kiểm thử tạo/sửa draft với idempotency để không tạo draft trùng.
- Kiểm thử publish với escrow fixture, đủ tiền, thiếu tiền, validation, conflict và retry.
- Chứng minh hành trình publisher hoàn chỉnh tạo ledger entry thật.
- Bằng chứng hoàn tất: một yêu cầu logic tạo một draft; publish/escrow nhất quán sau retry.

### 6.10 Moderation

- Chuẩn bị hai admin hoạt động; admin không được duyệt survey của chính mình.
- Kiểm thử queue rỗng, approve/reject, forbidden, concurrent decision và audit trail.
- Bằng chứng hoàn tất: self-review bị chặn; quyết định chỉ ghi một lần và truy vết được người thực hiện.

### 6.11 File upload

- Kiểm thử presign → upload private object → scan → finalize.
- Kiểm tra expired presign, sai object/metadata, storage unavailable và ClamAV unavailable/infected.
- ClamAV lỗi phải fail-closed và tạo log/alert có correlation.
- Bằng chứng hoàn tất: object không public; file chưa scan/không an toàn không được finalize.

### 6.12 Analytics và consent

- Chỉ bật analytics đã được xác nhận ở G0; ẩn entry point AI.
- Nếu telemetry thuộc phạm vi, chốt và kiểm thử consent endpoints trước G1 exit.
- Kiểm tra PII scrubbing trong Sentry/log/trace.
- Bằng chứng hoàn tất: không thu thập ngoài consent/phạm vi; không lộ PII trong observability.

## 7. Sổ khoảng trống hợp đồng API

> Trạng thái ban đầu là `assumed` vì nguồn chỉ xác định đây là gap; owner phải cập nhật sang `verified` sau khi có controller/schema và test bằng chứng.

| ID | Hợp đồng/gap | Trạng thái đầu | Ưu tiên | Owner đề xuất | Milestone | Bằng chứng đóng gap |
|---|---|---|---|---|---|---|
| API-01 | `GET /surveys/:id` | assumed | Must | Backend Survey Owner | G1 thiết kế, G3 chấp nhận | Contract test + marketplace/summary E2E |
| API-02 | `GET /attempts/:id` | assumed | Must | Backend Attempt Owner | G1/G3 | Contract test + read/resume E2E |
| API-03 | `POST /attempts/:id/cancel` | assumed | Must | Backend Attempt Owner | G1/G3 | Idempotency/conflict test + cancel E2E |
| API-04 | `GET /attempts/:id/outcome` | assumed | Must | Backend Attempt Owner | G1/G3 | Contract test + outcome E2E |
| API-05 | Endpoint đọc form được pin theo attempt | assumed | Must | Backend Survey/Attempt Owners | G1 thiết kế, G3 chấp nhận | Version-pinning integration test |
| API-06 | Consent endpoints nếu telemetry thuộc pilot | assumed/conditional | Must nếu in-scope | Privacy/Product Owner + Backend Owner | Quyết định G0, đóng G1/G3 | Consent contract + telemetry acceptance test |
| API-07 | Shell/session source thay `mockRepository` | mock-only/unknown | Must | Frontend Lead + Auth Owner | G2 | Auth/session E2E không MSW |
| API-08 | Notification source thay `mockRepository` | mock-only/unknown | Must | Frontend Lead + Notification Owner | G3 | Transaction/outbox-to-UI E2E |
| API-09 | Feedback source thay `mockRepository` | mock-only/unknown | Must nếu reachable | Product Owner + Frontend Lead | Quyết định G1, đóng G3 | Loại bỏ/ẩn hoặc contract + E2E |
| API-10 | Onboarding guard source thay `mockRepository` | mock-only/unknown | Must | Frontend Lead + Profile Owner | G2 | Deterministic routing E2E |
| API-11 | Legacy respondent page | mock-only/unknown | Must nếu reachable | Product Owner + Frontend Lead | Quyết định G1, đóng G3 | Loại bỏ/redirect hoặc backend E2E |
| API-12 | `POST /auth/password/forgot` | assumed; cần quyết định in-scope/hidden | Must nếu reachable | Product Owner + Auth Owner | Quyết định phạm vi G1; triển khai/ẩn trước G3 | Nếu in-scope: contract test, rate-limit/privacy test và E2E yêu cầu quên mật khẩu; nếu out-of-scope: entry point không reachable trong build pilot |
| API-13 | `GET /integrity/reliability/me` | assumed; cần quyết định in-scope/hidden | Must nếu reachable | Product Owner + Integrity Owner | Quyết định phạm vi G1; triển khai/ẩn trước G3 | Nếu in-scope: contract/authorization test và E2E trạng thái reliability; nếu out-of-scope: consumer/entry point bị ẩn hoặc build-time exclude |
| API-14 | `GET /forms/:id/responses` | assumed; cần quyết định in-scope/hidden | Must nếu reachable | Product Owner + Forms Owner | Quyết định phạm vi G1; triển khai/ẩn trước G3 | Nếu in-scope: contract, authorization, empty-state và pagination test cùng E2E; nếu out-of-scope: route UI không reachable |
| API-15 | `GET /forms/:id/analytics` | assumed; cần quyết định in-scope/hidden | Must nếu reachable | Product Owner + Analytics/Forms Owner | Quyết định phạm vi G1; triển khai/ẩn trước G3 | Nếu in-scope: contract, authorization, empty-state và scoped analytics E2E; nếu out-of-scope: analytics entry point bị ẩn/build-time exclude |

Quy tắc quản trị sổ:

- `verified`: có route/controller/schema thực, access mode và test pass.
- `assumed`: frontend đang trông đợi nhưng chưa có đủ bằng chứng backend; bắt buộc có owner và milestone.
- `mock-only`: chỉ tồn tại trong mock; phải loại bỏ, ẩn/build-time exclude hoặc được thiết kế thành hợp đồng thật.
- Ngoài các dòng đã biết, G1 phải dùng kiểm kê cơ học để phát hiện mọi route **progress**, **complaints**, **admin disputes** và **quality** còn reachable. Mỗi route phải được thêm vào sổ với owner/milestone/evidence hoặc được ghi nhận là out-of-scope và ẩn/build-time exclude rõ ràng.
- Không endpoint launch-critical nào được giữ `assumed` hoặc `mock-only` khi qua G3.

## 8. Ma trận môi trường và cấu hình

| Hạng mục | Local integration | Staging | Production |
|---|---|---|---|
| Browser API path | Relative `/api` | Relative `/api` | Relative `/api` |
| Mock mode | Hybrid theo domain, có banner | `NEXT_PUBLIC_API_MOCKING` tắt tại build time | Tắt tại build time; mock route không reachable |
| UI hosting | Local frontend | Vercel staging/preview tương ứng | `app.rescom.com.vn` trên Vercel `sin1`; Caddy không phục vụ UI |
| Domain/proxy | Mô phỏng browser chỉ gọi same-origin `/api` | Mirror chuỗi Vercel external rewrite → API edge/Cloudflare → Caddy → Nest private port | Browser → `app.rescom.com.vn` trên Vercel → external rewrite `/api` → public API edge/Cloudflare → Caddy trên GCE → NestJS private port 4000 |
| OAuth | Local client riêng; callback qua frontend `/api` | OAuth client/secret riêng, callback same-host `/api` đi qua full proxy chain | Production client/secret, callback `app.rescom.com.vn/api/...` qua Vercel rewrite và backend chain |
| CSRF/CORS | Exact local origin | Exact staging origin | Exact production origin; không wildcard với credentials |
| Database | Local isolated PostgreSQL | DB riêng, không production data | Cloud SQL private IP |
| Migration | `prisma migrate deploy` trong luồng thử nghiệm | Pipeline-controlled | Pipeline-controlled sau backup check |
| Object storage | Bucket/emulator cô lập | Private bucket riêng | Private GCS bucket qua S3 API |
| ClamAV | Bật để test success/failure | Bật, fail-closed, có alert | Bật, fail-closed, có alert |
| API replicas | Một | Một | Một trong pilot |
| Image | Dev/local build có truy vết | Commit SHA immutable | Cùng artifact đã promote, SHA immutable |
| Secrets | Local secret ngoài Git | Secret riêng staging | Managed secret; không Git/image; có rotation |
| Data/accounts | Seed persona xác định | Synthetic respondent/publisher/2 admin | Tài khoản smoke chuyên dụng; không mock records |
| Observability | Structured logs tối thiểu | Sentry + logs + traces + alerts | Sentry PII scrubbed, release ID, uptime/alarms |
| Health | Liveness/readiness | Qua external rewrite, public API edge và backend proxy topology tương đương | TLS documented health qua API edge/Caddy; liveness và readiness backend tách biệt |
| Backup/restore | Migration safety check | Restore rehearsal | Backup/PITR và restore procedure đã diễn tập |
| Environment banner | Hiển thị mock/domain state | Hiển thị staging rõ ràng | Không gây nhầm với staging; không lộ config nhạy cảm |

Phân loại biến cấu hình:

- **Build-time:** tối thiểu gồm `NEXT_PUBLIC_API_MOCKING`; artifact staging/production phải được kiểm tra giá trị tại lúc build.
- **Runtime không nhạy cảm:** topology/proxy, release ID, health/dependency settings và feature flags phù hợp.
- **Runtime secret:** DB credentials, OAuth secret, storage credentials, Sentry credential và secret ứng dụng; tuyệt đối không nhúng vào image hoặc Git.
- Mọi release manifest phải ghi image SHA, schema version và config version, không ghi giá trị secret.

## 9. Ma trận kiểm thử

| Lớp kiểm thử | Đối tượng | Môi trường | Điều kiện bắt buộc | Owner |
|---|---|---|---|---|
| Unit | Validation, state mapping, ledger rules | CI | Pass trước build image | FE/BE Engineers |
| Contract | Frontend path ↔ controller/schema | CI/local | 100% route pilot được phân loại và test | Integration Lead |
| Integration | DB, migration, ledger, outbox, pinned form | Local/CI | Không dùng balance shortcut; migration sạch | Backend Lead |
| Auth/security | Session, CSRF, OAuth, exact origins, trusted proxy | Local/staging | Same-host cookie và callback; real IP đúng | Security/Auth Owner |
| E2E respondent | Auth → demographics → marketplace → attempt → completion → reward | Local/staging | Hoàn chỉnh không MSW | QA Lead |
| E2E publisher | Draft → publish → escrow/ledger | Local/staging | Ledger entry thật; idempotency | QA Lead |
| E2E moderation | Hai admin, self-review protection | Staging | Self-review bị chặn; audit đầy đủ | QA Lead |
| Concurrency | Attempt reservation/start; moderation decision | CI/staging | Không cấp/ghi quyết định trùng | Backend + QA |
| Failure modes | unauthorized, forbidden, validation, conflict, rate-limit, expiry, offline, empty | Local/staging | Bao phủ khi áp dụng cho từng flow | QA Lead |
| Upload | Presign, private upload, scan, finalize | Staging | Storage/ClamAV lỗi fail-closed | Backend + Platform |
| Deployment | Build, scan, migrate, readiness, smoke | Staging/prod | Một artifact SHA; không secret | DevOps Owner |
| Rollback | Previous image + schema compatibility | Staging | Một quy trình/lệnh đã diễn tập | DevOps + DBA/BE |
| Backup restore | Backup/PITR restore | Staging | Restore dữ liệu dùng được, có biên bản | Operations Owner |
| Observability | Correlation, Sentry trace, alerts, PII scrubbing | Staging | Critical flow truy vết được; alert tới owner | Operations Owner |
| Performance | Một replica dưới abuse profile hiện tại | Staging | Baseline được ghi và chấp nhận | QA + Operations |
| Production smoke | Health + synthetic business journeys | Production | Dùng tài khoản test riêng; không chạm dữ liệu thật | Release Manager |

Mỗi hành trình phải đánh dấu rõ trạng thái nào trong bộ sau có áp dụng và có test: `success`, `unauthorized`, `forbidden`, `validation`, `conflict`, `rate-limit`, `session expiry`, `offline`, `idempotency`, `empty state`.

## 10. Sổ rủi ro

| ID | Rủi ro | Khả năng/Tác động | Phòng ngừa | Trigger và ứng phó | Owner |
|---|---|---|---|---|---|
| R01 | MSW request không xử lý âm thầm rơi sang backend thật | Cao/Cao | Hybrid toggle có kiểm soát, fail visibility, contract coverage | Phát hiện call không phân loại → chặn gate, không tiếp tục rollout | Frontend Lead |
| R02 | Endpoint assumed gây 404 ở màn hình chính | Cao/Cao | Canonical gap register, owner/milestone | 404 route pilot → rollback domain toggle hoặc chặn G3 | Integration Lead |
| R03 | OAuth local pass nhưng production mất cookie qua multi-hop rewrite | Trung/Cao | Same-host callback `/api`, staging mirror đầy đủ Vercel → API edge/Cloudflare → Caddy → Nest | Callback/session fail → no-go; sửa config/architecture trước production | Auth Owner |
| R04 | CSRF/CORS cấu hình rộng hoặc sai origin | Trung/Cao | Exact allowlist, staging security test | Origin không hợp lệ được chấp nhận/hợp lệ bị chặn → stop release | Security Owner |
| R05 | Migration làm rollback phá dữ liệu | Trung/Rất cao | Expand-contract, backup check, compatibility review | Schema incompatible → forward fix hoặc reviewed restore; không blind down |
| R06 | Upload lọt khi ClamAV/storage lỗi | Trung/Cao | Private bucket, fail-closed, health/alert | Scanner unhealthy → chặn upload/finalize và báo động | Platform + Backend |
| R07 | Rate limit dùng sai IP sau chuỗi proxy | Trung/Cao | Trusted proxy config và test xuyên Vercel rewrite/Cloudflare/Caddy | Nhiều user cùng IP hoặc bypass → stop cohort và sửa proxy chain | Platform Owner |
| R08 | Secret/default credential/placeholder bank data vào production | Trung/Rất cao | Secret scanning, checklist blocking, rotation | Phát hiện → no-go/rotate ngay và audit exposure | Security Owner |
| R09 | Backup có nhưng không restore được | Trung/Rất cao | Restore/PITR rehearsal trước pilot | Drill fail → chặn G5, sửa backup/runbook | Operations Owner |
| R10 | Lost session làm người dùng mất niềm tin | Trung/Cao | Same-origin, expiry handling, synthetic login | Session drop tăng → đóng cohort/rollback và điều tra trace | Auth + Operations |
| R11 | Reward/top-up bị ghi trùng | Trung/Rất cao | Ledger invariants, idempotency, concurrency tests | Ledger mismatch → stop reward flow/cohort, reconcile và forward fix | Backend Owner |
| R12 | Admin tự duyệt survey | Thấp/Cao | Hai admin, server-side self-review protection | Audit phát hiện → khóa moderation, điều tra và sửa | Moderation Owner |
| R13 | Một replica quá tải | Trung/Cao | Performance baseline, connection limits, alarms | Vượt ngưỡng được duyệt → giảm cohort/rollback; chưa tự ý scale nhiều replica | Operations Owner |
| R14 | Mock data bị đưa vào production | Thấp/Cao | Tách dataset, production smoke accounts riêng | Phát hiện → dừng launch, cô lập/xóa theo quy trình được duyệt | Release Manager |
| R15 | Không truy vết được lỗi critical flow | Trung/Cao | Correlation logs, Sentry traces/release IDs | Incident không có trace → chặn G5/G6 mở rộng cohort | Operations Owner |
| R16 | Đổi sang VPS làm tăng trách nhiệm vận hành không được ghi nhận | Trung/Cao | Bắt buộc architecture change | Đề xuất VPS → dừng provisioning tới khi quyết định được duyệt | Architect |

## 11. RACI

Ký hiệu: **R** thực hiện, **A** chịu trách nhiệm cuối, **C** tham vấn, **I** được thông báo.

| Hoạt động | Product Owner | Integration Lead | FE Lead | BE Lead | QA Lead | Security/Auth | Platform/DevOps | Operations | Release Manager |
|---|---|---|---|---|---|---|---|---|---|
| Chốt phạm vi/hành trình pilot | A | R | C | C | C | C | I | I | C |
| Contract inventory/gap register | C | A/R | R | R | C | C | I | I | I |
| Local integration foundation | I | A | R | R | C | C | C | I | I |
| Vertical journey implementation | C | A | R | R | R | C | I | I | I |
| Same-origin auth/CSRF/OAuth | I | C | R | R | C | A/R | C | I | I |
| Image, staging, cloud, pipeline | I | C | C | C | C | C | A/R | C | I |
| Test/UAT và evidence pack | C | C | C | C | A/R | C | C | C | I |
| Backup/restore/observability | I | I | I | C | C | C | R | A/R | C |
| Go/no-go | A | C | I | I | C | C | C | C | R |
| Production deploy/rollback | I | I | I | C | C | C | R | R | A |
| Cohort và general pilot | A | C | I | I | C | I | C | R | R |
| Post-launch review | A | R | C | C | C | C | C | R | C |

## 12. Trình tự đề xuất trong 6 tuần

### Tuần 1 — G0 và G1

- Chốt scope, journey, architecture, owners, analytics/external completion/consent decisions.
- Hoàn tất inventory frontend calls và direct mock consumers.
- Phân loại contract; gán owner/milestone cho gap.
- Chốt exact origins, OAuth callback và config classification.
- **Kết quả tuần:** G0 đạt; G1 đạt hoặc chỉ còn gap đã có kế hoạch khóa rõ ràng.

### Tuần 2 — G2

- Dựng local real-stack, proxy `/api`, hybrid toggles, environment banner và deterministic seeds.
- Tích hợp shell, email auth, demographics; kiểm thử session, CSRF và routing.
- Thiết lập contract coverage và baseline tests.
- **Kết quả tuần:** Vertical slice đầu tiên chạy không MSW; G2 đạt.

### Tuần 3 — G3 phần respondent

- Tích hợp marketplace/survey summary.
- Tích hợp attempt start/read/resume/cancel/outcome và pinned form.
- Tích hợp internal submission; external completion nếu in-scope.
- Chạy concurrency, error-state và idempotency tests.
- **Kết quả tuần:** Hành trình respondent hoàn chỉnh chạy không mock.

### Tuần 4 — G3 phần publisher + G4 khởi động

- Tích hợp reward/wallet/top-up/notification, publisher draft/publish/escrow, moderation và upload.
- Đóng direct mock consumers còn lại; ẩn AI entry points.
- Song song đóng gói backend image non-root, backend compose/Caddy, health probes, staging và CI pipeline; frontend UI tiếp tục được triển khai trên Vercel.
- **Kết quả tuần:** Hành trình publisher tạo ledger thật; G3 đạt; staging sẵn sàng triển khai.

### Tuần 5 — G4 và G5

- Deploy staging với mock tắt, dữ liệu/tài khoản synthetic riêng.
- Chạy UAT, OAuth/CSRF/proxy/IP, upload/ClamAV, full journey và performance baseline.
- Hoàn thiện Sentry/log/alerts; diễn tập backup restore và previous-image rollback.
- **Kết quả tuần:** G4 và G5 đạt; evidence pack go/no-go hoàn chỉnh.

### Tuần 6 — G6 và khởi động G7

- Freeze, backup check, go/no-go, migrate, production dark deploy và smoke.
- Mở limited cohort, theo dõi và rollback nếu chạm stop condition.
- Nếu ổn định, phê duyệt general pilot; tổ chức retrospective và lập remediation backlog.
- **Kết quả tuần:** G6 đạt có bằng chứng; lịch G7 và owner hậu kiểm được chốt.

## 13. Definition of Done

Một hạng mục tích hợp hoặc release chỉ được coi là Done khi tất cả điều kiện áp dụng đều đạt:

- Contract được phân loại `verified`, ánh xạ frontend path → controller → schema → access mode.
- Không còn `assumed`/`mock-only` dependency trong hành trình launch tương ứng.
- Request browser dùng relative `/api`; session, CSRF và quyền được kiểm thử.
- Success và mọi failure state áp dụng đã có test: unauthorized, forbidden, validation, conflict, rate-limit, session expiry, offline, idempotency và empty state.
- Unit, contract, integration và E2E liên quan đều pass; concurrency test pass nơi có reservation/decision/ledger.
- Có bằng chứng chạy với mock tắt; không có direct `mockRepository` consumer reachable trong production build.
- Migration tương thích ngược, chạy bằng `prisma migrate deploy`; kế hoạch forward fix/restore được ghi rõ.
- Không secret trong Git/image/log; Sentry/log đã scrub PII.
- Image non-root được scan, gắn commit SHA bất biến và có release manifest.
- Liveness/readiness, structured logs, correlation, traces và alerts hoạt động.
- Backup check, restore drill và previous-image rollback đã được chứng minh theo gate tương ứng.
- Runbook, owner và evidence artifact được cập nhật; QA/Release Manager xác nhận ở lane riêng với lane authoring/implementation.
- Với release production: TLS health pass, synthetic smoke journeys pass, go/no-go được ghi nhận và rollback artifact còn sẵn.

## 14. Mười hành động tiếp theo ngay lập tức

1. Product Owner triệu tập phiên G0, chốt launch journey và quyết định external completion, analytics, consent có thuộc pilot hay không.
2. Chỉ định Integration Lead, Release Manager và owner theo RACI; tạo deadline cho mọi quyết định còn mở.
3. Frontend Lead xuất inventory toàn bộ endpoint và mọi direct `mockRepository` consumer trong phạm vi launch.
4. Backend Lead ánh xạ inventory sang controller/schema/access mode, khởi tạo ba trạng thái `verified`/`assumed`/`mock-only`.
5. Gán owner và milestone cho API-01 đến API-15; tại G1 quyết định in-scope hay hidden cho password forgot, reliability, form responses và form analytics, đồng thời kiểm kê cơ học các route progress/complaints/admin disputes/quality còn reachable.
6. Auth Owner chốt canonical `/api`, exact origins và Google OAuth callback trên `app.rescom.com.vn`; ghi rõ chuỗi Vercel external rewrite → public API edge/Cloudflare → Caddy → NestJS private port 4000 và xác định biến build-time/runtime.
7. QA Lead định nghĩa bộ persona seed gồm respondent, publisher, hai admin và tài khoản smoke chuyên dụng.
8. FE/BE Leads dựng vertical slice local shell + email auth + demographics với hybrid mock toggle và environment banner.
9. Platform Owner lập skeleton backend image Node 22 non-root, backend-only production compose/Caddy, NestJS private port 4000, liveness/readiness và release manifest; xác nhận UI chạy riêng trên Vercel và chưa deploy production.
10. Release Manager tạo evidence checklist G0–G7 và lịch review sáu tuần, trong đó restore drill, rollback drill và go/no-go là cổng bắt buộc.

## 15. Bộ bằng chứng tối thiểu cho quyết định go/no-go

- Contract coverage report không còn gap launch-critical mở.
- Báo cáo E2E respondent và publisher chạy với mock tắt.
- Bằng chứng ledger, idempotency, attempt concurrency và moderation self-review protection.
- Bằng chứng OAuth/session/CSRF trên staging topology giống production.
- Image scan, SHA tag và release manifest.
- Migration log, backup check, restore drill và previous-image rollback record.
- Upload/ClamAV fail-closed evidence.
- Sentry PII scrub, correlation trace và alert delivery evidence.
- Production smoke script sử dụng tài khoản test chuyên dụng.
- Checklist freeze, stop conditions, incident owner và quyết định go/no-go có người chịu trách nhiệm.
