import { http, type RequestHandler } from "msw";
import { z } from "zod";
import {
  SURVEY_DURATION_EXCEEDS_RESERVATION_CODE,
  calculateEscrowCost,
  checkPublishRewardBand,
  checkSurveyFitsReservationWindow,
  createExternalSurveySchema,
  resolveRewardBandDurationOptions,
  surveyTargetingSchema,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import { reserveSurveyEscrow, walletOf } from "../data/economy";
import { addPublisherForm } from "../data/forms";
import { createCollection, mockId, nowIso } from "../db/store";
import { getMockSessionUser } from "../db/session";
import { fail, missingCsrf, ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";

/**
 * Mirrors `apps/backend/src/modules/forms/presentation/forms.controller.ts`
 * `POST /forms/external` (→ `forms.service.ts#createExternalSurvey`) for the
 * Google Forms wizard (Figma 9), plus the ASSUMED audience estimate.
 */

/** School is supported only by the ASSUMED audience-estimate endpoint. */
const wizardTargetingSchema = surveyTargetingSchema.extend({
  schools: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
});
const createBodySchema = createExternalSurveySchema;

/** Wizard data `MockPublisherForm` has no field for, keyed by form id (MOCK-ONLY). */
export interface CreatedFormExtras {
  description: string | null;
  topic: string | null;
  targeting: z.infer<typeof wizardTargetingSchema> | null;
  estimatedDurationMinutes: number | null;
  /** Plaintext only in the mock; the backend stores a verifier. */
  completionCode: string;
}

export const createdFormExtras = createCollection<Record<string, CreatedFormExtras>>(
  "publisher-form-create-extras",
  () => ({}),
);

/** `CompletionCodePort.generateSixDigitCode` (uniform 000000–999999). */
function sixDigitCode(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return value.toString().padStart(6, "0");
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** Deterministic stand-in for the audience estimate (Figma 9b). */
function estimateRespondents(targeting: z.infer<typeof wizardTargetingSchema>): number {
  let estimate = 2400;
  if (targeting.ageRange) {
    const span = targeting.ageRange.max - targeting.ageRange.min + 1;
    estimate *= Math.min(1, span / 12);
  }
  if (targeting.genders?.length) estimate *= 0.5 * Math.min(2, targeting.genders.length);
  if (targeting.fieldOfStudy?.length) estimate *= Math.min(1, 0.16 * targeting.fieldOfStudy.length);
  if (targeting.schools?.length) estimate *= 0.35;
  if (targeting.locations?.length) estimate *= 0.45;
  return Math.max(0, Math.round(estimate));
}

export const formsCreateHandlers: RequestHandler[] = [
  // VERIFIED: POST /forms/external → 201 externalSurveyResponseSchema (+ FormDetailDto fields)
  http.post(apiUrl("/forms/external"), async ({ request }) => {
    const forced = await applyScenario("forms-create");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const parsed = createBodySchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", "Validation failed", { details: parsed.error.format() });
    }
    const dto = parsed.data;
    const definition = {
      metadata: {
        expectedEffortSeconds: dto.expectedEffortSeconds,
        minTimeBarrierSeconds: Math.min(15, dto.expectedEffortSeconds),
      },
    };
    const estimatedDurationMinutes = dto.estimatedDurationMinutes ?? null;

    if (dto.autoPublish) {
      // `assertSurveyFitsReservationWindow` (decision E5-D2) → 422.
      const window = checkSurveyFitsReservationWindow({ type: "EXTERNAL", definition, estimatedDurationMinutes });
      if (!window.fits) {
        return fail(422, SURVEY_DURATION_EXCEEDS_RESERVATION_CODE, "This survey cannot be published.", {
          details: window.violations,
        });
      }
      // `assertRewardWithinPricingBand` (FR-14, decision E6-D2).
      const band = checkPublishRewardBand(
        { type: "EXTERNAL", rewardPerResponse: dto.rewardPerResponse, estimatedDurationMinutes },
        resolveRewardBandDurationOptions("EXTERNAL", definition),
      );
      if (band.status === "DURATION_REQUIRED") {
        return fail(422, "ESTIMATED_DURATION_REQUIRED", "Set the estimated completion time before publishing.", {
          details: [],
        });
      }
      if (band.status === "OUT_OF_BAND") {
        return fail(400, "PRICING_REWARD_OUT_OF_BAND", "Reward is outside the pricing band.", {
          details: { min: band.range.min, max: band.range.max, suggested: band.range.suggested },
        });
      }
    }

    const escrow = calculateEscrowCost({
      type: "EXTERNAL",
      expectedCompletions: dto.expectedCompletions,
      rewardPerResponse: dto.rewardPerResponse,
    }).effectiveCost;
    const id = mockId();
    const now = nowIso();
    const status = dto.autoPublish ? "MODERATION_QUEUE" : "DRAFT";
    const completionCode = sixDigitCode();
    // AD-16: the escrow is reserved in the same unit of work; an unfunded
    // auto-publish creates nothing (409, `InsufficientEscrowBalanceException`).
    if (dto.autoPublish) {
      try {
        reserveSurveyEscrow(user, { amount: escrow, surveyId: id, title: dto.title });
      } catch (error) {
        if (error instanceof Error && error.message === "INSUFFICIENT_AVAILABLE") {
          return fail(409, "INSUFFICIENT_ESCROW_BALANCE", "Insufficient balance to reserve the escrow.", {
            details: { availableBalance: walletOf(user).available, requiredAmount: escrow },
          });
        }
        throw error;
      }
    }
    addPublisherForm({
      id,
      ownerEmail: user.email,
      title: dto.title,
      type: "EXTERNAL",
      status,
      rewardPerResponse: dto.rewardPerResponse,
      expectedCompletions: dto.expectedCompletions,
      completedCompletions: 0,
      escrowLocked: dto.autoPublish ? escrow : 0,
      estimatedEffortSeconds: dto.expectedEffortSeconds,
      externalUrl: dto.externalUrl,
      createdAt: now,
      submittedAt: dto.autoPublish ? now : null,
      publishedAt: null,
      deadlineAt: null,
      closedAt: null,
      hiddenFromMarketplace: true,
      rejection: null,
      versionNumber: 1,
    });
    createdFormExtras.update((all) => {
      all[id] = {
        description: dto.description ?? null,
        topic: null,
        targeting: dto.targetingJson ?? null,
        estimatedDurationMinutes,
        completionCode,
      };
    });

    return ok(
      {
        id,
        publisherId: user.id,
        type: "EXTERNAL",
        status,
        title: dto.title,
        description: dto.description ?? null,
        rewardPerResponse: dto.rewardPerResponse,
        expectedCompletions: dto.expectedCompletions,
        estimatedDurationMinutes,
        closeKind: null,
        createdAt: now,
        updatedAt: now,
        plaintextCompletionCode: completionCode,
        hasCompletionCode: true,
        externalUrl: dto.externalUrl,
        currentVersionNumber: 1,
      },
      201,
    );
  }),

  // ASSUMED API CONTRACT: POST /forms/audience-estimate { targeting } → { estimatedRespondents }
  http.post(apiUrl("/forms/audience-estimate"), async ({ request }) => {
    const forced = await applyScenario("forms-create");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const body = await readJson(request);
    const parsed = wizardTargetingSchema.safeParse(
      typeof body === "object" && body !== null ? (body as { targeting?: unknown }).targeting : undefined,
    );
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", "Invalid targeting.", { details: parsed.error.format() });
    }
    return ok({ estimatedRespondents: estimateRespondents(parsed.data) });
  }),
];
