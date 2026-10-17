import {
  addBusinessDays,
  payosTransferContent,
  type AdminPayosTopUp,
  type PayosTopUpStatus,
  type AdminPayosMismatch,
  type AdminPayosUncredited,
  type AdminTopUpRefundListItem,
  type AdminTopUpRefundDetail,
} from "@rescom/schemas";
import { toMockUuid } from "./auth.ts";
import { payosTopUps, type MockPayosTopUp, type MockAdminRefundRequest } from "./top-up.ts";
import { findMockUserByEmail } from "../db/session.ts";
import { updateWallet } from "./economy.ts";
import { loadStore } from "../legacy/store.ts";
import { listTopUpsForReview } from "./admin-top-ups.ts";

const emails = ["minh.le@fpt.edu.vn", "minh.tran@fpt.edu.vn", "anh.le@fpt.edu.vn"];
const statuses: PayosTopUpStatus[] = ["PROCESSING", "SUCCESSFUL", "CANCELLED", "EXPIRED", "AMOUNT_MISMATCH", "MANUAL_REFUNDED"];
function seed() {
  const users = emails.map(email => findMockUserByEmail(email));
  const ids = users.map((user, i) => user?.id ?? toMockUuid(`admin-payos-seed:${i}`));
  const current = payosTopUps.get();
  if (current[ids[1]]?.some(row => row.orderCode === 800_001)) return;
  payosTopUps.update(data => {
    for (let i = 0; i < 12; i++) {
      const userId = ids[i % 3];
      const status = statuses[i % statuses.length];
      const createdAt = new Date(Date.now() - i * 3_600_000).toISOString();
      const row: MockPayosTopUp = {
        id: toMockUuid(`admin-payos-row:${i}`), userId, orderCode: 800_000 + i,
        amountVnd: status === "AMOUNT_MISMATCH" ? (i === 4 ? 50_000 : 100_000) : 20_000 * (i + 1),
        points: status === "AMOUNT_MISMATCH" ? (i === 4 ? 250 : 500) : 100 * (i + 1), status,
        amountPaidVnd: status === "AMOUNT_MISMATCH" ? (i === 4 ? 49_000 : 98_000) : null,
        createdAt, paidAt: ["SUCCESSFUL", "AMOUNT_MISMATCH", "MANUAL_REFUNDED"].includes(status) ? createdAt : null,
        expiresAt: new Date(Date.parse(createdAt) + 300_000).toISOString(), cancelledAt: status === "CANCELLED" ? createdAt : null,
        checkoutUrl: null,
      };
      data[userId] = [...(data[userId] ?? []), row];
    }
    const overdue = data[ids[1]]?.find(row => row.orderCode === 800_004);
    if (overdue) overdue.createdAt = overdue.paidAt = new Date(Date.now() - 6 * 86_400_000).toISOString();
    // Figma row "Còn 2 ngày làm việc": paid one business day ago.
    const twoDaysLeft = data[ids[1]]?.find(row => row.orderCode === 800_010);
    if (twoDaysLeft) {
      const paid = new Date(Date.now() - 86_400_000);
      while ([0, 6].includes(paid.getDay())) paid.setDate(paid.getDate() - 1);
      twoDaysLeft.createdAt = twoDaysLeft.paidAt = paid.toISOString();
    }
    const tiny: MockPayosTopUp = { id: toMockUuid("admin-payos-tiny"), userId: ids[0], orderCode: 800_012,
      amountVnd: 50_000, points: 250, amountPaidVnd: 150, status: "AMOUNT_MISMATCH",
      createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), paidAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(), cancelledAt: null, checkoutUrl: null };
    data[ids[0]] = [...(data[ids[0]] ?? []), tiny];

    // Seed refund requests (Story 13.12)
    // 1. Eligible overdue
    const req1 = data[ids[1]]?.find(row => row.orderCode === 800_001);
    if (req1 && !req1.refund) {
      req1.refund = {
        canRequest: false,
        unavailableReason: "ALREADY_REQUESTED",
        destination: { bankId: "970422", bankName: "MB Bank", holderName: "TRAN THI MINH", accountNumber: "0987654321", last4: "4321", verified: true },
        request: {
          id: toMockUuid("admin-refund:1"), status: "REQUESTED", eligibility: "ELIGIBLE", ineligibleReason: null,
          reason: "WRONG_AMOUNT", points: req1.points, amountVnd: req1.amountVnd,
          destination: { bankId: "970422", bankName: "MB Bank", holderName: "TRAN THI MINH", accountNumber: "0987654321", last4: "4321", verified: true },
          submittedAt: new Date(Date.now() - 7 * 86_400_000).toISOString(), withdrawnAt: null,
          holdJournalId: toMockUuid("admin-hold:1"),
        } as MockAdminRefundRequest,
      };
    }
    // 2. Not eligible due in 1 day
    const req7 = data[ids[1]]?.find(row => row.orderCode === 800_007);
    if (req7 && !req7.refund) {
      req7.refund = {
        canRequest: false,
        unavailableReason: "ALREADY_REQUESTED",
        destination: { bankId: "970436", bankName: "Vietcombank", holderName: "TRAN THI MINH", accountNumber: "0123456789", last4: "6789", verified: true },
        request: {
          id: toMockUuid("admin-refund:2"), status: "REQUESTED", eligibility: "NOT_ELIGIBLE", ineligibleReason: "SPENT_SINCE_TOP_UP",
          reason: "NO_LONGER_NEEDED", points: req7.points, amountVnd: req7.amountVnd,
          destination: { bankId: "970436", bankName: "Vietcombank", holderName: "TRAN THI MINH", accountNumber: "0123456789", last4: "6789", verified: true },
          submittedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), withdrawnAt: null,
        } as MockAdminRefundRequest,
      };
    }
    // 3. Eligible unverified
    const req2 = data[ids[2]]?.find(row => row.orderCode === 800_002);
    if (req2 && !req2.refund) {
      req2.refund = {
        canRequest: false,
        unavailableReason: "ALREADY_REQUESTED",
        destination: { bankId: "970407", bankName: "Techcombank", holderName: null, accountNumber: "19031234567890", last4: "7890", verified: false },
        request: {
          id: toMockUuid("admin-refund:5"), status: "REQUESTED", eligibility: "ELIGIBLE", ineligibleReason: null,
          reason: "WRONG_AMOUNT", points: req2.points, amountVnd: req2.amountVnd,
          destination: { bankId: "970407", bankName: "Techcombank", holderName: null, accountNumber: "19031234567890", last4: "7890", verified: false },
          submittedAt: new Date(Date.now() - 86_400_000).toISOString(), withdrawnAt: null,
          holdJournalId: toMockUuid("admin-hold:5"),
        } as MockAdminRefundRequest,
      };
    }
    const req3 = data[ids[0]]?.find(row => row.orderCode === 800_003);
    if (req3 && !req3.refund) {
      req3.refund = {
        canRequest: false,
        unavailableReason: "ALREADY_REQUESTED",
        destination: { bankId: "970422", bankName: "MB Bank", holderName: "MINH LE", accountNumber: "1122334455", last4: "4455", verified: true },
        request: {
          id: toMockUuid("admin-refund:3"), status: "REFUNDED", eligibility: "ELIGIBLE", ineligibleReason: null,
          reason: "WRONG_ACCOUNT", points: req3.points, amountVnd: req3.amountVnd,
          destination: { bankId: "970422", bankName: "MB Bank", holderName: "MINH LE", accountNumber: "1122334455", last4: "4455", verified: true },
          submittedAt: new Date(Date.now() - 4 * 86_400_000).toISOString(), withdrawnAt: null,
          resolvedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          bankTransferReference: "FT800003", bankTransferredAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          holdJournalId: toMockUuid("admin-hold:3"), resolveJournalId: toMockUuid("admin-resolve:3"),
          resolvedBy: { id: ids[0], email: emails[0] },
        } as MockAdminRefundRequest,
      };
    }
    const req9 = data[ids[0]]?.find(row => row.orderCode === 800_009);
    if (req9 && !req9.refund) {
      req9.refund = {
        canRequest: false,
        unavailableReason: "ALREADY_REQUESTED",
        destination: { bankId: "970422", bankName: "MB Bank", holderName: "MINH LE", accountNumber: "9988776655", last4: "6655", verified: true },
        request: {
          id: toMockUuid("admin-refund:4"), status: "REJECTED", eligibility: "ELIGIBLE", ineligibleReason: null,
          reason: "OTHER", points: req9.points, amountVnd: req9.amountVnd,
          destination: { bankId: "970422", bankName: "MB Bank", holderName: "MINH LE", accountNumber: "9988776655", last4: "6655", verified: true },
          submittedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), withdrawnAt: null,
          resolvedAt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
          rejectionReason: "Tài khoản không chính chủ.",
          holdJournalId: toMockUuid("admin-hold:4"), resolveJournalId: toMockUuid("admin-resolve:4"),
          resolvedBy: { id: ids[0], email: emails[0] },
        } as MockAdminRefundRequest,
      };
    }
  });
  // Seeded open ELIGIBLE requests hold their Điểm, like the backend; users with no
  // mock session fall back to REFUND_NOT_HELD in the resolve handler.
  const seededHolds = new Set([toMockUuid("admin-refund:1"), toMockUuid("admin-refund:5")]);
  for (const [i, user] of users.entries()) {
    if (!user) continue;
    const held = (payosTopUps.get()[ids[i]] ?? [])
      .map(row => row.refund?.request)
      .filter(req => req && seededHolds.has(req.id))
      .reduce((sum, req) => sum + (req?.points ?? 0), 0);
    if (held > 0) updateWallet(user, wallet => { wallet.refundHold = (wallet.refundHold ?? 0) + held; });
  }
}
export function adminPayosRows(): AdminPayosTopUp[] {
  seed();
  const users = Object.values(loadStore().users);
  const emailsById = new Map(emails.map((email, i) => [findMockUserByEmail(email)?.id ?? toMockUuid(`admin-payos-seed:${i}`), email]));
  return Object.values(payosTopUps.get()).flat().map(row => ({
    id: row.id, userId: row.userId, orderCode: row.orderCode,
    userEmail: users.find(user => toMockUuid(user.id) === row.userId)?.email ?? emailsById.get(row.userId) ?? null,
    amountVnd: row.amountVnd, points: row.points,
    pointsCredited: row.status === "SUCCESSFUL" ? (row.mismatchResolution === "CREDIT" ? Math.floor((row.amountPaidVnd ?? 0) / 200) : row.points) : null,
    amountPaidVnd: row.amountPaidVnd ?? (row.paidAt ? row.amountVnd : null),
    status: row.status,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    expiresAt: row.expiresAt,
    cancelledAt: row.cancelledAt,
  })).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export function adminPayosExportRows() {
  const users = Object.values(loadStore().users);
  const emailsById = new Map(emails.map((email, i) => [findMockUserByEmail(email)?.id ?? toMockUuid(`admin-payos-seed:${i}`), email]));
  return Object.values(payosTopUps.get()).flat().map(row => {
    const req = row.refund?.request;
    return {
      orderCode: row.orderCode,
      userEmail: users.find(user => toMockUuid(user.id) === row.userId)?.email ?? emailsById.get(row.userId) ?? null,
      amountVnd: row.amountVnd,
      amountPaidVnd: row.amountPaidVnd ?? (row.paidAt ? row.amountVnd : null),
      points: row.points,
      pointsCredited: row.status === "SUCCESSFUL" ? (row.mismatchResolution === "CREDIT" ? Math.floor((row.amountPaidVnd ?? 0) / 200) : row.points) : null,
      status: row.status,
      createdAt: row.createdAt,
      paidAt: row.paidAt,
      refundStatus: req?.status ?? "",
      refundResolvedAt: req?.resolvedAt ?? "",
      bankTransferReference: req?.bankTransferReference ?? "",
    };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function topUpTabCounts() {
  const { uncredited, mismatches } = adminActionRequired();
  return {
    actionRequired: uncredited.length + mismatches.length,
    payos: adminPayosRows().length,
    manual: ["PENDING", "APPROVED", "REJECTED"].reduce(
      (sum, status) => sum + listTopUpsForReview(status as "PENDING" | "APPROVED" | "REJECTED").length,
      0,
    ),
    refunds: adminRefundListItems().filter(row => row.status === "REQUESTED").length,
  };
}

export function adminActionRequired(): { uncredited: AdminPayosUncredited[]; mismatches: AdminPayosMismatch[] } {
  const rows = adminPayosRows();
  const mismatches = rows.filter(row => row.status === "AMOUNT_MISMATCH").map(row => ({ ...row,
    resolveDueAt: addBusinessDays(new Date(row.paidAt ?? row.createdAt), 3).toISOString(),
    providerReference: `PO-${row.orderCode}`, transferContent: payosTransferContent(row.orderCode),
    counterAccountBankName: "MB Bank", counterAccountLast4: "2210",
  })).sort((a, b) => a.resolveDueAt.localeCompare(b.resolveDueAt));
  const uncredited = rows.filter(row => row.orderCode === 800_000 && row.status === "PROCESSING").map(row => ({
    topUpId: row.id, orderCode: row.orderCode, userId: row.userId, userEmail: row.userEmail,
    amountVnd: row.amountVnd, amountPaidVnd: null, status: row.status,
    paidAt: new Date(Date.now() - 45 * 60_000).toISOString(), alertedAt: new Date(Date.now() - 15 * 60_000).toISOString(),
  }));
  return { uncredited, mismatches };
}

/** Mirrors the backend: points are held only while REQUESTED with a hold journal. */
function heldPointsOf(req: MockAdminRefundRequest): number {
  const hasHold = req.holdJournalId ?? (req.eligibility === "ELIGIBLE" ? "implicit" : null);
  return req.status === "REQUESTED" && hasHold ? req.points : 0;
}

export function adminRefundListItems(): AdminTopUpRefundListItem[] {
  seed();
  const users = Object.values(loadStore().users);
  const emailsById = new Map(emails.map((email, i) => [findMockUserByEmail(email)?.id ?? toMockUuid(`admin-payos-seed:${i}`), email]));

  const items: AdminTopUpRefundListItem[] = [];
  for (const row of Object.values(payosTopUps.get()).flat()) {
    const req = row.refund?.request;
    if (!req) continue;
    const user = users.find(u => toMockUuid(u.id) === row.userId);
    const userEmail = user?.email ?? emailsById.get(row.userId) ?? null;
    const userName = user?.name ?? (userEmail ? userEmail.split("@")[0] : null);
    const dueAt = addBusinessDays(new Date(req.submittedAt), 3).toISOString();
    const overdue = req.status === "REQUESTED" && Date.now() >= Date.parse(dueAt);
    const heldPoints = heldPointsOf(req);

    items.push({
      id: req.id,
      topUpId: row.id,
      orderCode: row.orderCode,
      userId: row.userId,
      userEmail,
      userName,
      amountVnd: req.amountVnd,
      points: req.points,
      status: req.status,
      eligibility: req.eligibility,
      ineligibleReason: req.ineligibleReason ?? null,
      reason: req.reason,
      destinationVerified: Boolean(req.destination?.verified),
      heldPoints,
      submittedAt: req.submittedAt,
      dueAt,
      overdue,
      resolvedAt: req.resolvedAt ?? null,
    });
  }
  return items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.id.localeCompare(a.id));
}

export function adminRefundDetail(requestId: string): AdminTopUpRefundDetail | null {
  seed();
  const users = Object.values(loadStore().users);
  const emailsById = new Map(emails.map((email, i) => [findMockUserByEmail(email)?.id ?? toMockUuid(`admin-payos-seed:${i}`), email]));

  for (const row of Object.values(payosTopUps.get()).flat()) {
    const req = row.refund?.request;
    if (!req || req.id !== requestId) continue;
    const user = users.find(u => toMockUuid(u.id) === row.userId);
    const userEmail = user?.email ?? emailsById.get(row.userId) ?? null;
    const userName = user?.name ?? (userEmail ? userEmail.split("@")[0] : null);
    const dueAt = addBusinessDays(new Date(req.submittedAt), 3).toISOString();
    const overdue = req.status === "REQUESTED" && Date.now() >= Date.parse(dueAt);
    const heldPoints = heldPointsOf(req);
    const dest = req.destination ?? row.refund?.destination ?? {
      bankId: null,
      bankName: null,
      holderName: null,
      accountNumber: null,
      verified: false,
    };

    return {
      id: req.id,
      topUpId: row.id,
      orderCode: row.orderCode,
      userId: row.userId,
      userEmail,
      userName,
      amountVnd: req.amountVnd,
      points: req.points,
      status: req.status,
      eligibility: req.eligibility,
      ineligibleReason: req.ineligibleReason ?? null,
      reason: req.reason,
      destinationVerified: Boolean(dest.verified),
      heldPoints,
      submittedAt: req.submittedAt,
      dueAt,
      overdue,
      resolvedAt: req.resolvedAt ?? null,
      note: req.note ?? "Yêu cầu hoàn tiền nạp Điểm",
      paidAt: row.paidAt ?? row.createdAt,
      providerReference: `PO-${row.orderCode}`,
      destination: {
        bankId: dest.bankId ?? null,
        bankName: dest.bankName ?? null,
        holderName: dest.holderName ?? null,
        accountNumber: dest.accountNumber ?? dest.last4 ?? null,
        verified: Boolean(dest.verified),
      },
      rejectionReason: req.rejectionReason ?? null,
      manualTransferRecorded: Boolean(req.manualTransferRecorded),
      bankTransferReference: req.bankTransferReference ?? null,
      bankTransferredAt: req.bankTransferredAt ?? null,
      bankTransferRecordedAt: req.bankTransferRecordedAt ?? null,
      withdrawnAt: req.withdrawnAt ?? null,
      resolvedBy: req.resolvedBy ?? (["REFUNDED", "REJECTED"].includes(req.status) ? { id: findMockUserByEmail(emails[0])?.id ?? toMockUuid("admin-payos-seed:0"), email: emails[0] } : null),
      holdJournalId: req.holdJournalId ?? (req.eligibility === "ELIGIBLE" ? toMockUuid(`hold:${req.id}`) : null),
      resolveJournalId: req.resolveJournalId ?? (["REFUNDED", "REJECTED"].includes(req.status) ? toMockUuid(`resolve:${req.id}`) : null),
    };
  }
  return null;
}
