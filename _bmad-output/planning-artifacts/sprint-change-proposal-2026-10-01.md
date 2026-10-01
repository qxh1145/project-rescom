# Sprint Change Proposal: Epic IR backlog reconciliation (2026-10-01)

- **Author:** Quan (with the Developer agent, Correct Course workflow)
- **Mode:** Incremental. Proposals 1–5 were approved one by one.
- **Scope classification:** Moderate (backlog reorganization; no replan)

## 1. Issue Summary

On 2026-10-01 the "mock-off" work (`.omc/plans/mock-off-full-backend.md` and `mock-off-phase2-7-execution.md`, Phases 0–7 plus gate G hybrid) built the backend the frontend needs to run without MSW. It was committed in `3e9c69e` (654 files, 9 migrations up to `20261001120800`). The work used OMC plans instead of the BMAD story flow. As a result:

- `sprint-status.yaml` and the four gap-closing story files (IR.2a, IR.2b, IR.4a, IR.4b) still said `ready-for-dev`, although their code is in place. Running `bmad-dev-story` on them would rebuild existing work.
- Binding owner decisions for internal testing ("no screen is hidden", export open, hybrid mocking, `0` placeholder queue counts) override some acceptance criteria. No BMAD document recorded them.
- Scope was built without any story: auth throttle made configurable, S3 checksum fix, runner file_upload, integrity consent, survey topic, QUOTA auto-close, forgot/reset password, session revoke reason, admin fraud-log, ledger and outbox views.
- The real-stack smoke and gate G runs turned up follow-ups that existed only in session memory.

The findings of the readiness review (throttle, S3 checksum, file_upload) were already fixed in code. This change reconciles only the tracking documents.

**Evidence:**
- Full verify 2026-10-01: schemas 615, backend unit 2224, e2e 431 incl. Postgres suites, FE 744; typecheck and lint clean.
- rescom_db migrated, and the real-stack API smoke passed.
- Gate G journeys passed: admin 8/8 pages; respondent In-Rescom and Google Forms flows; scheduler pending-release after a 48 h backdate.
- Two read-only AC audits (2026-10-01): no AC is NOT MET.

## 2. Impact Analysis

- **Epic IR:** can still be completed. IR.2a/2b/4a/4b move to `review`. The gates IR.2/3/4 move to `in-progress`, because the journeys work but formal or automated gate evidence is missing. IR.1 stays `backlog`, and its scope narrows to re-gating the internal-testing overrides for the pilot.
- **Epic 11 and the deferred Phase 2 epics:** no impact. No deferred scope is marked complete; it is mock-served in hybrid mode only.
- **PRD:** no conflict.
- **Architecture:** one accepted deviation (§4.5).
- **UX:** none.
- **Technical:** no code change in this proposal.

### AC audit summary

| Story | Status | Remaining before `done` | Deliberate overrides |
|---|---|---|---|
| IR.2a | AC1–AC7 MET | http-exception.filter spec cases for 3 new errors; `MarketplaceService.getFeed` to use `resolveEstimatedEffortSeconds` | none |
| IR.2b | AC1–AC6 MET; AC7–AC8 evidence partial | in-memory `test/scheduler.e2e-spec.ts` (Task 11.3); confirm the old storage-cleanup `setInterval` is removed | none |
| IR.4a | AC1–AC6, AC9 MET; AC8/AC10 partly verified | frontend cut-over checks (quality filter removed, MSW owner-only 404) | AC0/AC5.2/AC7: export, quality, complaints, version diff reachable |
| IR.4b | A, B, C mostly MET | e2e evidence for profile/admin reads | C3/C4 `0` placeholders; C7 nav filter not built; B5 transaction boundary (§4.5) |

## 3. Recommended Approach

**Direct Adjustment.** Update tracking and documents to match the code. Then run one `bmad-code-review` on the combined IR scope, which serves as the project's single BMAD review pass, and close the small gaps above. Rollback is not viable, because the work is verified and in use. An MVP review is not needed.

- **Effort:** Low.
- **Risk:** Low.
- **Timeline:** no slip; this removes the risk of duplicate implementation.

## 4. Detailed Change Proposals (all approved)

### 4.1 `sprint-status.yaml`
- `ir-2a`, `ir-2b`, `ir-4a`, `ir-4b`: `ready-for-dev` → `review`.
- `ir-2`, `ir-3`, `ir-4`: `backlog` → `in-progress`.
- `ir-1`, `ir-5`, `ir-6`: unchanged (`backlog`).

### 4.2 Story files (IR.2a, IR.2b, IR.4a, IR.4b)
- Status → `review`.
- Each Dev Agent Record gets Completion Notes: implemented outside the story flow in `3e9c69e`, the AC audit table, open questions as the code resolved them, evidence, items left before `done`, and the deliberate overrides.
- Task boxes stay unticked on purpose. Ticking them after the fact would claim more checking than was done.

### 4.3 `epics.md`, Epic IR
- Add the "Internal-testing milestone (2026-10-01)" note after the dependencies list. It covers the hybrid mode, the overrides, the work built without a story, and the pilot re-gate requirement.
- IR.1 gets one added criterion: the internal-testing overrides are each re-decided for the pilot.
- The IR.4a and IR.4b acceptance criteria stay as the pilot target. They are not rewritten.

### 4.4 `deferred-work.md`
New section "Deferred from: mock-off real-stack smoke and gate G (2026-10-01)", all low severity:
- a cancelled attempt leaves its Response IN_PROGRESS (by design);
- lock then unlock within ~30 s skips the lock email;
- seeded surveys have topic = null;
- the wallet history badge stays "Chờ duyệt" after release;
- the hybrid quality mock shows ENOUGH_DATA for a pending Google Forms survey;
- the admin review panel is cramped at ~800 px;
- notification bodies are English (reminder of E9-D2).

### 4.5 Architecture deviation: ACCEPTED
IR.4b B5: the email handler commits `SENT` separately from `processed_handlers`. A replay that finds `SENT` or `UNCONFIRMED` does not resend, and an ambiguous send needs operator resolution. Accepted because an external email send cannot be atomic with a database transaction. This deviates from the IR.2b AC6 rule "effect commits atomically with its `ProcessedHandler` record" for the email handler only. No architecture file was edited; an architecture decision record is optional (bmad-agent-architect).

## 5. Implementation Handoff

- **Scope:** Moderate. Owner: Developer agent, for the documentation edits and the gap closure.
- **Next steps:**
  1. Apply §4.1–§4.4. This is done by this workflow.
  2. Run `bmad-code-review` on the IR.2a/2b/4a/4b scope (commit `3e9c69e`), in a fresh context.
  3. Close the "remaining before done" items in §2, then mark the four stories `done`.
  4. Produce formal evidence for gates IR.2, IR.3 and IR.4: a G2 record, and automated failure-case evidence for the respondent, publisher and admin journeys.
  5. Before the pilot, use IR.1 to re-gate the internal-testing overrides (hide deferred screens, close export, staging mocking `disabled`).
- **Success criteria:**
  - Sprint status matches the code.
  - No story is re-implemented.
  - Every override and every piece of work built without a story is traceable from `epics.md`.
  - The four stories reach `done` through one BMAD review pass.
