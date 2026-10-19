import { MAX_PAGINATION_OFFSET } from "../common/pagination.schema";
import { listUsersQuerySchema, updateUserStatusSchema } from "./admin-users.schema";

describe("listUsersQuerySchema pagination bounds", () => {
  it("accepts page up to MAX_PAGINATION_OFFSET", () => {
    expect(listUsersQuerySchema.parse({}).page).toBe(1);
    expect(
      listUsersQuerySchema.parse({ page: String(MAX_PAGINATION_OFFSET) }).page,
    ).toBe(MAX_PAGINATION_OFFSET);
  });

  it("rejects an unbounded page instead of reaching the database skip", () => {
    for (const page of ["1e20", String(MAX_PAGINATION_OFFSET + 1)]) {
      const result = listUsersQuerySchema.safeParse({ page });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(["page"]);
      }
    }
  });
});

describe("updateUserStatusSchema", () => {
  it("requires an audit reason when locking and accepts unlock without one", () => {
    expect(updateUserStatusSchema.safeParse({ status: "LOCKED" }).success).toBe(false);
    expect(updateUserStatusSchema.safeParse({ status: "LOCKED", reason: "Vi phạm lặp lại" }).success).toBe(true);
    expect(updateUserStatusSchema.safeParse({ status: "ACTIVE" }).success).toBe(true);
  });
});

describe("admin point credit schemas", () => {
  const validCreditInput = {
    amount: 100,
    reason: "Hoàn tiền hỗ trợ người dùng",
    idempotencyKey: "123e4567-e89b-12d3-a456-426614174000",
  };

  it("accepts valid credit input", () => {
    const { createAdminPointCreditSchema } = require("./admin-users.schema");
    const parsed = createAdminPointCreditSchema.parse(validCreditInput);
    expect(parsed.amount).toBe(100);
    expect(parsed.reason).toBe("Hoàn tiền hỗ trợ người dùng");
  });

  it("rejects extra keys in createAdminPointCreditSchema", () => {
    const { createAdminPointCreditSchema } = require("./admin-users.schema");
    const result = createAdminPointCreditSchema.safeParse({
      ...validCreditInput,
      extra: "not allowed",
    });
    expect(result.success).toBe(false);
  });

  it("validates amount bounds: rejects 0, floats, and max+1", () => {
    const {
      createAdminPointCreditSchema,
      ADMIN_POINT_CREDIT_MAX_AMOUNT,
    } = require("./admin-users.schema");
    expect(
      createAdminPointCreditSchema.safeParse({ ...validCreditInput, amount: 0 })
        .success,
    ).toBe(false);
    expect(
      createAdminPointCreditSchema.safeParse({
        ...validCreditInput,
        amount: 1.5,
      }).success,
    ).toBe(false);
    expect(
      createAdminPointCreditSchema.safeParse({
        ...validCreditInput,
        amount: ADMIN_POINT_CREDIT_MAX_AMOUNT + 1,
      }).success,
    ).toBe(false);
    expect(
      createAdminPointCreditSchema.safeParse({
        ...validCreditInput,
        amount: ADMIN_POINT_CREDIT_MAX_AMOUNT,
      }).success,
    ).toBe(true);
  });

  it("validates reason length after trim (min 10, max 500)", () => {
    const { createAdminPointCreditSchema } = require("./admin-users.schema");
    // 9 chars after trim
    expect(
      createAdminPointCreditSchema.safeParse({
        ...validCreditInput,
        reason: "  123456789  ",
      }).success,
    ).toBe(false);
    // 10 chars after trim
    expect(
      createAdminPointCreditSchema.safeParse({
        ...validCreditInput,
        reason: "  1234567890  ",
      }).success,
    ).toBe(true);
    // 501 chars
    expect(
      createAdminPointCreditSchema.safeParse({
        ...validCreditInput,
        reason: "a".repeat(501),
      }).success,
    ).toBe(false);
    // 500 chars
    expect(
      createAdminPointCreditSchema.safeParse({
        ...validCreditInput,
        reason: "a".repeat(500),
      }).success,
    ).toBe(true);
  });

  it("rejects non-uuid idempotencyKey", () => {
    const { createAdminPointCreditSchema } = require("./admin-users.schema");
    expect(
      createAdminPointCreditSchema.safeParse({
        ...validCreditInput,
        idempotencyKey: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("validates adminPointCreditSchema and adminPointCreditListSchema", () => {
    const {
      adminPointCreditSchema,
      adminPointCreditListSchema,
    } = require("./admin-users.schema");
    const validCredit = {
      journalId: "123e4567-e89b-12d3-a456-426614174001",
      userId: "123e4567-e89b-12d3-a456-426614174002",
      amount: 500,
      reason: "Hỗ trợ sự cố hệ thống",
      createdAt: new Date().toISOString(),
      replayed: false,
    };
    expect(adminPointCreditSchema.safeParse(validCredit).success).toBe(true);

    const validItem = {
      journalId: "123e4567-e89b-12d3-a456-426614174001",
      amount: 500,
      reason: "Hỗ trợ sự cố hệ thống",
      createdAt: new Date().toISOString(),
      reversed: true,
      reversalJournalId: "123e4567-e89b-12d3-a456-426614174003",
      reversedAt: new Date().toISOString(),
    };
    expect(
      adminPointCreditListSchema.safeParse({ items: [validItem] }).success,
    ).toBe(true);
  });

  it("validates adminPointsCreditedPayloadSchema", () => {
    const {
      adminPointsCreditedPayloadSchema,
      ADMIN_POINTS_CREDITED_EVENT_TYPE,
    } = require("./admin-users.schema");
    expect(ADMIN_POINTS_CREDITED_EVENT_TYPE).toBe("AdminPointsCredited");
    expect(
      adminPointsCreditedPayloadSchema.safeParse({
        journalId: "123e4567-e89b-12d3-a456-426614174001",
        userId: "123e4567-e89b-12d3-a456-426614174002",
        amount: 250,
        reason: "Tặng thưởng khảo sát",
        actorId: "123e4567-e89b-12d3-a456-426614174003",
      }).success,
    ).toBe(true);
  });
});

