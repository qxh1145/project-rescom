import type { WalletBalanceDto } from "@rescom/schemas";
import { createCollection, hoursAgo, mockId, nowIso } from "../db/store";
import type { MockSessionUser } from "../db/session";

/**
 * Wallet balances per user id. Figma (page 7 · Ví điểm) shows an activated
 * account with 112 available + 18 pending; a new account starts with the 100
 * starter points frozen (header "100 đóng băng").
 */
export type MockWallet = Omit<WalletBalanceDto, "total">;

export const wallets = createCollection<Record<string, MockWallet>>("wallets", () => ({}));

function seedWallet(user: MockSessionUser): MockWallet {
  return user.profileComplete && user.email === "minh.le@fpt.edu.vn"
    ? { available: 112, pending: 18, escrow: 0, frozen: 0, integrityHold: 0 }
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
 */
export type MockTransactionKind =
  | "STARTER_GRANT" // "Điểm khởi đầu" · Đóng băng
  | "STARTER_UNLOCK" // "Mở khoá điểm khởi đầu" · Đóng băng → Khả dụng
  | "SURVEY_REWARD" // "Thưởng khảo sát"
  | "TOP_UP" // "Nạp điểm"
  | "SURVEY_ESCROW" // "Ký quỹ khảo sát" (publisher spend)
  | "ESCROW_REFUND"; // "Hoàn ký quỹ"

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
}

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
  transactions.update((all) => {
    all[user.id] = seeded;
  });
  return seeded;
}

export function recordTransaction(user: MockSessionUser, row: Omit<MockTransaction, "id" | "createdAt">): MockTransaction {
  transactionsOf(user);
  const full: MockTransaction = { ...row, id: mockId(), createdAt: nowIso() };
  transactions.update((all) => {
    all[user.id].unshift(full);
  });
  return full;
}

/**
 * Credits a survey reward. In-Rescom rewards go straight to Khả dụng (Figma 6
 * "+12 điểm vào Khả dụng"); Google Forms rewards wait 48h in Chờ duyệt (page 5).
 * The first completed survey also unlocks the frozen starter points.
 * Returns whether this call activated the account.
 */
export function creditSurveyReward(
  user: MockSessionUser,
  input: { amount: number; pending: boolean; surveyId: string; attemptId: string; title: string },
): { activated: boolean } {
  recordTransaction(user, {
    kind: "SURVEY_REWARD",
    amount: input.amount,
    status: input.pending ? "PENDING" : "AVAILABLE",
    note: input.title,
    surveyId: input.surveyId,
    attemptId: input.attemptId,
    releasesAt: input.pending ? new Date(Date.now() + 48 * 3_600_000).toISOString() : null,
  });
  let activated = false;
  updateWallet(user, (wallet) => {
    if (input.pending) wallet.pending += input.amount;
    else wallet.available += input.amount;
    if (wallet.frozen > 0) {
      activated = true;
      wallet.available += wallet.frozen;
      wallet.frozen = 0;
    }
  });
  if (activated) {
    recordTransaction(user, {
      kind: "STARTER_UNLOCK",
      amount: 100,
      status: "AVAILABLE",
      note: "Đóng băng → Khả dụng sau khảo sát đầu tiên",
      surveyId: null,
      // Phase 3B: the attempt that triggered the unlock (read by `rewardOutcomeOf`).
      attemptId: input.attemptId,
      releasesAt: null,
    });
  }
  return { activated };
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
