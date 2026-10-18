---
title: RESCOM — Academic Survey Exchange Platform
created: 2026-08-08
updated: 2026-10-18
status: final
---

# PRD: RESCOM — Nền Tảng Cộng Đồng Hỗ Trợ Trao Đổi Khảo Sát Học Thuật

## 0. Document Purpose

This PRD defines the product requirements for **RESCOM (Research + Community)** — a web-based two-sided marketplace that enables university students to exchange academic surveys fairly and transparently. It is intended for the development team, stakeholders, and downstream workflow owners (architecture, UX, epics/stories).

The canonical authority chain is:
1. `_bmad-output/specs/spec-rescom/SPEC.md`
2. This final PRD plus `_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/addendum.md`
3. `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md`
4. `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md`
5. `_bmad-output/planning-artifacts/epics.md`
6. Repository reality as brownfield evidence and structural seed

The SRS v1.0 draft, `rescom.md`, the project-overview DOCX, the Sprint Change Proposal, and both “RESCOM Architecture V2 — Research Integrity Engine” documents are historical inputs only. They cannot override the canonical chain. This PRD includes **Internal Form Builder + AI Form Generator** in GO LIVE and supersedes the SRS deferral of those capabilities.

Features are grouped with globally numbered Functional Requirements (FR-1 through FR-75). Glossary terms are used verbatim throughout. Unresolved product choices remain explicit owner-bound gates in §8; they are not implementation defaults.

---

## 1. Vision

Historical discovery inputs estimate that over 2 million Vietnamese university students need primary survey data and report three leading problems with social-media recruitment: inability to reach the right respondents (60.6%), garbage-quality data (76.0%), and deadline pressure with insufficient samples (68.3%), alongside zero reciprocity and no completion verification. The source method, sample, date, and population remain unverified for external publication and are gated by Open Question 21.

**RESCOM replaces social media survey posting** with a purpose-built marketplace where surveys reach the right audience and respondents are fairly rewarded. The platform operates on a **"give-to-get" token economy**: students complete surveys to earn Points, then spend those Points to publish their own surveys — creating a self-sustaining cycle of reciprocity.

Beyond linking external survey tools, RESCOM provides a **built-in drag-and-drop Form Builder** powered by an **AI question suggestion assistant**, so Publishers can create, manage, and version surveys entirely within the platform — cheaper and with richer analytics than external forms.

RESCOM launches as a pilot at **FPT University Da Nang**, with a vision to expand nationwide.

For surveys created and completed inside RESCOM, the platform additionally provides a **Research Integrity Engine**. It assesses research-data quality across three independent dimensions: **Response Integrity**, **Respondent Reliability**, and **Survey Quality**. Each assessment communicates confidence, evidence coverage, safe reason codes, and the policy version used.

The full engine applies only to **Internal Forms**, where RESCOM can collect disclosed question-level interaction evidence. External Forms retain Completion Code, Time Barrier, Pending Balance, Publisher dispute, and FraudLog controls, but their responses are marked `NOT_ASSESSED` by the full Integrity Engine. Missing evidence is never represented as poor quality.

New respondents begin as `UNESTABLISHED`, not untrustworthy. Until sufficient eligible history exists, the engine evaluates their current Internal Form response using available response evidence and applicable baselines while reporting lower assessment confidence.

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
  2. She is immediately taken to the mandatory demographic survey—age, gender, region, major, interests, and income bracket. Her 100 starter Points remain Frozen after she submits it.
  3. She enters the Marketplace in onboarding mode and completes one eligible Marketplace survey. Only then does her account become fully active and the 100 Frozen Points transfer to Available.
  4. She taps "Create Survey" and chooses between **External Form** (Google Forms link) or **Internal Form Builder**. She picks Form Builder because it's cheaper.
  5. She uses the drag-and-drop editor to build her survey. She tries the AI assistant — types "Khảo sát hành vi tiêu dùng của sinh viên Marketing" and gets a suggested question structure that she reviews and edits.
  6. She sets targeting criteria: Marketing majors, age 18-25, Da Nang region.
  7. She sets sample size (100) and point reward per response. The system calculates total Escrow and checks her balance.
  8. She publishes. The survey enters the **Admin moderation queue** before appearing on the marketplace.
  9. Once approved, she monitors progress via her Dashboard: completion count, click-through tracking, individual response data, traffic analytics by hour/day/week/month.
  10. When she hits 100 responses, the system auto-hides the survey from the marketplace.
- **Climax:** Linh sees "100/100 responses collected" and views all Internal Form response data directly in RESCOM. File export remains a separate gated scope decision.
- **Resolution:** Survey auto-hidden. If Linh later needs more samples, she can reopen by paying additional tokens for a larger quota.
- **Edge case:** If Linh doesn't have enough Points, she must complete other students' surveys to earn Points first (no free publishes).

---

**UJ-2. Minh earns Points by completing surveys from the feed.**

- **Persona + context:** Minh, 2nd-year IT student, already onboarded and activated. Has 100 available Points. Wants to accumulate more before publishing his own survey next month.
- **Entry state:** Authenticated, lands on Marketplace.
- **Path:**
  1. Minh sees the Marketplace feed — surveys filtered by his demographic profile, showing reward points, estimated time, and remaining slots.
  2. He picks a short 5-minute survey offering 10 Points.
  3. **If Internal Form:** The survey opens within RESCOM after a clear integrity-telemetry notice. Minh answers and submits. The system validates the response, produces a Response Integrity assessment, and updates eligible reliability and Survey Quality evidence. Under `SHADOW` and `ADVISORY`, Points are credited to Available **immediately** (within 1–2 minutes) without waiting for scoring. Under a separately approved `ENFORCED` policy, the reward first enters a non-spendable Integrity Hold before any decision; `ACCEPT` releases it to Available, while `REVIEW` retains the existing hold for human review without declaring fraud.
  4. **If External (Google Forms):** RESCOM opens Google Forms in a new tab. A countdown timer + code input modal stays on the RESCOM tab. The system has auto-generated a unique 6-digit completion code (server-side) that the Publisher was required to paste at the end of their Google Form. Minh completes the survey, copies the code from the thank-you page, enters it in the RESCOM modal. Points enter **Pending Balance (48h)** for Publisher review.
  5. If the Publisher forgot to place the code, Minh can **report the issue** to Admin.
- **Climax:** Minh sees the current reward state—Available or Integrity Hold—and his streak counter increment.
- **Resolution:** Minh checks the Leaderboard — he's ranked #12 for most surveys completed this week. He plans to come back tomorrow to maintain his streak.
- **Edge case:** If Minh's answers contain a demographic contradiction, the system records an integrity signal. The contradiction cannot independently reject the response, reduce long-term reliability, or create a FraudLog entry unless a separate security policy was violated.

---

**UJ-3. Hùng resolves a data quality dispute as Admin.**

- **Persona + context:** Hùng is the RESCOM system administrator. He checks the admin dashboard daily.
- **Entry state:** Authenticated as Admin.
- **Path:**
  1. Hùng logs into the Admin Dashboard. He sees: active user list, pending complaints, open top-up refund requests, transaction dashboard overview.
  2. A new complaint appears: Publisher Linh reports that Respondent X submitted garbage data on her external Google Forms survey.
  3. Hùng opens the complaint — sees Linh's evidence (screenshots of the problematic response), the Respondent's completion timestamp, and FraudLog entries.
  4. Hùng decides the complaint is valid. He triggers a point reversal: Points are returned from Respondent X's Pending Balance to Linh's Escrow.
  5. The system sends email notifications to both Linh (complaint upheld) and Respondent X (points reversed, reason given).
  6. Hùng also notices Respondent X has 5 prior FraudLog entries. He **bans the account**.
- **Climax:** Dispute resolved, both parties notified, bad actor removed.
- **Resolution:** Hùng moves on to approve 3 new surveys waiting in the moderation queue before they go live on the marketplace.

---

**UJ-4. An builds reliability from her first Internal Form response.**

- **Persona + context:** An is a newly registered first-year student. She has completed onboarding but has no eligible Internal Form history.
- **Entry state:** Authenticated, reliability state `UNESTABLISHED`, Assessment Confidence low because personal history is unavailable.
- **Path:**
  1. An opens an Internal Form from the Marketplace.
  2. RESCOM explains the integrity purpose and permitted interaction categories before she starts.
  3. An completes and submits the form normally.
  4. RESCOM preserves her response, evaluates current-response evidence, and reports Response Integrity with confidence and evidence coverage.
  5. Missing personal history does not reduce her score or block her reward.
  6. As An completes more eligible Internal Forms, RESCOM creates increasingly confident Respondent Reliability snapshots.
  7. The Publisher sees safe assessment metadata for An's response but cannot access raw telemetry or unrelated history.
  8. After the Form Version accumulates sufficient eligible responses, its Publisher receives Survey Quality findings.
- **Climax:** An sees that her response was accepted and that her reliability is still being established rather than treated as suspicious.
- **Resolution:** An continues using all existing RESCOM features while the platform gradually builds evidence-based reliability.
- **Edge case:** If telemetry is incomplete, the response remains durable and the assessment reports lower evidence coverage or a recoverable pending state.

**UJ-5. Linh tops up Points through PayOS.**

- **Persona + context:** Linh is a third-year student who needs Points quickly to publish a survey.
- **Entry state:** Authenticated, on `/wallet`.
- **Path:**
  1. Linh opens the **Top up Points** section on `/wallet`.
  2. She enters a VNĐ amount (minimum 10,000 VNĐ, maximum 5,000,000 VNĐ, multiple of 200). RESCOM shows the Points she will receive at 1 Point = 200 VNĐ.
  3. She confirms. RESCOM creates a PayOS payment for that exact amount and redirects her to the PayOS checkout page. The QR code is valid for 5 minutes.
  4. Linh scans the QR and pays. PayOS confirms the payment to RESCOM, which credits her Available Balance, records the ledger entry, and notifies her in one atomic step.
  5. PayOS returns her to the top-up result page (`/wallet/top-up/:id`), which shows the result from RESCOM and links to `/wallet` with her new balance.
- **Climax:** Points arrive without waiting for an Admin.
- **Resolution:** Linh publishes her survey.
- **Edge cases:** If Linh cancels on PayOS or the QR expires, she returns to `/wallet` with a cancelled/expired message and no Point change. If she returns before PayOS confirms, `/wallet` shows **Processing** and updates itself when the result arrives.

**UJ-6. Linh requests a refund and Hùng resolves it.**

- **Persona + context:** Linh topped up by mistake. Hùng is the Admin.
- **Entry state:** Linh has a successful PayOS top-up less than 24 hours old.
- **Path:**
  1. On `/wallet`, Linh selects the top-up and chooses **Request refund**.
  2. RESCOM opens the refund request page with a fixed template. Transaction code, amount, top-up time, account email, and the paying bank account (masked) are prefilled and read-only; the money can only go back to that account. Linh chooses a reason from a list and writes a mandatory note.
  3. Linh submits. RESCOM records the submission time, places that top-up's Points on Refund Hold if the request is eligible, emails the request to the Admin refund mailbox, and notifies Linh.
  4. Hùng opens top-up history in the Admin Panel. RESCOM shows whether the request is **Eligible** or **Not eligible** and why.
  5. Hùng marks the request **Refunded** first, which locks it against withdrawal, then transfers the money back to the paying account. RESCOM removes the held Points through the ledger and notifies Linh. If he rejects instead, he gives a reason, the Refund Hold is released, and Linh is notified.
- **Climax:** Linh gets her money back without disputing a charge.
- **Resolution:** The ledger shows the top-up and its reversal as two linked entries.
- **Edge case:** If Linh already spent Points after the top-up, the request is recorded as **Not eligible**, nothing is held, Hùng rejects it with that reason, and Linh is notified.

---

## 3. Glossary

- **Publisher** — A user who creates and publishes a survey on RESCOM to collect responses. Any verified user can be a Publisher.
- **Respondent** — A user who completes surveys to earn Points. Any verified user can be a Respondent. The same user can act as both Publisher and Respondent.
- **Point (Điểm)** — The internal token unit of exchange on RESCOM. 1 Point = 200 VNĐ when topping up. Points are not currency — they cannot be traded, transferred between accounts, or cashed out as money.
- **Survey** — A questionnaire published on RESCOM, either as an External Form (Google Forms link) or an Internal Form (built with Form Builder). Has a form type: `EXTERNAL` or `INTERNAL`.
- **Form** — The logical Survey aggregate that owns its ordered Form Versions. One-completion eligibility is enforced at this logical Form level, not reset by a new version or quota reopen.
- **Survey Feed / Marketplace** — The personalized list of active surveys displayed to Respondents, filtered by Targeted Matching against the Respondent's demographic profile.
- **Form Builder** — RESCOM's built-in drag-and-drop survey creation tool. Produces a Form Definition JSON. Costs fewer Points than External Forms.
- **AI Form Generator** — An optional AI assistant that suggests survey question structures based on natural-language descriptions. Outputs a draft Form Definition for the Publisher to review and edit. Powered by Ollama/Qwen on a private GPU server.
- **Form Definition** — The canonical JSON representation of a survey's structure (sections, questions, options, settings). Shared between Form Builder, AI Generator, Form Renderer, and backend validation.
- **Form Version** — An immutable snapshot of a Form Definition at publishing. A published version cannot be edited — changes require a new draft version. Ensures response data always matches the questions asked.
- **Research Integrity Engine** — Internal-Form-only capability that evaluates research-data quality using disclosed interaction evidence, answers, relevant history, survey context, and TrustGraph-ready relationships.
- **Response Integrity** — Assessment of one Internal Form response, reported with score, confidence, evidence coverage, safe reason codes, policy version, and timestamp.
- **Respondent Reliability** — Longitudinal assessment derived from eligible authenticated Internal Form history. It is independent of engagement tier and completion count.
- **Survey Quality** — Assessment of a specific Internal Form Version using completion behavior, dropout, question friction, respondent feedback, technical failures, and integrity distributions.
- **Assessment Confidence** — How strongly the available evidence supports an assessment. Confidence is separate from the score.
- **Evidence Coverage** — Which expected evidence categories were available. Missing evidence reduces coverage; it does not directly reduce integrity.
- **Integrity Reason Code** — Stable, non-sensitive explanation of a factor that materially affected an assessment.
- **Integrity Policy Version** — Immutable version of the rules, weights, thresholds, and signal definitions used to produce an assessment.
- **Integrity Decision** — Operational result derived from an assessment: `ACCEPT`, `REVIEW`, or `NOT_ASSESSED`. Rejection remains a human or separately authorized enforcement outcome.
- **UNESTABLISHED** — Neutral reliability state used when a respondent lacks sufficient eligible history.
- **TrustGraph** — Versioned representation of integrity-relevant relationships among respondents, responses, Form Versions, Publishers, reviews, and outcomes. It does not require a graph database.
- **NOT_ASSESSED** — Status used when the full Integrity Engine does not apply, including External Form responses.
- **NOT_AVAILABLE** — Status used when a dimension cannot exist for an item, including Respondent Reliability for guest submissions.
- **ASSESSMENT_PENDING** — Recoverable status indicating that an eligible response is durable but its integrity assessment has not completed.
- **INSUFFICIENT_EVIDENCE** — Neutral status indicating that an assessment dimension lacks the minimum eligible evidence required for a score.
- **Guest Response** — A gated future Internal Form response without a persistent authenticated Respondent identity. Guest participation is disabled by default until Open Question 19 is approved; if enabled, it cannot update Respondent Reliability or earn account-bound rewards.
- **Targeted Matching** — The mechanism that distributes surveys to Respondents whose demographic profile matches the Publisher's targeting criteria (major, age, gender, region, etc.).
- **Completion Code** — A unique 6-digit code auto-generated by the server for each published External Form Version. The Publisher pastes this version-scoped code at the end of their external form. The Respondent enters it back into RESCOM and the backend validates it against the active Attempt, exact version, and server-side Time Barrier.
- **Time Barrier** — Anti-fraud mechanism that measures actual completion time server-side. Rejects submissions completed too fast (indicating the Respondent didn't actually complete the survey).
- **Onboarding Survey** — A mandatory system survey collecting demographic and interest data from new users. Required before account activation.
- **Frozen Points** — The 100 starter Points given at registration, locked until the user completes 2 onboarding surveys (demographic survey + 1 marketplace survey).
- **Refund Hold** — Points from a top-up, locked while an eligible refund request awaits Admin resolution (FR-77). Non-spendable; distinct from Frozen Points.
- **Point Escrow** — Points locked by the system when a Publisher publishes a survey, guaranteeing Respondents will be paid. Released per completion or refunded for unfilled slots.
- **Pending Balance** — Points earned from External Form completions, held for 48 hours for Publisher review before becoming available. Internal Forms never use this state: they use immediate Available credit in `SHADOW`/`ADVISORY` or Integrity Hold in `ENFORCED`.
- **Integrity Hold** — A non-spendable balance state used only for an authenticated Internal reward submitted under an approved `ENFORCED` policy. The hold exists before the Integrity Decision: `ACCEPT` releases it to Available, `REVIEW` retains it for human review, and terminal assessment failure or expiry of the approved decision deadline releases it under the fail-open rule.
- **Available Balance** — Points that can be spent immediately (to publish surveys or for other platform transactions).
- **Point Ledger** — The immutable, append-only double-entry transaction log recording every Point movement. Cannot be edited or deleted.
- **FraudLog** — An immutable, append-only security log for rejected hard anti-abuse attempts, security-policy violations, and confirmed abuse evidence. Integrity scores, soft signals, and review routing do not automatically create FraudLog entries.
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
- A matching email never auto-links by email alone; an existing password user must authenticate and explicitly link the verified Google identity, otherwise no duplicate account is created

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
- *Amendment 2026-09-26 (UX decisions):* the income bracket stays required but offers a "Không chia sẻ" (prefer not to say) option, like gender; the onboarding submit button is always enabled and missing fields are reported after submit with an error summary linking to each field (design: Onboarding-Error). Brand green #4DB848 is decorative only; actions use #2B7A33 for contrast.
- *Amendment 2026-09-26 (onboarding flow, UX decision):* onboarding is a wizard with **one question per screen**, grouped into 4 parts. (1) *About you:* display name (prefilled from the Google account, editable, not a matching field), birth year (age is derived from it), gender, region/province. (2) *Study & work:* occupation; then university and academic year, asked only when occupation is "Sinh viên đại học" or "Học viên sau đại học"; academic major; household income. (3) *Interests:* at least 3 of the interest categories. (4) *Goal:* take surveys / run a study / both. The goal is stored as intent only; it never grants or limits a role or permission. A Welcome screen before and a Completion screen after are not counted in the progress indicator (4 parts). University and academic year join the profile (FR profile below) and back FR-10 university targeting; they are required whenever shown. Validation is per screen: Continue stays enabled, and tapping it with a missing or invalid answer shows an inline error on that screen. This **supersedes** the error-summary part of the previous amendment (design Onboarding-Error is retired). The Completion screen always leads with FR-7 (complete 1 Marketplace survey to unlock the starter Points) before the goal-specific next step. Design: canvas section 12 (Ob-* screens).
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

> *Amendment 2026-09-26 (onboarding flow):* the profile also stores university and birth year (age is derived), and the onboarding goal intent (take surveys / run a study / both) as a non-permission preference. See the FR-6 amendment.

**Consequences (testable):**
- Profile is populated from onboarding survey
- User can update profile at any time
- Profile changes take effect for future survey matching immediately

#### FR-10: Publisher Targeting Criteria
When creating a survey, Publisher sets targeting criteria: gender, age range, major, university, region. Interests and income are excluded until Open Question 13 is approved.

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

**Description:** Publishers can post surveys hosted on external platforms (e.g., Google Forms) by providing a link. The system auto-generates a unique 6-digit Completion Code for the published External Form Version that the Publisher must embed at the end of their external form. Respondents enter this code back into RESCOM to claim their reward. Costs more Points than Internal Forms. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-12: External Survey Creation (3-Step Stepper)
Publisher provides: (Step 1) Google Forms link + estimated completion time, (Step 2) targeting criteria, (Step 3) sample size + point reward per completion.

**Consequences (testable):**
- All three steps must be completed before submission
- System validates URL format
- Estimated time determines the minimum reward per the pricing table

#### FR-13: Server-Generated Completion Code
System auto-generates one unique 6-digit code for each published External Form Version. Publisher is instructed to paste this version-scoped code at the end of their external form. A different code is not generated per Respondent attempt because the hosted form embeds a static value; code rotation creates a new Form Version.

**Consequences (testable):**
- Code is generated server-side, not by Publisher
- Code is unique per published External Form Version
- Publisher sees the plaintext code once with clear instructions to embed it; the server persists only the verifier key version and a keyed digest bound to Form Version, retaining that key while the version is active
- Code rotation produces a new immutable Form Version

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
- Publisher can intentionally designate attention checks, define explicit consistency relationships, and provide expected-effort hints
- Builder previews which integrity evidence categories an Internal Form may collect
- System warns against excessive or misleading attention checks

#### FR-17: AI Form Generator (Optional)
Publisher can describe their survey intent in natural language. The AI assistant generates a draft Form Definition with suggested sections and questions. Publisher reviews, edits, and publishes.

**Consequences (testable):**
- AI generates valid Form Definition JSON (validated by Zod)
- Generated form opens directly in the Form Builder for editing
- If AI is unavailable (server down), the Form Builder still works normally — AI is never a blocking dependency
- Publisher must explicitly confirm any AI-suggested attention check, consistency rule, or integrity metadata before it becomes active
- AI generation uses a separately governed timeout and never inherits the regular API target; the launch value is gated by Open Question 5

#### FR-18: Form Versioning
Each survey maintains an ordered list of Form Versions. A published Form Version is immutable — Publisher must create a new draft version to make changes.

**Consequences (testable):**
- Editing a published form creates a new version draft
- Responses always reference the specific form_version_id they were submitted against
- Previous versions are archived and viewable
- Integrity configuration is immutable with the published Form Version

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
Respondent enters the 6-digit code. Backend validates: the code matches the exact published External Form Version pinned by the active Attempt AND actual elapsed time from the server-recorded start is ≥ estimated duration.

**Consequences (testable):**
- Correct code + sufficient time = success
- Wrong code = rejection, logged to FraudLog
- Maximum failed attempts, lock duration, and recovery behavior are versioned security-policy values; no launch value is assumed before Open Question 14 is approved

> **Amendment 2026-09-26 (code-review decision E5-D1):** Phase 1 implements the versioned policy `completion-code-policy-v1` with **provisional** values — 3 wrong codes lock an Attempt; 6 wrong codes per account and Form Version, summed across Attempts, refuse further Attempts and verifications on that version (`COMPLETION_CODE_LIMIT_REACHED`); no automatic reset or lock expiry; an Admin recovers the account for that version through an audited reset; a new Form Version starts a fresh count. The values remain provisional until Open Question 14 is approved (the FR is not rewritten).

#### FR-23: Missing Code Report
If the Publisher failed to embed the Completion Code in their Google Form, Respondent can report the issue to Admin.

**Consequences (testable):**
- Report button is visible on the code input modal
- Admin receives the report and can resolve (refund Respondent or instruct Publisher)
- "Refund Respondent" confirms the completion: the attempt becomes Completed and the reward follows the normal External path (Escrow → Pending 48 h → Available), paid at most once; it is refused when the survey is closed or its quota is full, the escrow is short, or the attempt is a guest attempt or already completed
- "Dismiss" requires a reason; the Respondent is notified with it
- On "Refund Respondent" the Publisher is notified to check the completion code on the external form
- Each report is resolved at most once, and every resolution is audited (FR-ADD-13)

#### FR-24: 48-Hour Pending Period (External Only)
Points from external form completions enter Pending Balance. After 48 hours without complaint, they auto-transfer to Available Balance.

**Consequences (testable):**
- Pending Balance shows the amount and countdown
- Publisher can file a complaint during the 48h window
- Auto-transfer is handled by a background job

#### FR-25: One Completion Per Account
Each authenticated account may complete each logical Form at most once across all Form Versions and reopen cycles.

**Consequences (testable):**
- A second completion against any version of the same logical Form is blocked
- Publishing a new Form Version or reopening quota does not reset an account's completion eligibility
- Survey card shows "Completed" status for that user

---

### 4.8 Survey Completion — Internal Forms

**Description:** Respondents complete Internal Forms directly within RESCOM. The system fully controls the experience—no Completion Code is needed. After hard validation, authenticated rewards follow the policy mode pinned at submission: `SHADOW`/`ADVISORY` credit Available without waiting for scoring, while `ENFORCED` posts to Integrity Hold before Decision. Realizes UJ-2.

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
- Direct demographic contradictions create versioned integrity signals
- A contradiction cannot independently reject a response or reduce long-term reliability
- A contradiction cannot create a FraudLog entry unless a separate security policy is violated
- System checks disclosed demographic consistency fields only, not opinion-based answers

#### FR-28: Automated Validation — Bot Detection
System validates that actual completion time meets a minimum threshold based on question count and type.

**Consequences (testable):**
- Submissions completed impossibly fast are rejected
- FraudLog records the attempt with timing data
- Hard bot controls remain separate from Research Integrity assessments, although their outcomes may be eligible integrity evidence

#### FR-29: Internal Reward Credit and ENFORCED Hold
Valid authenticated Internal Form submissions follow the policy mode pinned at submission. `SHADOW` and `ADVISORY` credit Points to Available Balance immediately (within 1–2 minutes) without waiting for scoring. `ENFORCED` first credits the reward to a non-spendable Integrity Hold before any Integrity Decision.

**Consequences (testable):**
- Internal rewards never enter the External Form 48-hour Pending period
- `SHADOW` and `ADVISORY` reward processing is independent of scoring availability and credits Available within the existing 1–2 minute window
- Every authenticated `ENFORCED` reward enters Integrity Hold before `ACCEPT` or `REVIEW`; it cannot first become spendable and then be clawed back because of that decision
- `ACCEPT` releases the existing hold to Available; `REVIEW` retains the same hold for human review without creating a second reward movement
- Terminal assessment failure or expiry of the governance-approved decision deadline releases the hold to Available and opens an operational incident
- Ledger operations for initial Available credit or hold posting, release, and review resolution are idempotent; retries cannot duplicate a reward
- Respondent sees the current reward state and notification; Guest Responses never create account-bound rewards

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
User wallet displays: Available Balance, Pending Balance, Escrow, Frozen Balance, Integrity Hold, Refund Hold, and full transaction history.

**Consequences (testable):**
- All balance types are visible on one screen
- Integrity Hold is clearly non-spendable and distinct from the External Form Pending Balance
- Transaction history shows: timestamp, type (earned/spent/frozen/escrow/refund/top-up/top-up reversal), amount, related survey or top-up
- Integrity Hold history distinguishes hold posting, decision release, review retention, review reversal, and fail-open release and links each movement to the Response
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

### 4.10 Top-Up (Point Purchase via PayOS)

**Description:** Users buy Points with real money through PayOS. Payment confirmation credits Points automatically; no Admin approval exists. Admins handle refunds manually and record the outcome in RESCOM. The manual bank-transfer flow is retired. PayOS is used only for Point top-ups. Realizes UJ-5 and UJ-6.

> **Amendment 2026-10-15 (PayOS integration):** FR-34 and FR-35 replace the manual Top-Up Request and Admin Top-Up Approval requirements. The former "no refunds" rule is replaced by FR-77 and FR-78.

**Functional Requirements:**

#### FR-34: Top-Up Checkout through PayOS
User enters a VNĐ amount on `/wallet`; RESCOM creates a PayOS payment for that exact amount and redirects the user to PayOS checkout.

**Consequences (testable):**
- Amount is at least 10,000 VNĐ, at most 5,000,000 VNĐ, and a multiple of 200; other values are rejected before any PayOS call
- Points = amount ÷ 200, computed server-side; the client cannot set the amount-to-Points mapping
- Each top-up creates its own PayOS payment with a unique order code and the exact amount
- A user can have at most one Processing top-up at a time
- The PayOS payment expires 5 minutes after creation
- The user can cancel their own Processing top-up; RESCOM cancels the PayOS payment and the top-up becomes Cancelled, so a new top-up can start at once
- Successful payment and cancellation both return the user to the top-up result page (`/wallet/top-up/:id`); the result shown comes from RESCOM, never from return parameters
- If PayOS payment creation fails or times out, the top-up becomes Cancelled, no balance changes, and the user sees a retryable error on screen (no separate notification)
- A user can start at most 5 checkouts per 10 minutes

#### FR-35: Automatic Crediting on Payment Confirmation
When PayOS confirms a payment, RESCOM credits the Points to the user's Available Balance without Admin action.

**Consequences (testable):**
- Only a confirmation whose authenticity is verified, and whose order code and amount match the top-up, credits Points
- Top-up status change, ledger credit, and user notification are all-or-nothing; any failure rolls all of them back
- Repeated confirmations for the same top-up never credit Points more than once
- If a payment is confirmed but crediting fails, RESCOM retries and reconciles against PayOS until the Points are credited, and alerts the Admin if the top-up is still uncredited 30 minutes after confirmation
- A verified full-amount payment for a top-up already marked Cancelled or Expired still credits the Points, moves the top-up to Successful, and notifies the user
- A payment whose amount differs from the top-up credits nothing automatically, is flagged, and shows the user the status Under review; the Admin either credits Points for the amount actually received (amount ÷ 200, rounded down) or refunds it manually, and the user is notified of the outcome
- When the Admin credits a mismatch, any remainder below 200 VNĐ is not converted and the user notification states it
- The Admin can re-check any PayOS top-up against PayOS at any time; a verified payment found this way credits through the same idempotent path (covers payments arriving after the 24-hour reconciliation window)
- The Admin resolves each flagged amount mismatch within 3 business days of the payment; an unresolved mismatch past that deadline raises an Admin alert
- Business days in every SLA (FR-35, FR-78) are Monday–Friday in Asia/Ho_Chi_Minh, with no holiday calendar

#### FR-76: Top-Up Status on Wallet
The Wallet shows every top-up with its current status and keeps the user informed of each change.

**Consequences (testable):**
- Statuses: Processing, Successful, Cancelled, Expired, Under review (amount mismatch awaiting Admin), Refund Requested, Refunded, Refund Rejected, Withdrawn; a mismatch refunded manually by the Admin shows Refunded with copy stating no Points were credited
- A user returning before confirmation sees Processing, and the page updates itself when the result arrives
- Cancelled and Expired top-ups change no balance
- Every status change sends the user a notification, except a top-up cancelled because PayOS payment creation failed (the error is shown on screen)

#### FR-77: Refund Request
User can request a refund of a Successful top-up through a templated in-app form.

**Consequences (testable):**
- The form is available only for the user's own Successful top-up and only within 24 hours of the payment time; the deadline is computed by the server (payment time + 24 hours, exclusive) and shown as is
- A top-up credited by the Admin after an amount mismatch cannot be refunded in-app; the Admin decided between credit and refund at mismatch resolution
- Banning a user does not release or remove a Refund Hold; the Admin can still resolve the request
- One request per top-up; a rejected or withdrawn request cannot be resubmitted
- The user can withdraw their own unresolved request; any Refund Hold returns to Available, the top-up shows Successful again, and the Admin is notified
- Prefilled read-only fields: transaction code, amount, Points, top-up time, account email, and the refund destination
- The refund destination is always the bank account that paid the top-up, as reported by PayOS (bank, account holder name, account number masked to the user); the user cannot enter or change it
- If PayOS did not report the paying account, the user can still submit; the request is marked destination unverified and the Admin confirms the paying account with the user by the account email before transferring
- User fields: reason (fixed list: wrong amount, wrong RESCOM account, no longer need Points, other) and note (mandatory for every reason, at most 300 characters)
- Submission records the submission time, emails the request to the configured Admin refund mailbox, and notifies the user
- If the request is eligible (FR-78), that top-up's Points move from Available to Refund Hold until the request is resolved; an ineligible request is recorded without a hold so the Admin can reject it
- If Available Balance is below the top-up's Points at submission for any reason, the request is recorded Not eligible and nothing is held
- The eligibility check and the Refund Hold are atomic with Point spending: a concurrent spend either completes first (request becomes Not eligible) or fails for insufficient Available Points

> **Amendment 2026-10-16 (Owner decision, Story 13.6 live probe):** The production probe (paid through MoMo) reported `counterAccountBankId` and `counterAccountNumber` (last 4) but no `counterAccountName`; `counterAccountBankName` was empty. The reported account may be a wallet pass-through account. A refund destination without the account holder name is therefore treated as "destination unverified" (branch above): the Admin confirms the paying account with the user by the account email before refunding. No other FR-77 change.

> **Amendment 2026-10-16 (Owner decision, Story 13.11):** The user sees the full paying account number on their own top-up; Outbox, mailbox email and logs keep last 4.

#### FR-78: Refund Eligibility and Admin Resolution
RESCOM evaluates refund eligibility; the Admin performs the bank refund outside RESCOM and records the outcome.

**Consequences (testable):**
- Eligible means: request submitted within 24 hours of the top-up, and the user made no Point-spending transaction (survey publishing, survey reopen, voucher redemption) between the top-up and the submission
- Admin sees the verdict and the reason for any ineligibility
- **Refunded** is allowed only for a request whose Points are on Refund Hold; it removes the held Points through a top-up reversal ledger entry against the platform top-up account, linked to the original top-up
- Admin marks Refunded before transferring money, so a withdrawal can never follow a completed bank transfer; the bank transfer reference and time are optional and can be added after marking, and the user then sees them
- A withdrawal and an Admin resolution of the same request cannot both succeed; the later one is refused with "request already resolved"
- Admin can export PayOS top-ups and refunds for a date range as CSV for bank and tax reconciliation; the CSV contains no bank account numbers and every export is audit-logged
- The refund-mailbox email masks the account number to its last 4 digits and links to the Admin Panel, which alone shows the full number
- **Rejected** requires a reason and releases any Refund Hold to Available
- No refund action can make any balance negative
- Admin resolves each request within 3 business days of submission; an unresolved request past that deadline raises an Admin alert
- A manual bank refund on a request without a hold is recorded as Rejected with a note stating the money was returned; it changes no balance
- RESCOM never moves money; the bank refund is manual and goes only to the paying account (FR-77)
- Every resolution notifies the user and is recorded in the Admin audit trail

#### FR-79: Retirement of the Manual Top-Up Flow
Enabling PayOS retires the manual bank-transfer top-up.

**Consequences (testable):**
- Before PayOS is enabled, the Admin resolves every pending manual top-up request: approve if the bank transfer was received, reject otherwise; each affected user is notified
- PayOS cannot be enabled while any manual request is still pending
- The manual request form and the Admin approval queue are no longer available
- Historical manual top-ups remain visible in Wallet and Admin history

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
- Result-update latency must meet the release-test profile approved in Open Question 22; no undefined “real-time” default is assumed

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
- Metric-update latency must meet the release-test profile approved in Open Question 22
- Progress bar shows visual completion percentage

#### FR-40: Response Data (Internal Forms Only)
For internal forms, Publisher can view individual response data directly in the dashboard.

**Consequences (testable):**
- Responses are displayed in a table/list format
- Each response is linked to its Form Version
- Each assessed response shows safe integrity metadata: score, confidence, evidence coverage, reason codes, policy version, and review status
- Raw telemetry, sensitive account/device evidence, and unrelated Respondent history are never exposed to Publishers
- FR-40 requires in-app viewing only; response-file export and integrity-metadata export remain separately gated by Open Questions 6 and 11

#### FR-41: Traffic Analytics
Dashboard shows survey access analytics: views/clicks by hour of day, by day of week, by month. Shows drop-off rate (started but not completed).

**Consequences (testable):**
- Charts display temporal traffic patterns
- Average completion time is calculated and shown
- Drop-off rate is calculated as (started - completed) / started
- Internal Form dashboards show integrity distributions and actionable Survey Quality findings by Form Version
- External Form dashboards show the full Integrity Engine as `NOT_ASSESSED`

#### FR-42: Feedback Summary
Dashboard aggregates Respondent feedback: question clarity, survey length, technical issues, overall experience.

**Consequences (testable):**
- Average ratings displayed per feedback dimension
- Free-text comments are listed

> **Amendment 2026-09-26 (code-review decision E9-D1):** Phase 1 collects feedback as one required overall rating (1–5 stars) plus optional issue tags and an optional comment (FR-43 amendment below), not five separately rated dimensions. The Feedback Summary (Story 9.3, Phase 2) therefore shows the **average overall rating** plus, **per issue tag, the share of respondents reporting it** (e.g. "% of respondents reporting unclear questions"); listing free-text comments stays behind the architecture's minimum-aggregation / pseudonymous-linkability launch gate (the FR is not rewritten).

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
- Validated aggregate feedback contributes to Survey Quality only after minimum evidence requirements are met
- A single negative review cannot materially change Survey Quality

> **Amendment 2026-09-26 (code-review decision E9-D1):** the Phase 1 feedback model is **one required overall-experience rating (1–5 stars) plus optional issue tags** for the other four dimensions — question clarity (`UNCLEAR_QUESTIONS`), survey length accuracy (`LONGER_THAN_ESTIMATED`), description accuracy (`MISLEADING_DESCRIPTION`), technical issues (`TECHNICAL_ISSUE`) — and an optional comment of at most 500 characters, one immutable feedback per completed Attempt (Story 9.2). The tags map directly onto FR-44's deprioritization triggers. Per-dimension star ratings are not collected; if they are wanted, they must be added before launch (adding them later would leave two incompatible data sets). "Visible to Publisher in dashboard" remains Story 9.3 (Phase 2) (the FR is not rewritten).

#### FR-44: Negative Feedback Deprioritization
If a survey crosses an approved negative-feedback threshold, the system reduces its visibility in the Marketplace feed. Automated deprioritization remains disabled until Open Question 15 is approved.

**Consequences (testable):**
- Deprioritized surveys appear lower in feed rankings
- Publisher is notified and advised to improve their survey
- The active threshold and version are auditable

---

### 4.14 Anti-Fraud System

**Description:** Multi-layered fraud prevention protects security and point integrity. Hard anti-abuse rejections, security-policy violations, and confirmed abuse evidence are logged immutably; Research Integrity evidence remains separate. Realizes UJ-2, UJ-3.

**Functional Requirements:**

#### FR-45: Time Barrier
Server measures actual elapsed time from startTime to submission. Rejects if time < minimum threshold.

**Consequences (testable):**
- startTime is recorded server-side only
- Rejection triggers FraudLog entry

> **Amendment 2026-09-26 (code-review decision E5-D2):** every Attempt reserves its quota slot for a fixed 30 minutes, so a survey is publishable only if it fits that window: its effective minimum time (Internal: answerable questions × 2 s or the Publisher minimum, whichever is stricter; External: the configured minimum) must leave at least 5 minutes to submit, and its declared effort / estimated duration must not exceed 30 minutes (rejected at publish with `SURVEY_DURATION_EXCEEDS_RESERVATION`). **Phase 1 does not support surveys longer than 30 minutes**; per-attempt reservation windows are a Phase 2 option (the FR is not rewritten).

#### FR-46: Rate Limiting
System limits how many surveys a user can complete in a given time window to prevent bot behavior.

**Consequences (testable):**
- Exceeding the rate limit blocks further attempts temporarily
- Limits are centrally versioned security policy, not discretionary per-user Admin settings; launch values and outage behavior require Open Question 16 approval

> **Amendment 2026-09-26 (code-review decision E8-D4):** "centrally versioned" is implemented as a named policy version configured per deployment — `PARTICIPATION_RATE_LIMIT_POLICY_VERSION`, **required in production** — that is stamped on every rate-limit rejection (429) and `RATE_LIMIT` FraudLog entry. The provisional Phase 1 values (20 completed surveys per user per rolling hour; 10 attempt-start / Internal-submission / completion-code requests per user per action per minute) are named `participation-rate-limit-v1`; any other values must run under a new version name. The values themselves **still require Open Question 16 approval** before launch (the FR is not rewritten).

#### FR-47: Immutable FraudLog
Rejected hard anti-abuse attempts, security-policy violations, and confirmed abuse evidence are logged in an append-only FraudLog. Soft quality signals, low scores, and integrity-review routing remain in Integrity records.

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
- Ranking-update latency must meet the release-test profile approved in Open Question 22
- Scope, time windows, and displayed ranking count require Open Question 1 approval before leaderboard stories are implementation-ready

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
| Trusted Researcher | ≥ 100 surveys | Engagement-tier benefits; External Form Pending remains 48 hours unless Open Question 3 approves a shorter duration. Respondent Reliability remains separate. |
| Community Ambassador | ≥ 300 surveys | Badge only until Open Question 4 approves specific privileges. |

**Consequences (testable):**
- Tier is calculated automatically from completion count
- Tier badge is displayed on user profile
- Benefits are applied automatically
- Engagement tier is independent of Respondent Reliability and Assessment Confidence
- Completing a threshold number of surveys cannot by itself establish research reliability

---

### 4.17 Admin Panel

**Description:** Admin manages users, moderates surveys, resolves disputes, resolves top-up refund requests, and monitors system integrity. Realizes UJ-3 and UJ-6.

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
- Pilot moderation cadence and reporting baseline require Open Question 22 approval before launch; no response-time promise exists until then

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
Admin sees overview of all Point transactions across the system: PayOS top-ups by status, open refund requests, escrows active, refunds processed.

**Consequences (testable):**
- Dashboard shows aggregate metrics and individual transaction drill-down

---

### 4.18 Notification System

**Description:** Users receive notifications for key events via in-app and email channels.

**Functional Requirements:**

#### FR-57: Event Notifications
System sends notifications for: account activation, survey approved/rejected, Points earned, Points pending, Integrity Hold placed/released/retained/resolved, complaint filed/resolved, survey quota reached, ban/unban, every top-up and top-up refund status change (FR-76).

**Consequences (testable):**
- In-app notifications appear in a notification center
- Email notifications sent for critical events (complaint resolution, ban, top-up Successful, top-up Refunded, top-up Refund Rejected)
- Integrity Hold notifications identify the current non-spendable state and next review/appeal action without exposing sensitive evidence
- Push notifications are excluded from MVP under §6.2

---

### 4.19 Research Integrity Engine — Internal Forms Only

**Description:** Internal Forms created and completed inside RESCOM produce explainable assessments across Response Integrity, Respondent Reliability, and Survey Quality. External Forms retain existing verification controls and are explicitly outside the full engine. The capability launches progressively so new policies can be evaluated before they affect rewards or review routing.

#### FR-58: Consent-Aware Behavioral Telemetry

For Internal Forms, RESCOM captures only disclosed interaction events required for integrity assessment.

**Consequences (testable):**
- Respondent receives a clear integrity-telemetry notice before eligible participation
- System records the accepted notice version and purposes
- Declining or withdrawing consent follows an approved, versioned product flow; production telemetry remains disabled until Open Question 17 and the launch gates in Constraints and Guardrails are closed
- Permitted events include question display, answer commit/change, navigation, focus state, validation errors, and submission timing
- Raw keystrokes, clipboard contents, unrelated browsing activity, and background device activity are prohibited
- Every event references the Response and exact Form Version
- External Forms do not use integrity telemetry

#### FR-59: Response Integrity Assessment

Every submitted Internal Form response receives a versioned integrity assessment or an explicit recoverable pending state.

**Consequences (testable):**
- Completed assessment contains a score from 0–100
- Assessment includes confidence, evidence coverage, safe reason codes, policy version, revision, and timestamp
- A separate immutable Integrity Decision links to the assessment and records operational outcome plus rollout mode
- Eligible evidence may include temporal, interaction, attention, consistency, semantic, historical, survey-context, and graph signals
- Missing evidence lowers coverage rather than directly lowering the score
- Assessment failure cannot corrupt or delete the submitted response

#### FR-60: Cold-Start Handling

New respondents are evaluated without treating missing history as risk.

**Consequences (testable):**
- New respondent begins in `UNESTABLISHED` state
- Current-response evidence and applicable survey/cohort baselines may be used
- Personal-history weighting increases gradually as eligible evidence accumulates
- Reliability and confidence are stored and displayed separately
- Respondent cannot be blocked solely because they lack history

#### FR-61: Respondent Reliability

System maintains a longitudinal reliability assessment for authenticated Respondents using eligible Internal Form evidence.

**Consequences (testable):**
- Reliability uses eligible assessments and confirmed review outcomes
- External Form and guest responses do not update Respondent Reliability
- Completion count alone cannot establish reliability
- One poor response cannot automatically classify a Respondent as fraudulent
- Reliability changes are preserved as versioned historical snapshots

#### FR-62: Survey Quality Assessment

Each Internal Form Version receives an independent quality assessment after sufficient eligible evidence exists.

**Consequences (testable):**
- Eligible evidence includes dropout, completion-time accuracy, question friction, technical failures, feedback, attention-check performance, and integrity distributions
- New Form Version begins a new Survey Quality history
- Historical versions remain reproducible and viewable
- Poor Survey Quality cannot automatically reduce Respondent Reliability
- Insufficient sample size produces `INSUFFICIENT_EVIDENCE`, not a low score

#### FR-63: Explainability and Reproducibility

Every integrity assessment must be explainable and reproducible.

**Consequences (testable):**
- Integrity policy versions are immutable after activation
- System preserves the derived signals and policy version used by each assessment
- Authorized users receive stable reason codes and plain-language explanations
- Sensitive anti-abuse thresholds and raw device-risk details are not exposed
- Reprocessing creates a new assessment revision and never overwrites the original

#### FR-64: Integrity Decision Modes

Integrity policies operate in controlled rollout modes.

**Consequences (testable):**
- `SHADOW` records assessments without affecting rewards or visibility
- `ADVISORY` exposes authorized findings without automatic rejection
- `ENFORCED` produces an operational `ACCEPT` or `REVIEW` decision after assessment
- New policy versions begin in `SHADOW`
- Existing instant rewards remain unchanged in `SHADOW` and `ADVISORY`
- Every authenticated Internal reward submitted under `ENFORCED` is placed in a non-spendable Integrity Hold before the Integrity Decision
- `ACCEPT` releases the pre-existing hold to Available; `REVIEW` retains that same hold for human review without declaring fraud
- A terminal assessment failure or missing decision at the governance-approved deadline fails open by releasing the hold to Available and opening an operational incident
- Automatic rejection is prohibited unless separately authorized and audited

#### FR-65: Integrity Review and Feedback Labels

Authorized reviewers can resolve responses routed for integrity review.

**Consequences (testable):**
- Reviewer sees assessment summary, reason codes, policy version, Form Version, and relevant response context
- Reviewer can accept, mark insufficient evidence, or reject with a documented reason
- A `REVIEW` case retains the pre-existing Integrity Hold; acceptance or insufficient evidence releases it, while a documented rejection resolves it through an idempotent reversal command
- `ENFORCED` cannot activate until Open Question 18 defines the review deadline, unresolved-review fallback, rejection destination, quota effect, appeal window, and compensating settlement after an overturned decision
- Review outcomes become calibration labels without rewriting historical assessments
- Respondent receives an understandable decision and access to an appeal mechanism

#### FR-66: TrustGraph-Ready Relationships

System maintains versioned integrity-relevant relationships using its approved platform data store.

**Consequences (testable):**
- Relationships cover Respondent, Response, Form Version, Publisher, assessment policy, review, and outcome
- Sensitive device or account-link evidence requires restricted access and explicit privacy controls
- Graph-derived signals identify their evidence source and policy version
- Publishers cannot access raw TrustGraph data

#### FR-67: Assessment Applicability

System explicitly records whether each integrity dimension applies.

**Consequences (testable):**
- Authenticated Internal response may use all three dimensions
- If and only if the Guest participation gate is approved, Guest Internal response may receive Response Integrity and contribute to Survey Quality; Respondent Reliability is `NOT_AVAILABLE`
- External response is `NOT_ASSESSED` by the full Integrity Engine
- `NOT_ASSESSED`, `NOT_AVAILABLE`, and `INSUFFICIENT_EVIDENCE` cannot be converted to zero scores

---

### 4.20 Rewards — Voucher Redemption & Flash Sale (Phase 2)

> **Added 2026-10-13 by sprint-change-proposal-2026-10-13 (Phase 2, after pilot launch).** Design source: Figma Rescom pages 20–27; business rules BR-01…BR-24 in the planning doc "Rescom — Đổi điểm lấy voucher F&B & Flash Sale" (2026-10-13). Architecture: AD-24.

**Description:** Users spend Available Points on F&B partner vouchers, which becomes the second way to spend Points after publishing surveys. 1 Point ≈ 200 VNĐ, the top-up rate. Every Point in Available Balance can be redeemed, including topped-up Points and unlocked starter Points. Pending, Frozen, Escrow, Integrity Hold, and Refund Hold Points can never be redeemed. Admins manage the catalog, code inventory, and time-boxed Flash Sales. Behavior that depends on Open Questions 23–26 stays gated until those questions are answered.

**Functional Requirements:**

#### FR-68: Voucher Catalog and Discovery
Users browse active vouchers, search by name or brand, filter by category, brand, point range, "on sale", and "I can afford", sort the results, and open a voucher detail page.

**Consequences (testable):**
- Every price is compared with the user's Available Balance, and the balance shown says that Pending Points are excluded
- User-facing states are Available, Sold Out, Expired (redemption window ended), and Paused. A Paused voucher stays listed with the redeem action disabled
- Hidden or archived vouchers are not listed, but vouchers already redeemed remain in the owner's account (BR-10)
- A voucher that has any redemption cannot be deleted, only hidden or archived (BR-24)

#### FR-69: Quote and Redemption
Opening the confirmation step creates a server quote. Confirming the quote redeems the voucher exactly once, at the locked price.

**Consequences (testable):**
- A quote returns `quoteId`, effective price, `priceVersion`, and an expiry no later than the quote TTL (Open Question 26) or the Flash Sale end
- The client creates one idempotency key per confirmation. Resending the same key returns the first result (BR-08)
- Redemption succeeds only if Available Balance ≥ the price at commit (BR-01). The price is resolved on the server at commit time in the order Flash > promotion > base. A `priceVersion` that differs from the quote returns `PRICE_CHANGED` with the new price (BR-11)
- A success posts exactly one balanced journal, USER_AVAILABLE → SYSTEM_SINK, for the integer price (BR-03). It decrements stock without ever going below zero (BR-04), assigns one unique code, and records one Redemption with its own RDM reference (BR-07, BR-14)
- Any failure rolls back Points, stock, and code assignment together (BR-09). The failed attempt is still recorded, without a journal (BR-07)
- Failure codes are `SOLD_OUT`, `PRICE_CHANGED`, `INSUFFICIENT_POINTS` (with the new balance), `VOUCHER_UNAVAILABLE`, and `ACCOUNT_NOT_ELIGIBLE`. Every failure message states that no Points were deducted
- Successful redemptions cannot be cancelled or refunded, except under FR-75 (BR-22)

#### FR-70: My Vouchers and Redemption History
Users see their redeemed vouchers as tickets, can use a code, and can review their redemption history.

**Consequences (testable):**
- Tabs are Unused, Used, and Expired. Tickets are sorted by nearest expiry, and Expiring is shown 7 days before expiry
- A ticket shows the code, a QR code, a copy action, and usage instructions
- The user can mark a voucher as used and undo it within 24 hours (Open Question 25)
- Reminders are sent 7 days and 1 day before expiry. An expired, unused voucher is not refunded (BR-23, Open Question 25)
- Redemption history shows Success, Failed, and Refunded entries, and each links to its ledger entry

#### FR-71: Flash Sale
Admins schedule time-boxed Flash Sales with a reserved quota at a lower price.

**Consequences (testable):**
- A Flash Sale applies only within `[start, end)` server time, in Asia/Ho_Chi_Minh. When it ends, sells out, or is ended early, the regular price returns immediately (BR-17)
- The Flash quota is reserved from regular stock at start, and unsold quota returns to stock at end. Start and end jobs run exactly once (BR-05)
- One voucher cannot be in two overlapping Flash Sales. The Flash price must be lower than the regular price, and the quota cannot exceed unreserved stock (BR-18)
- Each user may redeem at most N units per voucher per Flash Sale, default 1 (BR-19)
- Countdowns use server time. The client clock never decides the price

#### FR-72: Admin Voucher Management
Admins create, edit, pause, hide, and archive vouchers, with a card preview, and manage code inventory.

**Consequences (testable):**
- Codes are uploaded as CSV. A file is rejected if it contains duplicates within itself or codes already stored for that voucher (BR-15). Shared codes require an explicit `isShared` setting (BR-14)
- Stock can be reduced only within the unissued portion that is not reserved for Flash (BR-06)
- A price change applies only to redemptions after it is saved. Price history is append-only, and each redemption stores the price it used (BR-12)
- A point price that deviates more than 20% from value ÷ 200 VNĐ follows the approval rule in Open Question 23 (BR-13)
- Code expiry must be at least 7 days after the redemption window ends (BR-16, Open Question 25)
- Every Admin change is audited (FR-ADD-13)

#### FR-73: Admin Flash Sale Operations and Rewards Statistics
Admins create Flash Sales with a User Portal preview, monitor them, end them early, and view redemption statistics.

**Consequences (testable):**
- Scheduling rejects overlaps, a Flash price ≥ the regular price, and a quota above unreserved stock
- Monitoring shows Scheduled, Upcoming, Active, Sold Out, and Ended programs, with sold/quota counts
- Ending early requires confirmation. It returns unsold quota to stock, and users in confirmation receive `PRICE_CHANGED`
- Statistics show redemptions by day and by brand, Points spent, Flash Sale performance, and the self-reported usage rate, labelled as self-reported

#### FR-74: Redemption Limits and Abuse Controls
Redemption is limited per user and blocked for ineligible accounts.

**Consequences (testable):**
- Only activated accounts that are not locked can redeem. Accounts flagged in FraudLog cannot redeem in a Flash Sale (BR-21)
- Flash Sale eligibility requires at least one completed survey in the last 30 days, and Admin can disable this rule (BR-02)
- Per-user limits apply per voucher (default 2 per 30 days) and per day (default 500 Points), counted inside the redemption transaction (BR-20, Open Question 23)
- Admin can change the per-day Points limit (1–1,000,000) in the Admin console; a change applies to the next redemption and is audited (FR-ADD-13)
- A redemption in a Flash Sale within 24 hours after a top-up creates a FraudLog flag for review. It does not block the redemption automatically

#### FR-75: Faulty Code Resolution
A user can report a code that does not work. An Admin resolves the report with a replacement code or a refund.

**Consequences (testable):**
- The report is linked to the Redemption and enters an Admin queue. Story 8.5 is deferred, so this queue is Rewards-owned
- Admin either issues a replacement code or refunds through an Economy reversal journal (`reversesJournalId`). Each report has at most one outcome
- The target resolution time is 1 business day (Open Question 25), and the user is notified of the outcome

---

## 5. Non-Goals (Explicit)

- **RESCOM is NOT a money-making app.** Points are internal tokens — not currency, not cashable, not transferable between accounts.
  > **Amendment 2026-10-13 (sprint-change-proposal-2026-10-13, Phase 2 Rewards):** Available Points, including topped-up Points, may also be spent on partner vouchers in the Rewards catalog (§4.20). Points can never be withdrawn as cash or converted back to money, except the Admin-executed refund of an unspent top-up within 24 hours (FR-77, FR-78). Accounting/tax treatment is Open Question 24.
- **RESCOM does NOT sell survey responses.** It is a distribution service connecting surveys to the right audience.
- **RESCOM does NOT replace SurveyMonkey or Typeform.** The Form Builder serves academic survey needs, not enterprise research.
- **RESCOM does NOT support organizational accounts (v1).** B2B features for lecturers, departments, and research groups are deferred to Phase 3.
- **RESCOM does NOT process payments other than Point top-ups.** PayOS is used only to buy Points. Point withdrawal or cash-out does not exist; the only money return is the manual 24-hour top-up refund (FR-77, FR-78).
- **RESCOM does NOT guarantee AI availability.** The AI Form Generator is an optional enhancement — all core features work without it.
- **RESCOM does NOT claim full Integrity Engine coverage for External Forms.** External responses remain subject to existing verification and dispute controls.
- **RESCOM does NOT treat a low score or review flag as proof of fraud.** FraudLog and integrity assessments remain distinct.
- **RESCOM does NOT automatically reject responses under `SHADOW` or `ADVISORY`.** Enforcement requires an approved, audited policy transition.
- **RESCOM does NOT require machine learning or a graph database for the initial Integrity Engine.** Advanced models require sufficient confirmed labels and separate approval.
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
- Point System: Escrow, Pending (48h external), Instant Available credit (`SHADOW`/`ADVISORY` internal), Integrity Hold (`ENFORCED` internal), Available, Frozen
- Immutable Double-Entry Point Ledger
- Anti-Fraud: Time Barrier, Completion Code, demographic cross-check, bot detection, FraudLog
- Publisher Dashboard with progress, response data (internal), traffic analytics
- Feedback system (post-completion ratings + comments)
- **Gamification: Streak + Leaderboard**
- Membership tiers (5 levels)
- Admin panel: user management, moderation, complaints, top-ups, FraudLog
- Top-up via PayOS with automatic crediting and manual Admin refunds (§4.10)
- Notification system (in-app + email)
- **Survey reopen** with additional token payment
- **Research Integrity Engine for Internal Forms:** consent-aware telemetry, Response Integrity, Assessment Confidence, Evidence Coverage, reason codes, and policy versioning
- **Cold-start-safe Respondent Reliability:** `UNESTABLISHED` state, separate reliability/confidence, and eligible Internal Form history only
- **Survey Quality per Internal Form Version:** quality evidence, confidence, minimum evidence handling, and actionable Publisher findings
- **Integrity Review:** distinct from FraudLog, with progressive `SHADOW → ADVISORY → ENFORCED` rollout and idempotent reward actions
- **TrustGraph-ready relationships:** versioned integrity-relevant relationships with restricted sensitive evidence

> **Approved scope decision:** RESCOM uses Direct Adjustment. All existing GO LIVE features remain in scope while the Internal Form Research Integrity Engine is added. This deliberately increases delivery scope; Sprint Planning must size the additional work before committing a launch date.

### 6.2 Out of Scope for MVP

- **Survey boost/promotion** — deferred to Phase 2.
- **Rewards: voucher redemption + Flash Sale (§4.20)** — Phase 2, after pilot launch (Story 11.5). Approved by sprint-change-proposal-2026-10-13.
- **Advanced dashboard analytics** (comparative reports, export to Excel/SPSS) — deferred to Phase 2/3. Basic response-file export and integrity-metadata export are not authorized for MVP unless Open Questions 6 and 11 are explicitly approved.
- **Forced-attention mechanics** — deferred to Phase 2.
- **B2B organizational accounts** — deferred to Phase 3.
- **Nationwide expansion** beyond FPT Da Nang — deferred to Phase 3.
- **Mobile native app** — web-first; responsive web serves mobile users.
- **Push notifications** — in-app + email only for v1.
- **Horizontal backend scaling** — single VPS sufficient for pilot. *(Amendment 2026-09-26: the pilot runs on one Google Compute Engine VM per Architecture AD-23.)*
- **Semantic LLM integrity scoring** — deferred until sufficient reviewed labels and governance approval exist.
- **Graph anomaly detection and personalized behavioral models** — deferred until evidence volume, utility, and fairness are demonstrated.
- **Graph database adoption** — deferred until measured query or scale requirements justify it.

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
- **SM-8**: **Assessment Coverage** — % of submitted Internal Form responses receiving an assessment or explicit recoverable `ASSESSMENT_PENDING` state. Target: ≥ 95%. Validates FR-59.
- **SM-9**: **Explainability Coverage** — % of completed assessments containing policy version, confidence, evidence coverage, and reason codes. Target: 100%. Validates FR-63.
- **SM-10**: **Integrity Review Turnaround** — Median time to resolve integrity reviews. Monitor before establishing an SLA. Validates FR-65.
- **SM-11**: **Review Overturn Rate** — % of engine review flags later confirmed as acceptable, segmented by policy version. Calibration metric; no initial target. Validates FR-64, FR-65.
- **SM-12**: **Cold-Start Outcomes** — Acceptance and review outcomes for `UNESTABLISHED` Respondents compared with established Respondents. Monitoring metric; no initial target. Validates FR-60.
- **SM-13**: **Survey Quality Coverage** — % of eligible Internal Form Versions with sufficient activity that receive a Survey Quality assessment. Target: 100%. Validates FR-62.
- **SM-14**: **Publisher Integrity Utility** — % of active Internal Form Publishers who inspect, filter, or export integrity metadata. Monitor before establishing a target. Validates FR-40, FR-41.

No accuracy target is declared until RESCOM has reviewed ground-truth labels. A low review rate is not evidence of high assessment quality.

**Counter-metrics (do not optimize)**

- **SM-C1**: **Moderation Queue Time** — Average time from publish to Admin approval. Should NOT be minimized at the expense of review quality. Counterbalances SM-3.
- **SM-C2**: **Points Inflation** — Total Points in circulation vs total active users. Rapid growth may indicate point farming. Counterbalances SM-6.
- **SM-C3**: **False Enforcement** — Responses automatically rejected by policies in `SHADOW` or `ADVISORY`. Target: 0. Counterbalances SM-11.
- **SM-C4**: **Cohort Disparity** — Material differences in review or rejection outcomes across eligible demographic/device cohorts. Monitor and investigate before enforcement expansion.
- **SM-C5**: **Missing-Evidence Penalty** — Assessments where missing evidence directly lowers the score. Target: 0.
- **SM-C6**: **Score Gaming** — Concentration immediately above operational thresholds. Monitor without publicly exposing raw thresholds.
- **SM-C7**: **Stranded Integrity Holds** — Authenticated `ENFORCED` rewards still held after `ACCEPT`, terminal assessment failure, expiry of the approved decision deadline, or expiry of the separately approved human-review deadline. Target: 0.

---

## 8. Open Questions

1. `[NOTE FOR PM — Owner: Product Manager; gate: before leaderboard story readiness]` **Leaderboard contract:** Is scope FPT Da Nang or platform-wide, which time windows apply, and how many users are displayed? No ranking-count default is approved.
2. `[NOTE FOR PM — Owner: Product Manager + Economy owner; gate: before survey-reopen story readiness]` **Survey reopen pricing:** Is the per-response price preserved or recalculated? Reopen implementation remains blocked until approved.
3. `[NOTE FOR PM — Owner: Product Manager + Economy owner; gate: before tier-benefit activation]` **Trusted Researcher pending time:** Does the tier reduce the External Form 48-hour Pending period, and to what duration? The default remains 48 hours.
4. `[NOTE FOR PM — Owner: Product Manager; gate: before Community Ambassador benefits]` **Community Ambassador privileges:** Which capabilities does the tier unlock? The default is badge-only.
5. `[NOTE FOR PM — Owner: Product Manager + Platform owner; gate: before AI generator launch testing]` **AI generation timeout:** What separate timeout and user recovery behavior apply? The capability remains optional and cannot block Form Builder.
6. `[NOTE FOR PM — Owner: Product Manager + Privacy/Legal reviewer; gate: before response-file export scope]` **Response data export:** Is basic Internal Form response export allowed in MVP, in which format, and under what field/access policy? The default is in-app viewing only.
7. `[NOTE FOR PM — Owner: Product Manager + Integrity Governance; gate: before promotion beyond SHADOW]` **Policy promotion:** Who approves transitions from `SHADOW` to `ADVISORY` and from `ADVISORY` to `ENFORCED`, and what calibration evidence is required?
8. `[NOTE FOR PM — Owner: Product Manager + Research Lead; gate: before Survey Quality is Publisher-visible]` **Survey Quality minimum evidence:** What minimum eligible response count is required before a Form Version receives a quality score?
9. `[NOTE FOR PM — Owner: Operations/Admin Lead; gate: before ADVISORY launch]` **Integrity review ownership:** Which role owns review, appeal, and maximum turnaround expectations during the pilot?
10. `[NOTE FOR PM — Owner: Product Manager + Privacy/Legal reviewer; gate: before production telemetry collection]` **Data retention:** How long are raw integrity events, derived signals, assessments, reviews, and reliability snapshots retained?
11. `[NOTE FOR PM — Owner: Product Manager; gate: before integrity export implementation]` **Publisher export:** Which assessment fields may be exported, and how should confidence and non-applicability be represented?
12. `[NOTE FOR PM — Owner: Product Manager + Integrity Governance; gate: before ENFORCED activation]` **Integrity decision deadline:** What maximum interval may an authenticated Internal reward remain in Integrity Hold without an `ACCEPT` or `REVIEW` decision before mandatory fail-open release and incident creation?
13. `[NOTE FOR PM — Owner: Product Manager + Privacy/Legal reviewer; gate: before targeting schema/story readiness]` **Additional targeting fields:** May Publishers target interests or income? The default is the FR-10 list only.
14. `[NOTE FOR PM — Owner: Security owner + Product Manager; gate: before Completion Code endpoint readiness]` **Failed-code policy:** What attempt limit, lock duration, recovery flow, and audit behavior apply? No three-attempt default is approved.
15. `[NOTE FOR PM — Owner: Product Manager + Research Lead; gate: before automated feed deprioritization]` **Negative-feedback threshold:** What evidence threshold, time window, and appeal/recovery behavior apply? Automated deprioritization stays disabled.
16. `[NOTE FOR PM — Owner: Security owner + Platform owner; gate: before production anti-abuse activation]` **Rate-limit policy:** What limits, scopes, administrative controls, and dependency-outage behavior apply? Limits are versioned centrally, not discretionary per-user settings.
17. `[NOTE FOR PM — Owner: Product Manager + Privacy/Legal reviewer; gate: before any production personal-data processing and separately before telemetry]` **Consent and subject rights:** Approve purpose/notice versions, consent withdrawal behavior, data classification/allowlist, retention/deletion/anonymization, access audit, and subject access/correction/deletion/export flows. Production processing stays disabled until qualified review evidence exists.
18. `[NOTE FOR PM — Owner: Product Manager + Integrity Governance + Economy owner + Operations/Admin Lead; gate: before ENFORCED activation]` **Review, rejection, and appeal settlement:** Approve the review deadline and safe fallback, rejection destination, sample-quota effect, appeal window, and compensating ledger behavior after an overturned decision. `ENFORCED` stays disabled until resolved.
19. `[NOTE FOR PM — Owner: Product Manager + Security owner + Privacy/Legal reviewer + Research Lead; gate: before any Guest Internal participation]` **Guest identity and abuse controls:** Approve participant identity/pseudonym scope, repeat-completion rule at logical Form level, consent/notice, rate limits, reward exclusion, subject-rights handling, and Survey Quality eligibility. Guest participation stays disabled until resolved.
20. `[NOTE FOR PM — Owner: Product Manager + UX owner; gate: before UI-heavy story readiness]` **Accessibility and content contract:** Approve the WCAG target, responsive breakpoints/state matrix, keyboard and screen-reader behavior, focus/error association, contrast, reduced motion, Vietnamese localization policy, and sensitive Integrity language. UI-heavy stories remain blocked until a canonical UX artifact defines them.
21. `[NOTE FOR PM — Owner: Product Manager + Research Lead; gate: before external publication or launch-business-case use]` **Vision evidence:** Validate or replace the historical “over 2 million” statement and 60.6%/76.0%/68.3% figures with a cited source, sample, date, population, and method. Until then, treat them as discovery hypotheses rather than validated market facts.
22. `[NOTE FOR PM — Owner: Product Manager + Platform owner + Operations/Admin Lead; gate: before release-test approval]` **Operational SLO profiles:** Define workloads, percentiles, measurement windows, data freshness for results/metrics/rankings, moderation pilot baseline, “normal load,” and “peak academic period.” Release testing cannot interpret the affected FR/NFR language until approved.
23. `[NOTE FOR PM — Owner: Product Manager + Economy owner; gate: before Story 12.8 readiness]` **Rewards economics:** Can unlocked starter Points be redeemed (default: yes)? Who funds codes and Flash discounts (bought from partners or sponsored), and is the 200 VNĐ rate sustainable? Confirm per-user limits (default 2 per voucher per 30 days, 500 Points per day), Flash quota reserved from stock with 1 unit per user, whether tier affects eligibility (default: no), and the BR-13 rule for a point price that deviates more than 20% from value ÷ 200 VNĐ. The planning default is second-Admin approval; with one pilot Admin, the proposed default is a warning plus an audit record.
24. `[NOTE FOR PM — Owner: Product Manager + Accounting/Legal reviewer; gate: before Rewards production enable (Story 12.11)]` **Rewards accounting and tax:** Redeemable top-up Points mean vouchers are effectively sold for top-up money. Confirm invoice, tax, and recipient-information obligations, and the Wallet wording that Points are never withdrawn as cash. This document is not legal advice.
25. `[NOTE FOR PM — Owner: Product Manager + Tech lead; gate: before Story 12.7 readiness]` **Code supply and usage:** Confirm CSV code import without partner API (default), code expiry at least 7 days after the redemption window, no refund for expired unused vouchers, faulty-code resolution within 1 business day, and self-marked "used" with 24-hour undo.
26. `[NOTE FOR PM — Owner: Tech lead; gate: before Story 12.8 readiness]` **Quote TTL:** Confirm the quote lifetime (default 5 minutes, capped at the Flash end).
27. `[NOTE FOR PM — Owner: Quan (Product Manager + Accounting/Legal reviewer); gate: before PayOS production enable]` **PayOS personal account terms:** Top-up money goes to a personal PayOS account and top-up Points can buy vouchers (see Open Question 24). Confirm PayOS fees, transaction limits, and terms for selling digital goods or Points from a personal account, plus the owner's tax obligations. PayOS documentation does not state these. This document is not legal advice.
28. `[NOTE FOR PM — Owner: Tech lead; gate: before FR-35 story readiness]` **PayOS late and wrong-amount payments:** PayOS documentation does not define behavior for payments after expiry or for a wrong amount. Decided 2026-10-15: late full-amount payments credit; wrong-amount payments are flagged for Admin credit-or-refund (FR-35). Remains open only to confirm against real PayOS behavior during production testing.

---

## 9. Assumptions Index

No unresolved inference is approved as an implementation default. Former assumptions are now explicit owner-bound Open Questions in §8; where safe, each question states the behavior that remains in force until approval.

---

## Cross-Cutting NFRs

### Performance
| ID | Requirement |
|----|------------|
| NFR-1 | API response target is <500ms under the named normal-load profile; percentile, workload, exclusions, and measurement window require Open Question 22 approval before release testing |
| NFR-2 | Survey Feed loads in < 2 seconds with ≤ 50 surveys |
| NFR-3 | Point transactions use ACID + row-level locking to prevent race conditions |
| NFR-4 | PostgreSQL remains authoritative for Time Barrier and other durable security state. A declared single-replica/no-Redis profile uses PostgreSQL durable abuse counters plus conservative local request limits and cannot scale to multiple replicas; a shared-Redis profile uses Redis request counters and fails closed on high-risk mutations if configured Redis is down |
| NFR-5 | AI Form Generation has a separate timeout (not subject to 500ms SLA) |

### Security
| ID | Requirement |
|----|------------|
| NFR-6 | Short-lived signed access JWT stored in a Secure HTTP-Only cookie and bound to a PostgreSQL-authoritative revocable session; refresh secrets rotate and single-session invalidation is server-enforced |
| NFR-7 | CORS, Helmet, @nestjs/throttler on all API endpoints |
| NFR-8 | Server-side authority: startTime, Completion Code generation, point calculations — never trust client |
| NFR-9 | All point transactions use ACID to ensure data consistency |
| NFR-10 | FraudLog is append-only — no delete, no update |
| NFR-31 | PayOS credentials stay server-side in secret configuration; payment confirmations are accepted only after signature verification and are never trusted from the client or redirect parameters |

### Reliability
| ID | Requirement |
|----|------------|
| NFR-11 | Point Ledger integrity: balance can never be duplicated or lost |
| NFR-12 | Auto-Refund background job runs on schedule for expired surveys |
| NFR-13 | Pending → Available auto-transfer runs on schedule (48h expiry) |
| NFR-14 | System uptime target is ≥99% during the named peak-academic profile; service boundary, exclusions, and measurement window require Open Question 22 approval before release testing |
| NFR-15 | AI failure must not impact core system (login, surveys, points, marketplace) |
| NFR-32 | A reconciliation job runs every 1 minute and checks every Processing top-up, and every top-up expired within the last 24 hours, against PayOS, so a lost or failed confirmation never leaves a paid top-up uncredited or an expired one open. A payment arriving later than that window is credited only through the PayOS confirmation (FR-35) |

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
| NFR-20 | UI-heavy story acceptance is gated on a canonical UX artifact defining responsive states, accessibility behavior, localization/content rules, and sensitive Integrity language; Open Question 20 owns the unresolved measurable target |
| NFR-21 | Survey creation follows a clear 3-step stepper flow |
| NFR-22 | CSAT target > 4.0/5.0 |

### Research Integrity and Data Governance
| ID | Requirement |
|----|------------|
| NFR-23 | Integrity telemetry ingestion is idempotent using a client event ID and server-side uniqueness enforcement |
| NFR-24 | Submitted responses remain durable when scoring is unavailable; assessment enters a recoverable pending state |
| NFR-25 | Scoring retries cannot duplicate assessments, reviews, notifications, Integrity Holds, releases, reversals, or other ledger actions |
| NFR-26 | Historical assessments are reproducible from preserved signals and immutable policy versions |
| NFR-27 | Initial deterministic assessment completes within 1–2 minutes under the named normal-load profile; workload, percentile, and measurement window require Open Question 22 approval before release testing |
| NFR-28 | Raw telemetry, sensitive integrity evidence, and review actions are role-restricted and access-audited |
| NFR-29 | Integrity Engine failure cannot affect authentication, Form rendering, response durability, or External Form flows |
| NFR-30 | Assessment, review, and reliability queries are paginated and do not load raw event streams into dashboards |

---

## Constraints and Guardrails

### Privacy & Data
- Demographic data is collected for Targeted Matching and, with disclosed purpose and appropriate access controls, integrity consistency assessment — never sold or shared externally
- Survey response data is used only for academic purposes with clear confidentiality commitments
- RESCOM is a survey distribution service, not a response seller
- Respondents receive clear notice of integrity purposes and collected interaction categories before eligible Internal Form participation
- Raw keystrokes, clipboard contents, unrelated browsing activity, and background device activity are prohibited
- Raw telemetry is never exposed to Publishers
- Consequential integrity decisions provide understandable reasons and access to review or appeal
- Production personal-data processing requires documented subject access, correction, deletion/anonymization, export, and consent-withdrawal flows with named owners and access auditing

### Integrity Data Governance
- Store Publisher-facing reason codes separately from restricted raw signals
- Use pseudonymous identifiers in aggregate integrity processing where possible
- Define retention periods separately for raw telemetry, derived signals, assessments, reviews, reliability snapshots, and research responses
- Record consent-notice version with each eligible attempt
- Require approved purpose and documented lineage before using integrity data for statistical or machine-learning training
- Preserve historical assessments for audit even when a newer policy produces a different result
- Keep integrity assessments distinct from FraudLog accusations and security enforcement
- Production integrity telemetry remains disabled until purpose and consent-notice versions, event-field allowlist/data minimization, classification, retention/deletion/anonymization, access audit, subject-rights flows, policy-promotion owner, review/appeal owner, and Survey Quality evidence threshold are approved

### Compliance
- Points are NOT positioned as currency — they can be acquired with money only through PayOS top-up (FR-34) and cannot be sold or transferred between accounts
- Points cannot be cashed out as money (one-way conversion only: VNĐ → Points); the sole exception is the Admin-executed refund of an unspent top-up within 24 hours (FR-77, FR-78)
- Production launch requires qualified Vietnamese privacy/legal review and documented compliance evidence; product and architecture documents do not by themselves establish legal compliance

### Cost
- AI runs on a private GPU server (gaming laptop via Tailscale VPN) — no cloud AI costs
  > **Amendment 2026-09-26 (sprint-change-proposal-2026-09-26):** Epic 3 is deferred to Phase 2; the pilot provisions no AI host. This cost line applies when the AI Form Generator ships.
- Pilot hosting uses a USD 300 / 90-day Google Cloud trial credit (estimated USD 40–60 per month); the topology stays portable so it can move to FPT Cloud or another provider without code changes (Architecture AD-23, Story 11.6).
- AI must remain an optional dependency with zero impact on core operations if unavailable

---

## Platform

- **Web application** — responsive design, no native mobile app for v1
- **Domain:** rescom.com.vn (main), api.rescom.com.vn (backend), survey.rescom.com.vn (public surveys)
- **Frontend:** Next.js + TypeScript → Vercel
- **Backend:** NestJS + Clean Architecture → Docker → VPS (4 vCPU / 16 GB RAM)
- **Database:** Managed PostgreSQL (Neon/Supabase) with Connection Pooling
- **File Storage:** S3-compatible Object Storage
- **AI:** Ollama + Qwen on private GPU, accessed via Tailscale VPN
- **CDN/Security:** Cloudflare (DNS, SSL, CDN, basic DDoS protection)

> **Amendment 2026-09-26 (sprint-change-proposal-2026-09-26) — pilot hosting selected (Architecture AD-23).** Supersedes the hosting lines above for the pilot; product requirements are unchanged.
> - **Domain:** `rescom.com.vn` (frontend, including public surveys at `/f/<id>`) and `api.rescom.com.vn` (backend); no separate `survey.` subdomain in the pilot.
> - **Frontend:** Next.js → Vercel, function region `sin1`.
> - **Backend:** NestJS → Docker Compose on one Google Compute Engine VM (`asia-southeast1`) with Caddy and ClamAV; one API replica with the scheduler co-located.
> - **Database:** Cloud SQL for PostgreSQL (`asia-southeast1`, private IP, automated backups + point-in-time recovery).
> - **File Storage:** private Google Cloud Storage bucket through the S3-compatible API.
> - **AI:** no AI host in Phase 1 (Epic 3 deferred).
> - **CDN/Security:** Cloudflare remains the only public ingress.
> - **Observability / CI/CD:** Sentry, external uptime monitor, GitHub Actions → GHCR.
