---
stepsCompleted: ["step-01-validate-prerequisites", "step-02-design-epics", "step-03-create-stories", "step-04-final-validation"]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md
---

# project-rescom - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for project-rescom, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR-1: Email/Password Registration
FR-2: Google OAuth Login
FR-3: Single-Session Enforcement
FR-4: Frozen Starter Points
FR-5: Starter Points Expiry
FR-6: Mandatory Demographic Survey
FR-7: Second Onboarding Survey
FR-8: Point Unlock on Activation
FR-9: Demographic Profile
FR-10: Publisher Targeting Criteria
FR-11: Automated Matching
FR-12: External Survey Creation (3-Step Stepper)
FR-13: Server-Generated Completion Code
FR-14: Point Reward Pricing Table
FR-15: Escrow Lock on Publish
FR-16: Drag-and-Drop Form Builder
FR-17: AI Form Generator
FR-18: Form Versioning
FR-19: Internal Form Pricing Discount
FR-20: Moderation Queue
FR-21: Survey Attempt Start
FR-22: Completion Code Verification
FR-23: Missing Code Report
FR-24: 48-Hour Pending Period (External Only)
FR-25: One Completion Per Account
FR-26: In-Platform Survey Experience
FR-27: Automated Validation — Demographic Cross-Check
FR-28: Automated Validation — Bot Detection
FR-29: Instant Point Credit (Internal Only)
FR-30: Immutable Double-Entry Ledger
FR-31: Wallet Dashboard
FR-32: Escrow Refund on Survey Close
FR-33: Survey Reopen with Additional Tokens
FR-34: Manual Top-Up Request
FR-35: Admin Top-Up Approval
FR-36: Personalized Feed
FR-37: Sort & Filter Options
FR-38: Auto-Hide on Quota Completion
FR-39: Progress Tracking
FR-40: Response Data (Internal Forms Only)
FR-41: Traffic Analytics
FR-42: Feedback Summary
FR-43: Post-Completion Feedback
FR-44: Negative Feedback Deprioritization
FR-45: Time Barrier
FR-46: Rate Limiting
FR-47: Immutable FraudLog
FR-48: Frozen Points Anti-Bot
FR-49: Streak Counter
FR-50: Leaderboard
FR-51: Tier Progression
FR-52: User Management
FR-53: Survey Moderation
FR-54: Complaint Resolution
FR-55: FraudLog Monitoring
FR-56: Transaction Dashboard
FR-57: Event Notifications
FR-58: Consent-Aware Behavioral Telemetry
FR-59: Response Integrity Assessment
FR-60: Cold-Start Handling
FR-61: Respondent Reliability
FR-62: Survey Quality Assessment
FR-63: Explainability and Reproducibility
FR-64: Integrity Decision Modes
FR-65: Integrity Review and Feedback Labels
FR-66: TrustGraph-Ready Relationships
FR-67: Assessment Applicability

### NonFunctional Requirements

NFR-1: API average response time < 500ms under normal load
NFR-2: Survey Feed loads in < 2 seconds with ≤ 50 surveys
NFR-3: Point transactions use ACID + row-level locking to prevent race conditions
NFR-4: PostgreSQL-authoritative Time Barrier; Redis only for distributed rate limits/cache/ephemeral coordination when triggered
NFR-5: AI Form Generation has a separate timeout (not subject to 500ms SLA)
NFR-6: Short-lived cookie JWT bound to a PostgreSQL-authoritative revocable session with rotating refresh secret
NFR-7: Exact credentialed CORS allowlist, Helmet, CSRF protection, and NestJS throttling on exposed API endpoints
NFR-8: Server-side authority: startTime, Completion Code generation, point calculations — never trust client
NFR-9: All point transactions use ACID to ensure data consistency
NFR-10: FraudLog is append-only — no delete, no update
NFR-11: Point Ledger integrity: balance can never be duplicated or lost
NFR-12: Auto-Refund background job runs on schedule for expired surveys
NFR-13: Pending → Available auto-transfer runs on schedule (48h expiry)
NFR-14: System uptime ≥ 99% during peak academic periods
NFR-15: AI failure must not impact core system (login, surveys, points, marketplace)
NFR-16: Monorepo with Frontend and Backend fully separated
NFR-17: Prisma ORM for database schema management
NFR-18: Zod validation shared between Frontend and Backend
NFR-19: Form Definition JSON schema as a shared package
NFR-20: Modern, minimal UI targeting Gen Z students
NFR-21: Survey creation follows a clear 3-step stepper flow
NFR-22: CSAT target > 4.0/5.0

### Additional Requirements

- npm workspace setup for the existing Next.js and backend paths; Turborepo is deferred until measured orchestration/caching value
- Shared versioned Zod contracts in `packages/schemas`, imported by both FE and BE
- Pragmatic Clean Architecture in NestJS: strict dependency direction and ports/adapters at invariant/external seams, without mandatory four-layer folders for trivial CRUD
- PostgreSQL-authoritative Time Barrier and durable workflows; Redis is conditional ephemeral infrastructure for shared distributed state
- One NestJS codebase/image with API and worker entrypoints in production; explicit local co-location is allowed
- Secure API communication with AI Gateway via Tailscale VPN
- Database transaction handling for Double-Entry Ledger (Prisma `$transaction`)

### UX Design Requirements

(No UX document found for this project yet. Standard Next.js/Tailwind UI to be assumed as per PRD/Architecture).

### FR Coverage Map

- **Epic 1: System Foundation & Identity** -> FR-1, FR-2, FR-3, FR-ADD-12 (RBAC), FR-ADD-13 (Audit Log), FR-52
- **Epic 2: Core Form Builder & Schema** -> FR-12, FR-16, FR-18, FR-ADD-1, FR-ADD-2, FR-ADD-3, FR-ADD-4, FR-ADD-5, FR-ADD-5b
- **Epic 3: AI Form Generation Assistant** -> FR-17, FR-ADD-6, FR-ADD-7
- **Epic 4: Survey Distribution & Public Access** -> FR-10, FR-11, FR-36, FR-37, FR-38, FR-ADD-8
- **Epic 5: Survey Execution & Responses** -> FR-21, FR-22, FR-23, FR-24, FR-25, FR-26, FR-40, FR-ADD-9, FR-ADD-10, FR-13
- **Epic 6: Point Ledger & Wallet** -> FR-4, FR-5, FR-8, FR-14, FR-15, FR-19, FR-29, FR-30, FR-31, FR-32, FR-33, FR-34, FR-35, FR-ADD-11
- **Epic 7: Demographics & Gamification** -> FR-6, FR-7, FR-9, FR-27, FR-49, FR-50, FR-51
- **Epic 8: Moderation & Anti-Fraud** -> FR-20, FR-28, FR-45, FR-46, FR-47, FR-48, FR-53, FR-54, FR-55
- **Epic 9: Analytics & Notifications** -> FR-41, FR-42, FR-43, FR-44, FR-56, FR-57
- **Epic 10: Research Integrity Foundation & TrustGraph** -> FR-58, FR-59, FR-60, FR-61, FR-62, FR-63, FR-64, FR-65, FR-66, FR-67

## Epic List

### Epic 1: System Foundation & Identity
**Goal:** Users can securely authenticate, and Admins can manage the system with strict RBAC and audit logging.
**FRs covered:** FR-1, FR-2, FR-3, FR-ADD-12, FR-ADD-13, FR-52

### Epic 2: Core Form Builder & Schema
**Goal:** Publishers can create, edit, version, and manage surveys using a drag-and-drop interface, while schemas remain strictly validated and immutable upon publish.
**FRs covered:** FR-12, FR-16, FR-18, FR-ADD-1, FR-ADD-2, FR-ADD-3, FR-ADD-4, FR-ADD-5, FR-ADD-5b

### Epic 3: AI Form Generation Assistant
**Goal:** Publishers can rapidly generate form drafts using natural language prompts without blocking manual flows if the AI fails.
**FRs covered:** FR-17, FR-ADD-6, FR-ADD-7

### Epic 4: Survey Distribution & Public Access
**Goal:** Publishers can distribute surveys (internal feed or external links) and set targeting criteria; Respondents can discover targeted surveys.
**FRs covered:** FR-10, FR-11, FR-36, FR-37, FR-38, FR-ADD-8

### Epic 5: Survey Execution & Responses
**Goal:** Respondents can complete surveys securely and smoothly, handling edge cases like timeouts, completion codes, and file uploads.
**FRs covered:** FR-13, FR-21, FR-22, FR-23, FR-24, FR-25, FR-26, FR-40, FR-ADD-9, FR-ADD-10

### Epic 6: Immutable Point Ledger & Wallet
**Goal:** The system maintains an unalterable financial ledger for point transactions ensuring absolute integrity across balances, escrows, and top-ups.
**FRs covered:** FR-4, FR-5, FR-8, FR-14, FR-15, FR-19, FR-29, FR-30, FR-31, FR-32, FR-33, FR-34, FR-35, FR-ADD-11

### Epic 7: Onboarding, Demographics & Gamification
**Goal:** Respondents complete demographic profiles to unlock the platform and engage with gamification elements (streaks, tiers).
**FRs covered:** FR-6, FR-7, FR-9, FR-27, FR-49, FR-50, FR-51

### Epic 8: Security, Moderation & Integrity Guard
**Goal:** The platform automatically blocks bot activity and provides Admins with tools to moderate content and resolve disputes.
**FRs covered:** FR-20, FR-28, FR-45, FR-46, FR-47, FR-48, FR-53, FR-54, FR-55

### Epic 9: Analytics, Feedback & Notifications
**Goal:** Users receive timely notifications and Publishers gain insights from survey traffic and respondent feedback.
**FRs covered:** FR-41, FR-42, FR-43, FR-44, FR-56, FR-57

### Epic 10: Research Integrity Foundation & TrustGraph
**Goal:** Internal Form responses produce privacy-conscious telemetry, explainable integrity assessments, respondent reliability history, Survey Quality assessments, and TrustGraph-ready evidence without affecting external form compatibility.
**FRs covered:** FR-58, FR-59, FR-60, FR-61, FR-62, FR-63, FR-64, FR-65, FR-66, FR-67

### Additional Production Requirements (Newly Added)

**Form Builder & Schema**
- **FR-ADD-1:** Form Builder must support specific block types: text, textarea, number, single choice, multiple choice, rating, linear scale, date, file upload (as per PRD).
- **FR-ADD-2:** Form Builder must support block editing, reordering, and duplication.
- **FR-ADD-3:** Form Builder must support draft/autosave functionality and live preview before publishing.
- **FR-ADD-4:** The Form Definition exports in `packages/schemas` must implement strict Zod validation, including conditional logic rules if any.
- **FR-ADD-5:** Schema Versioning: The system must support versioning of the Form Definition JSON schema to handle future upgrades without breaking old responses. [Decision Required: Specific versioning strategy].
- **FR-ADD-5b:** Immutable Published Form: Once a form is published, its schema/definition becomes strictly immutable to ensure data integrity of responses. Any changes require creating a new version or draft.

**AI Form Generator**
- **FR-ADD-6:** AI Workflow: Prompt -> AI Context -> Structured JSON -> Zod Validation -> Load into Builder for editing.
- **FR-ADD-7:** AI Failure Isolation: If AI times out or fails (e.g., invalid JSON returned), the system must gracefully fail, notify the user, and allow them to continue building manually.
- **NFR-ADD-1:** AI Generation must have a configurable retry mechanism and timeout (e.g., 30s) separate from the standard 500ms API SLA.

**Public Sharing & Responses**
- **FR-ADD-8:** Public Access: The system must generate a shareable survey URL for Respondents to access internal forms. [Decision Required: Are non-logged-in users allowed to view the form without submitting?]
- **FR-ADD-9:** Response Lifecycle: Responses must transition through states (e.g., In Progress, Submitted, Validated, Rejected).
- **FR-ADD-10:** File Upload Validation: Any file upload blocks must validate file type, size, and scan for malware (if applicable).
- **NFR-ADD-2:** Secure File Storage: Uploaded files must be stored securely (e.g., S3) with restricted access policies via signed URLs.

**Security & Production Infra**
- **FR-ADD-11:** Idempotency: All financial operations (Point credits, Escrow locks, Refunds, and Survey completion rewards) must use idempotent keys to prevent double-spending on network retries.
- **FR-ADD-12:** Authorization: the system must enforce permissions. `ADMIN` is a privileged assignment; publishing and responding are simultaneous normal-user capabilities gated by product eligibility, not mutually exclusive account roles.
- **FR-ADD-13:** Audit Log: The system must maintain an immutable audit log of critical administrative actions and system-level financial operations.
- **NFR-ADD-3:** Secret Management: All environment variables (DB credentials, JWT secrets, OAuth tokens) must be securely managed and not hardcoded.
- **NFR-ADD-4:** Observability: The production system must implement structured logging, APM monitoring, and expose health check endpoints (`/health`).
- **NFR-ADD-5:** Disaster Recovery: The PostgreSQL database must have automated daily backups and a documented restore procedure. [Decision Required: Define RPO (Recovery Point Objective), RTO (Recovery Time Objective), and backup retention period].

**UX Requirements (Form Builder/AI)**
- **UX-ADD-1:** Form Builder needs drag-and-drop interaction patterns.
- **UX-ADD-2:** AI Generator requires clear loading states (e.g., skeleton loaders, progress text) during the 30-60s wait time.
- **UX-ADD-3:** Survey answering requires offline/reconnect handling or error states if submission fails.

## Epic 1: System Foundation & Identity

**Goal:** Users can securely authenticate, and Admins can manage the system with strict RBAC and audit logging.

### Story 1.1: Email/Password Registration & Authentication

As a User,
I want to register, login, and logout using my email and password,
So that I can securely access the RESCOM platform.

**Acceptance Criteria:**

**Given** an unregistered email address
**When** the user submits the registration form with a valid password
**Then** a new account is created with normal-user authorization and Respondent capability, and the user is logged in
**And** the password is securely hashed and a short-lived access JWT bound to a PostgreSQL-authoritative session is issued in a Secure HTTP-Only cookie according to AD-20.

**Given** an already registered email address
**When** the user attempts to register again
**Then** the system returns an appropriate error preventing duplicate registration without leaking account existence unnecessarily.

**Given** an existing user
**When** they attempt to log in with invalid credentials
**Then** the system returns a 401 error.

**Given** a logged-in user
**When** they click logout
**Then** the backend revokes the authoritative session and expires the access/refresh cookies using the same cookie attributes.

### Story 1.2: Google OAuth Login

As a User,
I want to log in using my Google account,
So that I can access the platform quickly without remembering a new password.

**Acceptance Criteria:**

**Given** a user on the login page
**When** they click "Continue with Google" and authorize the app
**Then** the system logs them in (or creates a new account if first time)
**And** issues the same revocable access/refresh session contract defined by AD-20.
**And** OAuth initiation/callback validates one-time expiring state, nonce, PKCE where supported, exact redirect URI, provider-token signature/issuer/audience/expiry, provider subject, and verified-email status.
**And** if the verified Google email matches an existing password account, the system does not auto-link or create a duplicate; the user must authenticate the existing account and explicitly link Google with recent authentication.
**And** identity link/unlink is audited and cannot remove the account's final login method.

### Story 1.3: Single-Session Enforcement

As a User/Admin,
I want my account to only have one active session at a time,
So that my account is protected from unauthorized concurrent access while using short-lived signed access tokens.

**Acceptance Criteria:**

**Given** an already logged-in user
**When** the user logs in from a new device/browser
**Then** the old PostgreSQL-authoritative Session is atomically revoked and the new access JWT carries the new `sessionId` and `sessionVersion`.
**And** any subsequent requests using the old JWT return a 401 Unauthorized error.

### Story 1.4: Role-Based Access Control (RBAC) & User Management

As an Admin,
I want to view all users and manage their roles/status,
So that I can control who has Publisher or Admin privileges and lock bad actors.

**Acceptance Criteria:**

**Given** an authenticated Admin user
**When** they access the User Management dashboard
**Then** they see a paginated list of all users
**And** they can manage privileged authorization assignments and lock/unlock accounts; ordinary publishing/responding capabilities are not mutually exclusive roles.

**Given** a non-Admin user (Respondent or Publisher)
**When** they attempt to access Admin-only API endpoints
**Then** the system explicitly rejects the request with a 403 Forbidden error.
**And** Admins cannot alter another Admin's role unless explicitly authorized by a super-admin rule (or similar boundary definition).

### Story 1.5: System Audit Logging

As a System Owner,
I want critical administrative and financial actions to be immutably logged,
So that I have a traceable history of who did what for security and compliance.

**Acceptance Criteria:**

**Given** an Admin performing a critical action (e.g., changing a user's role)
**When** the action is successfully executed
**Then** a record is appended to the Audit Log.
**And** the Audit Log implementation must be append-only (no updates, no hard deletes permitted) at the database/ORM level.
**And** the record includes the actor's ID, action type, timestamp, and payload details.

### Story 1.6: Security & API Foundation

As a System Architect,
I want the core API infrastructure to include baseline security measures,
So that all subsequent features are built on a secure, standardized foundation.

**Acceptance Criteria:**

**Given** the backend NestJS application
**When** it handles incoming HTTP requests
**Then** all endpoints are protected by basic API-level rate limiting to prevent abuse.
**And** Helmet and CORS are configured according to production security standards.
**And** Global authentication/authorization guards are established so endpoints can be easily decorated for RBAC.
**And** all payload validations use the shared Zod definitions exported by `packages/schemas`.

## Epic 2: Core Form Builder & Schema

**Goal:** Publishers can create, edit, version, and manage surveys using a drag-and-drop interface, while schemas remain strictly validated and immutable upon publish.

### Story 2.1: Shared Form Schema Validation

As a Full-Stack Developer,
I want a shared Zod schema package defining the Form Definition JSON,
So that both the frontend Form Builder and backend APIs validate the form structure consistently.

**Acceptance Criteria:**

**Given** the monorepo architecture
**When** a form definition is evaluated
**Then** it must be validated against the shared Form Definition Zod contract in `packages/schemas`.
**And** the schema must support standard block types (text, textarea, number, single choice, multiple choice, rating, linear scale, date, file upload).
**And** the schema package includes versioned integrity metadata support (expected-effort hints, attention check flags, consistency pairing rules, semantic category tags) that lock immutably with the published Form Version.
**And** the schema package includes basic versioning configuration to handle future upgrades.

### Story 2.2: Form Draft Creation & Lifecycle

As a Publisher,
I want to create a new form and have it saved automatically as a draft,
So that I can work on my survey over multiple sessions without losing progress.

**Acceptance Criteria:**

**Given** an authenticated Publisher
**When** they initiate a new survey creation
**Then** a new form record is created in the database with status `DRAFT`.
**And** subsequent changes made in the Form Builder automatically trigger autosave API calls to update the draft in the database.
**And** visual feedback (e.g., "Saved at 10:45 AM") is shown in the UI.

### Story 2.3: Form Builder Canvas & Block Types

As a Publisher,
I want to build my form using a drag-and-drop canvas supporting various input blocks,
So that I can construct complex surveys intuitively.

**Acceptance Criteria:**

**Given** the Form Builder interface
**When** the user drags a block from the toolbox onto the canvas
**Then** the block is rendered in the canvas and the internal JSON state is updated.
**And** the builder supports all required block types (text, textarea, number, single choice, multiple choice, rating, linear scale, date, file upload).

### Story 2.4: Form Block Editing & Manipulation

As a Publisher,
I want to select, edit, reorder, duplicate, and delete form blocks,
So that I can easily adjust the flow and content of my survey.

**Acceptance Criteria:**

**Given** a form with existing blocks
**When** the user clicks on a block
**Then** a properties panel opens allowing them to edit the block's specific settings (e.g., question text, choices, required flag).
**And** the user can drag the block to reorder it within the list.
**And** the user can click duplicate or delete to instantly manipulate the block.

### Story 2.5: Live Form Preview

As a Publisher,
I want to preview my form exactly as a Respondent will see it,
So that I can verify the layout and block behavior before publishing.

**Acceptance Criteria:**

**Given** a form draft being edited
**When** the user clicks the "Preview" button
**Then** the UI switches to a rendering mode displaying the form strictly via the shared Form Definition parser (no editing controls).
**And** interacting with the preview (e.g., typing in fields) does not save real response data to the database.

### Story 2.6: Form Publish Lifecycle & Immutability

As a Publisher,
I want to finalize my form and initiate the publishing process,
So that it can eventually be distributed while strictly locking the schema from edits to ensure data integrity.

**Acceptance Criteria:**

**Given** a complete form draft
**When** the user clicks "Publish"
**Then** the backend validates the entire form JSON against the shared Form Definition contract.
**And** the form status transitions from `DRAFT` to `ESCROW_LOCKED` (initiating the financial flow for external surveys) or directly to `PUBLISHED` (for internal non-reward surveys).
**And** the full lifecycle state machine is defined: `DRAFT` -> `ESCROW_LOCKED` -> `MODERATION_QUEUE` -> `PUBLISHED` -> `CLOSED`.
**And** once leaving the `DRAFT` state, the API strictly rejects any `PUT`/`PATCH` requests that attempt to mutate the form's blocks or schema.

### Story 2.7: Form Versioning

As a Publisher,
I want to create a new version of an already published form,
So that I can make adjustments (e.g., adding a new question) without corrupting the historical response data of the previous version.

**Acceptance Criteria:**

**Given** a form in `PUBLISHED` state
**When** the user clicks "Create New Version"
**Then** a new `FormVersion` entity is created under the same logical `Form`, with status `DRAFT` and `version_number` incremented under `unique(form_id, version_number)`.
**And** the published `FormVersion` remains immutable.
**And** every Attempt pins one exact `FormVersion`, and any Response derives its authoritative logical Form, version, and participant context from that Attempt.

## Epic 3: AI Form Generation Assistant

**Goal:** Publishers can rapidly generate form drafts using natural language prompts without blocking manual flows if the AI fails.

### Story 3.1: AI Prompt Submission & Payload Preparation

As a Publisher,
I want to describe my survey in natural language,
So that the AI can understand my requirements and generate an appropriate structure.

**Acceptance Criteria:**

**Given** the Form Builder interface
**When** the user clicks "Generate with AI"
**Then** a modal opens allowing them to input a text prompt.
**And** upon submission, the backend constructs a structured prompt payload including the shared Form Definition rules to send to the AI Gateway.

### Story 3.2: AI JSON Generation & UX Loading States

As a Publisher,
I want to see clear visual feedback while the AI is generating my form,
So that I know the system is working during the 30-60 second wait time.

**Acceptance Criteria:**

**Given** a submitted AI prompt
**When** the backend is waiting for the AI Gateway response
**Then** the frontend displays a clear loading state (e.g., skeleton loaders, progress text).
**And** the backend connection to the AI Gateway is configured with a 60-second timeout, bypassing the standard 500ms API SLA.

### Story 3.3: AI Output Parsing & Zod Validation

As a System Architect,
I want the AI output to be strictly validated before being saved,
So that AI hallucinations cannot corrupt the Form Builder state.

**Acceptance Criteria:**

**Given** a JSON response returned by the AI Gateway
**When** the backend receives the payload
**Then** it must parse the JSON and strictly validate it against the shared Form Definition Zod contract in `packages/schemas`.
**And** if validation passes, the JSON is saved as a new `DRAFT` form.
**And** the frontend loads this new draft into the standard drag-and-drop Builder for manual editing.

### Story 3.4: AI Failure & Fallback Isolation

As a Publisher,
I want the system to handle AI errors gracefully,
So that I can immediately switch to manual form creation if the AI server is down or returns invalid data.

**Acceptance Criteria:**

**Given** an AI generation request
**When** the AI Gateway times out, is unreachable via Tailscale, or returns Zod-invalid JSON
**Then** the backend gracefully catches the error and returns a friendly error message to the frontend.
**And** the UI notifies the user ("AI is currently unavailable or returned an invalid structure") and provides a direct CTA to "Build Form Manually."
**And** core system stability (login, survey feed, manual builder) is 100% unaffected by the AI failure.

## Epic 4: Survey Distribution & Public Access

**Goal:** Publishers can distribute surveys (internal feed or external links) and set targeting criteria; Respondents can discover targeted surveys.

### Story 4.1: Survey Targeting Criteria

As a Publisher,
I want to define demographic targeting criteria for my survey (e.g., age range, location),
So that my survey only reaches the relevant audience on the RESCOM Marketplace.

**Acceptance Criteria:**

**Given** a form being prepared for publish
**When** the user configures the distribution settings
**Then** they can set demographic requirements (e.g., Age 18-25, Location: Hanoi).
**And** the targeting configuration is saved as part of the survey's metadata (separate from the schema definition).

### Story 4.2: Automated Marketplace Matching

As a Respondent,
I want to see a personalized feed of surveys that match my demographic profile,
So that I don't waste time clicking on surveys I am not eligible for.

**Acceptance Criteria:**

**Given** an authenticated Respondent who has completed their demographic profile
**When** they view the Marketplace feed
**Then** the backend automatically filters the `PUBLISHED` surveys, only returning those where the Respondent's profile matches the Publisher's targeting criteria.

### Story 4.3: Feed Interactions (Sort/Filter/Auto-Hide)

As a Respondent,
I want to sort/filter my survey feed and automatically hide surveys I've already completed,
So that I can easily find new earning opportunities.

**Acceptance Criteria:**

**Given** the Marketplace feed
**When** the user views the page
**Then** any survey they have already submitted successfully is hidden from the feed.
**And** they can manually sort surveys by Reward amount or Estimated time.

### Story 4.4: Public Link & Guest Submissions

As a Publisher,
I want to generate a public link for my Internal Form and allow non-registered guests to submit responses,
So that I can collect data outside the RESCOM ecosystem without spending Escrow points.

**Acceptance Criteria:**

**Given** a published Internal Form configured for Public Access
**When** a non-logged-in user accesses the public link (`rescom.app/f/{id}`)
**Then** they can view and submit the form.
**And** the submission is tagged as `GUEST` and does NOT deduct points from the Publisher's Escrow, nor does it award points to the submitter.
**And** the guest submission receives Response Integrity assessment and contributes to Survey Quality, but Respondent Reliability is marked `NOT_AVAILABLE` and cannot be merged into an authenticated profile.
**And** the submission endpoint enforces strict IP-based rate limiting (e.g., 3 per day per IP) and requires an invisible reCAPTCHA/Turnstile token to prevent bot spam.

### Story 4.5: External Survey Setup (Google Forms)

As a Publisher,
I want to post a link to a Google Form and have the system auto-generate a Completion Code,
So that I can use RESCOM to drive traffic to my external surveys.

**Acceptance Criteria:**

**Given** the "Create External Survey" stepper
**When** the Publisher inputs their Google Forms link
**Then** the system automatically generates one unique, secure 6-digit Completion Code for the published External Form Version.
**And** shows the plaintext once and instructs the Publisher to paste it at the end of their external form while persisting only a keyed verifier.
**And** changing the code creates a new immutable Form Version; the code is not generated per Respondent attempt.

## Epic 5: Survey Execution & Responses

**Goal:** Respondents can complete surveys securely and smoothly, handling edge cases like timeouts, completion codes, and file uploads.

### Story 5.1: Survey Attempt Initialization & Concurrency

As a Respondent,
I want to start a survey attempt,
So that the system can verify my eligibility and reserve my spot before I spend time answering.

**Acceptance Criteria:**

**Given** a Respondent clicks "Start Survey"
**When** the backend receives the request
**Then** it verifies the exact FormVersion is published/open, the participant remains eligible, and the logical Form has not already been completed (FR-25).
**And** under concurrency it checks quota and conflicting active Attempts, then creates an expiring quota reservation.
**And** it creates an Attempt pinned by foreign key to that immutable `FormVersion`; authenticated one-completion is enforced at the logical `Form` level.
**And** in the same transaction it creates exactly one one-to-one Response identity with status `IN_PROGRESS`, so pre-submission telemetry has a durable `responseId`; submit transitions this record and never creates a second Response (FR-ADD-9, AD-19).
**And** External start applies the same published/open, eligibility, logical-completion, quota, conflicting-attempt, reservation, and server-start-time checks, omitting only the pre-submit Internal Response identity.

### Story 5.2: Internal Form Rendering & Execution

As a Respondent,
I want a smooth survey answering experience,
So that I can easily navigate questions even with unstable internet.

**Acceptance Criteria:**

**Given** an `IN_PROGRESS` internal survey
**When** the user is viewing the form
**Then** the frontend dynamically renders all inputs based on the shared Form Definition contract (FR-26).
**And** the renderer passively emits consented, privacy-preserving behavioral telemetry events (question view, answer select/change, focus/blur, navigation) via the shared telemetry contract (FR-58).
**And** if the network drops during answering, the UI caches inputs locally and shows an offline warning, automatically reconnecting when possible (UX-ADD-3); missing client telemetry must never block form submission.

### Story 5.3: File Upload Validation & Secure Storage

As a Respondent,
I want to upload files securely if a question requires it,
So that I can provide complete data without risking system security.

**Acceptance Criteria:**

**Given** a file upload block in a survey
**When** the user selects a file
**Then** the frontend validates file size and type (e.g., max 5MB, images/pdf only).
**And** the backend generates a secure, time-limited S3 presigned URL.
**And** the file is uploaded directly to private object storage through a scoped URL and enters the durable technical state `UPLOADED` then `QUARANTINED`; only a server-verified `CLEAN` object may become `ATTACHED` to the Response or downloadable, while scan outage fails closed (FR-ADD-10, AD-22).

### Story 5.4: Internal Form Submission

As a Respondent,
I want to submit my completed internal survey,
So that my answers are securely saved and I am credited with my reward instantly.

**Acceptance Criteria:**

**Given** a completed form payload
**When** the user clicks "Submit"
**Then** the backend strictly validates the `answers` array against the immutable FormVersion definition and shared schema contract (FR-40).
**And** upon success, saves the data, transitions the Response status to `VALIDATED`.
**And** for an authenticated Respondent, pins the effective policy-deployment identity/mode and atomically creates independent versioned `InternalRewardRequested` and `IntegrityAssessmentRequested` Outbox events carrying it in the same database transaction, with named ordering stream/sequence when ordering-sensitive, fenced claim/lease, retry/dead-letter, and atomic per-handler effect/deduplication semantics from AD-10; Guest Internal submission creates only the assessment event.
**And** in `SHADOW` or `ADVISORY`, Economy idempotently credits Available without waiting for scoring (FR-29); in an approved `ENFORCED` mode it posts the reward first to a non-spendable Integrity Hold and a later decision command releases or retains that hold.
**And** terminal assessment failure or a missed governance deadline in `ENFORCED` emits one idempotent fail-open release plus an incident so the hold cannot be stranded.

### Story 5.5: External Form Completion Code Verification

As a Respondent,
I want to enter the Completion Code I received from an external survey (e.g., Google Forms),
So that I can prove I finished it and claim my points.

**Acceptance Criteria:**

**Given** a completed external survey attempt
**When** the user enters a 6-digit Completion Code
**Then** the backend verifies the versioned keyed digest in constant time against the exact published External Form Version pinned by the active Attempt, never logs the plaintext/input code, and checks the server-authoritative Time Barrier (FR-13, FR-22).
**And** three failed validations lock the Attempt; account-plus-FormVersion abuse limits apply, and any IP/device scope requires Privacy approval.
**And** a named Participation coordinator atomically commits the completion claim and Economy Pending journal under one shared Unit of Work keyed `external-completion:{attemptId}`; failure rolls both back and retry returns the original result (FR-24, AD-16).
**And** provides an alternate flow ("Missing Code Report") if the user claims the Publisher forgot to include the code (FR-23).

## Epic 6: Immutable Point Ledger & Wallet

**Goal:** The system maintains an unalterable financial ledger for point transactions ensuring absolute integrity across balances, escrows, and top-ups.

### Story 6.1: Double-Entry Ledger Core & Idempotency

As a System Architect,
I want all point movements to be recorded in a double-entry ledger database,
So that point balances are strictly auditable and immune to race conditions or lost data.

**Acceptance Criteria:**

**Given** any financial point transfer (e.g., User to Escrow)
**When** the transaction is executed
**Then** Economy creates one `LedgerJournal` for the business command and at least two equal-and-opposite `LedgerEntry` rows against explicit `LedgerAccount` records (FR-30).
**And** the signed entries for each journal and Point unit sum to zero before posting in one database transaction.
**And** user Available, Pending, Frozen, Escrow, and Integrity Hold accounts cannot overdraft: Economy locks affected balance projections in ascending account-ID order and checks sufficiency, appends entries, and updates the rebuildable projection in the same transaction.
**And** posted journals/entries are append-only; each journal can be reversed at most once through a unique `reversesJournalId` journal that exactly negates it, with reversal-of-reversal forming a non-branching chain.
**And** the journal has one globally unique command/idempotency reference to prevent duplicate posting on retries (FR-ADD-11).

### Story 6.2: Wallet Balance Aggregation & Presentation

As a User,
I want to view my current point balances,
So that I know how much I can spend or withdraw.

**Acceptance Criteria:**

**Given** the Wallet UI
**When** the user loads the page
**Then** the backend calculates their balance dynamically, or via a rebuildable projection, from posted Ledger entries.
**And** the UI clearly displays: Available Balance, Pending Balance, Escrowed Points, and Frozen Points (FR-31).

### Story 6.3: Escrow Lock, Release & Refund

As a Publisher,
I want to lock points in Escrow when publishing a survey and get refunded for unused quotas,
So that respondents are guaranteed payment but I don't lose points if the survey ends early.

**Acceptance Criteria:**

**Given** a survey ready to publish
**When** the Publisher confirms payment
**Then** the system calculates the total cost (applying the 20% internal discount if applicable) (FR-14, FR-19).
**And** the Research publish coordinator atomically commits publication and Economy Escrow journal under one shared Unit of Work keyed by FormVersion; failure rolls both back (FR-15, AD-16).
**And** when the survey is manually closed, the Research close coordinator atomically commits close state and Economy refund journal for remaining Escrow under a stable close command (FR-32, FR-33).

### Story 6.4: Respondent Point Credit & Pending Logic

As a Respondent,
I want my points credited according to the survey type,
So that I receive instant rewards for internal surveys and pending rewards for external ones.

**Acceptance Criteria:**

**Given** a validated survey completion
**When** the reward transaction is triggered
**Then** for authenticated Internal forms in `SHADOW`/`ADVISORY`, Economy transfers points from Escrow to Available from the independent reward event without waiting for scoring (FR-29); Guest forms emit no reward event.
**And** under an `ENFORCED` policy, Economy first places points in an Integrity Hold; an immutable decision/review command releases or retains it, while terminal assessment failure/deadline releases fail-open and opens an incident.
**And** for External forms, the atomic completion coordinator transfers points to Pending, triggering an idempotent scheduled release after 48 hours only if no locked dispute hold exists (FR-24).

### Story 6.5: Frozen Starter Points Lifecycle

As a New User,
I want to receive starter points that unlock when I complete my profile,
So that I am incentivized to fill out my demographic data.

**Acceptance Criteria:**

**Given** a newly registered account
**When** the account is created
**Then** they receive 100 "Frozen" points (FR-4).
**And** when they successfully complete the Mandatory Demographic Survey and 1 additional marketplace survey, the ledger transfers these points from Frozen to Available (FR-8).
**And** a scheduled worker automatically expires (voids) these frozen points if both onboarding steps are not completed within 30 days of registration (FR-5).

### Story 6.6: Point Top-Up Request & Admin Approval

As a User,
I want to top up my balance via bank transfer,
So that I can fund my account to publish surveys.

**Acceptance Criteria:**

**Given** the Top-Up UI
**When** the user generates a transfer request
**Then** they are shown a QR code / Bank Info with a unique transfer syntax (FR-34).
**And** the request enters a "Pending Payment" state.
**And** an Admin can later review this request and click "Approve"; Economy verifies the live capability and idempotently commits approval plus one Ledger journal keyed `topup-approval:{topUpId}`, records actor/correlation, and emits a replayable Moderation admin-audit event (FR-35, AD-16).

## Epic 7: Onboarding, Demographics & Gamification

**Goal:** Respondents complete demographic profiles to unlock the platform and engage with gamification elements (streaks, tiers) to build habits.

### Story 7.1: Mandatory Demographic Survey

As a New Respondent,
I want to fill out my demographic profile upon my first login,
So that I can unlock my frozen starter points and access the survey marketplace.

**Acceptance Criteria:**

**Given** a newly registered user who has not completed onboarding
**When** they attempt to access the Marketplace
**Then** they are redirected to a Mandatory Demographic Survey (FR-6, FR-9).
**And** they cannot bypass this screen to access other earning features.
**And** upon successful submission, the system saves their profile and opens the Marketplace activation step; starter points remain Frozen until one additional Marketplace survey is completed (FR-7, FR-8).

### Story 7.2: Marketplace Survey Activation Step

As a New Respondent,
I want to complete one Marketplace survey after my demographic profile,
So that I can prove initial participation and unlock my starter Points.

**Acceptance Criteria:**

**Given** a Respondent who completed the demographic survey but has not completed activation
**When** they access the Marketplace
**Then** the system prompts them to complete one eligible Marketplace survey (FR-7).
**And** only after that completion does Economy transfer 100 Points from Frozen to Available exactly once (FR-8).

### Story 7.3: Automated Demographic Cross-Check (Algorithmic & AI-Ready)

As a System Architect,
I want the system to passively analyze user answers in internal forms and cross-check them against their onboarding profile,
So that we can detect respondents who provide false demographic data seamlessly.

**Acceptance Criteria:**

**Given** a Respondent submits an Internal Form
**When** the form contains questions related to demographic data (e.g., "Bạn bao nhiêu tuổi?", "Bạn đang sống ở đâu?")
**Then** the system algorithmically extracts the answers and compares them to the user's stored Onboarding profile (FR-27).
**And** if a discrepancy is detected, it creates a versioned integrity signal; it cannot independently reject a response or create a FraudLog entry unless a separate security policy is violated.
**And** the verification module must be designed via an Interface/Port so that a future "AI Verification Engine" can be seamlessly plugged in to augment the basic algorithmic checks without rewriting the core business logic.

### Story 7.4: Gamification: Daily Streaks

As a Respondent,
I want to see my daily survey completion streak,
So that I feel motivated to log in and earn points every day.

**Acceptance Criteria:**

**Given** an active Respondent
**When** they complete at least one survey in a calendar day
**Then** their `current_streak` counter is incremented (FR-49).
**And** if they miss a full calendar day, the `current_streak` resets to 0.
**And** the UI visually displays their streak on their dashboard.

### Story 7.5: Gamification: Respondent Leaderboard

As a Respondent,
I want to see where I rank compared to others,
So that I am competitively driven to complete more surveys.

**Acceptance Criteria:**

**Given** the Leaderboard UI
**When** a user views it
**Then** the backend returns an aggregated ranking of the top point-earners (FR-50).
**And** the user can see their own specific rank relative to the top 100.

### Story 7.6: Gamification: Progression Tiers (Trusted Researcher)

As a Respondent,
I want to unlock higher tiers by completing surveys,
So that I can earn better platform perks like faster payouts.

**Acceptance Criteria:**

**Given** a Respondent who has completed ≥ 100 valid surveys
**When** their count hits the threshold
**Then** they are automatically upgraded to the "Trusted Researcher" tier (FR-51).
**And** this tier automatically reduces the pending period for External Forms from 48 hours to 24 hours.
**And** completion count determines only the engagement tier; it does NOT automatically set Respondent Reliability, which is calculated independently based on verified internal response quality.

## Epic 8: Security, Moderation & Integrity Guard

**Goal:** The platform automatically blocks bot activity and provides Admins with tools to moderate content and resolve disputes.

### Story 8.1: Survey Moderation Queue

As an Admin,
I want to review all newly created surveys before they go live on the Marketplace,
So that I can ensure they meet platform guidelines and don't contain malicious content.

**Acceptance Criteria:**

**Given** a Publisher publishes a survey
**When** the status changes to `MODERATION_QUEUE`
**Then** it appears in the Admin Moderation Dashboard (FR-20, FR-53).
**And** an Admin can preview the survey and click "Approve" (moves to `PUBLISHED`) or "Reject" (moves to `CLOSED`, points refunded).

### Story 8.2: Automated Bot Protection (Time Barrier & Rate Limit)

As a System Architect,
I want to implement automated protections against bots,
So that malicious scripts cannot drain Publisher Escrows.

**Acceptance Criteria:**

**Given** a Respondent submitting an Internal Form
**When** the system receives the submission
**Then** it checks the "Time Barrier" (e.g., submission must take at least `number_of_questions * 2` seconds). If too fast, it's rejected (FR-45).
**And** it enforces the configured Rate Limit (FR-46, FR-28); PostgreSQL remains authoritative for the Attempt, and Redis becomes the shared counter store when multi-replica/shared enforcement is required.
**And** these security controls operate independently of and provide evidence to the Research Integrity Engine.

### Story 8.3: Integrity Incident System

As a System Admin,
I want the system to silently log suspicious behavior,
So that I can review patterns and identify sophisticated bots over time.

**Acceptance Criteria:**

**Given** a user failing the Time Barrier, Rate Limit, or Demographic Cross-Check
**When** the failure occurs
**Then** a rejected hard Time Barrier/Rate Limit violation logs a `FraudLog` entry, while a Demographic Cross-Check mismatch creates only a versioned Integrity signal unless separately confirmed as a security-policy violation (FR-47).
**And** `FraudLog` remains strictly reserved for confirmed abuse and hard security violations; response quality scoring and review routing remain in integrity assessment records.
**And** Admins can view a `FraudLog` monitoring dashboard to analyze these entries (FR-55).

### Story 8.4: Frozen Starter Point Anti-Bot Control

As a System Owner,
I want starter Points to remain unusable until onboarding is completed,
So that creating fake accounts cannot immediately create spendable value.

**Acceptance Criteria:**

**Given** a newly registered account with 100 Frozen Points
**When** onboarding is incomplete
**Then** the account cannot spend those Points (FR-48).
**And** Integrity scores or review routing never automatically freeze Available Balance; a separate authorized security/Admin action is required for account restrictions.

### Story 8.5: Complaint & Dispute Resolution Workflow

As a Publisher,
I want to report invalid responses from external surveys,
So that I don't lose points to low-quality respondents.

**Acceptance Criteria:**

**Given** an external survey response in the 48-hour pending window
**When** the Publisher clicks "Report Response" and provides a reason
**Then** the response enters a `DISPUTED` state, and the points remain locked.
**And** an Admin can review the dispute in the Admin Panel and decide to either "Refund Publisher" (returns points to Escrow/Publisher) or "Reject Complaint" (releases points to Respondent) (FR-54).

## Epic 9: Analytics, Feedback & Notifications

**Goal:** Users receive timely notifications and Publishers gain insights from survey traffic and respondent feedback.

### Story 9.1: Survey Traffic & Analytics Dashboard

As a Publisher,
I want to view basic analytics for my published surveys,
So that I can measure the performance and conversion rate of my campaigns.

**Acceptance Criteria:**

**Given** a published survey
**When** the Publisher opens the Analytics Dashboard
**Then** the UI displays: Total Views, Total Completions, Conversion Rate, and Average Completion Time (FR-41).
**And** for Internal Forms, it displays Response Integrity score distribution, confidence, evidence coverage, safe reason codes, and Survey Quality metrics (FR-40).
**And** for External Forms, the Integrity section displays `NOT_ASSESSED`.
**And** for Internal Forms, it also provides a CSV export of the raw JSON response data with assessment metadata.

### Story 9.2: Respondent Post-Completion Feedback

As a Respondent,
I want to rate and review the survey I just completed,
So that I can report if a survey was broken, misleading, or too long.

**Acceptance Criteria:**

**Given** a newly submitted survey
**When** the submission is successful
**Then** the UI immediately prompts the Respondent with a 5-star rating component and an optional comment box (FR-43).
**And** the feedback is saved, linked to the `form_id`, and feeds into Survey Quality aggregation only after validation.

### Story 9.3: Publisher Feedback Summary

As a Publisher,
I want to see the aggregated feedback from Respondents,
So that I can improve my future surveys.

**Acceptance Criteria:**

**Given** the Publisher's Survey Dashboard
**When** a survey has received feedback
**Then** the UI displays the average star rating and a list of respondent comments/tags (FR-42).

### Story 9.4: Negative Feedback Deprioritization

As a Platform Owner,
I want poorly rated surveys to lose visibility,
So that Respondents have a better experience on the Marketplace.

**Acceptance Criteria:**

**Given** a survey with an average rating below a specific threshold (e.g., < 2 stars after 10 reviews)
**When** the Marketplace feed is generated for a user
**Then** the algorithm deprioritizes this survey, pushing it to the bottom of the feed (FR-44).
**And** if it drops below a critical threshold (e.g., < 1.5 stars), it is automatically flagged for Admin Moderation review.

### Story 9.5: Transaction & Ledger Dashboard

As a User (Publisher/Respondent),
I want to view my complete point transaction history,
So that I can track my earnings and expenditures transparently.

**Acceptance Criteria:**

**Given** the Wallet UI
**When** the user clicks "Transaction History"
**Then** they see a paginated list of their point movements (earned, locked, refunded, spent) projected from owned Ledger journals and entries (FR-56).
**And** each entry shows the date, amount, transaction type, and related `form_id` (if applicable).

### Story 9.6: Event Notification System

As a User,
I want to receive notifications for important account events,
So that I know when my surveys are approved, points are released, or top-ups succeed.

**Acceptance Criteria:**

**Given** a system event (e.g., 48h pending points released, Top-up approved)
**When** the event occurs
**Then** an in-app notification record is created for the target user (FR-57).
**And** a notification badge appears in the user's header navigation.
**And** the user can click to view a list of recent unread notifications.

## Epic 10: Research Integrity Foundation & TrustGraph

**Goal:** Internal Form responses produce privacy-conscious telemetry, explainable integrity assessments, respondent reliability history, Survey Quality assessments, and TrustGraph-ready evidence without affecting external form compatibility.

### Story 10.1: Integrity Consent & Telemetry Event Contract

As a System Architect,
I want a shared Zod contract and consent schema for behavioral telemetry,
So that only approved, non-invasive interaction events are captured with explicit respondent consent.

**Acceptance Criteria:**

**Given** the shared schemas package
**When** telemetry schemas are defined
**Then** the contract permits only allowed event types: `QUESTION_SHOWN`, `ANSWER_SELECTED`, `ANSWER_CHANGED`, `QUESTION_SKIPPED`, `QUESTION_RETURNED`, `PAGE_HIDDEN`, `PAGE_VISIBLE`, `ATTENTION_CHECK_RESULT`, `RESPONSE_SUBMITTED` (FR-58).
**And** raw keystrokes, clipboard content, cross-site trackers, and background device inspection are strictly prohibited.
**And** each event requires `responseId`, `formVersionId`, `clientEventId`, `sequenceNumber`, and timestamp.
**And** the schema records consent-notice version acceptance prior to Internal Form answering.

### Story 10.2: Behavioral Telemetry Collection in Internal Form Renderer

As a Respondent,
I want my interaction telemetry captured smoothly in the background,
So that my survey answering is not slowed down or blocked by network glitches.

**Acceptance Criteria:**

**Given** an authenticated or guest respondent completing an Internal Form
**When** they interact with the form (changing focus, selecting answers, navigating)
**Then** the frontend batches and emits events to `POST /responses/:responseId/integrity-events` (FR-58).
**And** client event IDs ensure deduplication on the backend.
**And** telemetry failures or drops do NOT prevent response submission.

### Story 10.3: Signal Derivation Pipeline & Outbox Processing

As a Data Engineer,
I want a reliable asynchronous worker to derive integrity signals from stored events and answers,
So that raw events are distilled into normalized, immutable features for scoring.

**Acceptance Criteria:**

**Given** an `IntegrityAssessmentRequested` Outbox event triggered independently of the baseline reward event upon Internal Form submission (AD-10, AD-14)
**When** the Integrity Worker processes the event
**Then** it derives versioned signals: Temporal (dwell time, completion ratio), Interaction (revisions, skips), Attention check result, Consistency pairs, Semantic score (via AI Gateway if available), and Historical baseline (FR-59, FR-63).
**And** missing signals are explicitly marked as unavailable evidence rather than default penalties.
**And** derivation is idempotent and can be safely re-run without duplicate side effects.
**And** the worker claims with an owner/fencing token; an ordering-sensitive handler consumes its complete named stream, defers stream-sequence gaps, ignores duplicate/stale sequences, and commits each PostgreSQL-local effect with its processed-handler record atomically. Aggregate version is not used as a partial-subscription delivery offset.

### Story 10.4: Pure Versioned Response Integrity Scoring Core

As a System Architect,
I want a deterministic, pure domain scoring service,
So that response integrity assessments are mathematically reproducible and support progressive policy rollout.

**Acceptance Criteria:**

**Given** derived signals and an immutable `ScoringPolicy` definition
**When** the scoring engine calculates an assessment
**Then** it appends an assessment revision containing `score` (0–100 when applicable), `confidence` (0.0–1.0), `evidenceCoverage` (0.0–1.0), safe `reasonCodes`, policy version, and input lineage (FR-59, FR-63).
**And** a separate immutable `IntegrityDecision` links to that assessment and records operational outcome (`ACCEPT`, `REVIEW`, `NOT_ASSESSED`) plus rollout mode (FR-64).
**And** the engine operates in `SHADOW` (logged only), `ADVISORY` (visible to authorized users), or `ENFORCED` mode (AD-14).
**And** External Form responses automatically receive `NOT_ASSESSED` (FR-67).
**And** re-running with a new policy version creates a new assessment revision without overwriting historical records.

### Story 10.5: Cold Start & Respondent Reliability Snapshots

As a Respondent,
I want my reliability to start at a neutral baseline and build up over time,
So that I am not treated as suspicious just because I am a new user.

**Acceptance Criteria:**

**Given** a new or unestablished respondent (0–2 completed surveys)
**When** their response is scored
**Then** their Respondent Reliability state is `UNESTABLISHED` with low confidence, relying on current response evidence and cohort baselines (FR-60, FR-61).
**And** missing personal history does NOT penalize their integrity score.
**And** as verified internal responses accumulate, the system creates immutable `RespondentReliabilitySnapshot` records with updated `ReliabilityState` (`UNESTABLISHED` → `EMERGING` → `ESTABLISHED` → `TRUSTED`).
**And** guest submissions receive `NOT_AVAILABLE` for Respondent Reliability.

### Story 10.6: Survey Quality Assessment per Form Version

As a Publisher,
I want to receive objective quality insights for my survey design,
So that I can identify confusing questions or high-dropout sections across form versions.

**Acceptance Criteria:**

**Given** an Internal Form Version with completed and abandoned attempts
**When** the Survey Quality Worker aggregates data
**Then** it computes a `SurveyQualitySnapshot` using dropout rates, completion-time variance, question friction, attention failures, and respondent feedback (FR-62).
**And** poor Survey Quality does NOT penalize the reliability score of respondents who answered it.
**And** a new Form Version starts a clean, independent quality assessment.

### Story 10.7: Admin Integrity Review Queue & Label Feedback Loop

As an Admin,
I want a dedicated Integrity Review Queue separate from the FraudLog,
So that I can inspect flagged responses and confirm ground-truth quality labels.

**Acceptance Criteria:**

**Given** an assessment routed to `REVIEW` under an `ENFORCED` policy
**When** an Admin opens the Integrity Review dashboard
**Then** the UI displays the score, confidence, evidence coverage, reason codes, and response context without exposing raw keystrokes or hidden thresholds (FR-65).
**And** the Admin can resolve with `ACCEPTED`, `INSUFFICIENT_EVIDENCE`, or `REJECTED`.
**And** resolving with `ACCEPTED` idempotently releases held Escrow rewards to the respondent.
**And** confirmed review decisions are saved as immutable training/calibration labels.

### Story 10.8: Relational TrustGraph Projection & Evidence Protection

As a System Architect,
I want integrity-relevant relationships stored as a queryable relational projection in PostgreSQL,
So that the system can track graph evidence without requiring a separate graph database in MVP.

**Acceptance Criteria:**

**Given** authoritative records for Users, Responses, Form Versions, Reviews, and Policies are stable and a measured query/evidence trigger has been approved under AD-15
**When** relationships change
**Then** typed `TrustEdge` records are projected in PostgreSQL (e.g., Respondent → Response, FormVersion → Publisher, Response → ReviewOutcome) (FR-66, FR-67, AD-15).
**And** raw graph and device linkages are strictly isolated and never exposed through Publisher-facing APIs.
**And** the projection is fully rebuildable from primary transactional tables.
