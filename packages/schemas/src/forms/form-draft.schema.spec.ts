import { MAX_PAGINATION_OFFSET } from "../common/pagination.schema";
import { listFormsQuerySchema } from "./form-draft.schema";

describe("listFormsQuerySchema pagination bounds", () => {
  it("accepts page up to MAX_PAGINATION_OFFSET", () => {
    expect(listFormsQuerySchema.parse({}).page).toBe(1);
    expect(
      listFormsQuerySchema.parse({ page: String(MAX_PAGINATION_OFFSET) }).page,
    ).toBe(MAX_PAGINATION_OFFSET);
  });

  it("rejects an unbounded page instead of reaching the database skip", () => {
    for (const page of ["1e20", String(MAX_PAGINATION_OFFSET + 1)]) {
      const result = listFormsQuerySchema.safeParse({ page });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(["page"]);
      }
    }
  });
});
