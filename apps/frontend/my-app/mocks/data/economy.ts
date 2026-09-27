import type { WalletBalanceDto } from "@rescom/schemas";
import { createCollection, hoursAgo, mockId, nowIso } from "../db/store";
import type { MockSessionUser } from "../db/session";
import { getActiveScenario } from "../scenarios";
import {
  creditReward,
  ledgerItemsFromRows,
  releaseDueRewards,
  settleHeldReward,
  type EconomyState,
  type MockLedgerItem,
  type MockTransaction,
  type RuleContext,
} from "./economy-rules";

export type { MockTransaction, MockTransactionKind, MockTransactionStatus } from "./economy-rules";

/**
 * Wallet balances per user id. Figma (page 7 · Ví điểm) shows an activated
 * account with 112 available + 18 pending; a new account starts with the 100
 * starter points frozen (header "100 đóng băng").
 */
export type MockWallet = Omit<WalletBalanceDto, "total">;

export const wallets = createCollection<Record<string, MockWallet>>("wallets", () => ({}));

function seedWallet(user: MockSessionUser): MockWallet {
  return user.profileComplete && user.email === "minh.le@fpt.edu.vn"
    ? // Escrow 140 = the two running publisher surveys in Figma 10 (100 + 40); available is after those locks.
      { available: 112, pending: 18, escrow: 140, frozen: 0, integrityHold: 0 }
    : { available: 0, pending: 0, escrow: 0, frozen: 100, integrityHold: 0 };
}

export function walletOf(user: MockSessionUser): MockWallet {
  const existing = wallets.get()[user.id];
  if (existing) return existing;
  const seeded = seedWallet(user);
  wallets.update((all) => {
    all[user.id] = seeded;
  });
  return seeded;
}

export function updateWallet(user: MockSessionUser, mutator: (wallet: MockWallet) => void): MockWallet {
  walletOf(user);
  return wallets.update((all) => {
    mutator(all[user.id]);
  })[user.id];
}

export function toBalanceDto(wallet: MockWallet): WalletBalanceDto {
  const total = wallet.available + wallet.pending + wallet.escrow + wallet.frozen + wallet.integrityHold;
  return { ...wallet, total };
}

/**
 * Wallet history (Figma 7 "Lịch sử giao dịch"). Phase 4 maps these rows to
 * the backend `walletTransactionItemSchema`; participation mocks append to it.
 * Row shape and reward rules: `economy-rules.ts`.
 */
export const transactions = createCollection<Record<string, MockTransaction[]>>("wallet-transactions", () => ({}));

export function transactionsOf(user: MockSessionUser): MockTransaction[] {
  const existing = transactions.get()[user.id];
  if (existing) return existing;
  const activated = user.profileComplete && user.email === "minh.le@fpt.edu.vn";
  const seeded: MockTransaction[] = [
    {
      id: mockId(),
      kind: "STARTER_GRANT",
      amount: 100,
      status: "FROZEN",
      note: "Tài khoản mới",
      surveyId: null,
      attemptId: null,
      createdAt: hoursAgo(72),
      releasesAt: null,
    },
  ];
  if (activated) {
    // Publisher escrow locks for "Khảo sát của tôi" (Figma 10, mocks/data/forms.ts), taken before the 112 snapshot.
    seeded.push({
      id: mockId(),
      kind: "SURVEY_ESCROW",
      amount: -40,
      status: "ESCROW",
      note: "Thói quen đọc sách của sinh viên",
      surveyId: "7c2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4f02",
      attemptId: null,
      createdAt: hoursAgo(24 * 5),
      releasesAt: null,
    });
    seeded.unshift({
      id: mockId(),
      kind: "SURVEY_ESCROW",
      amount: -100,
      status: "ESCROW",
      note: "Hành vi tiêu dùng của sinh viên Marketing",
      surveyId: "7c2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4f01",
      attemptId: null,
      createdAt: hoursAgo(2.5),
      releasesAt: null,
    });
    // Figma 7 sample history: 112 available + 18 pending.
    seeded.unshift(
      {
        id: mockId(),
        kind: "SURVEY_REWARD",
        amount: 18,
        status: "PENDING",
        note: "Thói quen dùng AI trong học tập của sinh viên IT",
        surveyId: "5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e02",
        attemptId: null,
        createdAt: hoursAgo(17),
        releasesAt: hoursAgo(-31),
      },
      {
        id: mockId(),
        kind: "SURVEY_REWARD",
        amount: 12,
        status: "AVAILABLE",
        note: "Hành vi mua sắm online của sinh viên Đà Nẵng",
        surveyId: "5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e01",
        attemptId: null,
        createdAt: hoursAgo(18),
        releasesAt: null,
      },
      {
        id: mockId(),
        kind: "STARTER_UNLOCK",
        amount: 100,
        status: "AVAILABLE",
        note: "Đóng băng → Khả dụng sau khảo sát đầu tiên",
        surveyId: null,
        attemptId: null,
        createdAt: hoursAgo(18),
        releasesAt: null,
      },
    );
  }
  // Newest first, like the ledger the wallet history lists.
  seeded.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  transactions.update((all) => {
    all[user.id] = seeded;
  });
  return seeded;
}

/**
 * `GET /economy/wallet` transactions: one item per ledger entry, newest
 * first, like `ledger.service.ts#getWallet` (mapping: `ledgerItemsFromRows`).
 */
export function ledgerItemsOf(user: MockSessionUser, limit: number, offset: number): MockLedgerItem[] {
  return ledgerItemsFromRows(user.id, transactionsOf(user)).slice(offset, offset + limit);
}

export function recordTransaction(user: MockSessionUser, row: Omit<MockTransaction, "id" | "createdAt">): MockTransaction {
  transactionsOf(user);
  const full: MockTransaction = { ...row, id: mockId(), createdAt: nowIso() };
  transactions.update((all) => {
    all[user.id].unshift(full);
  });
  return full;
}

const ruleContext = (): RuleContext => ({ now: Date.now(), newId: mockId });

/** Runs a rule on one user's wallet + history and saves both. */
function withEconomy<T>(user: MockSessionUser, rule: (state: EconomyState) => T): T {
  const state: EconomyState = { wallet: { ...walletOf(user) }, rows: structuredClone(transactionsOf(user)) };
  const result = rule(state);
  wallets.update((all) => {
    all[user.id] = state.wallet;
  });
  transactions.update((all) => {
    all[user.id] = state.rows;
  });
  return result;
}

/**
 * Credits a survey reward. In-Rescom rewards go straight to Khả dụng (Figma 6
 * "+12 điểm vào Khả dụng") and unlock the frozen starter points; Google Forms
 * rewards wait 48h in Chờ duyệt (page 5) and unlock nothing until released
 * (`releaseDuePendingRewards`). Returns whether this call activated the account.
 */
export function creditSurveyReward(
  user: MockSessionUser,
  input: { amount: number; pending: boolean; surveyId: string; attemptId: string; title: string },
): { activated: boolean } {
  return withEconomy(user, (state) => creditReward(state, ruleContext(), input));
}

/**
 * Ends the 48h review of pending rewards whose `releasesAt` passed — or all of
 * them under the MOCK-ONLY scenario `?msw=release-pending` — then unlocks the
 * starter points. Called whenever the wallet, the starter status or an
 * attempt's outcome is read, so the mock needs no background job.
 */
export function releaseDuePendingRewards(user: MockSessionUser): { released: number; activated: boolean } {
  const releaseAll = getActiveScenario() === "release-pending";
  const history = transactionsOf(user);
  const now = Date.now();
  const anyDue = history.some(
    (row) =>
      row.kind === "SURVEY_REWARD" &&
      row.status === "PENDING" &&
      (releaseAll || (row.releasesAt !== null && Date.parse(row.releasesAt) <= now)),
  );
  if (!anyDue) return { released: 0, activated: false };
  return withEconomy(user, (state) => releaseDueRewards(state, ruleContext(), releaseAll));
}

/**
 * Phase 3B (in-Rescom, `?msw=integrity-hold`): an ENFORCED-policy reward goes
 * to the non-spendable Integrity Hold first (Figma 17c). The starter points
 * stay frozen until a decision releases it.
 */
export function holdSurveyReward(
  user: MockSessionUser,
  input: { amount: number; surveyId: string; attemptId: string; title: string },
): void {
  recordTransaction(user, {
    kind: "SURVEY_REWARD",
    amount: input.amount,
    status: "HELD",
    note: input.title,
    surveyId: input.surveyId,
    attemptId: input.attemptId,
    releasesAt: null,
  });
  updateWallet(user, (wallet) => {
    wallet.integrityHold += input.amount;
  });
}

export interface MockRewardOutcome {
  status: "SETTLED" | "PENDING" | "HELD_IN_INTEGRITY";
  amount: number;
  targetAccountClass: "USER_AVAILABLE" | "PENDING" | "INTEGRITY_HOLD";
  settledAt: string;
  /** This attempt unlocked the starter points. */
  accountActivated: boolean;
}

/** Phase 3B: reward state of one attempt, from the wallet history (null = no reward row). */
export function rewardOutcomeOf(user: MockSessionUser, attemptId: string): MockRewardOutcome | null {
  const history = transactionsOf(user);
  const reward = history.find((row) => row.kind === "SURVEY_REWARD" && row.attemptId === attemptId);
  if (!reward || reward.status === "REVERSED") return null;
  const accountActivated = history.some((row) => row.kind === "STARTER_UNLOCK" && row.attemptId === attemptId);
  const base = { amount: reward.amount, settledAt: reward.createdAt, accountActivated };
  if (reward.status === "HELD") return { ...base, status: "HELD_IN_INTEGRITY", targetAccountClass: "INTEGRITY_HOLD" };
  if (reward.status === "PENDING") return { ...base, status: "PENDING", targetAccountClass: "PENDING" };
  return { ...base, status: "SETTLED", targetAccountClass: "USER_AVAILABLE" };
}

/**
 * Publisher escrow (Figma 9c/10/10b "Ký quỹ"): points move Khả dụng → Ký quỹ
 * when a survey is submitted/published or reopened with more samples. Row
 * shape agreed with the wallet screens → journal `publish:<row.id>`.
 * Throws `INSUFFICIENT_AVAILABLE` so handlers can answer like the backend.
 */
export function reserveSurveyEscrow(
  user: MockSessionUser,
  input: { amount: number; surveyId: string; title: string },
): MockTransaction {
  const wallet = walletOf(user);
  if (input.amount <= 0) throw new Error("Escrow amount must be positive");
  if (wallet.available < input.amount) throw new Error("INSUFFICIENT_AVAILABLE");
  updateWallet(user, (draft) => {
    draft.available -= input.amount;
    draft.escrow += input.amount;
  });
  return recordTransaction(user, {
    kind: "SURVEY_ESCROW",
    amount: -input.amount,
    status: "ESCROW",
    note: input.title,
    surveyId: input.surveyId,
    attemptId: null,
    releasesAt: null,
  });
}

/**
 * Returns unused escrow when a survey closes or is rejected → journal
 * `close-refund:<row.id>` ("Hoàn ký quỹ" +N). Caps at the escrow balance.
 */
export function refundSurveyEscrow(
  user: MockSessionUser,
  input: { amount: number; surveyId: string; title: string },
): MockTransaction | null {
  const amount = Math.min(input.amount, walletOf(user).escrow);
  if (amount <= 0) return null;
  updateWallet(user, (draft) => {
    draft.escrow -= amount;
    draft.available += amount;
  });
  return recordTransaction(user, {
    kind: "ESCROW_REFUND",
    amount,
    status: "AVAILABLE",
    note: input.title,
    surveyId: input.surveyId,
    attemptId: null,
    releasesAt: null,
  });
}

/**
 * Phase 6 (admin "Duyệt nạp điểm", Figma 11b): an approved top-up credits
 * Khả dụng once. The row maps to the backend `topup-approval:` journal
 * ("Manual top-up approval: <reference> (N points)", `ledgerItemsFromRows`),
 * shown as "Nạp điểm" on /wallet. Its id is the journal id.
 */
export function creditTopUp(user: MockSessionUser, input: { amount: number; reference: string }): MockTransaction {
  updateWallet(user, (wallet) => {
    wallet.available += input.amount;
  });
  return recordTransaction(user, {
    kind: "TOP_UP",
    amount: input.amount,
    status: "AVAILABLE",
    note: input.reference,
    surveyId: null,
    attemptId: null,
    releasesAt: null,
  });
}

/**
 * Phase 6 admin "Xét chất lượng" (Figma 17b): an admin decision on a reward
 * held by `holdSurveyReward`. `RELEASE` → Khả dụng (and the starter points
 * unlock), `REVERSE` → the hold is reversed. Rule: `settleHeldReward`.
 * Returns null when that attempt has no reward still held.
 */
export function settleHeldSurveyReward(
  user: MockSessionUser,
  input: { attemptId: string; outcome: "RELEASE" | "REVERSE" },
): { amount: number; activated: boolean } | null {
  return withEconomy(user, (state) => settleHeldReward(state, ruleContext(), input));
}
