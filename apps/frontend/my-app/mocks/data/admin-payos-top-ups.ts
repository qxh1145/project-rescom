import type { AdminPayosTopUp, PayosTopUpStatus } from "@rescom/schemas";
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
        amountVnd: 20_000 * (i + 1), points: 100 * (i + 1), status,
        createdAt, paidAt: ["SUCCESSFUL", "AMOUNT_MISMATCH", "MANUAL_REFUNDED"].includes(status) ? createdAt : null,
        expiresAt: new Date(Date.parse(createdAt) + 300_000).toISOString(), cancelledAt: status === "CANCELLED" ? createdAt : null,
        checkoutUrl: null,
      };
      data[userId] = [...(data[userId] ?? []), row];
    }
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
    pointsCredited: row.status === "SUCCESSFUL" ? row.points : null,
    amountPaidVnd: row.paidAt ? row.amountVnd : null,
    status: row.status, createdAt: row.createdAt, paidAt: row.paidAt, expiresAt: row.expiresAt, cancelledAt: row.cancelledAt,
  })).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
export function topUpTabCounts() { return { payos: adminPayosRows().length, manual: ["PENDING", "APPROVED", "REJECTED"].reduce((sum, status) => sum + listTopUpsForReview(status as "PENDING" | "APPROVED" | "REJECTED").length, 0) }; }
