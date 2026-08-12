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

### NonFunctional Requirements

NFR-1: API average response time < 500ms under normal load
NFR-2: Survey Feed loads in < 2 seconds with ≤ 50 surveys
NFR-3: Point transactions use ACID + row-level locking to prevent race conditions
NFR-4: In-memory cache for Time Barrier data to reduce database hits
NFR-5: AI Form Generation has a separate timeout (not subject to 500ms SLA)
NFR-6: Stateless JWT stored in HTTP-Only Cookies
NFR-7: CORS, Helmet, express-rate-limit on all API endpoints
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

- Turborepo Monorepo setup for Next.js (Frontend) and NestJS (Backend)
- Shared `form-schema` Zod package imported by both FE and BE
- Clean Architecture implementation in NestJS (Domain, Application, Infrastructure, Presentation layers)
- Redis Cache integration for Time Barrier and Rate Limiting
- In-process background job execution using `@nestjs/schedule`
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

### Epic 8: Security, Moderation & Anti-Fraud
**Goal:** The platform automatically blocks bot activity and provides Admins with tools to moderate content and resolve disputes.
**FRs covered:** FR-20, FR-28, FR-45, FR-46, FR-47, FR-48, FR-53, FR-54, FR-55

### Epic 9: Analytics, Feedback & Notifications
**Goal:** Users receive timely notifications and Publishers gain insights from survey traffic and respondent feedback.
**FRs covered:** FR-41, FR-42, FR-43, FR-44, FR-56, FR-57

### Additional Production Requirements (Newly Added)

**Form Builder & Schema**
- **FR-ADD-1:** Form Builder must support specific block types: text, textarea, number, single choice, multiple choice, rating, linear scale, date, file upload (as per PRD).
- **FR-ADD-2:** Form Builder must support block editing, reordering, and duplication.
- **FR-ADD-3:** Form Builder must support draft/autosave functionality and live preview before publishing.
- **FR-ADD-4:** The `form-schema` must implement strict validation for the Form Definition JSON structure, including conditional logic rules if any.
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
- **FR-ADD-12:** RBAC: The system must enforce Role-Based Access Control. Roles must be clarified (e.g., Admin: full system control; Publisher: create/manage forms and escrow; Respondent: answer forms and earn points).
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
**Then** a new account is created with the default role (Respondent) and the user is logged in
**And** the password must be securely hashed (e.g., bcrypt) and a stateless JWT is issued in an HTTP-Only cookie.

**Given** an already registered email address
**When** the user attempts to register again
**Then** the system returns an appropriate error preventing duplicate registration without leaking account existence unnecessarily.

**Given** an existing user
**When** they attempt to log in with invalid credentials
**Then** the system returns a 401 error.

**Given** a logged-in user
**When** they click logout
**Then** their session is cleared (cookie cleared) on the client side.

### Story 1.2: Google OAuth Login

As a User,
I want to log in using my Google account,
So that I can access the platform quickly without remembering a new password.

**Acceptance Criteria:**

**Given** a user on the login page
**When** they click "Continue with Google" and authorize the app
**Then** the system logs them in (or creates a new account if first time)
**And** issues the same stateless JWT in an HTTP-Only cookie.
**And** [Decision Required: Define behavior if the Google email matches an existing email/password account (e.g., auto-link accounts vs block due to conflict)].

### Story 1.3: Single-Session Enforcement

As a User/Admin,
I want my account to only have one active session at a time,
So that my account is protected from unauthorized concurrent access, despite using stateless JWTs.

**Acceptance Criteria:**

**Given** an already logged-in user
**When** the user logs in from a new device/browser
**Then** the old session is immediately invalidated (e.g., by incrementing a `session_version` in the DB that the JWT must match, or blacklisting the old token).
**And** any subsequent requests using the old JWT return a 401 Unauthorized error.

### Story 1.4: Role-Based Access Control (RBAC) & User Management

As an Admin,
I want to view all users and manage their roles/status,
So that I can control who has Publisher or Admin privileges and lock bad actors.

**Acceptance Criteria:**

**Given** an authenticated Admin user
**When** they access the User Management dashboard
**Then** they see a paginated list of all users
**And** they can change a user's role (Respondent -> Publisher) or lock/unlock their account.

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
**And** all payload validations use the shared Zod schema definitions (`form-schema` package).

## Epic 2: Core Form Builder & Schema

**Goal:** Publishers can create, edit, version, and manage surveys using a drag-and-drop interface, while schemas remain strictly validated and immutable upon publish.

### Story 2.1: Shared Form Schema Validation

As a Full-Stack Developer,
I want a shared Zod schema package defining the Form Definition JSON,
So that both the frontend Form Builder and backend APIs validate the form structure consistently.

**Acceptance Criteria:**

**Given** the monorepo architecture
**When** a form definition is evaluated
**Then** it must be validated against a shared `form-schema` Zod package.
**And** the schema must support standard block types (text, textarea, number, single choice, multiple choice, rating, linear scale, date, file upload).
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
**Then** the UI switches to a rendering mode displaying the form strictly via the `form-schema` parser (no editing controls).
**And** interacting with the preview (e.g., typing in fields) does not save real response data to the database.

### Story 2.6: Form Publish Lifecycle & Immutability

As a Publisher,
I want to finalize my form and initiate the publishing process,
So that it can eventually be distributed while strictly locking the schema from edits to ensure data integrity.

**Acceptance Criteria:**

**Given** a complete form draft
**When** the user clicks "Publish"
**Then** the backend validates the entire form JSON against the `form-schema`.
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
**Then** a new form record is created with status `DRAFT` and `version_number` incremented by 1.
**And** the new draft retains a `parent_form_id` linking it to the original form.
**And** any existing responses remain permanently tied to the specific version of the form they were submitted against.

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
**And** upon submission, the backend constructs a structured prompt payload (including the `form-schema` definition rules) to send to the AI Gateway.

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
**Then** it must parse the JSON and strictly validate it against the shared `form-schema` Zod package.
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
**And** the submission endpoint enforces strict IP-based rate limiting (e.g., 3 per day per IP) and requires an invisible reCAPTCHA/Turnstile token to prevent bot spam.

### Story 4.5: External Survey Setup (Google Forms)

As a Publisher,
I want to post a link to a Google Form and have the system auto-generate a Completion Code,
So that I can use RESCOM to drive traffic to my external surveys.

**Acceptance Criteria:**

**Given** the "Create External Survey" stepper
**When** the Publisher inputs their Google Forms link
**Then** the system automatically generates a unique, secure 6-digit Completion Code.
**And** instructs the Publisher to paste this code at the end of their Google Form.

## Epic 5: Survey Execution & Responses

**Goal:** Respondents can complete surveys securely and smoothly, handling edge cases like timeouts, completion codes, and file uploads.

### Story 5.1: Survey Attempt Initialization & Concurrency

As a Respondent,
I want to start a survey attempt,
So that the system can verify my eligibility and reserve my spot before I spend time answering.

**Acceptance Criteria:**

**Given** a Respondent clicks "Start Survey"
**When** the backend receives the request
**Then** it verifies the user hasn't already completed this survey (FR-25).
**And** it checks if the survey quota is still open.
**And** it creates a Response record with status `IN_PROGRESS` (FR-ADD-9).

### Story 5.2: Internal Form Rendering & Execution

As a Respondent,
I want a smooth survey answering experience,
So that I can easily navigate questions even with unstable internet.

**Acceptance Criteria:**

**Given** an `IN_PROGRESS` internal survey
**When** the user is viewing the form
**Then** the frontend dynamically renders all inputs based on the `form-schema` definition (FR-26).
**And** if the network drops during answering, the UI caches inputs locally and shows an offline warning, automatically reconnecting when possible (UX-ADD-3).

### Story 5.3: File Upload Validation & Secure Storage

As a Respondent,
I want to upload files securely if a question requires it,
So that I can provide complete data without risking system security.

**Acceptance Criteria:**

**Given** a file upload block in a survey
**When** the user selects a file
**Then** the frontend validates file size and type (e.g., max 5MB, images/pdf only).
**And** the backend generates a secure, time-limited S3 presigned URL.
**And** the file is uploaded directly to S3 (bypassing our API server load), and the resulting restricted URL is stored in the response data (FR-ADD-10).

### Story 5.4: Internal Form Submission

As a Respondent,
I want to submit my completed internal survey,
So that my answers are securely saved and I am credited with my reward instantly.

**Acceptance Criteria:**

**Given** a completed form payload
**When** the user clicks "Submit"
**Then** the backend strictly validates the `answers` array against the original `form-schema` (FR-40).
**And** upon success, saves the data, transitions the Response status to `VALIDATED`.
**And** calls the Point Ledger to credit the user's Available Balance instantly.

### Story 5.5: External Form Completion Code Verification

As a Respondent,
I want to enter the Completion Code I received from an external survey (e.g., Google Forms),
So that I can prove I finished it and claim my points.

**Acceptance Criteria:**

**Given** a completed external survey attempt
**When** the user enters a 6-digit Completion Code
**Then** the backend verifies it matches the exact code generated for that survey (FR-13, FR-22).
**And** the system ensures this code hasn't been used maliciously.
**And** upon success, credits the user's Pending Balance with a 48-hour lock (FR-24).
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
**Then** it creates equal and opposite entries in a `ledger_transactions` table (FR-30).
**And** the table is append-only (no updates/deletes permitted).
**And** the API strictly requires and processes an `idempotency_key` to prevent double-spending on network retries (FR-ADD-11).

### Story 6.2: Wallet Balance Aggregation & Presentation

As a User,
I want to view my current point balances,
So that I know how much I can spend or withdraw.

**Acceptance Criteria:**

**Given** the Wallet UI
**When** the user loads the page
**Then** the backend calculates their balance dynamically (or via materialized view) directly from the ledger transactions.
**And** the UI clearly displays: Available Balance, Pending Balance, Escrowed Points, and Frozen Points (FR-31).

### Story 6.3: Escrow Lock, Release & Refund

As a Publisher,
I want to lock points in Escrow when publishing a survey and get refunded for unused quotas,
So that respondents are guaranteed payment but I don't lose points if the survey ends early.

**Acceptance Criteria:**

**Given** a survey ready to publish
**When** the Publisher confirms payment
**Then** the system calculates the total cost (applying the 20% internal discount if applicable) (FR-14, FR-19).
**And** it transfers the points from Available Balance to the system's Escrow account, locking them (FR-15).
**And** when the survey is manually closed by the Publisher, any remaining unspent Escrow points are immediately refunded to their Available Balance (FR-32, FR-33).

### Story 6.4: Respondent Point Credit & Pending Logic

As a Respondent,
I want my points credited according to the survey type,
So that I receive instant rewards for internal surveys and pending rewards for external ones.

**Acceptance Criteria:**

**Given** a validated survey completion
**When** the reward transaction is triggered
**Then** for Internal forms, points are transferred from Escrow directly to the Respondent's Available Balance (FR-29).
**And** for External forms, points are transferred to their Pending Balance, triggering a scheduled background job to release them to Available after 48 hours (if no complaint is filed) (FR-24).

### Story 6.5: Frozen Starter Points Lifecycle

As a New User,
I want to receive starter points that unlock when I complete my profile,
So that I am incentivized to fill out my demographic data.

**Acceptance Criteria:**

**Given** a newly registered account
**When** the account is created
**Then** they receive 500 "Frozen" points (FR-4).
**And** when they successfully complete the Mandatory Demographic Survey, the ledger transfers these points from Frozen to Available (FR-8).
**And** a scheduled cron job automatically expires (voids) these frozen points if the profile isn't completed within 7 days (FR-5).

### Story 6.6: Point Top-Up Request & Admin Approval

As a User,
I want to top up my balance via bank transfer,
So that I can fund my account to publish surveys.

**Acceptance Criteria:**

**Given** the Top-Up UI
**When** the user generates a transfer request
**Then** they are shown a QR code / Bank Info with a unique transfer syntax (FR-34).
**And** the request enters a "Pending Payment" state.
**And** an Admin can later review this request in the dashboard and click "Approve", which triggers a ledger transaction minting new points into the user's Available Balance (FR-35).

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
**And** upon successful submission, the system saves their profile to the database and unlocks their starter points (FR-8).

### Story 7.2: Secondary Deep Onboarding

As a Platform Owner,
I want users to provide deeper demographic data after they prove their engagement,
So that we can offer richer targeting criteria for Publishers.

**Acceptance Criteria:**

**Given** an active Respondent
**When** they perform a specific engagement trigger (e.g., reaching 1000 points or attempting their first withdrawal)
**Then** the system prompts them to complete a "Second Onboarding Survey" (FR-7).
**And** this survey updates their existing demographic profile with more granular data (e.g., household income, specific interests).

### Story 7.3: Automated Demographic Cross-Check (Algorithmic & AI-Ready)

As a System Architect,
I want the system to passively analyze user answers in internal forms and cross-check them against their onboarding profile,
So that we can detect respondents who provide false demographic data seamlessly.

**Acceptance Criteria:**

**Given** a Respondent submits an Internal Form
**When** the form contains questions related to demographic data (e.g., "Bạn bao nhiêu tuổi?", "Bạn đang sống ở đâu?")
**Then** the system algorithmically extracts the answers and compares them to the user's stored Onboarding profile (FR-27).
**And** if a direct contradiction is detected, the account and response are flagged for Admin review.
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

## Epic 8: Security, Moderation & Anti-Fraud

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
**And** it enforces a Rate Limit (e.g., max 3 surveys per minute per user) using Redis (FR-46, FR-28).

### Story 8.3: FraudLog System

As a System Admin,
I want the system to silently log suspicious behavior,
So that I can review patterns and identify sophisticated bots over time.

**Acceptance Criteria:**

**Given** a user failing the Time Barrier, Rate Limit, or Demographic Cross-Check
**When** the failure occurs
**Then** the system logs a `FraudLog` entry into the database (FR-47).
**And** Admins can view a `FraudLog` monitoring dashboard to analyze these entries (FR-55).

### Story 8.4: Anti-Bot Point Freezing

As a System Admin,
I want accounts flagged for fraud to have their points automatically frozen,
So that they cannot cash out ill-gotten gains before a manual review.

**Acceptance Criteria:**

**Given** a user accumulating too many `FraudLog` entries
**When** the `FraudLog` count exceeds the threshold (e.g., 3 strikes)
**Then** the system automatically transitions their Available Balance to a "Frozen" state (FR-48).
**And** they are blocked from initiating top-ups or withdrawals until an Admin clears the flag.

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
**And** for Internal Forms, it also provides a CSV export of the raw JSON response data (FR-40).

### Story 9.2: Respondent Post-Completion Feedback

As a Respondent,
I want to rate and review the survey I just completed,
So that I can report if a survey was broken, misleading, or too long.

**Acceptance Criteria:**

**Given** a newly submitted survey
**When** the submission is successful
**Then** the UI immediately prompts the Respondent with a 5-star rating component and an optional comment box (FR-43).
**And** the feedback is saved and linked to the `form_id`.

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
**Then** they see a paginated list of their point movements (earned, locked, refunded, spent) pulled directly from the `ledger_transactions` table (FR-56).
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
