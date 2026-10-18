import {
  listPayosTopUpsQuerySchema,
  payosCheckoutSchema,
  payosRecheckResultSchema,
  payosTopUpListSchema,
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

describe("payOS top-up list schemas", () => {
  it("validates listPayosTopUpsQuerySchema defaults and bounds", () => {
    const defaultQuery = listPayosTopUpsQuerySchema.parse({});
    expect(defaultQuery.limit).toBe(20);
    expect(defaultQuery.offset).toBe(0);

    const coerced = listPayosTopUpsQuerySchema.parse({ limit: "10", offset: "5" });
    expect(coerced.limit).toBe(10);
    expect(coerced.offset).toBe(5);

    expect(listPayosTopUpsQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(listPayosTopUpsQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(listPayosTopUpsQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
  });

  it("validates payosTopUpListSchema", () => {
    const item = {
      id: "11111111-1111-4111-8111-111111111111",
      orderCode: 1,
      amountVnd: 10_000,
      points: 50,
      status: "PROCESSING",
      checkoutUrl: null,
      expiresAt: "2026-10-15T12:00:00.000Z",
      cancelledAt: null,
      paidAt: null,
      createdAt: "2026-10-15T11:55:00.000Z",
      refundDeadline: null,
      refund: {
        canRequest: false,
        unavailableReason: "NOT_SUCCESSFUL",
        request: null,
        destination: null,
      },
    };
    const page = { items: [item], total: 1, limit: 20, offset: 0, hasMore: false };
    expect(payosTopUpListSchema.safeParse(page).success).toBe(true);
    // Pre-13.11 BE payload (no refund.destination) still parses.
    const { destination: _omit, ...legacyRefund } = item.refund;
    expect(payosTopUpListSchema.safeParse({ ...page, items: [{ ...item, refund: legacyRefund }] }).success).toBe(true);
    expect(payosTopUpListSchema.safeParse({ ...page, items: [{ ...item, status: "MANUAL" }] }).success).toBe(false);
    expect(payosTopUpListSchema.safeParse({ ...page, total: -1 }).success).toBe(false);
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

