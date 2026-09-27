import {
  marketplaceFeedQuerySchema,
  starterPointsStatusSchema,
  STARTER_ACTIVATION_MISSING_STEPS,
  STARTER_POINTS_EXPIRY_DAYS,
  type StarterActivationState,
} from "@rescom/schemas";
import { http } from "msw";
import { apiUrl } from "@/lib/api/config";
import { transactionsOf, walletOf } from "../data/economy";
import { completedSurveyIdsOf, findSurvey, surveys, SURVEY_IDS, type MockSurvey } from "../data/surveys";
import { getMockSessionUser } from "../db/session";
import { fail, ok, unauthorized } from "../envelope";
import { applyScenario, getActiveScenario } from "../scenarios";

const DAY_MS = 86_400_000;

/**
 * Figma 3 mobile labels the first card "Phù hợp với bạn": the mock treats it
 * as the only survey whose targeting matches the demo profile.
 */
const TARGETED_SURVEY_IDS = new Set<string>([SURVEY_IDS.onlineShopping]);

function toCard(survey: MockSurvey, completed: boolean) {
  const hasTargeting = TARGETED_SURVEY_IDS.has(survey.id);
  return {
    id: survey.id,
    title: survey.title,
    description: survey.description,
    type: survey.type,
    // The DTO only projects published surveys; a completed (possibly closed)
    // one is still listed as a card when `hideCompleted=false`.
    status: "PUBLISHED" as const,
    rewardPerResponse: survey.rewardPerResponse,
    expectedCompletions: survey.expectedCompletions,
    completedCompletions: survey.completedCompletions,
    estimatedEffortSeconds: survey.estimatedEffortSeconds,
    versionNumber: survey.versionNumber,
    publishedAt: survey.publishedAt,
    targetingJson: null,
    hasTargeting,
    isCompletedByCurrentUser: completed,
    // ASSUMED API CONTRACT extension (not in the backend DTO yet).
    topic: survey.topic,
  };
}

type Card = ReturnType<typeof toCard>;

/** Same comparators as `marketplace.service.ts`; `best_match` keeps the Figma order, completed last. */
function compareCards(sortBy: string, catalogOrder: Map<string, number>) {
  return (a: Card, b: Card): number => {
    const dateA = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const dateB = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    switch (sortBy) {
      case "reward_desc":
        return b.rewardPerResponse - a.rewardPerResponse || dateB - dateA;
      case "reward_asc":
        return a.rewardPerResponse - b.rewardPerResponse || dateB - dateA;
      case "duration_asc":
        return a.estimatedEffortSeconds - b.estimatedEffortSeconds || dateB - dateA;
      case "duration_desc":
        return b.estimatedEffortSeconds - a.estimatedEffortSeconds || dateB - dateA;
      case "newest":
        return dateB - dateA || b.rewardPerResponse - a.rewardPerResponse;
      default:
        // Relevance is computed by the backend; the mock keeps the catalog (Figma) order.
        if (a.isCompletedByCurrentUser !== b.isCompletedByCurrentUser) return a.isCompletedByCurrentUser ? 1 : -1;
        if (a.hasTargeting !== b.hasTargeting) return a.hasTargeting ? -1 : 1;
        return (catalogOrder.get(a.id) ?? 0) - (catalogOrder.get(b.id) ?? 0);
    }
  };
}

export const marketplaceHandlers = [
  // VERIFIED: GET /marketplace/feed → marketplaceFeedResponseSchema (+ ASSUMED `topic`).
  http.get(apiUrl("/marketplace/feed"), async ({ request }) => {
    const forced = await applyScenario("marketplace");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const scenario = getActiveScenario();
    if (!user.profileComplete || scenario === "profile-incomplete") {
      return fail(403, "DEMOGRAPHIC_PROFILE_REQUIRED", "Complete your demographic profile first.");
    }

    const parsed = marketplaceFeedQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", parsed.error.errors[0]?.message ?? "Validation failed", {
        details: parsed.error.format(),
      });
    }
    if (scenario === "marketplace-empty") return ok({ surveys: [], total: 0, profileCompleted: true });

    const query = parsed.data;
    const completedIds = new Set(completedSurveyIdsOf(user.id, user.email));
    const search = query.search?.toLowerCase();
    const catalog = surveys.get();
    const catalogOrder = new Map(catalog.map((survey, index) => [survey.id, index]));

    const cards = catalog
      .filter((survey) => {
        const completed = completedIds.has(survey.id);
        if (completed) return !query.hideCompleted;
        // Open surveys only: published and not yet full (FR-38 auto-hide).
        return survey.status === "PUBLISHED" && survey.completedCompletions < survey.expectedCompletions;
      })
      .filter((survey) => query.type === "ALL" || survey.type === query.type)
      .filter((survey) => query.minReward === undefined || survey.rewardPerResponse >= query.minReward)
      .filter((survey) => query.maxDuration === undefined || survey.estimatedEffortSeconds <= query.maxDuration)
      .filter(
        (survey) =>
          !search ||
          // The backend matches title/description; the mock also matches the ASSUMED topic ("Tìm theo chủ đề").
          [survey.title, survey.description ?? "", survey.topic].some((text) => text.toLowerCase().includes(search)),
      )
      .map((survey) => toCard(survey, completedIds.has(survey.id)))
      .sort(compareCards(query.sortBy, catalogOrder));

    return ok({ surveys: cards, total: cards.length, profileCompleted: true });
  }),

  // VERIFIED: GET /economy/starter-points/status → starterPointsStatusSchema.
  http.get(apiUrl("/economy/starter-points/status"), async () => {
    const forced = await applyScenario("starter-points");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();

    const wallet = walletOf(user);
    const history = transactionsOf(user);
    const grant = history.find((row) => row.kind === "STARTER_GRANT");
    const unlock = history.find((row) => row.kind === "STARTER_UNLOCK");
    const isGranted = Boolean(grant) || wallet.frozen > 0;
    const isUnlocked = Boolean(unlock) && wallet.frozen === 0;
    const hasCompletedMarketplaceSurvey = completedSurveyIdsOf(user.id, user.email).length > 0;

    const now = Date.now();
    let registeredAt = grant ? Date.parse(grant.createdAt) : now;
    // 15f demo: the 30-day window ends in two and a half days ("Còn 3 ngày").
    if (getActiveScenario() === "starter-expiring" && !isUnlocked) {
      registeredAt = now - STARTER_POINTS_EXPIRY_DAYS * DAY_MS + 2.5 * DAY_MS;
    }
    const expiresAt = registeredAt + STARTER_POINTS_EXPIRY_DAYS * DAY_MS;
    const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / DAY_MS));

    const missingSteps = [
      ...(user.profileComplete ? [] : [STARTER_ACTIVATION_MISSING_STEPS.DEMOGRAPHICS]),
      ...(hasCompletedMarketplaceSurvey ? [] : [STARTER_ACTIVATION_MISSING_STEPS.MARKETPLACE_SURVEY]),
    ];
    const activationState: StarterActivationState = isUnlocked
      ? "ACTIVATED"
      : !isGranted
        ? "NOT_GRANTED"
        : !user.profileComplete
          ? "DEMOGRAPHICS_REQUIRED"
          : !hasCompletedMarketplaceSurvey
            ? "SURVEY_REQUIRED"
            : "READY_TO_UNLOCK";

    return ok(
      starterPointsStatusSchema.parse({
        userId: user.id,
        isGranted,
        frozenBalance: wallet.frozen,
        isDemographicComplete: user.profileComplete,
        hasCompletedMarketplaceSurvey,
        isUnlocked,
        isExpired: false,
        registeredAt: new Date(registeredAt).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        daysRemaining,
        unlockEligibility: { eligible: !isUnlocked && missingSteps.length === 0, missingSteps },
        activationState,
        activatedAt: isUnlocked && unlock ? unlock.createdAt : null,
        isVerifiedMember: isUnlocked || (user.profileComplete && hasCompletedMarketplaceSurvey),
        activationSurvey: null,
      }),
    );
  }),

  // ASSUMED API CONTRACT: GET /surveys/:id/summary (18.7 "Khảo sát đã đủ người").
  http.get(apiUrl("/surveys/:id/summary"), async ({ params }) => {
    const forced = await applyScenario("marketplace");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const survey = findSurvey(String(params.id));
    if (!survey) return fail(404, "SURVEY_NOT_FOUND", "Survey not found.");
    return ok({
      id: survey.id,
      title: survey.title,
      status: survey.status,
      expectedCompletions: survey.expectedCompletions,
      completedCompletions: survey.completedCompletions,
    });
  }),
];
