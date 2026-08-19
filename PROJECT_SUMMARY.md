# RESCOM — Project Summary (AI-Readable)

> **Last Updated:** 2026-08-16
> **Status:** Early Development (Database schema defined, infrastructure scaffolded, no application logic yet)
> **Team:** Rescom Team — FPT University Da Nang

---

## 1. What is RESCOM?

RESCOM (Research + Community) is a **two-sided marketplace web platform** that connects university students who need survey data (Publishers) with students willing to complete surveys (Respondents). The platform operates on a **point-based economy** — users earn points by completing surveys and spend points to distribute their own surveys.

**Core principle:** "Nhận hỗ trợ — Đóng góp lại" (Receive support — Give back).

---

## 2. Repository Structure

```
project-rescom/                 # Monorepo root
├── apps/
│   ├── backend/                # Node.js/Express API server
│   │   ├── prisma/
│   │   │   └── schema.prisma   # Database schema (PostgreSQL)
│   │   ├── prisma.config.ts
│   │   └── package.json        # Dependencies: Prisma ORM
│   └── frontend/               # Next.js web application (not yet initialized)
│       └── package.json        # Empty scaffold
├── packages/
│   ├── schemas/                # Shared Zod validation schemas (empty)
│   ├── shared/                 # Shared utilities (empty)
│   └── types/                  # Shared TypeScript types (empty)
├── docs/                       # Documentation (empty)
├── _bmad-output/               # Planning artifacts
│   ├── planning-artifacts/
│   │   ├── epics.md            # Full epic/story breakdown (9 epics, 30+ stories)
│   │   ├── architecture/       # Architecture documents
│   │   └── prds/               # Product requirement documents
│   └── implementation-artifacts/  # (empty)
├── docker-compose.yml          # Local dev: PostgreSQL 15 on port 5433
├── rescom.md                   # Detailed architecture decisions document
├── srs_rescom.md               # Software Requirements Specification v1.0
└── package.json                # Monorepo root
```

---

## 3. Tech Stack

| Layer              | Technology                                                                   |
| :----------------- | :--------------------------------------------------------------------------- |
| **Frontend**       | Next.js, TypeScript, App Router, Tailwind CSS, shadcn/ui, Redux Toolkit + RTK Query, Framer Motion |
| **Backend**        | NestJS, TypeScript, Clean Architecture                                       |
| **ORM**            | Prisma ORM                                                                   |
| **Validation**     | Zod (shared between FE & BE via `packages/schemas`)                          |
| **Auth**           | Stateless JWT in HTTP-Only Cookies + Google OAuth                            |
| **Security**       | CORS, Helmet, express-rate-limit                                             |
| **Database**       | PostgreSQL (Docker Compose locally, Neon/Supabase in production)             |
| **AI Inference**   | Ollama + Qwen model on dedicated GPU machine via Tailscale VPN               |
| **File Storage**   | S3-compatible Object Storage (presigned URL uploads)                         |
| **Frontend Host**  | Vercel                                                                       |
| **Backend Host**   | VPS (4 vCPU / 16GB RAM / 200GB NVMe) with Docker + Nginx                    |
| **CDN/DNS/SSL**    | Cloudflare                                                                   |

---

## 4. Domain Architecture

```
rescom.com.vn          → Landing / Main App (Vercel)
app.rescom.com.vn      → Authenticated Application (Vercel)
survey.rescom.com.vn   → Public Survey Access (Vercel)
api.rescom.com.vn      → Backend API (VPS)
admin.rescom.com.vn    → Admin Dashboard (Vercel)
```

---

## 5. User Roles

| Role           | Description                                           |
| :------------- | :---------------------------------------------------- |
| **RESPONDENT** | Default role. Completes surveys to earn points.       |
| **PUBLISHER**  | Creates and distributes surveys. Spends points.       |
| **ADMIN**      | System administrator. Manages disputes, approves top-ups, monitors fraud. |

A single user can act as both Publisher and Respondent.

### User Tiers (Respondent progression)

| Tier                    | Condition            | Benefit                          |
| :---------------------- | :------------------- | :------------------------------- |
| New User                | Just registered      | 100 frozen points                |
| Verified Member         | 2 onboarding surveys | Points unlocked                  |
| Active Contributor      | ≥ 20 surveys         | Feed priority                    |
| Trusted Researcher      | ≥ 100 surveys        | Reduced pending time (48h→24h)   |
| Community Ambassador    | ≥ 300 surveys        | Community privileges             |

---

## 6. Core Features

### 6.1 Authentication & Authorization
- Email/password registration + Google OAuth
- Single-session enforcement (one device at a time)
- JWT in HTTP-only cookies
- Role-Based Access Control (RBAC)
- Immutable audit log for admin actions

### 6.2 Onboarding Flow
1. Register → receive 100 **Frozen** points
2. Complete mandatory demographic survey (age, gender, location, occupation, field of study, income, interests)
3. Complete 1 additional survey from feed
4. Frozen points → **Available** balance
5. If inactive for 30 days, frozen points expire

### 6.3 Survey System (Two Types)

#### Internal Forms (RESCOM Form Builder)
- **Drag-and-drop form builder** with block types: text, textarea, number, single_choice, multiple_choice, rating, linear_scale, date, file_upload
- **Form Definition JSON** is the core domain object (not HTML, not React components)
- **AI Form Generator**: natural language prompt → Ollama/Qwen → JSON → Zod validation → draft form
- **Form Versioning**: immutable once published; new edits create new versions
- Responses linked to specific form version for data integrity
- Instant point credit upon validated completion

#### External Forms (Google Forms)
- Publisher provides link + system-generated completion code
- Completion Code + Time Barrier verification
- 48-hour pending period before points become available
- Publisher can dispute responses within 48 hours

### 6.4 Form Builder Architecture
```
Form Definition JSON (shared schema in packages/schemas)
        ↑                           ↑
   AI Generator               Drag & Drop Builder
        ↓                           ↓
   Generate JSON              Edit JSON visually
        ↓
   Zod Validation → Normalize IDs → Save as Draft
```

**Component Registry** (frontend renderer):
```
QUESTION_REGISTRY = {
  text, textarea, number, single_choice, multiple_choice,
  rating, linear_scale, date, file_upload
}
```

### 6.5 Point System & Financial Engine
- **Double-Entry Ledger**: all transactions are append-only, immutable
- **Balance types**: Available, Pending, Frozen, Escrow
- **ACID transactions** with row-level locking to prevent race conditions
- **Idempotency keys** on all financial operations to prevent double-spending
- **Point value**: 1 point = 200 VNĐ

#### Point Flow
```
Publisher publishes survey
  → Points moved from Available → Escrow (locked)
  → Respondent completes survey
  → External: Points → Pending (48h) → Available
  → Internal: Points → Available (instant)
  → Survey closes with unused slots → Escrow → Auto-Refund to Publisher
```

#### Reward Pricing Table
| Completion Time | Min Points | Max Points |
| :-------------- | :--------- | :--------- |
| < 5 min         | 5          | 10         |
| 5–10 min        | 10         | 20         |
| 10–15 min       | 15         | 25         |
| > 15 min        | 20         | 40         |

### 6.6 Survey Marketplace Feed
- Personalized feed filtered by respondent's demographic profile
- Completed/in-progress surveys hidden
- Sort by: reward, estimated time, deadline proximity, relevance
- Card shows: points, estimated time, slots remaining
- Groups: best match, short/easy, near deadline, high reward, same school/field, new

### 6.7 Integrity Engine
- **SurveyAttempt**: Central object capturing session telemetry.
- **IntegrityEvent**: Append-only telemetry (time, interaction, behavioral).
- **IntegrityAssessment**: Scored output for policies.
- **IntegrityIncident**: Tracks specific anomalous events and quality issues for review.
- **FraudLog**: Append-only log strictly reserved for confirmed abuse and hard security violations.
- **Time Barrier & Rate Limiting**: Real-time guards for submissions.

### 6.8 Dashboard & Analytics
- Per-survey dashboard: completions, slots remaining, escrow balance, deadline countdown
- Average completion time, drop-off rate
- Survey status: Active / Paused / Closed / Out of Points / Expired
- Traffic analytics (internal forms only)
- Feedback summary

### 6.9 Feedback System
- Post-completion rating by respondents
- Evaluates: question clarity, length, description accuracy, technical issues, experience
- High negative feedback → deprioritize survey in feed

### 6.10 Admin Features
- User management (role changes, account locking)
- Survey moderation queue (approve/reject before going live)
- Complaint resolution (Publisher disputes within 48h)
- Manual top-up approval (bank transfer → points)
- Integrity Incident monitoring and review queue
- Transaction dashboard

### 6.11 Gamification
- Daily streaks (consecutive days completing surveys)
- Leaderboard (top point earners)
- Tier progression (Verified → Active → Trusted → Ambassador)

### 6.12 Notifications
- Survey approved, escrow released, top-up success, warnings
- In-app notification system

---

## 7. Database Schema Overview

**PostgreSQL** with the following models (see `apps/backend/prisma/schema.prisma`):

| Model                | Purpose                                               |
| :------------------- | :---------------------------------------------------- |
| `User`               | Account with email, password hash, role, status       |
| `DemographicProfile` | Age, location, income, interests (1:1 with User)      |
| `Form`               | Survey definition. Supports INTERNAL/EXTERNAL types   |
| `FormSchema`         | JSON schema for internal form blocks (1:1 with Form)  |
| `FormTargeting`      | Demographic targeting criteria JSON (1:1 with Form)   |
| `SurveyAttempt`      | Session tracking for integrity telemetry              |
| `Response`           | Survey submission. Tracks status lifecycle            |
| `LedgerJournal`      | Immutable point transaction header (double-entry)     |
| `LedgerEntry`        | Immutable point transaction line item                 |
| `LedgerAccount`      | Point balance and limits for a specific user/system   |
| `IntegrityEvent`     | Append-only telemetry events                          |
| `IntegrityAssessment`| Output of feature engine scoring                      |
| `IntegrityIncident`  | Issues flagged for quality or policy review           |
| `FraudLog`           | Confirmed abuse and hard security violations          |
| `RespondentReputation`| Historical trust score                               |
| `GamificationStat`   | Streaks, total completions, tier status (1:1 with User)|
| `Notification`       | In-app notifications                                  |
| `TopUpRequest`       | Manual point purchase requests                        |
| `OutboxEvent`        | Transactional Outbox pattern support                  |

### Key Enums
- `FormStatus`: DRAFT → ESCROW_LOCKED → MODERATION_QUEUE → PUBLISHED → CLOSED
- `ResponseStatus`: IN_PROGRESS → SUBMITTED → VALIDATED → DISPUTED → REJECTED
- `TransactionType`: EARN, SPEND, ESCROW_LOCK, ESCROW_REFUND, TOP_UP, ADMIN_MINT
- `BalanceType`: AVAILABLE, PENDING, FROZEN, ESCROW
- `AttemptStatus`: IN_PROGRESS, COMPLETED, ABANDONED

---

## 8. AI Form Generator Architecture

```
Frontend (prompt input)
  → POST /ai/forms/generate
  → Backend constructs context (form schema + question registry + guidelines + user prompt)
  → Tailscale VPN → Gaming Laptop (NVIDIA GPU)
  → Ollama → Qwen model
  → Returns structured JSON (NOT HTML, NOT React)
  → Backend: parse → Zod validate → normalize IDs → save as Draft
  → Frontend: load into drag-and-drop builder for editing
```

**Critical rules:**
- AI is an **optional dependency** — if AI is down, all other features continue working
- AI server is **never exposed to the internet** (only accessible via Tailscale VPN from backend)
- Backend uses an **AI Provider Interface** pattern (can swap Ollama for cloud AI later)
- AI timeout is separate from the standard 500ms API SLA (30-60s allowed)

---

## 9. Critical Business Rules

1. **Never trust frontend** — startTime, completion codes, point calculations are all server-side
2. **Point Ledger is immutable** — no UPDATE/DELETE on ledger transactions, only INSERT
3. **Integrity Incident & Evidence is append-only** — no delete, no update
4. **Published forms are immutable** — edits create new versions
5. **All point transactions use ACID** — wrapped in database transactions with row-level locking
6. **Escrow is mandatory** — Publisher must have sufficient Available Balance before publishing
7. **Form Definition JSON is a shared domain object** — validated by the same Zod schema on both FE and BE
8. **Responses reference specific form versions** — ensures analytics integrity when Publisher edits
9. **One completion per account per survey** — enforced at database level
10. **48h dispute window** for external surveys — Publisher can report fraudulent responses

---

## 10. Non-Functional Requirements

| Requirement        | Target                                                    |
| :----------------- | :-------------------------------------------------------- |
| API Response Time  | < 500ms average (normal load)                             |
| Survey Feed Load   | < 2 seconds (≤ 50 surveys)                                |
| System Uptime      | ≥ 99% during peak academic periods                        |
| CSAT Score         | > 4.0 / 5.0                                               |
| Activation Rate    | > 80% (frozen points unlock rate)                          |
| Completion Rate    | > 75% (code submission success rate)                       |
| AI Generation      | Separate timeout (30-60s), not subject to 500ms SLA       |

---

## 11. Development Phases

| Phase              | Scope                                                                      |
| :----------------- | :------------------------------------------------------------------------- |
| **Phase 1 — MVP**  | P2P at FPT University Da Nang. External forms + Completion Code + Time Barrier + 48h Pending + manual top-up |
| **Phase 2 — Enhance** | Internal Form Builder + AI Form Generator + forced-attention + auto payment + Boost + advanced dashboard |
| **Phase 3 — Scale** | B2B for organizations + nationwide expansion + data analysis + Excel/SPSS export |

> **Note:** The architecture document (rescom.md) includes Form Builder + AI Generator in Go Live scope, overriding the SRS which lists them as Phase 2.

---

## 12. Current Development Status

| Component           | Status                                                    |
| :------------------ | :-------------------------------------------------------- |
| Monorepo structure  | ✅ Scaffolded (`apps/backend`, `apps/frontend`, `packages/*`) |
| Docker Compose      | ✅ PostgreSQL 15 on port 5433                              |
| Prisma Schema       | ✅ Full schema defined (11 models, 8 enums)                |
| Backend API         | ❌ Not started (no Express setup, no routes, no middleware) |
| Frontend App        | ❌ Not started (Next.js not initialized)                   |
| Shared packages     | ❌ Empty (`schemas`, `shared`, `types`)                    |
| CI/CD               | ❌ Not configured                                          |
| Tests               | ❌ Not started                                             |

---

## 13. Epic Breakdown (9 Epics)

| Epic | Name                                  | Key FRs                                  |
| :--- | :------------------------------------ | :--------------------------------------- |
| 1    | System Foundation & Identity          | Auth, RBAC, audit log, security baseline |
| 2    | Core Form Builder & Schema            | Drag-and-drop builder, versioning, immutability |
| 3    | AI Form Generation Assistant          | NLP prompt → form draft, failure isolation |
| 4    | Survey Distribution & Public Access   | Targeting, marketplace feed, public links |
| 5    | Survey Execution & Responses          | Attempt lifecycle, submission, file upload |
| 6    | Immutable Point Ledger & Wallet       | Double-entry ledger, escrow, top-up, refund |
| 7    | Onboarding, Demographics & Gamification | Profile, streaks, leaderboard, tiers    |
| 8    | Security, Moderation & Anti-Fraud     | Time barrier, bot detection, moderation queue |
| 9    | Analytics, Feedback & Notifications   | Dashboard analytics, feedback, event notifications |

---

## 14. Key Documents Reference

| File                                                    | Description                          |
| :------------------------------------------------------ | :----------------------------------- |
| `srs_rescom.md`                                         | Software Requirements Specification  |
| `rescom.md`                                             | Architecture decisions & design      |
| `_bmad-output/planning-artifacts/epics.md`              | Full epic & story breakdown          |
| `apps/backend/prisma/schema.prisma`                     | Database schema                      |
| `docker-compose.yml`                                    | Local development infrastructure     |

---

## 15. Backend Module Structure (Planned V2)

```
apps/backend/src/
├── modules/
│   ├── identity/       # Users, Authentication, Authorization, Sessions
│   ├── research/       # Surveys, Forms, Schema, Targeting, Versioning
│   ├── participation/  # Attempts, Responses, Submission Lifecycle
│   ├── integrity/      # Telemetry, Scoring, Policy, Reputation, Incidents, Reviews
│   ├── marketplace/    # Eligibility, Matching, Ranking
│   ├── economy/        # Wallet, Ledger, Escrow, Reward Settlement
│   ├── moderation/     # Survey Moderation, Disputes
│   ├── analytics/      # Research Analytics, Publisher Dashboard
│   ├── notifications/  # Notification services
│   └── ai/             # AI Gateway, Form Generation, Semantic Analysis
├── infrastructure/     # Database, Events (Outbox), Storage, AI
├── common/             # Guards, Pipes, Interceptors, Filters
├── workers/            # outbox.worker.ts, integrity.worker.ts, refund.worker.ts
└── main.ts             # App entry point
```
