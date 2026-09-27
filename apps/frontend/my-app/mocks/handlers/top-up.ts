import { http, type RequestHandler } from "msw";
import {
  TOP_UP_MAX_PENDING_REQUESTS,
  createTopUpRequestSchema,
  listTopUpRequestsQuerySchema,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import { createTopUp, toTopUpDto, topUpsOf } from "../data/top-up";
import { getMockSessionUser } from "../db/session";
import { fail, missingCsrf, ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";

/**
 * Mirrors `apps/backend/src/modules/economy/presentation/top-up.controller.ts`
 * (Story 6.6): the caller's own manual top-up requests.
 */

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export const topUpHandlers: RequestHandler[] = [
  // VERIFIED: POST /economy/top-ups → 201 topUpRequestSchema; 409 TOPUP_PENDING_LIMIT_REACHED
  http.post(apiUrl("/economy/top-ups"), async ({ request }) => {
    const forced = await applyScenario("top-up");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const parsed = createTopUpRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", "Invalid top-up request.", { details: parsed.error.format() });
    }
    const open = topUpsOf(user).filter((item) => item.status === "PENDING").length;
    if (open >= TOP_UP_MAX_PENDING_REQUESTS) {
      return fail(
        409,
        "TOPUP_PENDING_LIMIT_REACHED",
        `You already have ${TOP_UP_MAX_PENDING_REQUESTS} top-up requests awaiting payment review. Please wait for them to be processed before creating another.`,
        { details: { maxPendingRequests: TOP_UP_MAX_PENDING_REQUESTS } },
      );
    }
    return ok(toTopUpDto(createTopUp(user, parsed.data.amount)), 201);
  }),

  // VERIFIED: GET /economy/top-ups?limit&offset&status → topUpRequestListSchema (newest first)
  http.get(apiUrl("/economy/top-ups"), async ({ request }) => {
    const forced = await applyScenario("top-up");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = listTopUpRequestsQuerySchema.safeParse(query);
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", "Invalid query.", { details: parsed.error.format() });
    }
    const { limit, offset, status } = parsed.data;
    const all = topUpsOf(user).filter((item) => !status || item.status === status);
    const items = all.slice(offset, offset + limit).map(toTopUpDto);
    return ok({ items, total: all.length, limit, offset, hasMore: offset + items.length < all.length });
  }),
];
