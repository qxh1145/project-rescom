import {
  SCHOOL_YEAR_VALUES,
  USER_GOALS,
  USER_PROFILE_DISPLAY_NAME_MAX,
  USER_PROFILE_SCHOOL_MAX,
  hasProfileControlCharacters,
  isBirthYearAllowed,
  updateUserProfileSchema,
  userProfileSchema,
} from "./user-profile.schema";

describe("User profile contract (Story IR.4b part A, FR-9)", () => {
  const issuePaths = (input: unknown) => {
    const result = updateUserProfileSchema.safeParse(input);
    return result.success ? [] : result.error.issues.map((issue) => issue.path);
  };

  it("lists the goals and school years the frontend offers", () => {
    expect([...USER_GOALS]).toEqual(["EARN", "COLLECT", "BOTH"]);
    expect([...SCHOOL_YEAR_VALUES]).toEqual([
      "Năm 1",
      "Năm 2",
      "Năm 3",
      "Năm 4",
      "Năm 5+",
    ]);
  });

  it("accepts the full onboarding patch and trims text", () => {
    expect(
      updateUserProfileSchema.parse({
        displayName: "  Linh Nguyễn ",
        birthYear: 2005,
        school: " Trường Đại học FPT – Đà Nẵng ",
        schoolYear: "Năm 3",
        goal: "BOTH",
      }),
    ).toEqual({
      displayName: "Linh Nguyễn",
      birthYear: 2005,
      school: "Trường Đại học FPT – Đà Nẵng",
      schoolYear: "Năm 3",
      goal: "BOTH",
    });
  });

  it("accepts an empty patch as a no-op and keeps absent keys absent", () => {
    expect(updateUserProfileSchema.parse({})).toEqual({});
    expect(
      Object.keys(updateUserProfileSchema.parse({ goal: "EARN" })),
    ).toEqual(["goal"]);
  });

  it("keeps an explicit null so the field is cleared", () => {
    expect(
      updateUserProfileSchema.parse({
        displayName: null,
        birthYear: null,
        school: null,
        schoolYear: null,
        goal: null,
      }),
    ).toEqual({
      displayName: null,
      birthYear: null,
      school: null,
      schoolYear: null,
      goal: null,
    });
  });

  it("normalizes blank text to null", () => {
    expect(
      updateUserProfileSchema.parse({ displayName: "   ", school: "" }),
    ).toEqual({ displayName: null, school: null });
  });

  it("bounds the display name at 50 and the school at 200 characters after trimming", () => {
    const name = "a".repeat(USER_PROFILE_DISPLAY_NAME_MAX);
    expect(
      updateUserProfileSchema.parse({ displayName: ` ${name} ` }).displayName,
    ).toBe(name);
    expect(issuePaths({ displayName: `${name}b` })).toEqual([["displayName"]]);

    const school = "s".repeat(USER_PROFILE_SCHOOL_MAX);
    expect(updateUserProfileSchema.parse({ school }).school).toBe(school);
    expect(issuePaths({ school: `${school}s` })).toEqual([["school"]]);
  });

  it("removes lone surrogates and keeps emoji", () => {
    expect(
      updateUserProfileSchema.parse({ displayName: "Linh\uD800 \uD83D\uDE00" })
        .displayName,
    ).toBe("Linh \uD83D\uDE00");
    expect(
      updateUserProfileSchema.parse({ displayName: "\uDC00 " }).displayName,
    ).toBeNull();
  });

  it.each([
    ["a tab", "Linh\tNguyễn"],
    ["a line break", "Linh\nNguyễn"],
    ["a bell", "Linh\u0007"],
    ["a C1 control", "Linh\u0085"],
    ["a bidi override", "Linh\u202Egnoh"],
    ["a bidi isolate", "\u2066Linh\u2069"],
  ])("rejects %s in text fields", (_label, value) => {
    expect(hasProfileControlCharacters(value)).toBe(true);
    expect(issuePaths({ displayName: value })).toEqual([["displayName"]]);
    expect(issuePaths({ school: value })).toEqual([["school"]]);
  });

  it("keeps the zero-width joiner used by emoji sequences", () => {
    const family = "\uD83D\uDC69\u200D\uD83D\uDC67";
    expect(hasProfileControlCharacters(family)).toBe(false);
    expect(
      updateUserProfileSchema.parse({ displayName: family }).displayName,
    ).toBe(family);
  });

  it("rejects unknown keys, bad enums and non-integer birth years", () => {
    expect(issuePaths({ role: "ADMIN" })).toEqual([[]]);
    expect(issuePaths({ goal: "ADMIN" })).toEqual([["goal"]]);
    expect(issuePaths({ schoolYear: "Năm 6" })).toEqual([["schoolYear"]]);
    expect(issuePaths({ schoolYear: "" })).toEqual([["schoolYear"]]);
    expect(issuePaths({ birthYear: 2005.5 })).toEqual([["birthYear"]]);
    expect(issuePaths({ birthYear: "2005" })).toEqual([["birthYear"]]);
    expect(issuePaths({ displayName: 42 })).toEqual([["displayName"]]);
  });

  it("reports errors in the zod format() tree under the field", () => {
    const result = updateUserProfileSchema.safeParse({
      displayName: "x".repeat(51),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.format().displayName?._errors).toEqual([
        "Display name cannot exceed 50 characters",
      ]);
    }
  });

  it("allows birth years that give an age of 13 to 100", () => {
    expect(isBirthYearAllowed(2013, 2026)).toBe(true);
    expect(isBirthYearAllowed(1926, 2026)).toBe(true);
    expect(isBirthYearAllowed(2014, 2026)).toBe(false);
    expect(isBirthYearAllowed(1925, 2026)).toBe(false);
    expect(isBirthYearAllowed(2030, 2026)).toBe(false);
    expect(isBirthYearAllowed(2005.5, 2026)).toBe(false);
    expect(isBirthYearAllowed(Number.NaN, 2026)).toBe(false);
  });

  it("parses the response: all null for a user without a profile, strict on keys", () => {
    const empty = {
      displayName: null,
      birthYear: null,
      school: null,
      schoolYear: null,
      goal: null,
    };
    expect(userProfileSchema.parse(empty)).toEqual(empty);
    // A school year stored before a catalog change still parses.
    expect(
      userProfileSchema.safeParse({ ...empty, schoolYear: "Năm 6" }).success,
    ).toBe(true);
    expect(
      userProfileSchema.safeParse({ ...empty, userId: "x" }).success,
    ).toBe(false);
    expect(userProfileSchema.safeParse({ ...empty, goal: "X" }).success).toBe(
      false,
    );
    expect(userProfileSchema.safeParse({ displayName: null }).success).toBe(
      false,
    );
  });
});
