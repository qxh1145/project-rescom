import type { FormTopic } from "@rescom/schemas";
import { createCollection, hoursAgo } from "../db/store";
import { ANALYTICS_FORM_IDS, analyticsRespondentSurveys } from "./form-analytics-seed";

/**
 * Shared survey catalog for every respondent/publisher mock (marketplace,
 * participation, Google Forms, publisher dashboards). Content = Figma page 3
 * "Khám phá khảo sát" (62:582). Ids are fixed so handlers in different files
 * (and deep links while testing) agree.
 *
 * Ownership: fields below are shared; domain-specific data lives next to the
 * domain (e.g. `survey-content.ts` for in-Rescom questions) keyed by these ids.
 */
export const SURVEY_IDS = {
  onlineShopping: "5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e01",
  aiStudyHabits: "5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e02",
  librarySatisfaction: "5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e03",
  studyStressSleep: "5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e04",
  eScooterIntent: "5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e05",
  housingNearCampus: "5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e06",
  /** Running survey of the demo publisher, seeded in `form-analytics-seed.ts` (no responses yet). */
  groupStudy: ANALYTICS_FORM_IDS.groupStudy,
} as const;

export type SurveyType = "INTERNAL" | "EXTERNAL";
export type MockSurveyStatus = "PUBLISHED" | "CLOSED";

export interface MockSurvey {
  id: string;
  /** Current published version (answers are tied to a version — page 17a). */
  formVersionId: string;
  versionNumber: number;
  title: string;
  description: string | null;
  type: SurveyType;
  status: MockSurveyStatus;
  rewardPerResponse: number;
  expectedCompletions: number;
  completedCompletions: number;
  estimatedEffortSeconds: number;
  /** Plan 2.2: shared `FORM_TOPICS` value (the card shows its label). */
  topic: FormTopic | null;
  /** Figma 4 "Người đăng". ASSUMED display field. */
  publisherName: string;
  /** Google Forms URL for EXTERNAL surveys. */
  externalUrl: string | null;
  publishedAt: string;
}

const version = (n: number) => `6b1d2e3f-4a5b-4c6d-9e7f-00000000000${n}`;

function seed(): MockSurvey[] {
  return [
    {
      id: SURVEY_IDS.onlineShopping,
      formVersionId: version(1),
      versionNumber: 1,
      title: "Hành vi mua sắm online của sinh viên Đà Nẵng",
      description: "Khảo sát thói quen và mức độ tin tưởng khi mua sắm trên sàn thương mại điện tử.",
      type: "INTERNAL",
      status: "PUBLISHED",
      rewardPerResponse: 12,
      expectedCompletions: 100,
      completedCompletions: 62,
      estimatedEffortSeconds: 5 * 60,
      topic: "MARKETING",
      publisherName: "Nhóm Capstone MKT",
      externalUrl: null,
      publishedAt: hoursAgo(72),
    },
    {
      id: SURVEY_IDS.aiStudyHabits,
      formVersionId: version(2),
      versionNumber: 1,
      title: "Thói quen dùng AI trong học tập của sinh viên IT",
      description: "Bạn dùng công cụ AI thế nào khi học? Khảo sát trên Google Forms.",
      type: "EXTERNAL",
      status: "PUBLISHED",
      rewardPerResponse: 18,
      expectedCompletions: 80,
      completedCompletions: 68,
      estimatedEffortSeconds: 8 * 60,
      topic: "IT",
      publisherName: "CLB Nghiên cứu AI",
      externalUrl: "https://docs.google.com/forms/d/e/mock-ai-study-habits/viewform",
      publishedAt: hoursAgo(50),
    },
    {
      id: SURVEY_IDS.librarySatisfaction,
      formVersionId: version(3),
      versionNumber: 1,
      title: "Mức độ hài lòng với thư viện trường",
      description: null,
      type: "INTERNAL",
      status: "PUBLISHED",
      rewardPerResponse: 8,
      expectedCompletions: 60,
      completedCompletions: 6,
      estimatedEffortSeconds: 3 * 60,
      topic: "BUSINESS",
      publisherName: "Nhóm SWP QTKD",
      externalUrl: null,
      publishedAt: hoursAgo(20),
    },
    {
      id: SURVEY_IDS.studyStressSleep,
      formVersionId: version(4),
      versionNumber: 1,
      title: "Áp lực học tập và giấc ngủ của sinh viên năm nhất",
      description: null,
      type: "INTERNAL",
      status: "PUBLISHED",
      rewardPerResponse: 22,
      expectedCompletions: 150,
      completedCompletions: 130,
      estimatedEffortSeconds: 10 * 60,
      topic: "SOCIAL_SCIENCES",
      publisherName: "Nhóm Tâm lý K18",
      externalUrl: null,
      publishedAt: hoursAgo(120),
    },
    {
      id: SURVEY_IDS.eScooterIntent,
      formVersionId: version(5),
      versionNumber: 1,
      title: "Ý định sử dụng xe điện cá nhân",
      description: null,
      type: "EXTERNAL",
      status: "PUBLISHED",
      rewardPerResponse: 10,
      expectedCompletions: 50,
      completedCompletions: 9,
      estimatedEffortSeconds: 6 * 60,
      topic: "BUSINESS",
      publisherName: "Nhóm KT Xanh",
      externalUrl: "https://docs.google.com/forms/d/e/mock-e-scooter/viewform",
      publishedAt: hoursAgo(30),
    },
    {
      id: SURVEY_IDS.housingNearCampus,
      formVersionId: version(6),
      versionNumber: 1,
      title: "Nhu cầu nhà trọ gần trường",
      description: null,
      type: "INTERNAL",
      status: "CLOSED",
      rewardPerResponse: 12,
      expectedCompletions: 20,
      completedCompletions: 20,
      estimatedEffortSeconds: 6 * 60,
      topic: "BUSINESS",
      // Owned by the demo publisher in page 10 (Khảo sát của tôi).
      publisherName: "Lê Nhật Minh",
      externalUrl: null,
      publishedAt: hoursAgo(24 * 12),
    },
    ...analyticsRespondentSurveys(),
  ];
}

export const surveys = createCollection<MockSurvey[]>("surveys", seed);

export function findSurvey(id: string): MockSurvey | undefined {
  return surveys.get().find((survey) => survey.id === id);
}

export function updateSurvey(id: string, mutator: (survey: MockSurvey) => void): MockSurvey | undefined {
  return surveys
    .update((all) => {
      const target = all.find((survey) => survey.id === id);
      if (target) mutator(target);
    })
    .find((survey) => survey.id === id);
}

/**
 * Surveys each user has completed (Figma: "Nhu cầu nhà trọ gần trường" shows
 * "Đã hoàn thành" for the demo respondent).
 */
export const completedSurveys = createCollection<Record<string, string[]>>("completed-surveys", () => ({}));

export function completedSurveyIdsOf(userId: string, email: string): string[] {
  const existing = completedSurveys.get()[userId];
  if (existing) return existing;
  const seeded = email === "minh.le@fpt.edu.vn" ? [SURVEY_IDS.housingNearCampus] : [];
  completedSurveys.update((all) => {
    all[userId] = seeded;
  });
  return seeded;
}

export function markSurveyCompleted(userId: string, email: string, surveyId: string): void {
  completedSurveyIdsOf(userId, email);
  completedSurveys.update((all) => {
    if (!all[userId].includes(surveyId)) all[userId].push(surveyId);
  });
}
