# PayOS update rubric review (2026-10-15)

Verdict: REVISE (no stale "manual top-up approved / no refunds" text remains; 6 substantive gaps below).

Stale grep: clean for "top-up approved", "pending top-up", "no refunds", 100 Points/20,000 VNĐ. Exceptions: line 1096 and Glossary line 193 (below).

## Findings
1. HIGH - FR-79 (prd.md ~624): "All pending manual top-up requests are cancelled at cutover" ignores users who already transferred bank money. No credit/refund path for those in-flight requests. Fix: require Admin to resolve (approve or refund) every pending manual request before PayOS enable, or notify with a refund route.
2. HIGH - FR-35 (~587) + OQ-28: payment confirmed after RESCOM marked the top-up Expired/Cancelled (5-minute boundary, clock skew, webhook lag) credits nothing, with no stated outcome for the user's money. Fix: if PayOS reports paid with time <= expiry, credit; otherwise define the Admin handling outcome (refund/credit) and notify the user. FR-77 only covers Successful top-ups, so there is no refund route today.
3. HIGH - FR-77/FR-78 (~607, 613-616): eligibility check and freeze are not specified as atomic with spending (race between refund freeze and voucher/publish spend). Also nothing stops Admin marking an ineligible (unfrozen) request Refunded, or a frozen amount exceeding the balance (balance reduced by non-spend debits), giving a negative balance. Fix: add consequences: check+freeze atomic with spend; Refunded permitted only on a frozen request (or must fail if Available < amount); balance never negative.
4. MEDIUM - "Frozen" overload: Glossary line 193 and FR-4/FR-5 (lines 244-279) define Frozen as starter Points ("Frozen Balance becomes 0" after onboarding or 30 days). Refund hold reuses Frozen (FR-77). Existing testable consequences conflict. FR-31 history types (line 539) also omit top-up/top-up-reversal. Fix: name it "Refund Hold" or amend the glossary/FR-4 wording and FR-31 type list.
5. MEDIUM - Line 1096 (RESCOM is NOT a money-making app): "Points can never be withdrawn as cash or converted back to money" is unamended and contradicts the new 24h refund exception (only lines 1100 and 1321 were updated). Fix: add the same exception.
6. MEDIUM - Untestable/open-ended: FR-35 "alerts the Admin if it keeps failing" (no threshold), NFR-32 "scheduled reconciliation" (no cadence/age bound), FR-77/78 frozen Points have no Admin SLA/auto-release so user funds can stay frozen indefinitely; FR-34 has no maximum amount or limit on concurrent Processing top-ups (double payment links; personal PayOS account limits per OQ-27). Fix: add numeric thresholds (e.g. reconcile every N min, alert after N attempts, Admin SLA reminder) and a max amount.

## Low
- Implementation leakage: FR-35 "one database transaction" (also UJ-5 "one atomic step"); say "all-or-nothing". NFR-31 "signature verification" is acceptable.
- FR-30: reversal ledger entry has no stated counter-account (double-entry); state it.
- FR-78 spending list includes "survey reopen" though the memlog decision names only voucher + publishing (consistent in spirit, record it).
- UJ-6 edge cases omit not-eligible and rejected paths.

## Checked OK
FR-56/FR-57 and line 873 notification list updated; UJ-3 step 1 consistent with FR-56; Non-Goals/MVP scope consistent; 24h window semantics consistent with memlog; Rewards FR-68 FraudLog 24h flag does not conflict; OQ-27/28 gated with owner; addendum §12 consistent with NFR-31/32.

## Re-review (after fixes)

Verdict: ACCEPT-WITH-RESERVATIONS. Findings 1-6 are resolved: FR-79 gate, FR-35 late/wrong-amount, FR-77/78 atomicity + Refunded-only-when-held + no-negative + reversal account, Refund Hold in Glossary/FR-31/§4.20/UJ-6 (FR-4 Frozen wording no longer collides), line 1106 exception, FR-34 max + single Processing, 30-min alert, 1-min reconciliation, 3-business-day SLA.

Remaining (all LOW):
- FR-78: an Admin who has already bank-refunded an ineligible (no hold) request cannot record it as Refunded; define the handling (e.g. note on Reject, or allow a manual-adjustment record).
- FR-77/78: eligible request but Available < top-up Points (non-spend debit such as an integrity reversal) - hold outcome unspecified; state "recorded Not eligible, nothing held".
- NFR-32 only reconciles top-ups expired within 24h; a later webhook still credits per FR-35, but state that a payment after 24h is webhook-only.
- FR-78 SLA of 3 business days has no stated breach behavior (reminder/alert); fine to leave, but untestable beyond a metric.
