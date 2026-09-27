import {
  POINT_VND_RATE,
  buildTopUpReference,
  buildVietQrPayload,
  type TopUpRequestDto,
  type TopUpStatus,
} from "@rescom/schemas";
import { createCollection, mockId, nowIso } from "../db/store";
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
