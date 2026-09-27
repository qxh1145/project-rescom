import type { AdminOverview } from "@/lib/admin/overview-service";
import { mockEscrowTotal } from "./economy";
import { publisherForms } from "./forms";
import { surveys } from "./surveys";
import { openDisputeCases } from "./admin-disputes";
import { FRAUD_REPEAT_WINDOW_DAYS, FRAUD_SEED_USER_IDS, fraudSummaryOf } from "./admin-fraud-log";
import { moderationQueue, toModerationQueueItem } from "./admin-moderation";
import { listTopUpsForReview, pendingTopUpSummary, toAdminTopUpDto } from "./admin-top-ups";

/**
 * `GET /admin/overview` (ASSUMED API CONTRACT, `lib/admin/overview-service.ts`).
 *
 * Seed = Figma 11 "Tổng quan" (62:4070). Queue totals and to-do rows are
 * composed from the same stores as their detail screens so decisions update
 * the dashboard immediately. The escrow total is the ledger's (`mockEscrowTotal`,
 * the same number as the transactions summary).
 */

/** Ký quỹ card: every wallet's escrow (ledger truth) and the running (PUBLISHED) surveys. */
function runningEscrow(): { points: number; runningSurveys: number } {
  const running = new Set<string>();
  for (const form of publisherForms.get()) {
    if (form.status === "PUBLISHED") running.add(form.id);
  }
  for (const survey of surveys.get()) {
    if (survey.status === "PUBLISHED") running.add(survey.id);
  }
  return { points: mockEscrowTotal(), runningSurveys: running.size };
}

/** The whole dashboard in one object — the single composition point for the lead. */
export function buildAdminOverview(): AdminOverview {
  const surveysToReview = moderationQueue();
  const topUps = listTopUpsForReview("PENDING");
  const topUpSummary = pendingTopUpSummary();
  const issues = openDisputeCases();
  const disputes = issues.filter((item) => item.kind !== "MISSING_CODE");
  const missingCodes = issues.filter((item) => item.kind === "MISSING_CODE");
  const oldestDispute = disputes[0];
  const oldestMissingCode = missingCodes[0];
  const oldestSurvey = surveysToReview[0];
  const oldestTopUp = topUps[0];

  const todo: AdminOverview["todo"] = [];
  if (oldestDispute) {
    todo.push({
      kind: "DISPUTE",
      id: oldestDispute.id,
      createdAt: oldestDispute.createdAt,
      moreCount: Math.max(0, disputes.length - 1),
      priority: oldestDispute.reviewEndsAt !== null,
      attemptRef: oldestDispute.respondent.code.replace(/^#/, ""),
      respondentName: oldestDispute.reporter.name,
      surveyTitle: oldestDispute.survey.title,
      pendingReleasesAt: oldestDispute.reviewEndsAt,
    });
  }
  if (oldestSurvey) {
    const item = toModerationQueueItem(oldestSurvey);
    todo.push({
      kind: "SURVEY_REVIEW",
      id: item.formId,
      createdAt: item.submittedAt,
      moreCount: Math.max(0, surveysToReview.length - 1),
      priority: false,
      surveyTitle: item.title,
      publisherName: item.publisherName ?? item.publisherEmail,
      surveyType: item.type,
    });
  }
  if (oldestTopUp) {
    const item = toAdminTopUpDto(oldestTopUp);
    todo.push({
      kind: "TOP_UP",
      id: item.id,
      createdAt: item.createdAt,
      moreCount: Math.max(0, topUps.length - 1),
      priority: false,
      points: item.amount,
      amountVnd: item.amountVnd,
      requesterName: item.userName ?? item.userEmail ?? "Người dùng",
      transferReference: item.transferReference,
    });
  }
  if (oldestMissingCode) {
    todo.push({
      kind: "MISSING_CODE",
      id: oldestMissingCode.id,
      createdAt: oldestMissingCode.createdAt,
      moreCount: Math.max(0, missingCodes.length - 1),
      priority: false,
      surveyTitle: oldestMissingCode.survey.title,
      reporterRole: oldestMissingCode.reporter.role === "PUBLISHER" ? "PUBLISHER" : "RESPONDENT",
    });
  }

  const khang = fraudSummaryOf(FRAUD_SEED_USER_IDS.khang);
  const quan = fraudSummaryOf(FRAUD_SEED_USER_IDS.quan);
  return {
    pendingSurveys: { count: surveysToReview.length },
    pendingTopUps: topUpSummary,
    openIssues: { disputes: disputes.length, missingCodeReports: missingCodes.length },
    escrow: runningEscrow(),
    todo,
    flaggedAccounts: [
      {
        userId: FRAUD_SEED_USER_IDS.khang,
        reference: "7F3A",
        violationCount: khang.count14d,
        windowDays: FRAUD_REPEAT_WINDOW_DAYS,
        types: ["TIME_BARRIER", "COMPLETION_CODE"],
        repeated: khang.repeated,
      },
      {
        userId: FRAUD_SEED_USER_IDS.quan,
        reference: "A901",
        violationCount: quan.count14d,
        windowDays: FRAUD_REPEAT_WINDOW_DAYS,
        types: ["RATE_LIMIT"],
        repeated: quan.repeated,
      },
    ],
  };
}
