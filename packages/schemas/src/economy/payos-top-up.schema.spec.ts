import { payosCheckoutSchema, topUpCreditKey, topUpMismatchNoticeKey, topUpStatusChangedEventSchema } from "./payos-top-up.schema";

describe("payOS checkout amounts", () => {
  it("rejects invalid amounts and strips client points", () => {
    for (const value of [9999, 5_000_200, 10_100, 10.5, "10000"]) {
      expect(payosCheckoutSchema.safeParse({ amountVnd: value }).success).toBe(
        false,
      );
    }
    for (const value of [10_000, 5_000_000])
      expect(payosCheckoutSchema.safeParse({ amountVnd: value }).success).toBe(
        true,
      );
    expect(
      payosCheckoutSchema.parse({ amountVnd: 10_000, points: 999999 }),
    ).toEqual({ amountVnd: 10_000 });
  });
});


describe("payOS status event", () => {
  it("accepts credit and mismatch, preserving distinct idempotency keys", () => {
    const id = "2fb40564-05e2-4496-a043-bb3036001ad1";
    const payload = { schemaVersion: 1, topUpId: id, userId: id, orderCode: 1000000000, amountVnd: 10000, points: 50, occurredAt: "2026-10-15T00:00:00.000Z" };
    expect(topUpStatusChangedEventSchema.safeParse({ ...payload, status: "SUCCESSFUL" }).success).toBe(true);
    expect(topUpStatusChangedEventSchema.safeParse({ ...payload, status: "AMOUNT_MISMATCH", amountPaidVnd: 5000 }).success).toBe(true);
    expect(topUpCreditKey(id)).toBe(`topup-credit:${id}`);
    expect(topUpMismatchNoticeKey(id, 5000)).toBe(`topup-mismatch-notice:${id}:5000`);
  });
});
