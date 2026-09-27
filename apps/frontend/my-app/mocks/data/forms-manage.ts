import type { SurveyFeedbackIssueTag } from "@rescom/schemas";
import { createCollection, hoursAgo } from "../db/store";
import { PUBLISHER_FORM_IDS } from "./forms";

/**
 * Tracking data of the publisher surveys (Figma 10a "Theo dõi khảo sát",
 * 62:2565 / 62:3292), keyed by `MockPublisherForm.id`. Served by
 * `GET /forms/:id/progress` (ASSUMED) in `handlers/forms-manage.ts`.
 * Counts derived from the form (completed, escrow) live on the form itself.
 */

export type OpensRange = "hour" | "day" | "week" | "month";

export interface MockDispute {
  id: string;
  status: "OPEN" | "UPHELD" | "DISMISSED";
  reason: "LOW_EFFORT" | "NO_MATCHING_RESPONSE" | "DUPLICATE_RESPONDENT" | "OTHER";
  description: string;
  createdAt: string;
}

/** A Google Forms completion still inside its 48h review (disputable, FR-24). */
export interface MockPendingAttempt {
  attemptId: string;
  respondentCode: string;
  codeVerifiedAt: string;
  dispute: MockDispute | null;
}

export interface MockFormTracking {
  opens: Record<OpensRange, { label: string; count: number }[]>;
  started: number;
  abandoned: number;
  averageDurationSeconds: number | null;
  pendingAttempts: MockPendingAttempt[];
  feedback: {
    count: number;
    averageRating: number | null;
    issues: { tag: SurveyFeedbackIssueTag; percent: number }[];
  };
}

const WEEK_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const HOUR_LABELS = ["0h", "3h", "6h", "9h", "12h", "15h", "18h", "21h"];
const MONTH_LABELS = ["T4", "T5", "T6", "T7", "T8", "T9"];

function series(labels: readonly string[], counts: readonly number[]) {
  return labels.map((label, index) => ({ label, count: counts[index] ?? 0 }));
}

function emptyTracking(): MockFormTracking {
  return {
    opens: {
      hour: series(HOUR_LABELS, []),
      day: series(WEEK_LABELS, []),
      week: series(["Tuần 1", "Tuần 2", "Tuần 3", "Tuần 4"], []),
      month: series(MONTH_LABELS, []),
    },
    started: 0,
    abandoned: 0,
    averageDurationSeconds: null,
    pendingAttempts: [],
    feedback: { count: 0, averageRating: null, issues: [] },
  };
}

const NO_ISSUES: MockFormTracking["feedback"]["issues"] = [
  { tag: "LONGER_THAN_ESTIMATED", percent: 0 },
  { tag: "UNCLEAR_QUESTIONS", percent: 0 },
  { tag: "MISLEADING_DESCRIPTION", percent: 0 },
  { tag: "TECHNICAL_ISSUE", percent: 0 },
];

function seed(): Record<string, MockFormTracking> {
  return {
    // Figma 10a: 47 opens (peak Thursday, 12), 8 started, 2 abandoned, avg 7:40,
    // two completions waiting 48h (#7F3A "còn 31 giờ", #C21D "còn 34 giờ"), 6 ratings 4,3.
    [PUBLISHER_FORM_IDS.readingHabits]: {
      opens: {
        hour: series(HOUR_LABELS, [0, 0, 1, 2, 3, 1, 4, 2]),
        day: series(WEEK_LABELS, [4, 9, 6, 12, 8, 5, 3]),
        week: series(["Tuần 1", "Tuần 2", "Tuần 3", "Tuần 4"], [0, 0, 0, 47]),
        month: series(MONTH_LABELS, [0, 0, 0, 0, 0, 47]),
      },
      started: 8,
      abandoned: 2,
      averageDurationSeconds: 7 * 60 + 40,
      pendingAttempts: [
        { attemptId: "8d1e4b20-7f3a-4c1d-9e2f-0a1b2c3d5a01", respondentCode: "#7F3A", codeVerifiedAt: hoursAgo(17), dispute: null },
        { attemptId: "8d1e4b20-c21d-4c1d-9e2f-0a1b2c3d5a02", respondentCode: "#C21D", codeVerifiedAt: hoursAgo(14), dispute: null },
      ],
      feedback: {
        count: 6,
        averageRating: 4.3,
        issues: [
          { tag: "LONGER_THAN_ESTIMATED", percent: 33 },
          { tag: "UNCLEAR_QUESTIONS", percent: 17 },
          { tag: "MISLEADING_DESCRIPTION", percent: 0 },
          { tag: "TECHNICAL_ISSUE", percent: 0 },
        ],
      },
    },
    // Figma 17: 23 started, 3 abandoned, median 5:12, 8 ratings 4,5.
    [PUBLISHER_FORM_IDS.housingNearCampus]: {
      opens: {
        hour: series(HOUR_LABELS, []),
        day: series(WEEK_LABELS, [0, 0, 0, 0, 0, 0, 0]),
        week: series(["Tuần 1", "Tuần 2", "Tuần 3", "Tuần 4"], [0, 21, 64, 0]),
        month: series(MONTH_LABELS, [0, 0, 0, 0, 0, 85]),
      },
      started: 23,
      abandoned: 3,
      averageDurationSeconds: 5 * 60 + 12,
      pendingAttempts: [],
      feedback: {
        count: 8,
        averageRating: 4.5,
        issues: [
          { tag: "LONGER_THAN_ESTIMATED", percent: 13 },
          { tag: "UNCLEAR_QUESTIONS", percent: 0 },
          { tag: "MISLEADING_DESCRIPTION", percent: 0 },
          { tag: "TECHNICAL_ISSUE", percent: 0 },
        ],
      },
    },
  };
}

export const formTracking = createCollection<Record<string, MockFormTracking>>("publisher-form-tracking", seed);

/** Tracking of `formId`; surveys without seeded activity start empty. */
export function trackingOf(formId: string): MockFormTracking {
  const tracking = formTracking.get()[formId] ?? emptyTracking();
  return tracking.feedback.issues.length > 0
    ? tracking
    : { ...tracking, feedback: { ...tracking.feedback, issues: NO_ISSUES } };
}

export function updateTracking(formId: string, mutator: (tracking: MockFormTracking) => void): MockFormTracking {
  return formTracking.update((all) => {
    all[formId] ??= emptyTracking();
    mutator(all[formId]);
  })[formId];
}
