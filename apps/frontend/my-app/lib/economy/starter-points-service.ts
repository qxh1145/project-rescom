import { starterPointsStatusSchema, type StarterPointsStatusDto } from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

/**
 * VERIFIED: `GET /economy/starter-points/status` (`starter-points.controller.ts`,
 * session required) → `starterPointsStatusSchema`.
 */
export function getStarterPointsStatus(signal?: AbortSignal): Promise<StarterPointsStatusDto> {
  return apiRequest("/economy/starter-points/status", { schema: starterPointsStatusSchema, signal });
}

/** 15f: the warning variant shows when the 30-day window has at most this many days left. */
export const STARTER_EXPIRING_SOON_DAYS = 3;

export type ActivationView =
  | { kind: "hidden" }
  | {
      /** Figma 3 "BƯỚC 2/2 · KÍCH HOẠT TÀI KHOẢN" banner. */
      kind: "banner" | "expiring";
      amount: number;
      /** Onboarding steps done, out of `totalSteps` (profile + first survey). */
      completedSteps: number;
      totalSteps: 2;
      profileComplete: boolean;
      daysRemaining: number;
      expiresAt: string;
      /** A Google Forms completion is under its 48h review (PENDING_CONFIRMATION / READY_TO_UNLOCK). */
      awaitingConfirmation: boolean;
    };

export type VisibleActivation = Exclude<ActivationView, { kind: "hidden" }>;

/**
 * Marketplace activation card rule. Shown while the frozen starter points
 * still wait for the first survey; hidden once activated, expired, or when
 * nothing was granted. `expiring` (15f) replaces the banner in the last
 * `STARTER_EXPIRING_SOON_DAYS` days while no survey has been done yet.
 */
export function activationViewOf(status: StarterPointsStatusDto): ActivationView {
  const state = status.activationState;
  if (state !== "SURVEY_REQUIRED" && state !== "PENDING_CONFIRMATION" && state !== "READY_TO_UNLOCK") {
    return { kind: "hidden" };
  }
  const awaitingConfirmation = state !== "SURVEY_REQUIRED";
  const completedSteps = (status.isDemographicComplete ? 1 : 0) + (awaitingConfirmation ? 1 : 0);
  return {
    kind: !awaitingConfirmation && status.daysRemaining <= STARTER_EXPIRING_SOON_DAYS ? "expiring" : "banner",
    amount: status.frozenBalance,
    completedSteps,
    totalSteps: 2,
    profileComplete: status.isDemographicComplete,
    daysRemaining: status.daysRemaining,
    expiresAt: status.expiresAt,
    awaitingConfirmation,
  };
}

/** "29/09" — day/month of the deadline in Vietnam time. */
export function formatDeadline(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).formatToParts(new Date(iso));
  const part = (type: "day" | "month") => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}`;
}
