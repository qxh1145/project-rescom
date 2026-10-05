import { http } from "msw";
import {
  demographicProfileStatusSchema,
  demographicSurveySubmissionResultSchema,
  getMissingDemographicFields,
  submitDemographicSurveySchema,
  updateDemographicProfileSchema,
  type DemographicProfileDto,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import { mockRepository } from "../legacy/repository";
import { getMockSessionUser } from "../db/session";
import { fail, missingCsrf, ok, unauthorized } from "../envelope";
import { applyScenario, getActiveScenario } from "../scenarios";

/**
 * Mirrors `apps/backend/src/modules/users/presentation/demographics.controller.ts`
 * (VERIFIED): GET / PUT `/demographics`, POST `/demographics/survey`.
 *
 * The profile stays in the legacy demo store (`mocks/legacy`): the legacy
 * Marketplace, activation card and attempt pages still gate on it, and
 * `getMockSessionUser().profileComplete` (post-login redirect) derives from it.
 */

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** Backend `DemographicsService.toStatus` shape. `parse`: a drift from the shared schema must fail loudly. */
function toStatus(userId: string, stored: Partial<DemographicProfileDto> | null) {
  const profile = {
    userId,
    age: stored?.age ?? null,
    gender: stored?.gender ?? null,
    location: stored?.location ?? null,
    occupation: stored?.occupation ?? null,
    fieldOfStudy: stored?.fieldOfStudy ?? null,
    householdIncome: stored?.householdIncome ?? null,
    specificInterests: stored?.specificInterests ?? null,
    // The onboarding draft yields to a server copy saved after it.
    ...(stored?.createdAt ? { createdAt: stored.createdAt } : {}),
    ...(stored?.updatedAt ? { updatedAt: stored.updatedAt } : {}),
  };
  const missingFields = getMissingDemographicFields(profile);
  const forceIncomplete = getActiveScenario() === "profile-incomplete";
  return demographicProfileStatusSchema.parse({
    profile,
    isComplete: forceIncomplete ? false : missingFields.length === 0,
    missingFields,
  });
}

/** `ZodValidationPipe` answer: 400 `VALIDATION_ERROR`, first message, `format()` details. */
function validationError(error: { errors: { message: string }[]; format(): unknown }) {
  return fail(400, "VALIDATION_ERROR", error.errors[0]?.message ?? "Validation failed", {
    details: error.format(),
  });
}

export const demographicsHandlers = [
  http.get(apiUrl("/demographics"), async () => {
    const forced = await applyScenario("demographics");
    if (forced) return forced;

    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    return ok(toStatus(user.id, await mockRepository.getDemographicProfile()));
  }),

  http.put(apiUrl("/demographics"), async ({ request }) => {
    const forced = await applyScenario("demographics");
    if (forced) return forced;

    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;

    const parsed = updateDemographicProfileSchema.safeParse(await readJson(request));
    if (!parsed.success) return validationError(parsed.error);
    const saved = await mockRepository.saveDemographicProfile(parsed.data);
    return ok(toStatus(user.id, saved));
  }),

  http.post(apiUrl("/demographics/survey"), async ({ request }) => {
    const forced = await applyScenario("demographics");
    if (forced) return forced;

    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;

    const parsed = submitDemographicSurveySchema.safeParse(await readJson(request));
    if (!parsed.success) return validationError(parsed.error);
    // The legacy store also runs the starter-points unlock and picks `nextStep` like the backend.
    const result = await mockRepository.submitDemographicSurvey(parsed.data);
    // `parse` strips the legacy-only `redirectUrl`: the backend returns the status plus `nextStep`.
    return ok(
      demographicSurveySubmissionResultSchema.parse({
        ...toStatus(user.id, result.profile),
        nextStep: result.nextStep,
      }),
    );
  }),
];
