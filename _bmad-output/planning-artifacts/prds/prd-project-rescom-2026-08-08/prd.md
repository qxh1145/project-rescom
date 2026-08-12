---
title: RESCOM — Academic Survey Exchange Platform
created: 2026-08-08
updated: 2026-08-08
status: final
---

# PRD: RESCOM — Nền Tảng Cộng Đồng Hỗ Trợ Trao Đổi Khảo Sát Học Thuật

## 0. Document Purpose

This PRD defines the product requirements for **RESCOM (Research + Community)** — a web-based two-sided marketplace that enables university students to exchange academic surveys fairly and transparently. It is intended for the development team, stakeholders, and downstream workflow owners (architecture, UX, epics/stories).

This document builds upon:
- **SRS RESCOM v1.0** (Draft, 07/08/2026) — functional and non-functional requirements
- **Architecture Document** (rescom.md) — production infrastructure design
- **Project Overview** (RESCOM_Tong_Quan_Du_An.docx) — non-technical stakeholder summary

> **Scope change vs SRS:** This PRD reflects the decision to include **Internal Form Builder + AI Form Generator** in the GO LIVE scope, which the SRS v1.0 deferred to Phase 2. The SRS should be updated to reflect this change before release.

Features are grouped with globally numbered Functional Requirements (FR-1 through FR-N). Glossary terms are used verbatim throughout. Inline `[ASSUMPTION]` tags mark inferences not yet confirmed.

---

## 1. Vision

Every year, over 2 million Vietnamese university students need to collect primary survey data for assignments, thesis projects, and academic research. The current method — posting survey links in social media groups and begging for responses — suffers from five fundamental problems: inability to reach the right respondents (60.6%), garbage-quality data (76.0%), deadline pressure with insufficient samples (68.3%), zero reciprocity, and no way to verify who actually completed the survey.

**RESCOM replaces social media survey posting** with a purpose-built marketplace where surveys reach the right audience and respondents are fairly rewarded. The platform operates on a **"give-to-get" token economy**: students complete surveys to earn Points, then spend those Points to publish their own surveys — creating a self-sustaining cycle of reciprocity.

Beyond linking external survey tools, RESCOM provides a **built-in drag-and-drop Form Builder** powered by an **AI question suggestion assistant**, so Publishers can create, manage, and version surveys entirely within the platform — cheaper and with richer analytics than external forms.

RESCOM launches as a pilot at **FPT University Da Nang**, with a vision to expand nationwide.

---

## 2. Target User

### 2.1 Jobs To Be Done

- **Publisher:** "I need to collect 100 quality survey responses from students aged 18-22 in Marketing before my thesis deadline in 3 weeks. I can't afford to get garbage data or miss my target audience."
- **Respondent:** "I want to help other students with their surveys and receive something tangible in return — not just empty promises of 'I'll do yours too.'"
- **Admin:** "I need to keep the platform fair, resolve disputes quickly, and ensure no one games the point system."

### 2.2 Non-Users (v1)

- Organizations, lecturers, departments, or research groups (deferred to Phase 3 — B2B expansion)
- Non-student users outside the academic community
- Users seeking to monetize survey responses — RESCOM is not a money-making app

### 2.3 Key User Journeys

**UJ-1. Linh publishes her first survey — from zero to tracking responses.**

- **Persona + context:** Linh, 3rd-year Marketing student at FPT Da Nang, needs 100 survey responses for her capstone project. She discovered RESCOM through a social media ad.
- **Entry state:** Unauthenticated, first visit.
- **Path:**
  1. Linh signs up with Google account.
  2. She is immediately taken to the mandatory onboarding survey — demographic info (age, gender, region, major, interests, income bracket).
  3. After completing onboarding, her 100 frozen Points are unlocked. She completes one more survey from the feed to fully activate her account.
  4. She taps "Create Survey" and chooses between **External Form** (Google Forms link) or **Internal Form Builder**. She picks Form Builder because it's cheaper.
  5. She uses the drag-and-drop editor to build her survey. She tries the AI assistant — types "Khảo sát hành vi tiêu dùng của sinh viên Marketing" and gets a suggested question structure that she reviews and edits.
  6. She sets targeting criteria: Marketing majors, age 18-25, Da Nang region.
  7. She sets sample size (100) and point reward per response. The system calculates total Escrow and checks her balance.
  8. She publishes. The survey enters the **Admin moderation queue** before appearing on the marketplace.
  9. Once approved, she monitors progress via her Dashboard: completion count, click-through tracking, individual response data, traffic analytics by hour/day/week/month.
  10. When she hits 100 responses, the system auto-hides the survey from the marketplace.
- **Climax:** Linh sees "100/100 responses collected" on her dashboard and can download/view all response data directly in RESCOM.
- **Resolution:** Survey auto-hidden. If Linh later needs more samples, she can reopen by paying additional tokens for a larger quota.
- **Edge case:** If Linh doesn't have enough Points, she must complete other students' surveys to earn Points first (no free publishes).

---

**UJ-2. Minh earns Points by completing surveys from the feed.**

- **Persona + context:** Minh, 2nd-year IT student, already onboarded and activated. Has 100 available Points. Wants to accumulate more before publishing his own survey next month.
- **Entry state:** Authenticated, lands on Marketplace.
- **Path:**
  1. Minh sees the Marketplace feed — surveys filtered by his demographic profile, showing reward points, estimated time, and remaining slots.
  2. He picks a short 5-minute survey offering 10 Points.
  3. **If Internal Form:** The survey opens within RESCOM. Minh answers questions. The system cross-references his answers against his onboarding demographic data for consistency and monitors completion time for bot detection. He submits. Points are credited **immediately** (within 1-2 minutes).
  4. **If External (Google Forms):** RESCOM opens Google Forms in a new tab. A countdown timer + code input modal stays on the RESCOM tab. The system has auto-generated a unique 6-digit completion code (server-side) that the Publisher was required to paste at the end of their Google Form. Minh completes the survey, copies the code from the thank-you page, enters it in the RESCOM modal. Points enter **Pending Balance (48h)** for Publisher review.
  5. If the Publisher forgot to place the code, Minh can **report the issue** to Admin.
- **Climax:** Minh sees his Points balance increase and his streak counter increment.
- **Resolution:** Minh checks the Leaderboard — he's ranked #12 for most surveys completed this week. He plans to come back tomorrow to maintain his streak.
- **Edge case:** If Minh's answers are flagged as inconsistent with his onboarding data (e.g., claimed to be female in survey but registered as male), the system rejects the submission and logs it to FraudLog.

---

**UJ-3. Hùng resolves a data quality dispute as Admin.**

- **Persona + context:** Hùng is the RESCOM system administrator. He checks the admin dashboard daily.
- **Entry state:** Authenticated as Admin.
- **Path:**
  1. Hùng logs into the Admin Dashboard. He sees: active user list, pending complaints, pending top-up transactions, transaction dashboard overview.
  2. A new complaint appears: Publisher Linh reports that Respondent X submitted garbage data on her external Google Forms survey.
  3. Hùng opens the complaint — sees Linh's evidence (screenshots of the problematic response), the Respondent's completion timestamp, and FraudLog entries.
  4. Hùng decides the complaint is valid. He triggers a point reversal: Points are returned from Respondent X's Pending Balance to Linh's Escrow.
  5. The system sends email notifications to both Linh (complaint upheld) and Respondent X (points reversed, reason given).
  6. Hùng also notices Respondent X has 5 prior FraudLog entries. He **bans the account**.
- **Climax:** Dispute resolved, both parties notified, bad actor removed.
- **Resolution:** Hùng moves on to approve 3 new surveys waiting in the moderation queue before they go live on the marketplace.

---

## 3. Glossary

- **Publisher** — A user who creates and publishes a survey on RESCOM to collect responses. Any verified user can be a Publisher.
- **Respondent** — A user who completes surveys to earn Points. Any verified user can be a Respondent. The same user can act as both Publisher and Respondent.
- **Point (Điểm)** — The internal token unit of exchange on RESCOM. 1 Point = 200 VNĐ when topping up. Points are not currency — they cannot be traded, transferred between accounts, or cashed out as money.
- **Survey** — A questionnaire published on RESCOM, either as an External Form (Google Forms link) or an Internal Form (built with Form Builder). Has a form type: `EXTERNAL` or `INTERNAL`.
- **Survey Feed / Marketplace** — The personalized list of active surveys displayed to Respondents, filtered by Targeted Matching against the Respondent's demographic profile.
- **Form Builder** — RESCOM's built-in drag-and-drop survey creation tool. Produces a Form Definition JSON. Costs fewer Points than External Forms.
- **AI Form Generator** — An optional AI assistant that suggests survey question structures based on natural-language descriptions. Outputs a draft Form Definition for the Publisher to review and edit. Powered by Ollama/Qwen on a private GPU server.
- **Form Definition** — The canonical JSON representation of a survey's structure (sections, questions, options, settings). Shared between Form Builder, AI Generator, Form Renderer, and backend validation.
- **Form Version** — An immutable snapshot of a Form Definition at the time of publishing. Once a version has received responses, it cannot be edited — a new version must be created. Ensures response data always matches the questions asked.
- **Targeted Matching** — The mechanism that distributes surveys to Respondents whose demographic profile matches the Publisher's targeting criteria (major, age, gender, region, etc.).
- **Completion Code** — A unique 6-digit code auto-generated by the server for each survey attempt on External Forms. The Publisher must paste this code at the end of their Google Form. The Respondent enters it back into RESCOM to confirm completion.
- **Time Barrier** — Anti-fraud mechanism that measures actual completion time server-side. Rejects submissions completed too fast (indicating the Respondent didn't actually complete the survey).
- **Onboarding Survey** — A mandatory system survey collecting demographic and interest data from new users. Required before account activation.
- **Frozen Points** — The 100 starter Points given at registration, locked until the user completes 2 onboarding surveys (demographic survey + 1 marketplace survey).
- **Point Escrow** — Points locked by the system when a Publisher publishes a survey, guaranteeing Respondents will be paid. Released per completion or refunded for unfilled slots.
- **Pending Balance** — Points earned from External Form completions, held for 48 hours for Publisher review before becoming available. Internal Forms pay instantly.
- **Available Balance** — Points that can be spent immediately (to publish surveys or for other platform transactions).
- **Point Ledger** — The immutable, append-only double-entry transaction log recording every Point movement. Cannot be edited or deleted.
- **FraudLog** — An immutable, append-only log of all rejected attempts, suspicious behavior, and anti-fraud events. Cannot be edited or deleted.
- **Streak** — A consecutive-day count of survey completions. Resets if the Respondent misses a day.
- **Leaderboard** — Public rankings of Respondents by (1) most surveys completed and (2) longest active streak.
- **Moderation Queue** — The Admin review step that surveys must pass before appearing on the Marketplace.

---

## 4. Features

### 4.1 Authentication & Account Management

**Description:** Users register and authenticate via email/password or Google OAuth. Each account supports a single active session. Upon registration, the system grants 100 Frozen Points. Accounts inactive for 30 days from registration lose their starter Points. Realizes UJ-1.

**Functional Requirements:**

#### FR-1: Email/Password Registration
Users can register with email and password. System validates email uniqueness and password strength.

**Consequences (testable):**
- Duplicate email returns error with clear message
- Password must meet minimum complexity requirements

#### FR-2: Google OAuth Login
Users can sign up and log in via Google Account (OAuth 2.0).

**Consequences (testable):**
- First-time Google login creates a new account
- Subsequent Google logins authenticate to the existing account

#### FR-3: Single-Session Enforcement
Each account can only be logged in on one device at a time. New login invalidates the previous session.

**Consequences (testable):**
- Logging in on Device B immediately invalidates Device A's session
- Device A receives a "session expired" notification on next request

#### FR-4: Frozen Starter Points
System automatically grants 100 Frozen Points upon registration.

**Consequences (testable):**
- New user's wallet shows 100 Frozen Points, 0 Available
- Points cannot be spent while frozen

#### FR-5: Starter Points Expiry
If the account does not complete onboarding within 30 days of registration, the 100 Frozen Points are forfeited.

**Consequences (testable):**
- After 30 days, Frozen Balance becomes 0
- User is notified of expiry

---

### 4.2 Onboarding & Point Activation

**Description:** New users must complete a mandatory onboarding flow before they can fully participate. This consists of: (1) a system demographic survey collecting personal profile data, and (2) completing one additional survey from the Marketplace. Upon completing both, Frozen Points are unlocked to Available Balance. Realizes UJ-1.

**Functional Requirements:**

#### FR-6: Mandatory Demographic Survey
New users must complete the system onboarding survey as their first action. Collects: age range, gender, region/province, occupation, academic major, income bracket, and interests (multi-select from 17+ categories).

**Consequences (testable):**
- User cannot access Marketplace until demographic survey is completed
- All demographic fields are required
- Data is stored in the user's profile for Targeted Matching

#### FR-7: Second Onboarding Survey
After completing the demographic survey, user must complete 1 additional survey from the Marketplace to fully activate.

**Consequences (testable):**
- Marketplace is visible but a prompt directs user to complete 1 survey
- After completion, activation status changes to "Verified Member"

#### FR-8: Point Unlock on Activation
After completing both onboarding surveys, 100 Frozen Points transfer to Available Balance.

**Consequences (testable):**
- Frozen Balance becomes 0
- Available Balance becomes 100
- Ledger records the transfer as an immutable transaction

---

### 4.3 User Profile & Targeted Matching

**Description:** Each user maintains a demographic profile used for survey targeting. Publishers set audience criteria when creating surveys; the system matches surveys to Respondents whose profiles fit. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-9: Demographic Profile
Each user has a profile containing: major, academic year, age, gender, region, occupation, income bracket, and interests.

**Consequences (testable):**
- Profile is populated from onboarding survey
- User can update profile at any time
- Profile changes take effect for future survey matching immediately

#### FR-10: Publisher Targeting Criteria
When creating a survey, Publisher sets targeting criteria: gender, age range, major, university, region. `[ASSUMPTION: Publisher can also target by interests/income]`

**Consequences (testable):**
- At least one targeting criterion must be set
- Publisher can view estimated audience size before publishing

#### FR-11: Automated Matching
System matches survey targeting criteria against Respondent profiles and only shows matching surveys in their feed.

**Consequences (testable):**
- Respondent never sees a survey they don't qualify for
- Publisher can relax criteria if audience is too small (FR-10 allows broadening)

---

### 4.4 Survey Publishing — External Forms

**Description:** Publishers can post surveys hosted on external platforms (e.g., Google Forms) by providing a link. The system auto-generates a unique 6-digit Completion Code that the Publisher must embed at the end of their external form. Respondents enter this code back into RESCOM to claim their reward. Costs more Points than Internal Forms. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-12: External Survey Creation (3-Step Stepper)
Publisher provides: (Step 1) Google Forms link + estimated completion time, (Step 2) targeting criteria, (Step 3) sample size + point reward per completion.

**Consequences (testable):**
- All three steps must be completed before submission
- System validates URL format
- Estimated time determines the minimum reward per the pricing table

#### FR-13: Server-Generated Completion Code
System auto-generates a unique 6-digit code for each survey. Publisher is instructed to paste this code at the end of their Google Form.

**Consequences (testable):**
- Code is generated server-side, not by Publisher
- Code is unique per survey
- Publisher sees the code with clear instructions to embed it

#### FR-14: Point Reward Pricing Table
System enforces minimum/maximum point rewards based on estimated completion time:
- < 5 min: 5–10 Points
- 5–10 min: 10–20 Points
- 10–15 min: 15–25 Points
- > 15 min: 20–40 Points

Publisher cannot set rewards below the minimum.

**Consequences (testable):**
- Setting reward below minimum displays an error
- System auto-suggests a reward within the valid range

#### FR-15: Escrow Lock on Publish
System calculates total Escrow (sample size × points per response) and locks it from Publisher's Available Balance.

**Consequences (testable):**
- If Available Balance < total Escrow, publishing is blocked with a message suggesting to earn more Points
- Locked Points appear in Escrow, removed from Available Balance
- Ledger records the escrow transaction

---

### 4.5 Survey Publishing — Internal Form Builder

**Description:** Publishers can create surveys directly in RESCOM using a drag-and-drop Form Builder. An optional AI assistant suggests question structures from natural-language descriptions. Internal forms cost fewer Points than external forms, incentivizing platform-native survey creation. Produces a versioned Form Definition JSON. Realizes UJ-1.

**Functional Requirements:**

#### FR-16: Drag-and-Drop Form Builder
Publisher can create surveys using a visual editor with a component palette (text, textarea, number, single choice, multiple choice, rating, linear scale, date, file upload), a canvas, and a properties panel.

**Consequences (testable):**
- All question types from the Component Registry can be added via drag-and-drop
- Questions can be reordered, edited, and deleted
- Form can be organized into sections
- Required/optional can be toggled per question
- Live preview is available before publishing

#### FR-17: AI Form Generator (Optional)
Publisher can describe their survey intent in natural language. The AI assistant generates a draft Form Definition with suggested sections and questions. Publisher reviews, edits, and publishes.

**Consequences (testable):**
- AI generates valid Form Definition JSON (validated by Zod)
- Generated form opens directly in the Form Builder for editing
- If AI is unavailable (server down), the Form Builder still works normally — AI is never a blocking dependency
- `[ASSUMPTION: AI generation has a separate, longer timeout than regular API calls]`

#### FR-18: Form Versioning
Each survey maintains an ordered list of Form Versions. Once a version has received responses, it becomes immutable — Publisher must create a new version to make changes.

**Consequences (testable):**
- Editing a published form creates a new version draft
- Responses always reference the specific form_version_id they were submitted against
- Previous versions are archived and viewable

#### FR-19: Internal Form Pricing Discount
Internal Forms cost 20% fewer Points per response than External Forms for the same estimated duration.

**Consequences (testable):**
- Price calculation clearly shows the 20% discount vs external form pricing

---

### 4.6 Survey Moderation

**Description:** All surveys must pass Admin review before appearing on the Marketplace. This prevents spam, inappropriate content, and surveys that violate platform guidelines. Realizes UJ-3.

**Functional Requirements:**

#### FR-20: Moderation Queue
When a Publisher publishes a survey (external or internal), it enters a moderation queue visible to Admin. Survey does not appear on the Marketplace until approved.

**Consequences (testable):**
- New surveys have status "Pending Moderation"
- Admin can approve or reject with a reason
- Rejected surveys return Escrow Points to Publisher
- Publisher is notified of approval/rejection

---

### 4.7 Survey Completion — External Forms

**Description:** Respondents complete external surveys and submit the system-generated Completion Code to claim rewards. A Time Barrier prevents premature submissions. Points enter Pending Balance for 48-hour Publisher review. Realizes UJ-2.

**Functional Requirements:**

#### FR-21: Survey Attempt Start
When Respondent clicks "Start Survey", system records `startTime` server-side and opens the Google Form in a new tab. The RESCOM tab shows a countdown timer and code input modal.

**Consequences (testable):**
- `startTime` is server-side, never from client
- Submit button is disabled until countdown completes

#### FR-22: Completion Code Verification
Respondent enters the 6-digit code. Backend validates: code matches AND actual elapsed time ≥ estimated duration.

**Consequences (testable):**
- Correct code + sufficient time = success
- Wrong code = rejection, logged to FraudLog
- Maximum failed code attempts before session lock (3 attempts) `[ASSUMPTION: 3 attempts]`

#### FR-23: Missing Code Report
If the Publisher failed to embed the Completion Code in their Google Form, Respondent can report the issue to Admin.

**Consequences (testable):**
- Report button is visible on the code input modal
- Admin receives the report and can resolve (refund Respondent or instruct Publisher)

#### FR-24: 48-Hour Pending Period (External Only)
Points from external form completions enter Pending Balance. After 48 hours without complaint, they auto-transfer to Available Balance.

**Consequences (testable):**
- Pending Balance shows the amount and countdown
- Publisher can file a complaint during the 48h window
- Auto-transfer is handled by a background job

#### FR-25: One Completion Per Account
Each account can complete each survey exactly once.

**Consequences (testable):**
- Second attempt on the same survey is blocked
- Survey card shows "Completed" status for that user

---

### 4.8 Survey Completion — Internal Forms

**Description:** Respondents complete internal surveys directly within RESCOM. The system fully controls the experience — no Completion Code needed. Points are awarded immediately after automated validation (demographic consistency + time-based bot detection). Realizes UJ-2.

**Functional Requirements:**

#### FR-26: In-Platform Survey Experience
Internal form surveys render within RESCOM using the Form Renderer (driven by the published Form Version's Form Definition JSON). Respondent never leaves the platform.

**Consequences (testable):**
- Form renders all question types from Component Registry
- Progress bar shows completion status
- Respondent can navigate between sections

#### FR-27: Automated Validation — Demographic Cross-Check
System cross-references Respondent's survey answers against their onboarding profile data for consistency.

**Consequences (testable):**
- Inconsistent demographic answers (e.g., gender mismatch) trigger rejection
- Rejected submissions are logged to FraudLog
- `[ASSUMPTION: System checks only demographic fields, not opinion-based answers]`

#### FR-28: Automated Validation — Bot Detection
System validates that actual completion time meets a minimum threshold based on question count and type.

**Consequences (testable):**
- Submissions completed impossibly fast are rejected
- FraudLog records the attempt with timing data

#### FR-29: Instant Point Credit (Internal Only)
Valid internal form submissions credit Points to Available Balance immediately (within 1-2 minutes).

**Consequences (testable):**
- No Pending period for internal forms
- Ledger records the credit transaction
- Respondent sees updated balance and notification

---

### 4.9 Point System & Wallet

**Description:** All platform activity revolves around Points — the internal token economy. The Point Ledger is an immutable double-entry system ensuring no Points are created, duplicated, or lost. Wallet displays all balance states. Realizes UJ-1, UJ-2, UJ-3.

**Functional Requirements:**

#### FR-30: Immutable Double-Entry Ledger
Every Point movement is recorded as an append-only ledger entry with debit and credit sides. Entries cannot be edited or deleted.

**Consequences (testable):**
- Current balance can be derived by summing all ledger entries
- No UPDATE or DELETE operations exist on ledger tables
- ACID transactions with row-level locking prevent race conditions

#### FR-31: Wallet Dashboard
User wallet displays: Available Balance, Pending Balance, Frozen Balance, and full transaction history.

**Consequences (testable):**
- All balance types are visible on one screen
- Transaction history shows: timestamp, type (earned/spent/frozen/escrow/refund), amount, related survey
- History cannot be modified

#### FR-32: Escrow Refund on Survey Close
When a survey reaches its deadline or is closed with unfilled slots, remaining Escrow Points are automatically refunded to the Publisher's Available Balance.

**Consequences (testable):**
- Refund happens via background job
- Ledger records the refund transaction
- Publisher is notified of the refund amount

#### FR-33: Survey Reopen with Additional Tokens
Publisher can reopen a completed/closed survey by paying additional tokens for a larger sample quota.

**Consequences (testable):**
- New Escrow is calculated for the additional slots only
- Survey reappears on Marketplace after payment
- Previous responses are preserved

---

### 4.10 Top-Up (Point Purchase)

**Description:** Users can purchase Points with real money when they need Points urgently. Manual process via Admin in GO LIVE phase. Realizes UJ-3.

**Functional Requirements:**

#### FR-34: Manual Top-Up Request
User selects amount (minimum 100 Points = 20,000 VNĐ), transfers money to the platform's bank account, and submits a top-up request.

**Consequences (testable):**
- Minimum 100 Points enforced
- Request is queued for Admin approval
- Top-up is one-way: no refunds, no inter-account transfers

#### FR-35: Admin Top-Up Approval
Admin verifies the bank transfer and approves the top-up, crediting Points to the user's Available Balance.

**Consequences (testable):**
- Admin sees pending top-up requests with user info and amount
- Approval triggers ledger entry and user notification
- Rejection notifies user with reason

---

### 4.11 Survey Feed & Marketplace

**Description:** The Marketplace is the primary landing page for authenticated users. It displays a personalized feed of active surveys matching the Respondent's demographic profile. Surveys can be sorted and filtered. Realizes UJ-2.

**Functional Requirements:**

#### FR-36: Personalized Feed
Marketplace shows only surveys that are ACTIVE, match the user's profile, and have been approved by Admin.

**Consequences (testable):**
- Completed or in-progress surveys are hidden/dimmed
- Each survey card shows: point reward, estimated time, remaining slots
- Feed updates when new surveys are approved

#### FR-37: Sort & Filter Options
Feed supports sorting by: best match, shortest duration, highest reward, nearest deadline, same university/major, newest. Advanced filters available.

**Consequences (testable):**
- Default sort is "best match"
- Filters can be combined
- Results update in real-time

#### FR-38: Auto-Hide on Quota Completion
When a survey reaches its sample quota, it is automatically hidden from the Marketplace.

**Consequences (testable):**
- Survey status changes to "Completed"
- No new Respondents can start the survey
- Publisher is notified

---

### 4.12 Publisher Dashboard

**Description:** Each survey has a dedicated dashboard for the Publisher to track progress, view responses (internal forms), and monitor analytics. Realizes UJ-1.

**Functional Requirements:**

#### FR-39: Progress Tracking
Dashboard displays: completion count vs target, Points spent, Escrow remaining, deadline countdown, survey status (Pending Moderation / Active / Paused / Completed / Expired).

**Consequences (testable):**
- All metrics update in real-time
- Progress bar shows visual completion percentage

#### FR-40: Response Data (Internal Forms Only)
For internal forms, Publisher can view individual response data directly in the dashboard.

**Consequences (testable):**
- Responses are displayed in a table/list format
- Each response is linked to its Form Version
- `[ASSUMPTION: Publisher can export response data as CSV]`

#### FR-41: Traffic Analytics
Dashboard shows survey access analytics: views/clicks by hour of day, by day of week, by month. Shows drop-off rate (started but not completed).

**Consequences (testable):**
- Charts display temporal traffic patterns
- Average completion time is calculated and shown
- Drop-off rate is calculated as (started - completed) / started

#### FR-42: Feedback Summary
Dashboard aggregates Respondent feedback: question clarity, survey length, technical issues, overall experience.

**Consequences (testable):**
- Average ratings displayed per feedback dimension
- Free-text comments are listed

---

### 4.13 Feedback System

**Description:** After completing a survey, Respondents can leave ratings and comments for the Publisher. Surveys with consistently negative feedback may be deprioritized. Realizes UJ-2.

**Functional Requirements:**

#### FR-43: Post-Completion Feedback
Respondent can rate: question clarity, survey length accuracy, description accuracy, technical issues, overall experience. Optional free-text comment.

**Consequences (testable):**
- Feedback prompt appears after successful submission
- Feedback is optional but encouraged
- Feedback is visible to Publisher in dashboard

#### FR-44: Negative Feedback Deprioritization
If a survey receives consistently negative feedback, the system reduces its visibility in the Marketplace feed. `[ASSUMPTION: Threshold is ≥5 negative reviews OR average rating < 2.0/5.0]`

**Consequences (testable):**
- Deprioritized surveys appear lower in feed rankings
- Publisher is notified and advised to improve their survey

---

### 4.14 Anti-Fraud System

**Description:** Multi-layered fraud prevention protects data quality and point integrity. All suspicious events are logged immutably. Realizes UJ-2, UJ-3.

**Functional Requirements:**

#### FR-45: Time Barrier
Server measures actual elapsed time from startTime to submission. Rejects if time < minimum threshold.

**Consequences (testable):**
- startTime is recorded server-side only
- Rejection triggers FraudLog entry

#### FR-46: Rate Limiting
System limits how many surveys a user can complete in a given time window to prevent bot behavior.

**Consequences (testable):**
- Exceeding the rate limit blocks further attempts temporarily
- `[ASSUMPTION: Limit is configurable by Admin]`

#### FR-47: Immutable FraudLog
All rejected attempts, suspicious behavior, and fraud events are logged in an append-only FraudLog.

**Consequences (testable):**
- No UPDATE or DELETE operations exist on FraudLog
- Each entry records: user, timestamp, survey, type of violation, details

#### FR-48: Frozen Points Anti-Bot
100 Frozen starter Points cannot be used until 2 onboarding surveys are completed, preventing fake account point farming.

**Consequences (testable):**
- Creating accounts en masse yields no usable Points

---

### 4.15 Gamification

**Description:** Streak tracking and leaderboards drive Respondent engagement and retention. Realizes UJ-2.

**Functional Requirements:**

#### FR-49: Streak Counter
System tracks consecutive days on which the Respondent completed at least one survey. Streak resets if a day is missed.

**Consequences (testable):**
- Streak count is visible on user profile and Marketplace
- Streak increments once per calendar day, regardless of how many surveys completed

#### FR-50: Leaderboard
Public leaderboard displays two rankings: (1) most surveys completed (all-time and weekly), (2) longest active streak.

**Consequences (testable):**
- Leaderboard is visible to all authenticated users
- Rankings update in real-time or near-real-time
- `[ASSUMPTION: Leaderboard shows top 50 users per category]`

---

### 4.16 Membership Tiers

**Description:** Users progress through 5 tiers based on survey completion count, unlocking increasing benefits. Realizes UJ-2.

**Functional Requirements:**

#### FR-51: Tier Progression
| Tier | Requirement | Benefits |
|------|------------|----------|
| New User | Just registered | 100 Frozen Points |
| Verified Member | 2 onboarding surveys | Points unlocked, full access |
| Active Contributor | ≥ 20 surveys | Priority in feed display |
| Trusted Researcher | ≥ 100 surveys | Higher trust score, shorter pending time `[ASSUMPTION: reduced from 48h to 24h for external forms]` |
| Community Ambassador | ≥ 300 surveys | Community privileges `[ASSUMPTION: specific privileges TBD]` |

**Consequences (testable):**
- Tier is calculated automatically from completion count
- Tier badge is displayed on user profile
- Benefits are applied automatically

---

### 4.17 Admin Panel

**Description:** Admin manages users, moderates surveys, resolves disputes, processes top-ups, and monitors system integrity. Realizes UJ-3.

**Functional Requirements:**

#### FR-52: User Management
Admin can view active user list, search/filter users, ban/unban accounts, and edit user information.

**Consequences (testable):**
- Banned users cannot log in
- Unban restores full access
- User info edits are logged

#### FR-53: Survey Moderation
Admin reviews surveys in the moderation queue before they appear on the Marketplace.

**Consequences (testable):**
- Admin can approve or reject with reason
- Rejection returns Escrow to Publisher
- Moderation must happen whenever Admin is available (there is no strict SLA).

#### FR-54: Complaint Resolution
Admin reviews complaints with uploaded evidence (screenshots). Decides to uphold or dismiss. System sends email to both parties.

**Consequences (testable):**
- Complaint includes: reporter info, reported user, evidence attachments, description
- Upholding reverses Points (Pending → Escrow or Available → Escrow)
- Both parties receive email notification with decision and reason

#### FR-55: FraudLog Monitoring
Admin can view, search, and filter FraudLog. Can identify repeat offenders and take action (ban).

**Consequences (testable):**
- FraudLog is read-only for Admin (no edit/delete)
- Filter by: user, time range, violation type
- System flags repeat offenders, but banning is strictly a manual decision by Admin (no auto-ban).

#### FR-56: Transaction Dashboard
Admin sees overview of all Point transactions across the system: top-ups pending, escrows active, refunds processed.

**Consequences (testable):**
- Dashboard shows aggregate metrics and individual transaction drill-down

---

### 4.18 Notification System

**Description:** Users receive notifications for key events via in-app and email channels.

**Functional Requirements:**

#### FR-57: Event Notifications
System sends notifications for: account activation, survey approved/rejected, Points earned, Points pending, complaint filed/resolved, survey quota reached, ban/unban, top-up approved.

**Consequences (testable):**
- In-app notifications appear in a notification center
- Email notifications sent for critical events (complaint resolution, ban, top-up)
- `[ASSUMPTION: Push notifications are deferred to Phase 2]`

---

## 5. Non-Goals (Explicit)

- **RESCOM is NOT a money-making app.** Points are internal tokens for platform exchange only — not currency, not cashable, not transferable between accounts.
- **RESCOM does NOT sell survey responses.** It is a distribution service connecting surveys to the right audience.
- **RESCOM does NOT replace SurveyMonkey or Typeform.** The Form Builder serves academic survey needs, not enterprise research.
- **RESCOM does NOT support organizational accounts (v1).** B2B features for lecturers, departments, and research groups are deferred to Phase 3.
- **RESCOM does NOT provide automated payment processing (v1).** Top-ups and withdrawals are manual via Admin.
- **RESCOM does NOT guarantee AI availability.** The AI Form Generator is an optional enhancement — all core features work without it.
- `[NON-GOAL for MVP]` Survey boost/promotion features (paying extra for visibility)
- `[NON-GOAL for MVP]` Data analytics export (Excel/SPSS)
- `[NON-GOAL for MVP]` Mobile native app

---

## 6. MVP Scope

### 6.1 In Scope (GO LIVE)

- Email + Google OAuth registration and authentication
- Mandatory onboarding survey (demographics + interests)
- Frozen Points → activation → Available Balance flow
- User profile with demographic data for Targeted Matching
- External survey publishing (Google Forms + auto-generated Completion Code)
- **Internal Form Builder** (drag-and-drop, all question types)
- **AI Form Generator** (optional, Ollama/Qwen on private GPU)
- **Form Versioning** (immutable published versions)
- Survey Marketplace with personalized feed, sort, and filter
- **Admin survey moderation** before marketplace listing
- Point System: Escrow, Pending (48h external), Instant (internal), Available, Frozen
- Immutable Double-Entry Point Ledger
- Anti-Fraud: Time Barrier, Completion Code, demographic cross-check, bot detection, FraudLog
- Publisher Dashboard with progress, response data (internal), traffic analytics
- Feedback system (post-completion ratings + comments)
- **Gamification: Streak + Leaderboard**
- Membership tiers (5 levels)
- Admin panel: user management, moderation, complaints, top-ups, FraudLog
- Manual top-up via Admin
- Notification system (in-app + email)
- **Survey reopen** with additional token payment

### 6.2 Out of Scope for MVP

- **Automated payment processing** — deferred to Phase 2. `[NOTE FOR PM]` This is the #1 user friction point for top-ups.
- **Survey boost/promotion** — deferred to Phase 2.
- **Advanced dashboard analytics** (comparative reports, export to Excel/SPSS) — deferred to Phase 2/3.
- **Forced-attention mechanics** — deferred to Phase 2.
- **B2B organizational accounts** — deferred to Phase 3.
- **Nationwide expansion** beyond FPT Da Nang — deferred to Phase 3.
- **Mobile native app** — web-first; responsive web serves mobile users.
- **Push notifications** — in-app + email only for v1.
- **Redis/distributed caching** — single backend instance uses in-memory cache; Redis added when scaling.
- **Horizontal backend scaling** — single VPS sufficient for pilot.

---

## 7. Success Metrics

**Primary**

- **SM-1**: **Activation Rate** — % of registered users who complete both onboarding surveys. Target: > 80%. Validates FR-6, FR-7, FR-8.
- **SM-2**: **Completion Rate** — % of survey attempts that result in successful submission (code verified or internal form submitted). Target: > 75%. Validates FR-22, FR-26.
- **SM-3**: **Publisher Fulfillment Rate** — % of published surveys that reach their target sample size before deadline. Target: > 60%. Validates FR-11, FR-36.

**Secondary**

- **SM-4**: **Internal Form Adoption** — % of new surveys using Form Builder vs External Forms. Target: > 40% within 3 months. Validates FR-16, FR-19.
- **SM-5**: **CSAT** — Customer Satisfaction Score from in-app survey. Target: > 4.0/5.0. Validates FR-43.
- **SM-6**: **Daily Active Respondents** — Respondents completing ≥1 survey per day. Target: > 30% of verified users. Validates FR-49.
- **SM-7**: **Fraud Rejection Rate** — % of submissions rejected by anti-fraud. Target: < 5% (indicates healthy ecosystem, not over-blocking). Validates FR-45, FR-46, FR-47.

**Counter-metrics (do not optimize)**

- **SM-C1**: **Moderation Queue Time** — Average time from publish to Admin approval. Should NOT be minimized at the expense of review quality. Counterbalances SM-3.
- **SM-C2**: **Points Inflation** — Total Points in circulation vs total active users. Rapid growth may indicate point farming. Counterbalances SM-6.

---

## 8. Open Questions

1. `[NOTE FOR PM]` **Leaderboard scope:** Is the leaderboard university-wide (FPT Da Nang only) or platform-wide? Weekly vs all-time vs both?
2. `[NOTE FOR PM]` **Survey reopen pricing:** When reopening a closed survey, is the per-response price the same or recalculated?
3. `[NOTE FOR PM]` **Trusted Researcher pending time:** Does the Trusted Researcher tier (≥100 surveys) reduce the 48h pending period for external forms? To what duration?
4. `[NOTE FOR PM]` **Community Ambassador privileges:** What specific privileges does the highest tier unlock?
5. `[NOTE FOR PM]` **AI generation timeout:** What is the acceptable wait time for AI form generation? This is a separate SLA from the <500ms API target.
6. `[NOTE FOR PM]` **Response data export:** Can Publishers export internal form response data as CSV/Excel in v1, or is this deferred?

---

## 9. Assumptions Index

- **§4.3 FR-10** — Publisher can target by interests and income bracket in addition to major/age/gender/region.
- **§4.5 FR-17** — AI generation has a separate, longer timeout than regular API calls (e.g., 30-60 seconds vs 500ms).
- **§4.7 FR-22** — Maximum 3 failed Completion Code attempts before session lock.
- **§4.8 FR-27** — Demographic cross-check validates demographic fields only, not opinion-based answers.
- **§4.12 FR-40** — Publisher can export response data as CSV.
- **§4.13 FR-44** — Negative feedback threshold for deprioritization: ≥5 negative reviews OR average < 2.0/5.0.
- **§4.14 FR-46** — Rate limiting is configurable by Admin.
- **§4.15 FR-50** — Leaderboard shows top 50 users per category.
- **§4.16 FR-51** — Trusted Researcher tier reduces pending time from 48h to 24h for external forms.
- **§4.16 FR-51** — Community Ambassador specific privileges are TBD.
- **§4.18 FR-57** — Push notifications deferred to Phase 2.

---

## Cross-Cutting NFRs

### Performance
| ID | Requirement |
|----|------------|
| NFR-1 | API average response time < 500ms under normal load |
| NFR-2 | Survey Feed loads in < 2 seconds with ≤ 50 surveys |
| NFR-3 | Point transactions use ACID + row-level locking to prevent race conditions |
| NFR-4 | In-memory cache for Time Barrier data to reduce database hits |
| NFR-5 | AI Form Generation has a separate timeout (not subject to 500ms SLA) |

### Security
| ID | Requirement |
|----|------------|
| NFR-6 | Stateless JWT stored in HTTP-Only Cookies |
| NFR-7 | CORS, Helmet, express-rate-limit on all API endpoints |
| NFR-8 | Server-side authority: startTime, Completion Code generation, point calculations — never trust client |
| NFR-9 | All point transactions use ACID to ensure data consistency |
| NFR-10 | FraudLog is append-only — no delete, no update |

### Reliability
| ID | Requirement |
|----|------------|
| NFR-11 | Point Ledger integrity: balance can never be duplicated or lost |
| NFR-12 | Auto-Refund background job runs on schedule for expired surveys |
| NFR-13 | Pending → Available auto-transfer runs on schedule (48h expiry) |
| NFR-14 | System uptime ≥ 99% during peak academic periods |
| NFR-15 | AI failure must not impact core system (login, surveys, points, marketplace) |

### Maintainability
| ID | Requirement |
|----|------------|
| NFR-16 | Monorepo with Frontend and Backend fully separated |
| NFR-17 | Prisma ORM for database schema management |
| NFR-18 | Zod validation shared between Frontend and Backend |
| NFR-19 | Form Definition JSON schema as a shared package |

### Usability
| ID | Requirement |
|----|------------|
| NFR-20 | Modern, minimal UI targeting Gen Z students |
| NFR-21 | Survey creation follows a clear 3-step stepper flow |
| NFR-22 | CSAT target > 4.0/5.0 |

---

## Constraints and Guardrails

### Privacy & Data
- Demographic data is collected solely for Targeted Matching — never sold or shared externally
- Survey response data is used only for academic purposes with clear confidentiality commitments
- RESCOM is a survey distribution service, not a response seller

### Compliance
- Points are NOT positioned as currency — cannot be bought, sold, or transferred between accounts
- Points cannot be cashed out as money (one-way conversion only: VNĐ → Points)
- Platform complies with Vietnamese data protection regulations

### Cost
- AI runs on a private GPU server (gaming laptop via Tailscale VPN) — no cloud AI costs
- AI must remain an optional dependency with zero impact on core operations if unavailable

---

## Platform

- **Web application** — responsive design, no native mobile app for v1
- **Domain:** rescom.com.vn (main), api.rescom.com.vn (backend), survey.rescom.com.vn (public surveys)
- **Frontend:** Next.js + TypeScript → Vercel
- **Backend:** Node.js + Express → Docker → VPS (4 vCPU / 16 GB RAM)
- **Database:** Managed PostgreSQL (Neon/Supabase) with Connection Pooling
- **File Storage:** S3-compatible Object Storage
- **AI:** Ollama + Qwen on private GPU, accessed via Tailscale VPN
- **CDN/Security:** Cloudflare (DNS, SSL, CDN, basic DDoS protection)
