import {
  payosCheckoutSchema,
  payosRecheckResultSchema,
  topUpAdminAlertEventSchema,
  topUpAlertKey,
  topUpCreditKey,
  topUpExpireKey,
  topUpMismatchNoticeKey,
  topUpStatusChangedEventSchema,
} from "./payos-top-up.schema";

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
  it("accepts credit, mismatch, and expired, preserving distinct idempotency keys", () => {
    const id = "2fb40564-05e2-4496-a043-bb3036001ad1";
    const payload = {
      schemaVersion: 1,
      topUpId: id,
      userId: id,
      orderCode: 1000000000,
      amountVnd: 10000,
      points: 50,
      occurredAt: "2026-10-15T00:00:00.000Z",
    };
    expect(
      topUpStatusChangedEventSchema.safeParse({ ...payload, status: "SUCCESSFUL" })
        .success,
    ).toBe(true);
    expect(
      topUpStatusChangedEventSchema.safeParse({
        ...payload,
        status: "AMOUNT_MISMATCH",
        amountPaidVnd: 5000,
      }).success,
    ).toBe(true);
    expect(
      topUpStatusChangedEventSchema.safeParse({ ...payload, status: "EXPIRED" })
        .success,
    ).toBe(true);
    expect(
      topUpStatusChangedEventSchema.safeParse({ ...payload, status: "CANCELLED" })
        .success,
    ).toBe(true);
    expect(topUpCreditKey(id)).toBe(`topup-credit:${id}`);
    expect(topUpExpireKey(id)).toBe(`topup-expire:${id}`);
    expect(topUpMismatchNoticeKey(id, 5000)).toBe(
      `topup-mismatch-notice:${id}:5000`,
    );
  });
});

describe("payOS admin alert event and keys", () => {
  it("validates admin alert schema and builds alert keys", () => {
    const topUpId = "2fb40564-05e2-4496-a043-bb3036001ad1";
    const alert = {
      schemaVersion: 1,
      condition: "UNCREDITED_AFTER_PAYMENT",
      topUpId,
      orderCode: 1000000000,
      amountVnd: 20000,
      amountPaidVnd: 20000,
      occurredAt: "2026-10-15T00:00:00.000Z",
    };
    expect(topUpAdminAlertEventSchema.safeParse(alert).success).toBe(true);
    expect(topUpAlertKey("UNCREDITED_AFTER_PAYMENT", topUpId)).toBe(
      `topup-alert:UNCREDITED_AFTER_PAYMENT:${topUpId}`,
    );
    expect(
      topUpAlertKey("PROVIDER_FAILURE", "2026-10-15T00:00:00.000Z"),
    ).toBe("topup-alert:PROVIDER_FAILURE:2026-10-15T00:00:00.000Z");
  });
});

describe("payOS recheck result schema", () => {
  it("validates recheck result payload", () => {
    const topUpId = "2fb40564-05e2-4496-a043-bb3036001ad1";
    expect(
      payosRecheckResultSchema.safeParse({
        topUpId,
        result: "CREDITED",
        status: "SUCCESSFUL",
        amountPaidVnd: 20000,
      }).success,
    ).toBe(true);
    expect(
      payosRecheckResultSchema.safeParse({
        topUpId,
        result: "STILL_UNPAID",
        status: "PROCESSING",
        amountPaidVnd: null,
      }).success,
    ).toBe(true);
  });
});

