import {
  POINT_VND_RATE,
  buildTopUpReference,
  buildVietQrPayload,
  type TopUpRequestDto,
  type TopUpStatus,
} from "@rescom/schemas";
import { createCollection, hoursAgo, mockId, nowIso } from "../db/store";
import { getActiveScenario } from "../scenarios";
import { creditPayosTopUp } from "./economy";
import type { MockSessionUser } from "../db/session";

/**
 * Top-up requests per user id (Figma 14). Starts empty; the admin queue
 * (Figma 11b, `admin-top-ups.ts`) adds its Figma seed and approves/rejects
 * requests through the accessors at the end of this file.
 *
 * The platform bank account comes from backend configuration; the mock uses
 * Figma's placeholders. `accountNumber`/`bankBin` must be digits
 * (`topUpPaymentInstructionsSchema`), so Figma's "[SỐ TÀI KHOẢN]" cannot be
 * used verbatim.
 */
export const MOCK_TOP_UP_BANK = {
  bankName: "[TÊN NGÂN HÀNG]",
  bankBin: "970436",
  accountNumber: "0123456789",
  accountName: "[CHỦ TÀI KHOẢN]",
} as const;

export interface MockTopUp {
  id: string;
  amount: number;
  status: TopUpStatus;
  transferReference: string;
  rejectionReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  /** Requester shown in the admin queue (Phase 6); absent on requests stored before it. */
  userEmail?: string | null;
  userName?: string | null;
  /** ASSUMED extension `userCreatedAt` of the admin DTO ("tài khoản từ 12/09"). */
  userCreatedAt?: string | null;
  /** Set by the admin review (backend `adminTopUpRequestSchema`). */
  adminId?: string | null;
  journalId?: string | null;
  correlationId?: string | null;
}

export const topUps = createCollection<Record<string, MockTopUp[]>>("top-ups", () => ({}));

export function topUpsOf(user: MockSessionUser): MockTopUp[] {
  return topUps.get()[user.id] ?? [];
}

function randomReference(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return buildTopUpReference(bytes);
}

export function createTopUp(user: MockSessionUser, amount: number): MockTopUp {
  const taken = new Set(Object.values(topUps.get()).flatMap((items) => items.map((item) => item.transferReference)));
  let transferReference = randomReference();
  while (taken.has(transferReference)) transferReference = randomReference();
  const request: MockTopUp = {
    id: mockId(),
    amount,
    status: "PENDING",
    transferReference,
    rejectionReason: null,
    createdAt: nowIso(),
    reviewedAt: null,
    userEmail: user.email,
    userName: user.name,
  };
  topUps.update((all) => {
    all[user.id] = [request, ...(all[user.id] ?? [])];
  });
  return request;
}

/** Same shape as backend `TopUpService#toDto`: instructions only while PENDING. */
export function toTopUpDto(request: MockTopUp): TopUpRequestDto {
  const amountVnd = request.amount * POINT_VND_RATE;
  return {
    id: request.id,
    amount: request.amount,
    amountVnd,
    status: request.status,
    transferReference: request.transferReference,
    rejectionReason: request.rejectionReason,
    createdAt: request.createdAt,
    reviewedAt: request.reviewedAt,
    paymentInstructions:
      request.status === "PENDING"
        ? {
            ...MOCK_TOP_UP_BANK,
            amountVnd,
            transferContent: request.transferReference,
            qrPayload: buildVietQrPayload({
              bankBin: MOCK_TOP_UP_BANK.bankBin,
              accountNumber: MOCK_TOP_UP_BANK.accountNumber,
              amountVnd,
              transferContent: request.transferReference,
            }),
          }
        : null,
  };
}

export interface StoredTopUp {
  userId: string;
  request: MockTopUp;
}

/** Every stored request with its owner (admin queue, Phase 6). */
export function allTopUps(): StoredTopUp[] {
  return Object.entries(topUps.get()).flatMap(([userId, items]) => items.map((request) => ({ userId, request })));
}

export function findTopUp(id: string): StoredTopUp | null {
  return allTopUps().find((item) => item.request.id === id) ?? null;
}

/** Applies an admin decision to one request; null when it does not exist. */
export function updateTopUp(id: string, mutator: (request: MockTopUp) => void): StoredTopUp | null {
  let found: StoredTopUp | null = null;
  topUps.update((all) => {
    for (const [userId, items] of Object.entries(all)) {
      const request = items.find((item) => item.id === id);
      if (request) {
        mutator(request);
        found = { userId, request };
        return;
      }
    }
  });
  return found;
}

/** Adds requests to a user's list (admin seed), skipping ids already stored. */
export function addTopUps(userId: string, requests: readonly MockTopUp[]): void {
  topUps.update((all) => {
    const existing = all[userId] ?? [];
    const ids = new Set(existing.map((item) => item.id));
    all[userId] = [...requests.filter((item) => !ids.has(item.id)), ...existing];
  });
}

import type {
  UserTopUpRefundDestinationView,
  UserTopUpRefundRequest,
} from "@rescom/schemas";

export interface MockAdminRefundRequest extends UserTopUpRefundRequest {
  holdJournalId?: string | null;
  resolveJournalId?: string | null;
  note?: string | null;
  manualTransferRecorded?: boolean;
  bankTransferRecordedAt?: string | null;
  resolvedBy?: { id: string; email: string } | null;
}

export interface MockPayosTopUp {
  id: string;
  userId: string;
  orderCode: number;
  amountVnd: number;
  points: number;
  status: "PROCESSING" | "SUCCESSFUL" | "CANCELLED" | "EXPIRED" | "AMOUNT_MISMATCH" | "MANUAL_REFUNDED";
  checkoutUrl: string | null;
  expiresAt: string;
  cancelledAt: string | null;
  paidAt: string | null;
  amountPaidVnd?: number | null;
  mismatchResolution?: "CREDIT" | "MANUAL_REFUND";
  createdAt: string;
  refundDeadline?: string | null;
  counterAccount?: {
    bankId: string | null;
    bankName: string | null;
    holderName: string | null;
    accountNumber: string | null;
  } | null;
  refund?: {
    canRequest?: boolean;
    unavailableReason?: "NOT_SUCCESSFUL" | "LEGACY_MANUAL" | "DEADLINE_PASSED" | "MISMATCH_CREDITED" | "ALREADY_REQUESTED" | "WITHDRAWN" | null;
    destination?: UserTopUpRefundDestinationView | null;
    request?: MockAdminRefundRequest | null;
  };
}

export const payosTopUps = createCollection<Record<string, MockPayosTopUp[]>>("payos-top-ups", () => ({}));

/** MOCK-ONLY: a PROCESSING top-up counts as paid this long after creation (no URL state, NFR-31). */
export const MOCK_PAYOS_AUTO_PAY_MS = 8_000;
const MOCK_PAYOS_TTL_MS = 5 * 60_000;
export const MOCK_PAYOS_RATE_LIMIT = { limit: 5, windowMs: 10 * 60_000 } as const;

/** Verified and unverified fake counter accounts for seeds and tests (never real data, repo is public). */
const MOCK_VERIFIED_ACCOUNT = {
  bankId: "970436",
  bankName: "Vietcombank",
  holderName: "TRAN THI A",
  accountNumber: "0123456789",
};
const MOCK_UNVERIFIED_ACCOUNT = {
  bankId: "970422",
  bankName: null,
  holderName: null,
  accountNumber: "0987654321",
};

const toDestinationView = (
  acc: typeof MOCK_VERIFIED_ACCOUNT | typeof MOCK_UNVERIFIED_ACCOUNT,
): UserTopUpRefundDestinationView => ({
  bankId: acc.bankId,
  bankName: acc.bankName,
  holderName: acc.holderName,
  accountNumber: acc.accountNumber,
  last4: acc.accountNumber ? acc.accountNumber.slice(-4) : null,
  verified: Boolean(acc.bankId && acc.accountNumber && acc.holderName),
});

/** Seeds for the demo user covering all refund states (Story 13.11, Task 6). */
function seedPayosTopUps(user: MockSessionUser): MockPayosTopUp[] {
  if (user.email !== "minh.le@fpt.edu.vn") return [];
  const row = (
    n: number,
    amountVnd: number,
    status: MockPayosTopUp["status"],
    hours: number,
    extra: Partial<MockPayosTopUp> = {},
  ): MockPayosTopUp => {
    const isPaid = status === "SUCCESSFUL" || status === "MANUAL_REFUNDED" || status === "AMOUNT_MISMATCH";
    return {
      id: mockId(),
      userId: user.id,
      orderCode: 10_000 + n,
      amountVnd,
      points: amountVnd / POINT_VND_RATE,
      status,
      checkoutUrl: null,
      expiresAt: new Date(Date.parse(hoursAgo(hours)) + MOCK_PAYOS_TTL_MS).toISOString(),
      cancelledAt: status === "CANCELLED" ? hoursAgo(hours) : null,
      paidAt: isPaid ? hoursAgo(hours) : null,
      createdAt: hoursAgo(hours + 0.1),
      counterAccount: isPaid ? MOCK_VERIFIED_ACCOUNT : null,
      ...extra,
    };
  };

  addTopUps(user.id, [
    {
      id: mockId(),
      amount: 100,
      status: "APPROVED",
      transferReference: "RSC-MOCKOLD1",
      rejectionReason: null,
      createdAt: hoursAgo(24 * 14),
      reviewedAt: hoursAgo(24 * 14 - 1),
      userEmail: user.email,
      userName: user.name,
    },
  ]);

  const verifiedDest = toDestinationView(MOCK_VERIFIED_ACCOUNT);

  // 1. SUCCESSFUL paid 1 h ago, verified destination
  const seed1 = row(14, 50_000, "SUCCESSFUL", 1, {
    counterAccount: MOCK_VERIFIED_ACCOUNT,
  });

  // 2. SUCCESSFUL unverified (probe shape: bankId + number without holder)
  const seed2 = row(13, 100_000, "SUCCESSFUL", 2, {
    counterAccount: MOCK_UNVERIFIED_ACCOUNT,
  });

  // 3. SUCCESSFUL paid 30 h ago (DEADLINE_PASSED)
  const seed3 = row(12, 50_000, "SUCCESSFUL", 30, {
    counterAccount: MOCK_VERIFIED_ACCOUNT,
  });

  // 4. SUCCESSFUL mismatch-credited (MISMATCH_CREDITED)
  const seed4 = row(11, 40_000, "SUCCESSFUL", 4, {
    mismatchResolution: "CREDIT",
    amountPaidVnd: 40_000,
  });

  // 5. REQUESTED ELIGIBLE (50 points / 50_000đ)
  const seed5 = row(10, 50_000, "SUCCESSFUL", 5, {
    refund: {
      canRequest: false,
      unavailableReason: "ALREADY_REQUESTED",
      destination: verifiedDest,
      request: {
        id: mockId(),
        status: "REQUESTED",
        eligibility: "ELIGIBLE",
        ineligibleReason: null,
        reason: "WRONG_AMOUNT",
        points: 50,
        amountVnd: 50_000,
        destination: verifiedDest,
        submittedAt: hoursAgo(3),
        withdrawnAt: null,
      },
    },
  });

  // 6. REQUESTED NOT_ELIGIBLE (SPENT_SINCE_TOP_UP)
  const seed6 = row(9, 40_000, "SUCCESSFUL", 6, {
    refund: {
      canRequest: false,
      unavailableReason: "ALREADY_REQUESTED",
      destination: verifiedDest,
      request: {
        id: mockId(),
        status: "REQUESTED",
        eligibility: "NOT_ELIGIBLE",
        ineligibleReason: "SPENT_SINCE_TOP_UP",
        reason: "NO_LONGER_NEEDED",
        points: 40,
        amountVnd: 40_000,
        destination: verifiedDest,
        submittedAt: hoursAgo(4),
        withdrawnAt: null,
      },
    },
  });

  // 7. WITHDRAWN
  const seed7 = row(8, 30_000, "SUCCESSFUL", 7, {
    refund: {
      canRequest: false,
      unavailableReason: "WITHDRAWN",
      destination: verifiedDest,
      request: {
        id: mockId(),
        status: "WITHDRAWN",
        eligibility: "ELIGIBLE",
        ineligibleReason: null,
        reason: "WRONG_AMOUNT",
        points: 30,
        amountVnd: 30_000,
        destination: verifiedDest,
        submittedAt: hoursAgo(5),
        withdrawnAt: hoursAgo(2),
      },
    },
  });

  // 8. REFUNDED
  const seed8 = row(7, 50_000, "SUCCESSFUL", 8, {
    refund: {
      canRequest: false,
      unavailableReason: "ALREADY_REQUESTED",
      destination: verifiedDest,
      request: {
        id: mockId(),
        status: "REFUNDED",
        eligibility: "ELIGIBLE",
        ineligibleReason: null,
        reason: "WRONG_ACCOUNT",
        points: 50,
        amountVnd: 50_000,
        destination: verifiedDest,
        submittedAt: hoursAgo(6),
        withdrawnAt: null,
        resolvedAt: hoursAgo(1),
        bankTransferReference: "FT261016001",
        bankTransferredAt: hoursAgo(1),
      },
    },
  });

  // 9. REJECTED
  const seed9 = row(6, 50_000, "SUCCESSFUL", 9, {
    refund: {
      canRequest: false,
      unavailableReason: "ALREADY_REQUESTED",
      destination: verifiedDest,
      request: {
        id: mockId(),
        status: "REJECTED",
        eligibility: "ELIGIBLE",
        ineligibleReason: null,
        reason: "OTHER",
        points: 50,
        amountVnd: 50_000,
        destination: verifiedDest,
        submittedAt: hoursAgo(8),
        withdrawnAt: null,
        resolvedAt: hoursAgo(2),
        rejectionReason: "Tài khoản nhận tiền không khớp với thông tin nạp.",
      },
    },
  });

  return [
    seed1,
    seed2,
    seed3,
    seed4,
    seed5,
    seed6,
    seed7,
    seed8,
    seed9,
    row(5, 100_000, "SUCCESSFUL", 24),
    row(4, 50_000, "CANCELLED", 48),
    row(3, 20_000, "EXPIRED", 72),
    row(2, 40_000, "AMOUNT_MISMATCH", 96),
    row(1, 60_000, "MANUAL_REFUNDED", 120),
  ];
}

/**
 * The user's PayOS top-ups, newest first. Settles lazily (no background job):
 * PROCESSING past `expiresAt` → EXPIRED; PROCESSING older than
 * `MOCK_PAYOS_AUTO_PAY_MS` → SUCCESSFUL + Khả dụng credit (`topup-credit:`),
 * unless the scenario `payos-pending` keeps it PROCESSING.
 */
export function payosTopUpsOf(user: MockSessionUser): MockPayosTopUp[] {
  let all = payosTopUps.get();
  if (!all[user.id]) {
    const seeded = seedPayosTopUps(user);
    payosTopUps.update((draft) => {
      draft[user.id] = seeded;
    });
    all = payosTopUps.get();
  }
  const now = Date.now();
  const autoPay = getActiveScenario() !== "payos-pending";
  const credited: MockPayosTopUp[] = [];
  const due = all[user.id].some(
    (item) =>
      item.status === "PROCESSING" &&
      (Date.parse(item.expiresAt) <= now || (autoPay && now - Date.parse(item.createdAt) >= MOCK_PAYOS_AUTO_PAY_MS)),
  );
  if (!due) return all[user.id];
  payosTopUps.update((draft) => {
    for (const item of draft[user.id]) {
      if (item.status !== "PROCESSING") continue;
      if (autoPay && now - Date.parse(item.createdAt) >= MOCK_PAYOS_AUTO_PAY_MS && Date.parse(item.expiresAt) > now) {
        item.status = "SUCCESSFUL";
        item.paidAt = new Date(now).toISOString();
        item.checkoutUrl = null;
        credited.push({ ...item });
      } else if (Date.parse(item.expiresAt) <= now) {
        item.status = "EXPIRED";
        item.checkoutUrl = null;
      }
    }
  });
  for (const item of credited) creditPayosTopUp(user, { points: item.points, orderCode: item.orderCode });
  return payosTopUps.get()[user.id];
}

/** Next order code = max persisted + 1 (survives reloads, unique across users). */
function nextMockOrderCode(): number {
  const codes = Object.values(payosTopUps.get()).flatMap((items) => items.map((item) => item.orderCode));
  return Math.max(10_000, ...codes) + 1;
}

/** Seconds until the oldest checkout in the window ages out; null when under the limit. */
export function mockPayosRetryAfter(user: MockSessionUser): number | null {
  const now = Date.now();
  const recent = payosTopUpsOf(user)
    .map((item) => Date.parse(item.createdAt))
    .filter((at) => at > now - MOCK_PAYOS_RATE_LIMIT.windowMs)
    .sort((a, b) => a - b);
  if (recent.length < MOCK_PAYOS_RATE_LIMIT.limit) return null;
  return Math.max(1, Math.ceil((recent[0] + MOCK_PAYOS_RATE_LIMIT.windowMs - now) / 1000));
}

export function createMockPayosTopUp(user: MockSessionUser, amountVnd: number): MockPayosTopUp {
  payosTopUpsOf(user);
  const id = mockId();
  const orderCode = nextMockOrderCode();
  const points = Math.floor(amountVnd / POINT_VND_RATE);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MOCK_PAYOS_TTL_MS).toISOString();

  const item: MockPayosTopUp = {
    id,
    userId: user.id,
    orderCode,
    amountVnd,
    points,
    status: "PROCESSING",
    // Relative on purpose: the FE accepts it only while mock mode is on. Payment completes by time, not by URL.
    checkoutUrl: `/wallet/top-up/${id}`,
    expiresAt,
    cancelledAt: null,
    paidAt: null,
    createdAt: now.toISOString(),
  };

  payosTopUps.update((all) => {
    all[user.id] = [item, ...(all[user.id] ?? [])];
  });

  return item;
}

export function findMockPayosTopUp(id: string, userId: string): MockPayosTopUp | null {
  const userItems = payosTopUps.get()[userId] ?? [];
  return userItems.find((item) => item.id === id) ?? null;
}

export function cancelMockPayosTopUp(id: string, userId: string): MockPayosTopUp | null {
  let found: MockPayosTopUp | null = null;
  payosTopUps.update((all) => {
    const list = all[userId] ?? [];
    const item = list.find((it) => it.id === id);
    if (item && item.status === "PROCESSING") {
      item.status = "CANCELLED";
      item.cancelledAt = nowIso();
      item.checkoutUrl = null;
      found = item;
    } else if (item && item.status === "CANCELLED") {
      found = item;
    }
  });
  return found;
}

