import {
  createdFormVersionSchema,
  formDetailSchema,
  formListSchema,
  formVersionSummaryListSchema,
  pricingQuoteSchema,
} from "./publisher-form.schema";
import { csrfTokenResponseSchema } from "../auth/csrf.schema";

const version = {
  id: "v1",
  formId: "f1",
  versionNumber: 1,
  schemaJson: { blocks: [] },
  targetingJson: null,
  isPublished: false,
  createdAt: "2026-10-01T00:00:00.000Z",
};
const detail = {
  id: "f1",
  publisherId: "u1",
  type: "INTERNAL",
  status: "DRAFT",
  title: "T",
  rewardPerResponse: 10,
  expectedCompletions: 50,
  currentVersion: version,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

describe("publisher form contracts", () => {
  it("accepts a FormDetailDto and refuses one without its version", () => {
    expect(formDetailSchema.parse(detail).id).toBe("f1");
    expect(formDetailSchema.safeParse({ ...detail, currentVersion: undefined }).success).toBe(false);
    expect(formDetailSchema.safeParse({ ...detail, status: "NOPE" }).success).toBe(false);
  });

  it("keeps unknown backend fields", () => {
    expect(formDetailSchema.parse({ ...detail, extra: 1 })).toHaveProperty("extra", 1);
  });

  it("requires interruptedAttempts on a created version", () => {
    expect(createdFormVersionSchema.safeParse(detail).success).toBe(false);
    expect(createdFormVersionSchema.parse({ ...detail, interruptedAttempts: 2 }).interruptedAttempts).toBe(2);
  });

  it("parses the list, quote, version list and csrf payloads", () => {
    const summary = { ...detail, latestVersionNumber: 1, closeKind: null, completedCompletions: 0, escrowLocked: null };
    expect(formListSchema.parse({ forms: [summary], total: 1, page: 1, limit: 20, totalPages: 1 }).total).toBe(1);
    expect(
      pricingQuoteSchema.safeParse({
        type: "INTERNAL",
        expectedCompletions: 50,
        baseRewardPerResponse: 10,
        effectiveRewardPerResponse: 8,
        baseCost: 500,
        effectiveCost: 400,
        discountPercent: 20,
        discountAmount: 100,
        estimatedDurationMinutes: null,
        pricingBand: null,
        bandCheck: "DURATION_REQUIRED",
      }).success,
    ).toBe(true);
    expect(
      formVersionSummaryListSchema.parse([{ id: "v1", formId: "f1", versionNumber: 1, isPublished: true, publishedAt: null, createdAt: "2026-10-01T00:00:00.000Z" }]),
    ).toHaveLength(1);
    expect(csrfTokenResponseSchema.safeParse({ csrfToken: "" }).success).toBe(false);
    expect(csrfTokenResponseSchema.parse({ csrfToken: "abc" }).csrfToken).toBe("abc");
  });
});
