Được. Dựa trên **SRS RESCOM v1.0** bạn cung cấp và toàn bộ những gì chúng ta vừa thống nhất — đặc biệt là việc **đã chuyển sang GO LIVE**, có **AI Form Generator + Drag & Drop Form Builder**, frontend dùng domain riêng và **AI chạy trên máy có GPU riêng** — tôi sẽ chốt cho bạn một kiến trúc production hoàn chỉnh.

> **Lưu ý quan trọng:** SRS hiện ghi Internal Form Builder là Giai đoạn 2, nhưng trong thiết kế dưới đây tôi coi **Form Builder + AI Form Generator là scope GO LIVE** theo quyết định mới của bạn. Đây là một thay đổi so với SRS và nên cập nhật lại SRS trước khi release. SRS hiện tại vẫn đang ở trạng thái Draft.  

# 1. Kiến trúc tổng thể tôi đề xuất

![Image](https://images.openai.com/static-rsc-4/Ze4aHwFgSqrSg80fLFEiw968lGsaQV5fzC8dd0bwUvLMBnQhtlYJBcrP8QJPdD3C4NAnWeTGwSUWs9_eKuljKehm4dR7QJwONS1izSZVXL_Zb_pggc7VmB3zuZvEFXr4iytOIopkYWy0M2SNwX6usyYis0cN0WTQYnr4wHllXwaqicom9UG4JGcKOrKThbuR?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/SkzoOLvrNXcVJFDF2qr-zJHXrHFLSrOWpgCvhPjUcsLBoojL94MmmwyEyF9mSWBG_n2FjIlTDJS2_LpQH22GkDuU6zFqsaHsyCUax4-PXkyqPgRo1UKx1lCsdJMaYThFZzYWmwcqkB8RyX6KItDAR5rRuJpS9617fehMeQDWE1FTGpxGSviMvE4_W9pE9E2p?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/RjWCFaL3GQCaB8jPbRttuqE_HxwCYDlnaTHKAaPJv-b7hDsfmvaSI4v8PAOI1H2Co_opkiLk5Zla81PO2tE7fMwH8F40zf1swAIaeM12SFUQPcKPbecBZpkV6Q7WtJ6oPHOKHTHXxPI8emmOV8j3ENm-A8egJ6bfFXQv2fTkUW5BSkOun8Cxwt0GX6k3gubL?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/2yQ9bvVaX8_AQ3tSpXRLAQpHkcgtOlWFvnHlft4-P5J9CNrA3qhzlcKwJkEMXg1GOHqXLwbjt0k9gCSAu5AuktLK5sG0qKoV7C9Eg-9UOcVLk7zaRrqUmoPJGekm1pWHfsngFG-PKNuFPJPO-UNZZhCB6U7hEKe9WRscmzaXLILhbVqBhJ_EJvfD3CLgFMBa?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/OC7Jdtq3DVOlLgp9qhsleJhwIcVdBDL7ZZLfR9AoptsGSqN2NLDLXXURnFHQAQAAY5bTl-l_Y3vFGPwlvt_HVqkOc_8jQkylUNKwWg85z-ZQFeQTVD5zsuJIS_19Si-IX9R-FCb_9kUvtQ0-zTn9IaoqCkBo1ECRl7BUWrSl0CYYgo-QcdpSg5mYE7pwd0sW?purpose=fullsize)

```text
                                      INTERNET
                                         │
                                         ▼
                              ┌────────────────────┐
                              │     CLOUDFLARE     │
                              │                    │
                              │ DNS / Proxy / SSL  │
                              │ Basic DDoS / CDN   │
                              └─────────┬──────────┘
                                        │
                  ┌─────────────────────┼─────────────────────┐
                  │                     │                     │
                  ▼                     ▼                     ▼
        rescom.com.vn          api.rescom.com.vn    survey.rescom.com.vn
                  │                     │                     │
                  ▼                     │                     │
           ┌─────────────┐              │                     │
           │   VERCEL    │              │                     │
           │             │              │                     │
           │ Next.js     │              │                     │
           │ TypeScript  │              │                     │
           │ App Router  │              │                     │
           └──────┬──────┘              │                     │
                  │                     │                     │
                  └──────────────┬──────┴─────────────────────┘
                                 │
                              HTTPS
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │       PRODUCTION VPS     │
                    │                          │
                    │  4 vCPU / 16 GB RAM     │
                    │  200 GB NVMe             │
                    │  16 TB bandwidth         │
                    │                          │
                    │  ┌────────────────────┐  │
                    │  │ Reverse Proxy      │  │
                    │  │ Nginx / Caddy      │  │
                    │  └─────────┬──────────┘  │
                    │            │             │
                    │  ┌─────────▼──────────┐  │
                    │  │ Express Backend     │  │
                    │  │ Docker Container    │  │
                    │  └──────┬───────┬─────┘  │
                    │         │       │        │
                    └─────────┼───────┼────────┘
                              │       │
                              │       └─────────────────┐
                              │                         │
                              ▼                         ▼
                   ┌─────────────────┐       ┌──────────────────┐
                   │ Managed         │       │ Object Storage  │
                   │ PostgreSQL      │       │ S3 Compatible   │
                   │ Neon/Supabase   │       │                  │
                   └─────────────────┘       └──────────────────┘

                              │
                              │ Private VPN
                              │ Tailscale
                              ▼
                    ┌────────────────────────┐
                    │    AI INFERENCE HOST   │
                    │                        │
                    │ Gaming Laptop          │
                    │ NVIDIA GPU             │
                    │ Ollama                 │
                    │ Qwen                   │
                    │ Form Generator         │
                    └────────────────────────┘
```

Đây là kiến trúc tôi sẽ chọn cho **RESCOM production v1**.

---

# 2. Tôi sẽ chia hệ thống thành 6 hạ tầng

```text
1. Frontend Infrastructure
2. Backend Infrastructure
3. Database Infrastructure
4. File Storage Infrastructure
5. AI Infrastructure
6. Operations / Security Infrastructure
```

Không nên gom tất cả vào một VPS.

---

# 3. Frontend — Vercel + domain riêng

Bạn không cần bỏ Vercel.

Domain người dùng nhìn thấy là:

```text
https://rescom.com.vn
```

Vercel chỉ là infrastructure phía sau.

Tôi đề xuất:

```text
rescom.com.vn
        │
        └── Landing / Main App

app.rescom.com.vn
        │
        └── Authenticated Application

survey.rescom.com.vn
        │
        └── Public Survey

admin.rescom.com.vn
        │
        └── Admin Dashboard

api.rescom.com.vn
        │
        └── Backend API
```

Nếu muốn đơn giản hơn thì ban đầu chỉ cần:

```text
rescom.com.vn
api.rescom.com.vn
survey.rescom.com.vn
```

Frontend stack bám theo SRS:

```text
Next.js
TypeScript
App Router
Tailwind
shadcn/ui
Redux Toolkit
RTK Query
Framer Motion
```

Đây chính là stack SRS đang định hướng. 

---

# 4. Backend — VPS riêng

VPS của bạn:

```text
4 vCPU
16 GB RAM
200 GB NVMe
16 TB bandwidth
```

Tôi sẽ dùng nó cho:

```text
┌──────────────────────────┐
│ VPS                      │
│                          │
│ Docker                   │
│                          │
│ ┌──────────────────────┐ │
│ │ Nginx / Caddy         │ │
│ └──────────┬───────────┘ │
│            │             │
│ ┌──────────▼───────────┐ │
│ │ Express API          │ │
│ │ Node.js              │ │
│ └──────────────────────┘ │
└──────────────────────────┘
```

Backend stack:

```text
Node.js
Express 5
ES Modules
Prisma
Zod
JWT
HTTP-only Cookie
Helmet
CORS
express-rate-limit
```

SRS cũng đã xác định chính xác hướng này. 

---

# 5. Không đặt PostgreSQL production vào VPS

Đây là một quyết định tôi muốn **chốt rõ**.

### Local development

```text
Docker Compose
├── Backend
└── PostgreSQL
```

### Production

```text
Backend VPS
       │
       │ Connection Pool
       ▼
Managed PostgreSQL
```

Ví dụ:

```text
Neon
```

hoặc:

```text
Supabase PostgreSQL
```

SRS cũng đã định hướng PostgreSQL production trên Neon/Supabase và yêu cầu Connection Pooling. 

### Tại sao?

Vì RESCOM không phải CRUD app thông thường.

Bạn có:

```text
Point Ledger
Frozen Points
Pending Balance
Available Balance
Point Escrow
Auto Refund
FraudLog
Marketplace
Responses
```

và SRS yêu cầu:

* ACID transaction
* chống race condition
* Point Ledger không được sai lệch
* FraudLog append-only
* uptime ≥99%. 

Do đó database là thành phần **critical**.

---

# 6. Database architecture

Tôi sẽ thiết kế:

```text
                 Backend
                    │
                    ▼
            Connection Pool
                    │
                    ▼
        ┌───────────────────────┐
        │ PostgreSQL             │
        │ Managed                │
        └───────────────────────┘
                    │
       ┌────────────┼─────────────┐
       ▼            ▼             ▼
    Users        Surveys       Point Ledger
       │            │             │
       │            │             ├── Frozen
       │            │             ├── Pending
       │            │             ├── Available
       │            │             └── Escrow
       │            │
       │            ├── Questions
       │            ├── Responses
       │            └── Versions
       │
       ├── Profiles
       ├── Sessions
       └── FraudLog
```

---

# 7. Form System — trái tim mới của RESCOM

Đây là phần chúng ta vừa thiết kế.

Tôi khuyên bạn coi:

> **Form Definition JSON là một Domain Object chính của hệ thống.**

Không phải HTML.

Không phải React component.

Không phải dữ liệu chỉ dành cho AI.

---

## Form Definition

```json
{
  "schemaVersion": 1,

  "metadata": {
    "title": "Khảo sát sở thích ăn uống",
    "description": "..."
  },

  "settings": {
    "allowAnonymous": true,
    "showProgressBar": true,
    "shuffleQuestions": false
  },

  "sections": [
    {
      "id": "section_01",
      "title": "Thông tin chung",
      "order": 0,

      "questions": [
        {
          "id": "question_01",
          "type": "single_choice",
          "label": "Bạn thường ăn sáng ở đâu?",
          "required": true,

          "config": {
            "options": [
              {
                "id": "option_01",
                "label": "Tại nhà"
              },
              {
                "id": "option_02",
                "label": "Trường học"
              }
            ]
          }
        }
      ]
    }
  ]
}
```

---

# 8. Component Registry

Frontend có:

```ts
const QUESTION_REGISTRY = {
  text: TextBlock,

  textarea: TextareaBlock,

  number: NumberBlock,

  single_choice: SingleChoiceBlock,

  multiple_choice: MultipleChoiceBlock,

  rating: RatingBlock,

  linear_scale: LinearScaleBlock,

  date: DateBlock,

  file_upload: FileUploadBlock
};
```

Renderer:

```text
Form JSON
    │
    ▼
Question.type
    │
    ├── text
    │     ↓
    │  TextBlock
    │
    ├── rating
    │     ↓
    │  RatingBlock
    │
    ├── multiple_choice
    │     ↓
    │  MultipleChoiceBlock
    │
    └── file_upload
          ↓
       FileUploadBlock
```

Như vậy AI, Form Builder và Form Renderer **không phụ thuộc trực tiếp vào nhau**.

---

# 9. AI Form Generator

AI sẽ nằm **ngoài core business transaction**.

```text
Frontend
    │
    │ POST /ai/forms/generate
    ▼
Backend
    │
    ├── System Context
    ├── Form Schema
    ├── Question Registry
    ├── Survey Guidelines
    └── User Prompt
    │
    ▼
Tailscale
    │
    ▼
Gaming Laptop
    │
    ▼
Ollama
    │
    ▼
Qwen
```

AI trả:

```json
{
  "title": "...",
  "description": "...",
  "sections": [...]
}
```

**Không trả HTML.**

**Không trả React.**

**Không trả database ID.**

Backend sau đó:

```text
AI JSON
   ↓
Zod Validation
   ↓
Business Validation
   ↓
Normalize IDs
   ↓
Save Draft
```

---

# 10. AI Server

Bạn đang muốn tận dụng laptop gaming có GPU.

Tôi đồng ý cho **go-live ban đầu**, nhưng thiết kế theo hướng có thể thay server AI sau này.

```text
AI Gateway
     │
     ▼
AI Provider Interface
     │
     ├── Ollama
     │
     ├── Cloud AI (future)
     │
     └── Another GPU Server (future)
```

Backend không nên viết:

```ts
ollama.generate(...)
```

ở khắp nơi.

Mà:

```ts
aiService.generateForm(...)
```

↓

```text
AI Service
   ↓
Ollama Provider
```

Sau này đổi:

```text
Ollama
   ↓
Cloud GPU
```

không phải sửa business logic.

---

# 11. AI Server tuyệt đối không expose trực tiếp Internet

Không:

```text
Internet
    ↓
laptop-ip:11434
```

Mà:

```text
VPS
 │
 └── Tailscale
        │
        ▼
      Laptop
        │
        ▼
      Ollama
```

Backend là **client duy nhất** được phép gọi AI.

---

# 12. AI phải là optional dependency

Đây là nguyên tắc production rất quan trọng.

Nếu:

```text
Ollama DOWN
```

thì:

```text
❌ AI Generate Form
```

nhưng:

```text
✅ Login
✅ Survey Feed
✅ Create Manual Survey
✅ Submit Survey
✅ Point Ledger
✅ Marketplace
✅ Profile
✅ Admin
```

vẫn hoạt động.

Không để:

```text
AI down
   ↓
Backend down
   ↓
RESCOM down
```

---

# 13. Form Builder

Form Builder và AI Generator **cùng thao tác trên Form Definition**.

```text
                  Form Definition
                         ▲
                         │
          ┌──────────────┴──────────────┐
          │                             │
          │                             │
    AI Generator                  Drag & Drop Builder
          │                             │
          ▼                             ▼
       Generate                       Edit
```

Editor:

```text
┌─────────────┬───────────────────────┬─────────────────┐
│ Components  │ Canvas                │ Properties      │
│             │                       │                 │
│ Text        │ ┌───────────────────┐ │ Required ✓      │
│ Textarea    │ │ Họ và tên         │ │ Placeholder     │
│ Choice      │ └───────────────────┘ │                 │
│ Checkbox    │                       │                 │
│ Rating      │ ┌───────────────────┐ │ Min             │
│ Scale       │ │ Đánh giá ⭐⭐⭐⭐⭐ │ │ Max             │
│ File        │ └───────────────────┘ │                 │
│ Date        │                       │                 │
└─────────────┴───────────────────────┴─────────────────┘
```

---

# 14. Form versioning

Đây là **bắt buộc**.

Ví dụ:

```text
Survey
 │
 ├── Form Version 1
 │
 ├── Form Version 2
 │
 └── Form Version 3 ← Published
```

Publisher sửa:

```text
Version 3 Published
       │
       ▼
Create Version 4
       │
       ▼
Edit
       │
       ▼
Publish
```

Không sửa trực tiếp version đang được respondent sử dụng.

Response phải tham chiếu:

```text
survey_id
form_version_id
question_id
answer
```

Điều này đảm bảo analytics sau này không bị sai khi Publisher chỉnh sửa câu hỏi.

---

# 15. Marketplace

SRS xác định RESCOM là two-sided marketplace: Publisher đăng khảo sát, Respondent nhận khảo sát phù hợp. 

Kiến trúc:

```text
Publisher
   │
   ▼
Create Survey
   │
   ▼
Form Definition
   │
   ▼
Targeting
   │
   ▼
Calculate Escrow
   │
   ▼
Publish
   │
   ▼
Marketplace
   │
   ▼
Targeted Matching
   │
   ▼
Respondent Feed
```

---

# 16. Point System — phải tách riêng Domain

Tôi sẽ không để:

```text
SurveyService
```

tự ý:

```text
user.points += 20
```

Thay vào đó:

```text
Survey Service
      │
      ▼
Point Service
      │
      ▼
Ledger Transaction
```

Ví dụ:

```text
Publisher
   │
   │ 100 points
   ▼
Escrow
   │
   │ respondent completes
   ▼
Pending
   │
   │ 48h
   ▼
Available
```

SRS yêu cầu Frozen/Pending/Available/Escrow và Double-Entry Ledger. 

---

# 17. Point transaction phải ACID

Ví dụ Respondent hoàn thành survey:

```text
BEGIN TRANSACTION

1. Validate completion
2. Validate no duplicate attempt
3. Validate Time Barrier
4. Create Response
5. Create Pending Ledger Entry
6. Reduce Publisher Escrow
7. Create FraudLog if needed
8. Commit

COMMIT
```

Nếu bước 6 fail:

```text
ROLLBACK
```

Không có chuyện:

```text
Response created ✓
Points created ✓
Escrow failed ✗
```

SRS yêu cầu chống race condition và ACID transaction cho các giao dịch điểm. 

---

# 18. Background Jobs

Bạn có một số tác vụ **không nên chạy trực tiếp trong HTTP request**:

```text
Auto Refund
Pending → Available
Expired Survey
Fraud Processing
Email
Notifications
Analytics aggregation
```

Tôi khuyên:

```text
Backend
   │
   ▼
Job Scheduler
   │
   ├── Pending Balance Worker
   ├── Auto Refund Worker
   ├── Notification Worker
   └── Analytics Worker
```

### Một điểm cần nâng cấp

SRS hiện đề cập In-Memory Cache cho Time Barrier. 

Trong production **nếu chỉ có một backend instance thì vẫn dùng được**, nhưng nếu sau này scale:

```text
Backend 1
Backend 2
Backend 3
```

thì:

```text
Memory 1 ≠ Memory 2 ≠ Memory 3
```

Do đó Time Barrier và distributed jobs sau này nên chuyển sang Redis/centralized store.

---

# 19. File Upload

Không:

```text
Frontend
   ↓
Backend
   ↓
/uploads
   ↓
VPS
```

Vì file upload có thể làm đầy disk VPS.

Nên:

```text
Frontend
    │
    ▼
Backend
    │
    │ signed upload URL
    ▼
Object Storage
```

Ví dụ:

```text
S3-compatible storage
```

Database:

```json
{
  "fileId": "...",
  "storageKey": "surveys/abc/image.png",
  "mimeType": "image/png",
  "size": 123456
}
```

---

# 20. Authentication

Theo SRS:

```text
JWT
+
HTTP-Only Cookie
+
Google OAuth
```



Kiến trúc:

```text
Browser
   │
   │ HTTPS
   ▼
Backend
   │
   ├── JWT
   ├── HTTP-only cookie
   ├── Session validation
   └── RBAC
```

Roles:

```text
USER
PUBLISHER
RESPONDENT
ADMIN
```

Một user có thể đóng cả:

```text
Publisher
+
Respondent
```

vì bản chất RESCOM là marketplace hai chiều.

---

# 21. Security Layer

Tối thiểu:

```text
Cloudflare
      │
      ▼
HTTPS
      │
      ▼
Reverse Proxy
      │
      ▼
Helmet
      │
      ▼
CORS
      │
      ▼
Rate Limit
      │
      ▼
JWT
      │
      ▼
RBAC
      │
      ▼
Zod Validation
      │
      ▼
Business Validation
```

SRS cũng yêu cầu CORS, Helmet, rate limiting và nguyên tắc **không tin tưởng frontend**. 

---

# 22. Không tin frontend

Ví dụ frontend gửi:

```json
{
  "points": 1000
}
```

Backend:

```text
❌ Tin frontend
```

không được phép.

Backend phải tự:

```text
Database
 ↓
Available Balance
 ↓
Business Rule
 ↓
Calculate
```

Tương tự:

```text
startTime
```

phải do server ghi, đúng với SRS. 

---

# 23. CI/CD

Tôi khuyên:

```text
Developer
    │
    ▼
GitHub
    │
    ▼
Pull Request
    │
    ▼
CI
 ├── TypeScript
 ├── ESLint
 ├── Unit Test
 ├── Integration Test
 ├── Zod/schema test
 └── Build
    │
    ▼
Merge main
    │
    ▼
Deploy
```

Backend:

```text
GitHub
   ↓
Docker Build
   ↓
Container Registry
   ↓
VPS
   ↓
docker compose pull
   ↓
restart
```

Frontend:

```text
GitHub
   ↓
Vercel
   ↓
Production
```

---

# 24. Monitoring

GO LIVE thì tôi coi monitoring là **bắt buộc**.

Theo dõi:

```text
VPS
├── CPU
├── RAM
├── Disk
├── Network
└── Docker

Backend
├── Request count
├── 4xx
├── 5xx
├── latency
└── throughput

Database
├── Connections
├── CPU
├── Storage
├── Query latency
└── Errors

AI
├── Availability
├── Generation latency
├── Timeout
├── Error
└── GPU utilization
```

Đặc biệt NFR của bạn đặt mục tiêu API trung bình `<500ms` và Survey Feed `<2s` với tối đa 50 khảo sát. 

**AI generation không nên áp dụng SLA `<500ms` này** — đó là một loại workload khác và phải có metric riêng.

---

# 25. Backup

Production:

```text
PostgreSQL
      │
      ├── Managed backup
      │
      └── Periodic logical backup
                │
                ▼
          Object Storage
```

Backup phải có:

```text
Daily
Weekly
Retention
Restore test
```

Không chỉ:

> "Nhà cung cấp database có backup."

Bạn nên **test restore thật** trước go-live.

---

# 26. Disaster Recovery

Tôi sẽ định nghĩa tối thiểu:

### Backend chết

```text
Docker restart
        ↓
Backend trở lại
```

### VPS chết

```text
Provision new VPS
       ↓
Pull Docker image
       ↓
Load secrets
       ↓
Start
       ↓
Database vẫn tồn tại
```

### AI laptop chết

```text
AI unavailable
       ↓
Core RESCOM vẫn hoạt động
       ↓
AI feature disabled
```

### Database incident

```text
Managed PostgreSQL
       ↓
Restore
       ↓
Backend reconnect
```

---

# 27. Domain architecture

Tôi chốt:

```text
rescom.com.vn
    │
    ├── app.rescom.com.vn
    │
    ├── survey.rescom.com.vn
    │
    ├── api.rescom.com.vn
    │
    └── admin.rescom.com.vn
```

Nếu muốn giảm complexity:

```text
rescom.com.vn
api.rescom.com.vn
survey.rescom.com.vn
```

là đủ cho v1.

Người dùng **không cần nhìn thấy Vercel, VPS hay Ollama**.

---

# 28. Repository architecture

Vì SRS yêu cầu monorepo với frontend/backend tách biệt hoàn toàn,  tôi sẽ tổ chức:

```text
rescom/
│
├── apps/
│   │
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   ├── lib/
│   │   └── ...
│   │
│   └── api/
│       ├── src/
│       │   ├── modules/
│       │   │   ├── auth/
│       │   │   ├── users/
│       │   │   ├── surveys/
│       │   │   ├── forms/
│       │   │   ├── responses/
│       │   │   ├── points/
│       │   │   ├── marketplace/
│       │   │   ├── fraud/
│       │   │   ├── feedback/
│       │   │   ├── admin/
│       │   │   ├── files/
│       │   │   └── ai/
│       │   │
│       │   ├── middleware/
│       │   ├── infrastructure/
│       │   ├── jobs/
│       │   └── app.ts
│       │
│       └── prisma/
│
├── packages/
│   │
│   ├── shared-types/
│   ├── validation/
│   ├── form-schema/
│   └── config/
│
├── docker/
│
├── .github/
│   └── workflows/
│
└── package.json
```

---

# 29. `form-schema` phải là shared package

Đây là một quyết định kiến trúc rất quan trọng.

```text
packages/form-schema
        │
        ├───────────────┐
        │               │
        ▼               ▼
    Frontend         Backend
        │               │
        │               │
        ▼               ▼
 Form Renderer      Zod Validation
 Form Editor        AI Validation
```

Không được để frontend định nghĩa một schema và backend định nghĩa schema khác.

---

# 30. Data flow của AI Form Generator

Ví dụ user nhập:

> "Tạo khảo sát sở thích ăn uống của học sinh Đà Nẵng từ 12 đến 18 tuổi."

Luồng:

```text
User
 │
 ▼
Prompt Box
 │
 ▼
POST /ai/forms/generate
 │
 ▼
Backend
 │
 ├── Load AI context
 │
 ├── Load Form Schema
 │
 ├── Validate user
 │
 └── Create AI request
 │
 ▼
Tailscale
 │
 ▼
Ollama
 │
 ▼
Qwen
 │
 ▼
JSON
 │
 ▼
Backend
 │
 ├── Parse JSON
 ├── Zod validation
 ├── Normalize
 ├── Generate IDs
 └── Business validation
 │
 ▼
Draft Form
 │
 ▼
Frontend Editor
```

Sau đó user có thể:

```text
AI generated
     ↓
Edit
     ↓
Drag
     ↓
Delete
     ↓
Add block
     ↓
Preview
     ↓
Save
     ↓
Publish
```

---

# 31. Publish flow

```text
Draft
 │
 ▼
Validate Form
 │
 ├── Schema valid?
 ├── Questions valid?
 ├── Target valid?
 ├── Required fields?
 └── Business rules?
 │
 ▼
Create Version
 │
 ▼
Calculate Escrow
 │
 ▼
Check Available Balance
 │
 ├── NO → reject
 │
 └── YES
       │
       ▼
     Lock Escrow
       │
       ▼
     PUBLISHED
       │
       ▼
 Marketplace
```

Luồng này phù hợp với SRS: khi Publisher publish, hệ thống tính Escrow, kiểm tra Available Balance, khóa điểm và đưa khảo sát lên Marketplace. 

---

# 32. Respondent flow

Với Internal Form:

```text
Respondent
    │
    ▼
Survey Feed
    │
    ▼
Open Survey
    │
    ▼
Load Published Form Version
    │
    ▼
Form Renderer
    │
    ▼
Answer
    │
    ▼
Submit
    │
    ▼
Backend Validation
    │
    ▼
Response
    │
    ▼
Point Transaction
    │
    ▼
Pending Balance
    │
    ▼
48h
    │
    ▼
Available Balance
```

Với External Google Forms, vẫn giữ flow Completion Code + Time Barrier hiện có trong SRS. 

---

# 33. Một thay đổi rất quan trọng khi bạn đưa Internal Form vào

Bạn sẽ có **hai loại Survey**:

```text
Survey
 │
 ├── external_form
 │       └── Google Forms
 │
 └── internal_form
         └── RESCOM Form Builder
```

Đừng tạo hai hệ thống Survey riêng.

Nên:

```ts
survey.formType =
  "EXTERNAL"
  |
  "INTERNAL"
```

### External

```text
survey
 └── externalConfig
      ├── url
      ├── completionCode
      └── estimatedDuration
```

### Internal

```text
survey
 └── form
      └── versions
           └── formDefinition
```

Như vậy Marketplace, Point System, Targeting, Feedback, Dashboard... vẫn dùng chung.

---

# 34. Kiến trúc Database logic

Tôi sẽ chia domain như sau:

```text
AUTH
├── User
├── Session
└── OAuthAccount

PROFILE
├── UserProfile
├── Demographics
└── Preferences

SURVEY
├── Survey
├── SurveyTarget
├── SurveyVersion
├── FormDefinition
├── Section
└── Question

RESPONSE
├── Response
├── Answer
└── CompletionAttempt

POINT
├── Wallet
├── LedgerTransaction
├── LedgerEntry
├── Escrow
└── PendingTransaction

MARKETPLACE
├── MarketplaceListing
├── Matching
└── SurveyFeed

ANTI-FRAUD
├── FraudLog
├── FraudAttempt
└── Complaint

SOCIAL
├── Feedback
└── Notification

ADMIN
├── AdminAction
└── TopUpRequest
```

---

# 35. Điểm đặc biệt: Ledger phải immutable

Không:

```sql
UPDATE points
SET balance = balance + 20
```

rồi coi đó là lịch sử.

Thay vào đó:

```text
Ledger
────────────────────
Transaction #1001
+20

Transaction #1002
-10

Transaction #1003
+40
```

Balance có thể được derive/maintain nhưng ledger history phải bất biến.

SRS yêu cầu lịch sử điểm không thể bị xóa/chỉnh sửa và FraudLog cũng không được xóa.  

---

# 36. Production topology cuối cùng

Nếu vẽ thành một sơ đồ duy nhất, tôi sẽ chốt như sau:

```text
                                      ┌───────────────────────┐
                                      │       USER            │
                                      └───────────┬───────────┘
                                                  │
                                               HTTPS
                                                  │
                                                  ▼
                                      ┌───────────────────────┐
                                      │      CLOUDFLARE        │
                                      │ DNS / SSL / CDN / WAF │
                                      └───────────┬───────────┘
                                                  │
                    ┌─────────────────────────────┼─────────────────────┐
                    │                             │                     │
                    ▼                             ▼                     ▼
             ┌──────────────┐             ┌──────────────┐      ┌──────────────┐
             │    Vercel    │             │     VPS      │      │    Public    │
             │              │             │              │      │    Survey    │
             │   Next.js    │             │   Nginx      │      │    Route     │
             │              │             │      │       │      └──────────────┘
             └──────┬───────┘             │   Express    │
                    │                     │      │       │
                    │                     │      │       │
                    │                     └──────┼───────┘
                    │                            │
                    │                            │
                    │                ┌───────────┴───────────┐
                    │                │                       │
                    │                ▼                       ▼
                    │       ┌─────────────────┐     ┌─────────────────┐
                    │       │ Managed         │     │ Object Storage  │
                    │       │ PostgreSQL      │     │ S3 Compatible   │
                    │       │ Neon/Supabase   │     │                 │
                    │       └─────────────────┘     └─────────────────┘
                    │
                    │
                    │                 PRIVATE NETWORK
                    │                       │
                    │                    Tailscale
                    │                       │
                    │                       ▼
                    │              ┌──────────────────┐
                    │              │ Gaming Laptop    │
                    │              │                  │
                    │              │ NVIDIA GPU       │
                    │              │ Ollama            │
                    │              │ Qwen               │
                    │              └──────────────────┘
                    │
                    ▼
             Form Renderer
             Form Builder
             AI Form Editor
```

---

# 37. Và đây là phân bổ "sản phẩm cần mua"

Từ bảng chi phí bạn gửi lúc nãy, tôi sẽ **chỉnh lại BOM** như sau:

### 🔴 Bắt buộc

| Hạng mục           | Vai trò                  |
| ------------------ | ------------------------ |
| `rescom.com.vn`    | Domain chính             |
| VPS 4 vCPU / 16GB  | Backend                  |
| Managed PostgreSQL | Production DB            |
| Object Storage     | Avatar/file/upload       |
| Email service      | Auth/notification        |
| Monitoring         | Production observability |
| Backup             | Disaster recovery        |

### 🟢 Không cần mua riêng

| Thành phần       | Giải pháp                  |
| ---------------- | -------------------------- |
| SSL              | Cloudflare / Let's Encrypt |
| CDN              | Cloudflare                 |
| Docker           | Free                       |
| PostgreSQL local | Docker                     |
| Ollama           | Free                       |
| Qwen             | Open model                 |
| Tailscale        | Có thể dùng plan phù hợp   |
| GitHub           | Có thể dùng plan hiện tại  |
| CI/CD            | GitHub Actions / Vercel    |

### 🟡 Phụ thuộc laptop AI

```text
RAM 16GB
```

**chưa thể kết luận có cần mua hay không.**

Tôi vẫn giữ quan điểm từ nãy:

> **Đừng mua thanh RAM 6.490.000đ chỉ dựa trên việc "host AI".**

Cần xem:

```text
CPU
RAM hiện tại
GPU
VRAM
```

rồi mới quyết định model và RAM.

---

# 38. Những thứ tôi sẽ KHÔNG làm

Nếu tôi chịu trách nhiệm architecture cho RESCOM production, tôi sẽ tránh:

```text
❌ PostgreSQL production trên cùng VPS backend
❌ Public Ollama :11434
❌ Lưu file upload trên VPS
❌ AI trả HTML/React code
❌ AI tự tạo database ID
❌ Frontend tự quyết định point transaction
❌ Update trực tiếp Point Balance không qua Ledger
❌ Sửa Published Form Version
❌ AI là dependency bắt buộc của toàn hệ thống
❌ Commit API keys vào Git
❌ Không có database backup
❌ Không có monitoring
❌ Không có rollback strategy
```

---

# 39. Những thứ tôi sẽ ưu tiên trước ngày GO LIVE

Tôi sẽ chia thành checklist:

### P0 — Không đạt thì không release

```text
[ ] Production PostgreSQL
[ ] Database backup
[ ] Restore test
[ ] HTTPS
[ ] Domain
[ ] Authentication
[ ] RBAC
[ ] Rate limiting
[ ] Input validation
[ ] Point Ledger ACID
[ ] FraudLog immutable
[ ] Error handling
[ ] Logging
[ ] Monitoring
[ ] AI timeout/fallback
[ ] File storage
[ ] Secrets management
[ ] Production environment variables
```

### P1 — Cần trước launch

```text
[ ] CI/CD
[ ] Form versioning
[ ] Form schema validation
[ ] AI output validation
[ ] Survey response integrity
[ ] Auto Refund job
[ ] Pending → Available job
[ ] Notification system
[ ] Admin complaint flow
[ ] Load testing
[ ] Security testing
```

### P2 — Sau khi hệ thống ổn định

```text
[ ] Redis
[ ] Horizontal backend scaling
[ ] Dedicated GPU server
[ ] Advanced analytics
[ ] B2B
[ ] Payment automation
```

---

# 40. Cuối cùng: kiến trúc này có thể scale

Điểm tôi thích nhất ở thiết kế này là **bạn không tự khóa mình vào VPS hiện tại**.

Hiện tại:

```text
1 VPS
1 Managed DB
1 AI Laptop
1 Vercel
```

Sau này traffic tăng:

```text
                  Load Balancer
                       │
             ┌─────────┼─────────┐
             ▼         ▼         ▼
          API #1     API #2     API #3
             │         │         │
             └─────────┼─────────┘
                       │
                Managed PostgreSQL
                       │
                    Redis
                       │
                 AI Gateway
                  /       \
                 /         \
          GPU Server #1   GPU Server #2
```

Bạn không phải viết lại hệ thống.

---

## Kiến trúc tôi chốt cho RESCOM

**Frontend**

> Next.js + TypeScript → Vercel → `rescom.com.vn`

**Backend**

> Node.js + Express + Prisma + Zod → Docker → VPS 4 vCPU/16GB

**Database**

> Managed PostgreSQL → Neon/Supabase + Connection Pooling

**Files**

> S3-compatible Object Storage

**Network**

> Cloudflare → HTTPS → VPS
> VPS → Tailscale → AI Laptop

**AI**

> Ollama → Qwen → chỉ phục vụ AI Form Generation

**Form**

> Form Definition JSON → Zod → Form Builder → Renderer → Versioning → Marketplace

**Business**

> Survey → Targeting → Escrow → Response → Pending → Ledger → Available

**Operations**

> GitHub → CI/CD → Docker → VPS
> Monitoring + Logging + Backup + Restore

**Security**

> Cloudflare → Reverse Proxy → Helmet/CORS/Rate Limit → JWT HTTP-only Cookie → RBAC → Zod → Business Rules

Điểm quan trọng nhất là **Form Definition và Point Ledger**. Form Definition sẽ trở thành nền tảng để AI Generator, Drag & Drop Builder, Marketplace và Response System dùng chung; còn Point Ledger là "financial core" của RESCOM và phải được bảo vệ bằng transaction/immutability. Điều này phù hợp với định hướng cốt lõi của SRS về marketplace hai chiều, targeted matching và double-entry ledger. 

**Nếu triển khai đúng kiến trúc trên, tôi đánh giá đây là một kiến trúc production hợp lý cho RESCOM hiện tại: không over-engineer thành microservices, nhưng cũng không còn là kiến trúc "MVP chạy chung một VPS".** Nó giữ backend đơn giản, tách database critical khỏi compute, tách AI khỏi core system và quan trọng nhất là tạo sẵn đường để scale khi lượng survey/response tăng.
