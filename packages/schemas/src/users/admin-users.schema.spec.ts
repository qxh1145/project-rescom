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
