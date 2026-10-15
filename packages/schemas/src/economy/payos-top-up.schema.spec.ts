import {
  listPayosTopUpsQuerySchema,
  payosCheckoutSchema,
  payosTopUpListSchema,
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
    };
    const page = { items: [item], total: 1, limit: 20, offset: 0, hasMore: false };
    expect(payosTopUpListSchema.safeParse(page).success).toBe(true);
    expect(payosTopUpListSchema.safeParse({ ...page, items: [{ ...item, status: "MANUAL" }] }).success).toBe(false);
    expect(payosTopUpListSchema.safeParse({ ...page, total: -1 }).success).toBe(false);
  });
});
