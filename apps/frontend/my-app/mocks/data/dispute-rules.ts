import type { DisputeCase } from "../../lib/admin/disputes-service.ts";

/**
 * Pure rules of the admin disputes mock (no MSW, no storage), unit-tested in
 * `tests/admin-disputes.test.mjs`. `admin-disputes.ts` reads the live attempt,
 * wallets and survey around them and applies the result.
 */

export interface ResolveRefusal {
  status: number;
  code: string;
  message: string;
}

export interface CreditCheck {
  /** Points the Admin would credit (the case amount). */
  amount: number;
  /** CURRENT attempt status (`attempts.ts`), not the case snapshot. */
  attemptStatus: DisputeCase["attempt"]["status"];
  /** `rewardOutcomeOf(respondent, attemptId) !== null`: a reward row already exists for the attempt. */
  alreadyRewarded: boolean;
  /**
   * The survey the reward is paid for (publisher form when the mock has one,
   * else the Khám phá survey); null when the mock knows neither.
   */
  survey: { closed: boolean; completedCompletions: number; expectedCompletions: number } | null;
  /**
   * Escrow the reward is drawn from: the publisher form's `escrowLocked` and
   * its owner's wallet Ký quỹ (null when the owner is not a mock account).
   * Null when the mock has no publisher form for the survey (Figma samples).
   */
  escrow: { form: number; wallet: number | null } | null;
}

/**
 * Why "Cộng điểm" (`CREDIT_RESPONDENT`) on a missing-code report is refused
 * (ASSUMED codes, documented in `lib/admin/disputes-service.ts`), or null:
 * - the attempt was completed or rewarded since the report (the respondent
 *   found the code) → 409 `DISPUTE_ATTEMPT_ALREADY_REWARDED`;
 * - the survey is closed or its quota is full → 409 `DISPUTE_SURVEY_CLOSED`;
 * - the survey escrow cannot cover the reward → 409 `INSUFFICIENT_BALANCE`.
 */
export function creditRespondentRefusal(check: CreditCheck): ResolveRefusal | null {
  if (check.attemptStatus === "COMPLETED" || check.alreadyRewarded) {
    return {
      status: 409,
      code: "DISPUTE_ATTEMPT_ALREADY_REWARDED",
      message: "This attempt is already completed or rewarded.",
    };
  }
  const { survey, escrow } = check;
  if (survey && (survey.closed || survey.completedCompletions >= survey.expectedCompletions)) {
    return { status: 409, code: "DISPUTE_SURVEY_CLOSED", message: "The survey is closed or its quota is full." };
  }
  if (escrow && (escrow.form < check.amount || (escrow.wallet !== null && escrow.wallet < check.amount))) {
    return { status: 409, code: "INSUFFICIENT_BALANCE", message: "The survey escrow cannot cover this reward." };
  }
  return null;
}

type ReportCase = Pick<DisputeCase, "kind" | "status" | "reporter" | "description"> & {
  attempt: Pick<DisputeCase["attempt"], "id">;
};

/**
 * Adds a respondent's missing-code report to the queue, one OPEN case per
 * attempt (mutates `cases`):
 * - no OPEN case for the attempt → the report is added (`ADDED`);
 * - an OPEN locked-attempt case → it becomes this report, so the Admin can
 *   credit it (`MERGED`);
 * - an OPEN report already → nothing changes (`DUPLICATE`).
 */
export function addMissingCodeCase<T extends ReportCase>(cases: T[], report: T): "ADDED" | "MERGED" | "DUPLICATE" {
  const open = cases.find((item) => item.status === "OPEN" && item.attempt.id === report.attempt.id);
  if (!open) {
    cases.push(report);
    return "ADDED";
  }
  if (open.kind !== "LOCKED_ATTEMPT") return "DUPLICATE";
  open.kind = "MISSING_CODE";
  open.reporter = report.reporter;
  open.description = report.description;
  return "MERGED";
}

/**
 * `resolveDisputeHold` refuses before posting anything when the respondent's
 * Integrity Hold cannot cover the amount (backend `InsufficientBalanceException`
 * → 409 `INSUFFICIENT_BALANCE`): a refund is never credited out of thin air.
 * `held` = the respondent's Đang giữ balance, null when they are not a mock account.
 *
 * Distinct code `DISPUTE_NO_HELD_POINTS` (ASSUMED, mock-only refinement) when
 * the respondent has no held points at all (`held` is `null` or `0`) — e.g.
 * the hold was already released or reversed elsewhere. `INSUFFICIENT_BALANCE`
 * stays for a hold that exists but falls short of the amount, so the two
 * refusals point admins at different fixes (bác bỏ vs. kiểm tra sổ cái).
 */
export function disputeHoldRefusal(held: number | null, amount: number): ResolveRefusal | null {
  if (held !== null && held >= amount) return null;
  if (!held) {
    return {
      status: 409,
      code: "DISPUTE_NO_HELD_POINTS",
      message: "Respondent has no held points for this dispute: nothing to refund.",
    };
  }
  return {
    status: 409,
    code: "INSUFFICIENT_BALANCE",
    message: `Insufficient integrity hold points for dispute resolution: ${amount} required, but hold balance is ${held}.`,
  };
}
