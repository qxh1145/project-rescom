import {
  adminPayosTopUpSchema,
  exportAdminPayosTopUpsSchema,
  listAdminPayosTopUpsQuerySchema,
} from "./payos-top-up.schema";

describe("admin PayOS contracts", () => {
  it("allows only safe DTO fields", () => {
    const row = {
      id: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      orderCode: 123,
      userEmail: null,
      amountVnd: 20000,
      points: 100,
      pointsCredited: null,
      amountPaidVnd: null,
      status: "PROCESSING",
      createdAt: "2026-10-16T00:00:00.000Z",
      paidAt: null,
      expiresAt: "2026-10-16T00:05:00.000Z",
      cancelledAt: null,
    };
    expect(Object.keys(adminPayosTopUpSchema.parse(row)).sort()).toEqual(
      Object.keys(row).sort(),
    );
    expect(
      adminPayosTopUpSchema.safeParse({ ...row, counterAccountNumber: "123" })
        .success,
    ).toBe(false);
  });
  it("validates query dates and limits", () => {
    expect(
      listAdminPayosTopUpsQuerySchema.parse({ limit: "10", offset: "0" }).limit,
    ).toBe(10);
    expect(
      listAdminPayosTopUpsQuerySchema.safeParse({
        from: "2026-10-17",
        to: "2026-10-16",
      }).success,
    ).toBe(false);
    expect(
      listAdminPayosTopUpsQuerySchema.safeParse({ from: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      listAdminPayosTopUpsQuerySchema.safeParse({ limit: "999" }).success,
    ).toBe(false);
  });
  it("caps export range at 366 inclusive days", () => {
    expect(
      exportAdminPayosTopUpsSchema.safeParse({
        from: "2024-01-01",
        to: "2024-12-31",
      }).success,
    ).toBe(true);
    expect(
      exportAdminPayosTopUpsSchema.safeParse({
        from: "2024-01-01",
        to: "2025-01-01",
      }).success,
    ).toBe(false);
  });
});
