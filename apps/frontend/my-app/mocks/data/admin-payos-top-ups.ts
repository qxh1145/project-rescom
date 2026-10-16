import { addBusinessDays, payosTransferContent, type AdminPayosTopUp, type PayosTopUpStatus, type AdminPayosMismatch, type AdminPayosUncredited } from "@rescom/schemas";
import { toMockUuid } from "./auth";
import { payosTopUps, type MockPayosTopUp } from "./top-up";
import { findMockUserByEmail } from "../db/session";
import { loadStore } from "../legacy/store";
import { listTopUpsForReview } from "./admin-top-ups";

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
  });
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
    status: row.status, createdAt: row.createdAt, paidAt: row.paidAt, expiresAt: row.expiresAt, cancelledAt: row.cancelledAt,
  })).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
export function topUpTabCounts() { const { uncredited, mismatches } = adminActionRequired(); return { actionRequired: uncredited.length + mismatches.length, payos: adminPayosRows().length, manual: ["PENDING", "APPROVED", "REJECTED"].reduce((sum, status) => sum + listTopUpsForReview(status as "PENDING" | "APPROVED" | "REJECTED").length, 0) }; }

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
