import {
  AUDIENCE_ESTIMATE_MIN_REPORTABLE,
  audienceEstimateInputSchema,
  audienceEstimateSchema,
  toAudienceEstimate,
} from "./audience-estimate.schema";

describe("audience estimate (mock-off plan 5.5)", () => {
  it("hides every count below the minimum reportable group", () => {
    for (const count of [0, 1, 5, AUDIENCE_ESTIMATE_MIN_REPORTABLE - 1]) {
      expect(toAudienceEstimate(count)).toEqual({
        estimatedRespondents: null,
        minimumReportable: AUDIENCE_ESTIMATE_MIN_REPORTABLE,
      });
    }
  });

  it("rounds to 10 below 1 000 and to 100 from 1 000, never below the minimum", () => {
    expect(toAudienceEstimate(10).estimatedRespondents).toBe(10);
    expect(toAudienceEstimate(14).estimatedRespondents).toBe(10);
    expect(toAudienceEstimate(15).estimatedRespondents).toBe(20);
    expect(toAudienceEstimate(994).estimatedRespondents).toBe(990);
    expect(toAudienceEstimate(999).estimatedRespondents).toBe(1000);
    expect(toAudienceEstimate(1049).estimatedRespondents).toBe(1000);
    expect(toAudienceEstimate(2450).estimatedRespondents).toBe(2500);
  });

  it("fails closed on a non-finite count", () => {
    expect(toAudienceEstimate(Number.NaN).estimatedRespondents).toBeNull();
  });

  it("output always satisfies the shared response schema", () => {
    for (const count of [0, 9, 10, 123, 4567]) {
      expect(
        audienceEstimateSchema.safeParse(toAudienceEstimate(count)).success,
      ).toBe(true);
    }
  });

  it("accepts the strict targeting contract and rejects UI-only or unknown keys", () => {
    expect(
      audienceEstimateInputSchema.safeParse({
        targeting: {
          ageRange: { min: 18, max: 22 },
          genders: ["FEMALE"],
          locations: ["Hà Nội"],
        },
      }).success,
    ).toBe(true);
    expect(
      audienceEstimateInputSchema.safeParse({ targeting: {} }).success,
    ).toBe(true);
    expect(
      audienceEstimateInputSchema.safeParse({ targeting: { schools: ["FPT"] } })
        .success,
    ).toBe(false);
    expect(
      audienceEstimateInputSchema.safeParse({ targeting: {}, extra: 1 })
        .success,
    ).toBe(false);
    expect(audienceEstimateInputSchema.safeParse({}).success).toBe(false);
  });
});
