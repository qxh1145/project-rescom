---
title: RESCOM PRD Reconciliation — Implementation Readiness 2026-08-16
created: 2026-08-16
updated: 2026-08-16
status: reconciliation-input
changeSignal: implementation-readiness-report-2026-08-16-rerun.md
---

# PRD Reconciliation: ENFORCED Reward Hold

## Input and authority handling

The change signal is `_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-16-rerun.md`, especially blocking issue 2. Under the adopted authority chain, the final PRD plus approved Addendum outrank `ARCHITECTURE-SPINE.md`; therefore AD-14 cannot silently override the current PRD. This narrow Update must amend the PRD/Addendum so that they explicitly ratify the already-adopted AD-14 reward path before downstream epic or schema work proceeds.

The reconciled boundary is limited to authenticated Internal Form rewards under the policy mode pinned at submission:

- `SHADOW` and `ADVISORY`: Economy idempotently credits Available without waiting for scoring.
- `ENFORCED`: Economy first posts the reward to a non-spendable Integrity Hold, before any assessment Decision.
- `ACCEPT`: releases that pre-existing hold to Available.
- `REVIEW`: retains that pre-existing hold; it does not create a later hold or claw back Available Points.
- Terminal assessment failure or expiry of the governance-approved no-decision deadline: an idempotent fail-open command releases the hold to Available and opens an incident.
- Review resolution produces one idempotent release or reversal command. Integrity never writes Ledger state directly.

Guest Internal submissions remain non-rewarded. External Forms remain on their existing 48-hour Pending path and remain `NOT_ASSESSED` by the full Integrity Engine.

## Reconciliation gaps

### 1. FR-29 currently promises Available credit before the ENFORCED decision

Conflicting wording in `prd.md`:

- Section 4.8 description (line 438): “Points are awarded immediately after automated validation”.
- FR-29 (line 468): “Valid internal form submissions credit Points to Available Balance immediately”.
- FR-29 consequence (line 475): “A separately approved `ENFORCED/REVIEW` outcome may place the reward in an integrity hold”.

Required correction: preserve the 1–2 minute immediate path only for `SHADOW`/`ADVISORY`. For an authenticated submission pinned to `ENFORCED`, require the first Economy posting to go to Integrity Hold before Decision. State explicitly that Internal Forms never use the External Pending balance, while “immediate” does not mean “immediately spendable” in `ENFORCED`.

### 2. FR-64 assigns hold creation to the later `REVIEW` outcome

Conflicting wording in `prd.md` line 868: “`REVIEW` creates an integrity hold without declaring fraud.”

Required correction: `ENFORCED` creates the hold before Decision; `ACCEPT` releases it and `REVIEW` retains it. Add the terminal-failure/no-decision fail-open release and incident rule, and state that later policy promotion cannot reroute a response whose policy deployment/mode was pinned at submission. Keep automatic rejection separately authorized and audited.

### 3. Related narrative and technical-handoff wording must change with FR-29/FR-64

The same semantic correction is required in:

- UJ-2 step 3 (`prd.md` line 88), so the Respondent journey exposes Available versus Integrity Hold behavior under the pinned mode.
- The `Pending Balance` glossary entry (`prd.md` line 165), which currently says all Internal Forms “pay instantly”; clarify that Internal rewards do not use Pending, but an `ENFORCED` reward is initially non-spendable.
- A new or expanded `Integrity Hold` glossary entry, defining it as an Economy-owned, non-spendable Ledger account/state rather than an Integrity record.
- The section 4.8 description and FR-29 title/wording, while retaining the stable FR-29 ID.
- FR-65 (`prd.md` line 878), so review reward actions operate on the pre-existing hold through idempotent Economy commands; no Integrity component writes Ledger rows.
- The MVP Point System/Integrity Review bullets (`prd.md` lines 936 and 950), replacing the blanket “Instant (internal)” shorthand with the two policy-mode paths.
- Addendum section 3, “Progressive Enforcement” (`addendum.md` lines 80–85), which is currently silent about pre-hold timing. It must mirror pre-hold, release/retain, fail-open, idempotency, and Economy ownership so the approved technical handoff cannot be implemented differently from the PRD.

NFR-25 is already directionally compatible because it prohibits duplicate Ledger effects on scoring retries; it should be cross-referenced by the revised requirements rather than replaced.

### 4. The no-decision deadline remains an explicit gate

AD-14 prevents stranded holds by requiring fail-open after a governance-approved processing deadline, but the PRD has no duration decision. Extend Open Question 7 or add an adjacent gate, owned by Product Manager + Integrity Governance and required before promotion to `ENFORCED`, to decide the maximum assessment/no-decision duration. Do not invent a duration during this Update.

The existing memlog entry about ENFORCED review hold is not historical authority for the timing detail. Preserve it and append a new decision/change event through BMAD `memlog.py` when the PRD is amended; do not rewrite memlog history.

## Explicitly out of scope for this narrow Update

- The other readiness blockers: source-control reproducibility, missing UX artifact, epic resequencing/coverage, foundation stories, and schema-contract redesign.
- Reviewer schema findings for OAuth identity, required FormVersion relations, separate FraudLog, Outbox leasing/fencing/deduplication, assessment applicability, Guest participant identity, append-only Reliability snapshots, and telemetry client-event identity.
- Any Prisma edit, migration, application change, package install, or new runtime implementation.
- Changes to External Pending/dispute/FraudLog behavior, Guest reward eligibility, SHADOW/ADVISORY immediate Available credit, automatic-rejection authorization, or the existing privacy/legal/policy-promotion gates except the added no-decision deadline detail.
- Choosing a specific enforcement deadline, queue technology, worker library, Ledger schema, or review outcome policy beyond the ratified product contract above.

This reconciliation removes one PRD-level semantic blocker only. It does not change the readiness verdict or authorize feature implementation/migration until the remaining blockers are resolved and readiness is rerun.
