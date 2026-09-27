import { parseStoredTargeting } from "./stored-targeting";

describe("parseStoredTargeting (Epic 4 review P12)", () => {
  it("treats null/undefined as open to all", () => {
    expect(parseStoredTargeting(null)).toEqual({ ok: true, targeting: null });
    expect(parseStoredTargeting(undefined)).toEqual({ ok: true, targeting: null });
  });

  it("accepts valid criteria, including empty objects and empty arrays", () => {
    expect(parseStoredTargeting({})).toEqual({ ok: true, targeting: {} });
    expect(parseStoredTargeting({ locations: [] })).toEqual({
      ok: true,
      targeting: { locations: [] },
    });
    expect(
      parseStoredTargeting({ ageRange: { min: 18, max: 25 }, genders: ["FEMALE"] }),
    ).toEqual({
      ok: true,
      targeting: { ageRange: { min: 18, max: 25 }, genders: ["FEMALE"] },
    });
  });

  it.each([
    ["unknown key", { foo: 1 }],
    ["non-string location entry", { locations: [1] }],
    ["non-array criterion", { locations: "Hà Nội" }],
    ["unknown gender", { genders: ["ROBOT"] }],
    ["inverted age range", { ageRange: { min: 40, max: 20 } }],
    ["non-object", "everyone"],
  ])("fails closed on malformed targeting (%s)", (_label, raw) => {
    expect(parseStoredTargeting(raw)).toEqual({ ok: false });
  });
});
