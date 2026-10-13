import {
  truncateText,
  type AdminTopUpRequestDto,
  type NotificationDto,
  type TopUpStatus,
} from "@rescom/schemas";
import { formatTransferReference } from "@/lib/admin/top-up-admin";
import { formatPoints, formatVnd } from "@/lib/wallet/top-up";
import { toMockUuid } from "./auth";
import { creditTopUp } from "./economy";
import { updateNotifications } from "./notifications";
import { addTopUps, allTopUps, findTopUp, toTopUpDto, updateTopUp, type MockTopUp, type StoredTopUp } from "./top-up";
import { createCollection, mockId, nowIso } from "../db/store";
import { findMockUserByEmail, type MockSessionUser } from "../db/session";

/**
 * Admin review of manual top-ups (Figma 11b "Duyệt nạp điểm", 63:369) over
 * the SAME requests users create on /wallet/top-up (`top-up.ts`), so an
 * approval shows up on the requester's 14c status page, wallet and bell.
 *
 * Seed = Figma: Trần Minh 200 điểm · 40.000đ (26/09 18:20) and Lê Anh
 * 100 điểm · 20.000đ (26/09 19:05) → badge 2, "300 điểm · 60.000đ".
 * Figma's references ("RESCOM MT4402", "RESCOM LA1187") contain 0/1, which
 * the backend alphabet excludes (`topUpReferenceSchema`), so the seed uses
 * valid codes with the same initials. The REJECTED example is not drawn
 * (ASSUMED, matches the 14d notification seed).
 */

interface SeedRequester {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

const requester = (key: string, email: string, name: string, createdAt: string): SeedRequester => ({
  id: toMockUuid(`seed-top-up:${key}`),
  email,
  name,
  createdAt,
});

const MINH = requester("minh.tran", "minh.tran@fpt.edu.vn", "Trần Minh", "2026-09-12T02:00:00.000Z");
const ANH = requester("anh.le", "anh.le@fpt.edu.vn", "Lê Anh", "2026-09-03T02:00:00.000Z");
const LAN = requester("lan.ngo", "lan.ngo@fpt.edu.vn", "Ngô Lan", "2026-08-28T02:00:00.000Z");

const SEED_ADMIN_ID = toMockUuid("seed-top-up:admin");

function seedRequest(
  who: SeedRequester,
  request: Pick<MockTopUp, "id" | "amount" | "status" | "transferReference" | "createdAt"> & Partial<MockTopUp>,
): [string, MockTopUp] {
  return [
    who.id,
    {
      rejectionReason: null,
      reviewedAt: null,
      userEmail: who.email,
      userName: who.name,
      userCreatedAt: who.createdAt,
      ...request,
    },
  ];
}

const SEED: ReadonlyArray<[string, MockTopUp]> = [
  seedRequest(MINH, {
    id: "6e0b3d1a-4c2f-4a8e-9b1d-2f3a4b5c6d01",
    amount: 200,
    status: "PENDING",
    transferReference: "RESCOMMT4492QA",
    createdAt: "2026-09-26T11:20:00.000Z", // 26/09 18:20 (VN)
  }),
  seedRequest(ANH, {
    id: "6e0b3d1a-4c2f-4a8e-9b1d-2f3a4b5c6d02",
    amount: 100,
    status: "PENDING",
    transferReference: "RESCOMLA7487KD",
    createdAt: "2026-09-26T12:05:00.000Z", // 26/09 19:05 (VN)
  }),
  seedRequest(LAN, {
    id: "6e0b3d1a-4c2f-4a8e-9b1d-2f3a4b5c6d03",
    amount: 100,
    status: "REJECTED",
    transferReference: "RESCOMLN5829HT",
    createdAt: "2026-09-19T03:00:00.000Z",
    reviewedAt: "2026-09-19T09:30:00.000Z",
    rejectionReason: "Không tìm thấy giao dịch khớp nội dung chuyển khoản.",
    adminId: SEED_ADMIN_ID,
    correlationId: "6e0b3d1a-4c2f-4a8e-9b1d-2f3a4b5c6d13",
  }),
];

/** Set once the Figma seed was added to the shared top-up store (reset with `?msw-reset=1`). */
const seeded = createCollection<boolean>("admin-top-ups-seeded", () => false);

function ensureSeed(): void {
  if (seeded.get()) return;
  for (const [userId, request] of SEED) addTopUps(userId, [request]);
  seeded.set(true);
}

/** `topUpQueueCount()` — PENDING requests of every user (sidebar badge "Duyệt nạp điểm"). */
export function topUpQueueCount(): number {
  ensureSeed();
  return allTopUps().filter((item) => item.request.status === "PENDING").length;
}

/** Pending queue totals for the "Giao dịch" card "Nạp điểm chờ duyệt" (300 · 2 yêu cầu · 60.000đ). */
export function pendingTopUpSummary(): { count: number; points: number; amountVnd: number } {
  ensureSeed();
  const pending = allTopUps().filter((item) => item.request.status === "PENDING");
  const points = pending.reduce((sum, item) => sum + item.request.amount, 0);
  return { count: pending.length, points, amountVnd: pending.reduce((sum, item) => sum + toTopUpDto(item.request).amountVnd, 0) };
}

export type AdminTopUpMockDto = AdminTopUpRequestDto & { userName: string | null; userCreatedAt: string | null };

/** Backend `TopUpService#toAdminDto` + the ASSUMED `userName` / `userCreatedAt`. */
export function toAdminTopUpDto({ userId, request }: StoredTopUp): AdminTopUpMockDto {
  return {
    ...toTopUpDto(request),
    userId,
    userEmail: request.userEmail ?? null,
    adminId: request.adminId ?? null,
    journalId: request.journalId ?? null,
    correlationId: request.correlationId ?? null,
    userName: request.userName ?? null,
    userCreatedAt: request.userCreatedAt ?? null,
  };
}

/** Backend `listForReview`: PENDING oldest first, reviewed newest first. */
export function listTopUpsForReview(status: TopUpStatus): StoredTopUp[] {
  ensureSeed();
  const direction = status === "PENDING" ? 1 : -1;
  return allTopUps()
    .filter((item) => item.request.status === status)
    .sort(
      (a, b) =>
        direction * (a.request.createdAt.localeCompare(b.request.createdAt) || a.request.id.localeCompare(b.request.id)),
    );
}

export function findTopUpForReview(id: string): StoredTopUp | null {
  ensureSeed();
  return findTopUp(id);
}

/** The requester as a wallet owner: the real mock account when it exists, else the seed identity. */
function requesterOf(stored: StoredTopUp): MockSessionUser {
  const email = stored.request.userEmail ?? "";
  const account = email ? findMockUserByEmail(email) : null;
  if (account && account.id === stored.userId) return account;
  return {
    id: stored.userId,
    email,
    name: stored.request.userName ?? email,
    role: "USER",
    profileComplete: true,
  };
}

function notify(userId: string, type: NotificationDto["type"], message: string): void {
  const item: NotificationDto = { id: mockId(), type, message, isRead: false, createdAt: nowIso(), readAt: null };
  updateNotifications(userId, (items) => {
    items.unshift(item);
  });
}

/**
 * `ApproveTopUp` (AD-16): credits Khả dụng once (`creditTopUp` → the
 * `topup-approval:` journal), marks the request APPROVED, then sends
 * TOPUP_SUCCESS. Only called for a PENDING request.
 */
export function approveStoredTopUp(stored: StoredTopUp, adminId: string): StoredTopUp {
  const { request } = stored;
  const journal = creditTopUp(requesterOf(stored), { amount: request.amount, reference: request.transferReference });
  const updated =
    updateTopUp(request.id, (draft) => {
      draft.status = "APPROVED";
      draft.reviewedAt = nowIso();
      draft.adminId = adminId;
      draft.journalId = journal.id;
      draft.correlationId = mockId();
    }) ?? stored;
  const amountVnd = toTopUpDto(updated.request).amountVnd;
  notify(
    stored.userId,
    "TOPUP_SUCCESS",
    `Nạp điểm thành công: +${formatPoints(request.amount)} điểm đã vào Khả dụng. Chuyển khoản ${formatTransferReference(request.transferReference)} (${formatVnd(amountVnd)}) đã được xác nhận.`,
  );
  return updated;
}

/** Rejects a PENDING request with the admin's reason; no points move; TOPUP_REJECTED notification (IR.4b B3). */
export function rejectStoredTopUp(stored: StoredTopUp, adminId: string, reason: string): StoredTopUp {
  const { request } = stored;
  const updated =
    updateTopUp(request.id, (draft) => {
      draft.status = "REJECTED";
      draft.reviewedAt = nowIso();
      draft.adminId = adminId;
      draft.rejectionReason = reason;
      draft.correlationId = mockId();
    }) ?? stored;
  notify(
    stored.userId,
    "TOPUP_REJECTED",
    `Yêu cầu nạp điểm chưa được duyệt: ${formatPoints(request.amount)} điểm, nội dung ${formatTransferReference(request.transferReference)}. Lý do: ${truncateText(reason, 300)}`,
  );
  return updated;
}
