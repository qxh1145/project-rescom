import type { LedgerAccountClass, WalletTransactionItemDto } from "@rescom/schemas";

/**
 * Pure reward / starter-points rules of the MSW economy mock (no MSW, no
 * storage), unit-tested in `tests/participation-review.test.mjs` and
 * `tests/wallet-history.test.mjs` (ledger shape). `economy.ts` loads and
 * saves the per-user state around them.
 *
 * Backend behaviour mirrored (FR-24, Story 7.2, decision E7-DN2):
 * - an in-Rescom reward is confirmed at once (Khả dụng) and may unlock the
 *   frozen starter points;
 * - a Google Forms reward waits 48h in Chờ duyệt and unlocks nothing until
 *   that review window closes (`PENDING_CONFIRMATION`);
 * - the unlock moves exactly the frozen amount.
 */

export type MockTransactionKind =
  | "STARTER_GRANT" // "Điểm khởi đầu" · Đóng băng
  | "STARTER_UNLOCK" // "Mở khoá điểm khởi đầu" · Đóng băng → Khả dụng
  | "SURVEY_REWARD" // "Thưởng khảo sát"
  // Publisher side of a reward drawn from the survey escrow ("Trả thưởng khảo sát", `payRewardFromEscrow`).
  | "SURVEY_PAYOUT"
  | "REWARD_RELEASE" // "Điểm chờ duyệt đã mở" · Chờ duyệt → Khả dụng (`release-pending:` journal)
  | "TOP_UP" // "Nạp điểm"
  | "SURVEY_ESCROW" // "Ký quỹ khảo sát" (publisher spend)
  | "ESCROW_REFUND" // "Hoàn ký quỹ"
  // Phase 6 admin disputes: `dispute-resolution:{caseId}:refund|release` (see `dispute` below).
  | "DISPUTE_RESOLUTION"
  // Phase 6 admin "Xét chất lượng" (17b, `settleHeldReward`): the held reward is `rewardRowId`.
  | "INTEGRITY_RELEASE" // Đang giữ → Khả dụng (`integrity-decision:` journal)
  | "INTEGRITY_REVERSAL"; // Admin reversal of the `integrity-hold:` journal (Đang giữ −N)

export type MockTransactionStatus = "FROZEN" | "PENDING" | "AVAILABLE" | "HELD" | "ESCROW" | "REVERSED";

export interface MockTransaction {
  id: string;
  kind: MockTransactionKind;
  /** Signed points (+ received, − spent). */
  amount: number;
  status: MockTransactionStatus;
  /** Survey title or free note ("Tài khoản mới"). */
  note: string;
  surveyId: string | null;
  attemptId: string | null;
  createdAt: string;
  /** PENDING rows: when they move to AVAILABLE (48h review, Figma "còn 31 giờ"). */
  releasesAt: string | null;
  /** REWARD_RELEASE rows: id of the SURVEY_REWARD row whose 48h review it ended. */
  rewardRowId?: string;
  /**
   * DISPUTE_RESOLUTION rows (Phase 6, `mocks/data/admin-disputes.ts`): the case
   * and the backend action. `refund` + positive amount = the publisher's side
   * (credited to Khả dụng), negative = the respondent's held points taken back;
   * `release` = Đang giữ → Khả dụng for the respondent.
   */
  dispute?: { caseId: string; action: "refund" | "release" };
}

export interface MockWalletBalances {
  available: number;
  pending: number;
  escrow: number;
  frozen: number;
  integrityHold: number;
}

/** One user's wallet + history (newest row first), mutated in place. */
export interface EconomyState {
  wallet: MockWalletBalances;
  rows: MockTransaction[];
}

export interface RuleContext {
  now: number;
  newId: () => string;
}

/** FR-24: External completions stay in Chờ duyệt for 48 hours. */
export const PENDING_REVIEW_MS = 48 * 3_600_000;

function addRow(state: EconomyState, ctx: RuleContext, row: Omit<MockTransaction, "id" | "createdAt">): MockTransaction {
  const full: MockTransaction = { ...row, id: ctx.newId(), createdAt: new Date(ctx.now).toISOString() };
  state.rows.unshift(full);
  return full;
}

/** Moves the whole frozen starter balance to Khả dụng once. Returns whether it unlocked. */
function unlockStarterPoints(state: EconomyState, ctx: RuleContext, attemptId: string | null): boolean {
  const frozen = state.wallet.frozen;
  if (frozen <= 0 || state.rows.some((row) => row.kind === "STARTER_UNLOCK")) return false;
  state.wallet.available += frozen;
  state.wallet.frozen = 0;
  addRow(state, ctx, {
    kind: "STARTER_UNLOCK",
    amount: frozen,
    status: "AVAILABLE",
    note: "Đóng băng → Khả dụng sau khảo sát đầu tiên",
    surveyId: null,
    // The attempt whose confirmed reward triggered the unlock (read by `rewardOutcomeOf`).
    attemptId,
    releasesAt: null,
  });
  return true;
}

/**
 * Credits a survey reward. `pending` (Google Forms) goes to Chờ duyệt for 48h
 * and does not unlock the starter points; an available reward does.
 */
export function creditReward(
  state: EconomyState,
  ctx: RuleContext,
  input: { amount: number; pending: boolean; surveyId: string; attemptId: string; title: string },
): { activated: boolean } {
  addRow(state, ctx, {
    kind: "SURVEY_REWARD",
    amount: input.amount,
    status: input.pending ? "PENDING" : "AVAILABLE",
    note: input.title,
    surveyId: input.surveyId,
    attemptId: input.attemptId,
    releasesAt: input.pending ? new Date(ctx.now + PENDING_REVIEW_MS).toISOString() : null,
  });
  if (input.pending) {
    state.wallet.pending += input.amount;
    return { activated: false };
  }
  state.wallet.available += input.amount;
  return { activated: unlockStarterPoints(state, ctx, input.attemptId) };
}

/**
 * Publisher side of a confirmed reward paid from a survey's escrow (Phase 6
 * admin "Cộng điểm" on a missing-code report, `mocks/data/admin-disputes.ts`):
 * Ký quỹ −N, posted under the respondent credit's `internal-reward:{attemptId}`
 * journal, so `/wallet` shows "Trả thưởng khảo sát". Throws
 * `INSUFFICIENT_BALANCE` when the escrow is short (nothing changes then).
 */
export function payRewardFromEscrow(
  state: EconomyState,
  ctx: RuleContext,
  input: { amount: number; surveyId: string; attemptId: string; title: string },
): MockTransaction {
  if (input.amount <= 0) throw new Error("Payout amount must be positive");
  if (state.wallet.escrow < input.amount) throw new Error("INSUFFICIENT_BALANCE");
  state.wallet.escrow -= input.amount;
  return addRow(state, ctx, {
    kind: "SURVEY_PAYOUT",
    amount: -input.amount,
    status: "ESCROW",
    note: input.title,
    surveyId: input.surveyId,
    attemptId: input.attemptId,
    releasesAt: null,
  });
}

/**
 * Ends the 48h review of every pending reward whose `releasesAt` passed
 * (`releaseAll`: MOCK-ONLY `?msw=release-pending` ends them all now): Chờ
 * duyệt → Khả dụng, then the first confirmed reward unlocks the starter points.
 */
export function releaseDueRewards(
  state: EconomyState,
  ctx: RuleContext,
  releaseAll = false,
): { released: number; activated: boolean } {
  const due = state.rows
    .filter(
      (row) =>
        row.kind === "SURVEY_REWARD" &&
        row.status === "PENDING" &&
        (releaseAll || (row.releasesAt !== null && Date.parse(row.releasesAt) <= ctx.now)),
    )
    // Oldest first: it is the one that activates the account.
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const row of due) {
    // The reward row reports where the points are now (`rewardOutcomeOf` → SETTLED);
    // the ledger keeps its original Chờ duyệt credit and adds the release journal
    // (backend `release-pending:{attemptId}`, see `ledgerItemsFromRows`).
    row.status = "AVAILABLE";
    row.releasesAt = null;
    state.wallet.pending = Math.max(0, state.wallet.pending - row.amount);
    state.wallet.available += row.amount;
    addRow(state, ctx, {
      kind: "REWARD_RELEASE",
      amount: row.amount,
      status: "AVAILABLE",
      note: row.note,
      surveyId: row.surveyId,
      attemptId: row.attemptId,
      releasesAt: null,
      rewardRowId: row.id,
    });
  }
  const activated = due.length > 0 ? unlockStarterPoints(state, ctx, due[0].attemptId) : false;
  return { released: due.length, activated };
}

/** A confirmed Marketplace reward exists (counts for activation). */
export function hasConfirmedReward(rows: readonly MockTransaction[]): boolean {
  return rows.some((row) => row.kind === "SURVEY_REWARD" && row.status === "AVAILABLE" && row.amount > 0);
}

/** The oldest reward still in its 48h review (drives `PENDING_CONFIRMATION`). */
export function pendingActivationReward(rows: readonly MockTransaction[]): MockTransaction | null {
  const pending = rows
    .filter((row) => row.kind === "SURVEY_REWARD" && row.status === "PENDING" && row.amount > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return pending[0] ?? null;
}

export type MockLedgerItem = WalletTransactionItemDto & { surveyTitle: string | null };

/** Reference of a reward's `external-completion:` / `release-pending:` keys (attempt id, else the row id). */
function rewardRefOf(row: MockTransaction): string {
  return row.attemptId ?? row.rewardRowId ?? row.id;
}

/** `[accountClass, signed amount]` pairs posted on the user's own accounts. */
function entriesOf(row: MockTransaction, postedAsPending: boolean): Array<[LedgerAccountClass, number]> {
  const amount = Math.abs(row.amount);
  switch (row.kind) {
    case "STARTER_GRANT":
      return [["FROZEN", amount]];
    case "STARTER_UNLOCK":
      return [
        ["FROZEN", -amount],
        ["USER_AVAILABLE", amount],
      ];
    case "SURVEY_REWARD":
      if (row.status === "PENDING" || postedAsPending) return [["PENDING", amount]];
      if (row.status === "HELD") return [["INTEGRITY_HOLD", amount]];
      return [["USER_AVAILABLE", amount]];
    case "REWARD_RELEASE":
      return [
        ["PENDING", -amount],
        ["USER_AVAILABLE", amount],
      ];
    case "SURVEY_PAYOUT":
      return [["ESCROW", -amount]];
    case "TOP_UP":
      return [["USER_AVAILABLE", amount]];
    case "SURVEY_ESCROW":
      return [
        ["USER_AVAILABLE", -amount],
        ["ESCROW", amount],
      ];
    case "ESCROW_REFUND":
      return [
        ["ESCROW", -amount],
        ["USER_AVAILABLE", amount],
      ];
    case "DISPUTE_RESOLUTION":
      if (row.dispute?.action === "release") {
        return [
          ["INTEGRITY_HOLD", -amount],
          ["USER_AVAILABLE", amount],
        ];
      }
      // Backend `resolveDisputeHold` (refund): respondent INTEGRITY_HOLD −N → publisher
      // USER_AVAILABLE +N, one journal; each user's rows carry their own side.
      return row.amount < 0 ? [["INTEGRITY_HOLD", -amount]] : [["USER_AVAILABLE", amount]];
    case "INTEGRITY_RELEASE":
      return [
        ["INTEGRITY_HOLD", -amount],
        ["USER_AVAILABLE", amount],
      ];
    case "INTEGRITY_REVERSAL":
      // The publisher's Ký quỹ side of the reversal is not on the respondent's accounts.
      return [["INTEGRITY_HOLD", -amount]];
  }
}

/** Journal key + description the backend writes for each operation (`ledger.service.ts`). */
function journalOf(userId: string, row: MockTransaction, postedAsPending: boolean): { key: string; description: string } {
  const ref = rewardRefOf(row);
  switch (row.kind) {
    case "STARTER_GRANT":
      return { key: `starter-grant:${userId}`, description: `Starter points grant: ${userId}` };
    case "STARTER_UNLOCK":
      return { key: `starter-unlock:${userId}`, description: `Starter points onboarding unlock: ${userId}` };
    case "SURVEY_REWARD":
      if (row.status === "PENDING" || postedAsPending) {
        return { key: `external-completion:${ref}`, description: `Pending survey reward for external completion: ${ref}` };
      }
      if (row.status === "HELD") return { key: `integrity-hold:${ref}`, description: `Integrity hold: ${ref}` };
      return { key: `internal-reward:${ref}`, description: `Internal survey reward: ${ref}` };
    case "REWARD_RELEASE":
      return { key: `release-pending:${ref}`, description: `Matured pending survey reward release: ${ref}` };
    case "SURVEY_PAYOUT":
      // Same journal as the respondent's confirmed credit (`creditReward` with `pending: false`).
      return { key: `internal-reward:${ref}`, description: `Internal survey reward: ${ref}` };
    case "TOP_UP":
      return {
        key: `topup-approval:${row.id}`,
        description: `Manual top-up approval: ${row.note} (${Math.abs(row.amount)} points)`,
      };
    case "SURVEY_ESCROW":
      return { key: `publish:${row.id}`, description: `Escrow lock for survey publish: ${row.note}` };
    case "ESCROW_REFUND":
      return { key: `close-refund:${row.id}`, description: `Escrow refund on survey close: ${row.note}` };
    case "DISPUTE_RESOLUTION": {
      const caseId = row.dispute?.caseId ?? row.id;
      return row.dispute?.action === "release"
        ? {
            key: `dispute-resolution:${caseId}:release`,
            description: `Dispute resolution release to respondent: Case ${caseId}`,
          }
        : {
            key: `dispute-resolution:${caseId}:refund`,
            description: `Dispute resolution refund to publisher: Case ${caseId}`,
          };
    }
    case "INTEGRITY_RELEASE":
      // `releaseIntegrityHold`: keyed by the decision (this row's id).
      return { key: `integrity-decision:${row.id}`, description: `Integrity decision release: ${row.id} for response ${ref}` };
    case "INTEGRITY_REVERSAL": {
      // `reverseJournal` default key/description (`reverseJournalInputSchema`).
      const target = row.rewardRowId ?? row.id;
      return { key: `reversal:${target}`, description: `Reversal of journal ${target}` };
    }
  }
}

/** A UUID derived from the journal id for its n-th entry (the last hex digit changes). */
function entryId(journalId: string, index: number): string {
  return `${journalId.slice(0, -1)}${((parseInt(journalId.slice(-1), 16) + index) % 16).toString(16)}`;
}

const SURVEY_KINDS = new Set<MockTransactionKind>([
  "SURVEY_REWARD",
  "SURVEY_PAYOUT",
  "REWARD_RELEASE",
  "SURVEY_ESCROW",
  "ESCROW_REFUND",
  "DISPUTE_RESOLUTION",
  "INTEGRITY_RELEASE",
  "INTEGRITY_REVERSAL",
]);

/**
 * `GET /economy/wallet` transactions of one user: one item per ledger entry,
 * newest first, like `ledger.service.ts#getWallet`. A released Google Forms
 * reward stays the `external-completion:` Chờ duyệt credit it was posted as;
 * its release is the separate `release-pending:` journal (Chờ duyệt −N,
 * Khả dụng +N). `surveyTitle` is the ASSUMED extension documented in
 * `lib/wallet/wallet-service.ts`.
 */
export function ledgerItemsFromRows(userId: string, rows: readonly MockTransaction[]): MockLedgerItem[] {
  const releasedRewardIds = new Set(
    rows.flatMap((row) => (row.kind === "REWARD_RELEASE" && row.rewardRowId ? [row.rewardRowId] : [])),
  );
  // Held rewards an admin quality decision settled stay the `integrity-hold:` credit they were posted as.
  const decidedHoldIds = new Set(
    rows.flatMap((row) =>
      (row.kind === "INTEGRITY_RELEASE" || row.kind === "INTEGRITY_REVERSAL") && row.rewardRowId ? [row.rewardRowId] : [],
    ),
  );
  return rows.flatMap((stored) => {
    const row: MockTransaction =
      stored.kind === "SURVEY_REWARD" && decidedHoldIds.has(stored.id) ? { ...stored, status: "HELD" } : stored;
    const postedAsPending = row.kind === "SURVEY_REWARD" && releasedRewardIds.has(row.id);
    const { key, description } = journalOf(userId, row, postedAsPending);
    return entriesOf(row, postedAsPending).map(
      ([accountClass, amount], index): MockLedgerItem => ({
        id: entryId(row.id, index),
        journalId: row.id,
        amount,
        accountClass,
        description,
        idempotencyKey: key,
        createdAt: row.createdAt,
        reversesJournalId: row.kind === "INTEGRITY_REVERSAL" ? (row.rewardRowId ?? null) : null,
        surveyTitle: SURVEY_KINDS.has(row.kind) ? row.note : null,
      }),
    );
  });
}

/**
 * Phase 6 admin "Xét chất lượng" (Figma 17b): ends the integrity review of one
 * held in-Rescom reward, like `ledger.service.ts`.
 * - `RELEASE` = `releaseIntegrityHold` (Đang giữ → Khả dụng, `integrity-decision:`
 *   journal); the first confirmed reward then unlocks the frozen starter points
 *   (they stayed frozen while the reward was held, see `holdSurveyReward`).
 * - `REVERSE` = Admin reversal of the `integrity-hold:` journal: the points
 *   leave the respondent (the backend returns them to the publisher's Ký quỹ;
 *   the mock never drew the publisher's escrow for a reward, so nothing moves there).
 * Returns null when the attempt has no reward still held.
 */
export function settleHeldReward(
  state: EconomyState,
  ctx: RuleContext,
  input: { attemptId: string; outcome: "RELEASE" | "REVERSE" },
): { amount: number; activated: boolean } | null {
  const held = state.rows.find(
    (row) => row.kind === "SURVEY_REWARD" && row.status === "HELD" && row.attemptId === input.attemptId,
  );
  if (!held) return null;
  const amount = held.amount;
  state.wallet.integrityHold = Math.max(0, state.wallet.integrityHold - amount);
  const settlement = { note: held.note, surveyId: held.surveyId, attemptId: held.attemptId, releasesAt: null, rewardRowId: held.id };
  if (input.outcome === "RELEASE") {
    // `rewardOutcomeOf` now reports SETTLED; the ledger keeps the `integrity-hold:` credit.
    held.status = "AVAILABLE";
    state.wallet.available += amount;
    addRow(state, ctx, { kind: "INTEGRITY_RELEASE", amount, status: "AVAILABLE", ...settlement });
    return { amount, activated: unlockStarterPoints(state, ctx, held.attemptId) };
  }
  held.status = "REVERSED";
  addRow(state, ctx, { kind: "INTEGRITY_REVERSAL", amount: -amount, status: "REVERSED", ...settlement });
  return { amount, activated: false };
}
