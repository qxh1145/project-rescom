import { http, type RequestHandler } from "msw";
import {
  TOP_UP_MAX_PENDING_REQUESTS,
  createTopUpRequestSchema,
  listPayosTopUpsQuerySchema,
  listTopUpRequestsQuerySchema,
  payosCheckoutSchema,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import {
  cancelMockPayosTopUp,
  createMockPayosTopUp,
  createTopUp,
  findMockPayosTopUp,
  mockPayosRetryAfter,
  payosTopUpsOf,
  toTopUpDto,
  topUpsOf,
} from "../data/top-up";
import { getMockSessionUser } from "../db/session";
import { fail, missingCsrf, ok, unauthorized } from "../envelope";
import { applyScenario, getActiveScenario } from "../scenarios";


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

  // GET /economy/top-ups/payos/availability
  http.get(apiUrl("/economy/top-ups/payos/availability"), async () => {
    const forced = await applyScenario("top-up");
    if (forced) return forced;
    return ok({ payosEnabled: getActiveScenario() !== "payos-manual" });
  }),

  // POST /economy/top-ups/payos
  http.post(apiUrl("/economy/top-ups/payos"), async ({ request }) => {
    const forced = await applyScenario("top-up");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    if (getActiveScenario() === "payos-manual") return fail(404, "NOT_FOUND", "Not found.");

    const parsed = payosCheckoutSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", "Invalid top-up request.", {
        details: parsed.error.format(),
      });
    }

    const existingProcessing = payosTopUpsOf(user).find(
      (item) => item.status === "PROCESSING",
    );
    if (existingProcessing) {
      return fail(
        409,
        "TOPUP_ALREADY_PROCESSING",
        "A top-up is already being processed.",
        {
          details: {
            topUpId: existingProcessing.id,
            checkoutUrl: existingProcessing.checkoutUrl,
          },
        },
      );
    }

    const retryAfterSeconds = mockPayosRetryAfter(user);
    if (retryAfterSeconds !== null) {
      return fail(429, "TOPUP_CHECKOUT_RATE_LIMITED", "Too many top-up attempts.", {
        details: { retryAfterSeconds },
        headers: { "Retry-After": String(retryAfterSeconds) },
      });
    }

    const created = createMockPayosTopUp(user, parsed.data.amountVnd);
    return ok({ topUp: created, checkoutUrl: created.checkoutUrl }, 201);
  }),

  // GET /economy/top-ups/payos (list)
  http.get(apiUrl("/economy/top-ups/payos"), async ({ request }) => {
    const forced = await applyScenario("top-up");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();

    const query = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = listPayosTopUpsQuerySchema.safeParse(query);
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", "Invalid query.", {
        details: parsed.error.format(),
      });
    }

    const { limit, offset } = parsed.data;
    const all = payosTopUpsOf(user);
    const items = all.slice(offset, offset + limit);
    return ok({
      items,
      total: all.length,
      limit,
      offset,
      hasMore: offset + items.length < all.length,
    });
  }),

  // GET /economy/top-ups/payos/:id
  http.get(apiUrl("/economy/top-ups/payos/:id"), async ({ params }) => {
    const forced = await applyScenario("top-up");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();

    const id = String(params.id);
    const item = payosTopUpsOf(user).find((it) => it.id === id); // settles expiry / mock payment first
    if (!item) {
      return fail(404, "TOPUP_NOT_FOUND", "Top-up not found.");
    }

    return ok(item);
  }),

  // POST /economy/top-ups/payos/:id/cancel
  http.post(apiUrl("/economy/top-ups/payos/:id/cancel"), async ({ params, request }) => {
    const forced = await applyScenario("top-up");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;

    const id = String(params.id);
    payosTopUpsOf(user); // settle first
    const item = findMockPayosTopUp(id, user.id);
    if (!item) {
      return fail(404, "TOPUP_NOT_FOUND", "Top-up not found.");
    }

    const cancelled = cancelMockPayosTopUp(id, user.id);
    if (!cancelled) {
      return fail(409, "TOPUP_NOT_CANCELLABLE", "Top-up cannot be cancelled.", {
        details: { currentStatus: item.status },
      });
    }

    return ok(cancelled);
  }),
];

