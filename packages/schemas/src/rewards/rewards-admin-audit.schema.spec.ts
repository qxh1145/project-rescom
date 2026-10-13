import { rewardsAdminAuditEventPayloadSchema } from "./rewards-admin-audit.schema";
import * as rewards from "./index";

const id = "11111111-1111-4111-8111-111111111111";
const payload = { schemaVersion: 1, auditCategory: "REWARDS_ADMIN_ACTION", action: "VOUCHER_CREATED", voucherId: id, adminId: id, before: null, after: { title: "Coffee", stockTotal: 10 }, correlationId: id, occurredAt: "2026-10-13T00:00:00.000Z" };

test("admin audit payload validates identity, action, summary and redacts codes", () => {
  expect(rewards.rewardsAdminAuditEventPayloadSchema).toBe(rewardsAdminAuditEventPayloadSchema);
  expect(rewardsAdminAuditEventPayloadSchema.safeParse(payload).success).toBe(true);
  for (const change of [{ action: "UNKNOWN" }, { schemaVersion: 2 }, { adminId: "invalid" }, { after: { code: "SECRET-123" } }, { occurredAt: "yesterday" }]) {
    expect(rewardsAdminAuditEventPayloadSchema.safeParse({ ...payload, ...change }).success).toBe(false);
  }
});
