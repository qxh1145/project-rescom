# Adversarial review: AD-25 / AD-26 (PayOS top-up + refund hold)
Date 2026-10-15. Scope: AD-25, AD-26, workflow-map rows, Economy ownership row; inherited AD-1/10/16/17/24. Spine read-only.
**Verdict: REVISE.** Two Critical, three High, eight Medium, two Low. Nothing is invented; each hole is a pair of units that each obey every AD yet collide.

## CRITICAL

### C1. Three credit commands, three idempotency keys, no once-per-top-up guard (double credit)
Pair: `ApproveTopUp` (`topup-approval:{id}`, legacy) vs `CreditTopUp` (`topup-credit:{id}`) vs `ResolveTopUpMismatch` credit (`topup-mismatch:{id}`).
Scenario: a PAYOS row is paid; flag is off during a rollback, or an admin calls the manual endpoint with that id. Approve posts `SYSTEM_CLEARING -> USER_AVAILABLE` under its key. The webhook/reconcile then posts under a different key. Both journals are legal under AD-1 (unique key per journal, balanced). Same for MISMATCH: admin credits `floor(paid/200)`, a reconcile/webhook race then credits full.
Why ADs allow: AD-1 uniqueness is per command reference, AD-25 says "second caller is a no-op" only for the same key. "One outcome per top-up" is stated for mismatch only, with no mechanism. Nothing says `ApproveTopUp` is channel-scoped.
Fix: add to AD-25: "Every command that credits a top-up (`ApproveTopUp`, `CreditTopUp`, `ResolveTopUpMismatch`) first performs a conditional update `UPDATE TopUpRequest SET status=... WHERE id=? AND status IN (<allowed from-states>) AND channel=<own channel>`, 0 rows = no-op, and stores `creditJournalId` under a UNIQUE constraint. At most one credit journal per top-up, enforced by the database." `ApproveTopUp` must require `channel='MANUAL'`.

### C2. "Spend journal" is undefined, so the refund-after-use check is bypassable
Pair: `SubmitTopUpRefund` vs `ReserveEscrow` (publish form) / `RefundUnusedEscrow` / `ReverseJournal` of a redemption / ENFORCED-hold and dispute-hold flows.
AD-26: "the user's ledger has no spend journal since the top-up". AD-24 names only `SpendPoints` (`USER_AVAILABLE -> SYSTEM_SINK`) as spend. Survey publish moves Available to Escrow, a different journal type. Top up, publish a survey (escrow), close the form (`RefundUnusedEscrow` returns Points to Available), then submit refund: no `SpendPoints` since the top-up, Available >= Points, so cash refund AND the service value was consumed. Reverse case: a spend later reversed by the Rewards refund is counted as spend or not depending on the implementer.
Fix: replace with "spend = any journal posted after the top-up credit journal (compare ledger sequence, not timestamps) that debits the user's `USER_AVAILABLE` for any counter-account other than the top-up's own `REFUND_HOLD`; reversal journals do not cancel a spend. Equivalent, simpler test: user has no `USER_AVAILABLE` debit entry with journal sequence > credit journal sequence." Name Escrow, Hold and Sink counterparts explicitly.

## HIGH

### H1. Concurrent `CreditTopUp` (webhook + reconcile) and lock order are not specified
AD-25 says "second caller is a no-op" but not how. Two transactions pass an unlocked `status=PROCESSING` read; the loser hits the unique journal key and either throws (webhook returns 5xx, payOS retries or may disable the webhook) or double-writes provider facts. Lock order for the `TopUpRequest` row vs ledger accounts is undefined (AD-24 order covers Rewards rows only): `CreditTopUp`/`ResolveTopUpMismatch` can go topup-row -> accounts while `SubmitTopUpRefund` goes accounts -> topup-row (needs status/age), and `ResolveTopUpRefund` goes refund-row -> accounts. Different rows today, but one cycle appears as soon as a story reads the top-up under lock after taking accounts.
Fix: "`CreditTopUp` locks the TopUpRequest row `FOR UPDATE` (or uses the CAS in C1), re-checks status inside the transaction, returns success (no 5xx) on already-credited. Global lock order for Economy: TopUpRequest -> TopUpRefundRequest -> ledger accounts ascending id. `SubmitTopUpRefund` locks the TopUpRequest row before the accounts."

### H2. `PAYOS_ENABLED` flip vs in-flight and vs manual PENDING (check-then-act, stranded rows, dead webhook)
Scenarios: (a) manual request created at the instant checkout checks "no MANUAL PENDING": app-level check, no constraint, so both exist; manual endpoints now off, row stranded. (b) flag flipped back off (rollback): AD does not say webhook, reconcile, mismatch/refund commands keep running; if gated, paid users with PROCESSING rows lose credit. (c) in-flight manual approve commits after the flip.
Fix: "The flag gates only checkout creation and manual create/approve. Webhook, reconcile, `CreditTopUp`, mismatch and refund commands are never flag-gated. Flag is read inside the same transaction as the PENDING/PROCESSING write; enabling requires a DB-level guard (partial unique/exclusion or `SELECT ... FOR UPDATE` on a per-user row) that forbids PROCESSING and MANUAL PENDING for one user. A MANUAL PENDING row that exists after flip is approvable by Admin until FR-79 completes."

### H3. "Linked to the original top-up journal" collides with AD-1 reversal
`REFUNDED` posts `REFUND_HOLD -> SYSTEM_CLEARING` "linked" to the top-up journal. AD-1 reversal means exact negation with unique `reversesJournalId`; the refund journal is not an exact negation (debits REFUND_HOLD, not USER_AVAILABLE). Two implementers: one stores it in `reversesJournalId` (AD-1 validation rejects it, or it consumes the single reversal and a later `ReverseJournal` is blocked), the other uses a new column. Also nothing forbids Admin `ReverseJournal` on the top-up journal in parallel with a refund request: both claw back, user loses Points twice.
Fix: "Refund resolution uses its own `refundsJournalId` (unique), never `reversesJournalId`. `ReverseJournal` is forbidden on top-up credit journals; a top-up with a refund request in any state or a mismatch outcome cannot be reversed."

## MEDIUM
- M1. 24h age basis undefined (`createdAt`, `paidAt`, credit time?). Late-credited row via reconcile may be born ineligible or eligible. Fix: age = credit journal `postedAt`; server clock only.
- M2. `AMOUNT_MISMATCH` resolution leaves status/Points shape open: credited `floor(paid/200)` contradicts "Points always equal `amountVnd/200`", refund eligibility requires `SUCCESSFUL`. Fix: add terminal states `MISMATCH_CREDITED`/`MISMATCH_REFUNDED`, a stored `creditedPoints`, and state whether such rows are refund-eligible (recommend not).
- M3. Provider facts not write-once, and no rule for a verified event on a terminal row with different amount (SUCCESSFUL -> AMOUNT_MISMATCH would hide credited Points). Fix: facts write-once; transitions out of SUCCESSFUL/terminal forbidden; differing later facts raise an Admin alert only.
- M4. Reconcile window is 24h after EXPIRED/CANCELLED while payOS cancel is best-effort. Webhook lost + cancel failed + link alive >24h = paid, never credited. Same for create-timeout rows marked `CANCELLED` with null `paymentLinkId` (lookup key ambiguous: spec says `{id}`, orderCode lookup unstated). Fix: keep checking until provider confirms cancelled/expired, or paid; look up by orderCode.
- M5. "Alert when uncredited 30 min after `paidAt`": `paidAt` is committed only with the credit, so on webhook failure it is unknown. Alert is unobservable if reconcile GET also fails. Fix: also alert on PROCESSING rows past `expiresAt + X` with no successful provider GET.
- M6. `REFUND_HOLD` shape unspecified: per-user vs one system account, non-negative class, Wallet projection treatment (shown as held?), and which gates apply. AD-24 reads FraudLog/eligibility flags; `SubmitTopUpRefund` has none, so a flagged/suspended user or one with a pending dispute/Integrity hold can drain Available via refund and dodge clawback. Fix: per-user, non-negative class, wallet shows "held for refund"; state refund policy for suspended/flagged users explicitly.
- M7. No sandbox + sequential `orderCode`: dev/staging DBs have independent sequences overlapping prod's; if any environment shares the payOS channel (one webhook URL per channel), a signed webhook can match the wrong prod row. AD-17 isolation of secrets mitigates but does not state a separate payOS channel. Fix: separate payOS channel per environment, plus orderCode check against `amount` and `paymentLinkId`.
- M8. "Any failure returns 5xx": unknown `orderCode` or payOS confirm-webhook test ping would 5xx forever. Fix: signature-valid but unknown/unmatched -> 200 plus alert; 5xx only for retryable internal failure.

## LOW
- L1. Nothing constrains `amountVnd % 200 == 0` at checkout; `floor` appears only in mismatch path. Add CHECK.
- L2. payOS status enum / partial-payment behaviour is an open dependency (already noted in Open Questions); the "full-amount wins" rule cannot be tested until closed.

## Specific checks asked
- Concurrent webhook+reconcile: unresolved, see H1 and C1.
- Mismatch then second payment: second payment is a new row (MISMATCH is not PROCESSING), safe; only risk is overwrite of facts (M3) and resolve-vs-credit double path (C1).
- Refund submitted, late duplicate webhook: journal key makes it a no-op, safe, provided the no-op path returns 200 (H1) and does not touch status (M3).
- REFUND_HOLD vs other holds: separate account so spend checks on Available are unaffected; gating gap in M6.
- Spend definition: C2.
- Expiry vs webhook: handled by "paid wins", acceptable once CAS in C1 exists.
