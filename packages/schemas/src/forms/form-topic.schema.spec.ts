import {
  FORM_TOPICS,
  FORM_TOPIC_SEARCH_TERMS,
  LEGACY_FORM_TOPICS,
  checkFormDeadline,
  formDeadlineAtSchema,
  formTopicEnum,
  matchesSurveySearch,
  normalizeSearchText,
} from "./form-topic.schema";

describe("form topics (plan 2.2)", () => {
  it("every topic has search terms and the enum accepts only the shared values", () => {
    for (const topic of FORM_TOPICS) {
      expect(FORM_TOPIC_SEARCH_TERMS[topic].length).toBeGreaterThan(0);
      expect(formTopicEnum.parse(topic)).toBe(topic);
    }
    expect(formTopicEnum.safeParse("Kinh tế").success).toBe(false);
    expect(formTopicEnum.safeParse("HEALTH").success).toBe(false);
  });

  it("every pre-2026-10-05 topic maps to a current one", () => {
    for (const topic of Object.values(LEGACY_FORM_TOPICS)) expect(FORM_TOPICS).toContain(topic);
    expect(LEGACY_FORM_TOPICS.HEALTH).toBe("MENTAL_HEALTH");
  });

  it("normalizes Vietnamese text for search", () => {
    expect(normalizeSearchText("  Đời   SỐNG sinh viên ")).toBe("doi song sinh vien");
    expect(normalizeSearchText("Công nghệ")).toBe("cong nghe");
  });

  it("matches title, description and topic ignoring case and diacritics", () => {
    const survey = { title: "Thói quen ngủ", description: "Khảo sát về giấc ngủ", topic: "IT" as const };
    expect(matchesSurveySearch(survey, "")).toBe(true);
    expect(matchesSurveySearch(survey, "thoi quen")).toBe(true);
    expect(matchesSurveySearch(survey, "GIẤC")).toBe(true);
    expect(matchesSurveySearch(survey, "cntt")).toBe(true);
    expect(matchesSurveySearch(survey, "cong nghe thong tin")).toBe(true);
    expect(matchesSurveySearch(survey, "it")).toBe(true);
    expect(matchesSurveySearch(survey, "marketing")).toBe(false);
    expect(matchesSurveySearch({ title: "A", topic: null }, "khac")).toBe(false);
    expect(matchesSurveySearch({ title: "A", topic: "OTHER" }, "khác")).toBe(true);
    expect(matchesSurveySearch({ title: "A", topic: "MENTAL_HEALTH" }, "suc khoe tinh than")).toBe(true);
    expect(matchesSurveySearch({ title: "A", topic: "AI" }, "trí tuệ")).toBe(true);
  });
});

describe("form deadline (IR.2b Q1)", () => {
  const now = new Date("2026-10-01T00:00:00.000Z");

  it("accepts ISO instants only", () => {
    expect(formDeadlineAtSchema.safeParse("2026-10-15T00:00:00.000Z").success).toBe(true);
    expect(formDeadlineAtSchema.safeParse("15/10/2026").success).toBe(false);
  });

  it("requires 1 hour to 180 days of lead time", () => {
    expect(checkFormDeadline(new Date(now.getTime() + 59 * 60_000), now)).toBe("TOO_SOON");
    expect(checkFormDeadline(new Date(now.getTime() + 60 * 60_000), now)).toBeNull();
    expect(checkFormDeadline(new Date(now.getTime() + 180 * 86_400_000), now)).toBeNull();
    expect(checkFormDeadline(new Date(now.getTime() + 180 * 86_400_000 + 1), now)).toBe("TOO_LATE");
  });
});
