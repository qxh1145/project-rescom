import type { AdminOverview } from "@/lib/admin/overview-service";
import { hoursAgo } from "../db/store";
import { publisherForms } from "./forms";
import { surveys } from "./surveys";

/**
 * `GET /admin/overview` (ASSUMED API CONTRACT, `lib/admin/overview-service.ts`).
 *
 * Seed = Figma 11 "Tổng quan" (62:4070). The queue numbers and to-do rows
 * are fixed Figma content for now; the admin section mocks are built in
 * parallel, so the lead wires `buildAdminOverview()` to their data later
 * (one place: the constants below). The escrow total is real: it is summed
 * from the running surveys of the shared catalog.
 */

/** Stable ids so the to-do links and FraudLog links are deterministic. */
export const OVERVIEW_SEED_IDS = {
  dispute: "d15b0a7e-7f3a-4c1e-9a55-000000000001",
  surveyReview: "d15b0a7e-7f3a-4c1e-9a55-000000000002",
  topUp: "d15b0a7e-7f3a-4c1e-9a55-000000000003",
  missingCode: "d15b0a7e-7f3a-4c1e-9a55-000000000004",
  flaggedUser7F3A: "f7a3b1c2-7f3a-4d5e-8a90-00000000007f",
  flaggedUserA901: "f7a3b1c2-a901-4d5e-8a90-0000000000a9",
} as const;

/**
 * Points locked in escrow on running (PUBLISHED) surveys. Publisher forms
 * carry their own `escrowLocked`; catalog surveys of other publishers lock
 * their unused slots × reward (ASSUMED: the mock does not model the
 * per-completion platform subsidy).
 */
function runningEscrow(): { points: number; runningSurveys: number } {
  const counted = new Set<string>();
  let points = 0;
  for (const form of publisherForms.get()) {
    if (form.status !== "PUBLISHED") continue;
    counted.add(form.id);
    points += form.escrowLocked;
  }
  for (const survey of surveys.get()) {
    if (survey.status !== "PUBLISHED" || counted.has(survey.id)) continue;
    counted.add(survey.id);
    points += Math.max(0, survey.expectedCompletions - survey.completedCompletions) * survey.rewardPerResponse;
  }
  return { points, runningSurveys: counted.size };
}

/** The whole dashboard in one object — the single composition point for the lead. */
export function buildAdminOverview(): AdminOverview {
  return {
    pendingSurveys: { count: 3 },
    pendingTopUps: { count: 2, points: 300, amountVnd: 60_000 },
    openIssues: { disputes: 1, missingCodeReports: 1 },
    escrow: runningEscrow(),
    // "cũ nhất trước": createdAt ascending in Figma's row order.
    todo: [
      {
        kind: "DISPUTE",
        id: OVERVIEW_SEED_IDS.dispute,
        createdAt: hoursAgo(20),
        moreCount: 0,
        priority: true,
        attemptRef: "7F3A",
        respondentName: "Linh N.",
        surveyTitle: "Thói quen đọc sách của sinh viên",
        // Figma "điểm còn chờ 31 giờ".
        pendingReleasesAt: hoursAgo(-31),
      },
      {
        kind: "SURVEY_REVIEW",
        id: OVERVIEW_SEED_IDS.surveyReview,
        createdAt: hoursAgo(6),
        moreCount: 2,
        priority: false,
        surveyTitle: "Hành vi tiêu dùng của sinh viên Marketing",
        publisherName: "Linh N.",
        surveyType: "EXTERNAL",
      },
      {
        kind: "TOP_UP",
        id: OVERVIEW_SEED_IDS.topUp,
        createdAt: hoursAgo(4),
        moreCount: 1,
        priority: false,
        points: 200,
        amountVnd: 40_000,
        requesterName: "Trần Minh",
        transferReference: "RESCOM MT4402",
      },
      {
        kind: "MISSING_CODE",
        id: OVERVIEW_SEED_IDS.missingCode,
        createdAt: hoursAgo(2),
        moreCount: 0,
        priority: false,
        surveyTitle: "Thói quen dùng AI trong học tập của sinh viên IT",
        reporterRole: "RESPONDENT",
      },
    ],
    flaggedAccounts: [
      {
        userId: OVERVIEW_SEED_IDS.flaggedUser7F3A,
        reference: "7F3A",
        violationCount: 5,
        windowDays: 14,
        types: ["TIME_BARRIER", "COMPLETION_CODE"],
        repeated: true,
      },
      {
        userId: OVERVIEW_SEED_IDS.flaggedUserA901,
        reference: "A901",
        violationCount: 2,
        windowDays: 14,
        types: ["RATE_LIMIT"],
        repeated: false,
      },
    ],
  };
}
