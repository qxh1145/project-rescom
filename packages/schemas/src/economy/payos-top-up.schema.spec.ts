import { payosCheckoutSchema } from "./payos-top-up.schema";

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
