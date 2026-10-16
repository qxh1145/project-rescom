import { http, type RequestHandler } from "msw";
import {
  TOP_UP_MAX_PENDING_REQUESTS,
  createTopUpRequestSchema,
  listPayosTopUpsQuerySchema,
  listTopUpRequestsQuerySchema,
  payosCheckoutSchema,
  submitTopUpRefundSchema,
  type PayosTopUpDto,
  type TopUpRefundUnavailableReason,
  type UserTopUpRefundDestinationView,
  type UserTopUpRefundRequest,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import {
  cancelMockPayosTopUp,
  createMockPayosTopUp,
  createTopUp,
  findMockPayosTopUp,
  mockPayosRetryAfter,
  payosTopUps,
  payosTopUpsOf,
  toTopUpDto,
  topUpsOf,
  type MockPayosTopUp,
} from "../data/top-up";
import { holdTopUpRefund, walletOf, withdrawTopUpRefund } from "../data/economy";
import { getMockSessionUser } from "../db/session";
import { mockId, nowIso } from "../db/store";
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
    return ok({ topUp: toUserTopUpDto(created), checkoutUrl: created.checkoutUrl }, 201);
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
      items: items.map(toUserTopUpDto),
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

    return ok(toUserTopUpDto(item));
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

    return ok(toUserTopUpDto(cancelled));
  }),

  // POST /economy/top-ups/payos/:id/refund-request
  http.post(apiUrl("/economy/top-ups/payos/:id/refund-request"), async ({ params, request }) => {
    const forced = await applyScenario("top-up");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;

    const body = await readJson(request);
    const parsed = submitTopUpRefundSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", "Validation failed.", {
        details: parsed.error.issues,
      });
    }

    const id = String(params.id);
    payosTopUpsOf(user);
    const item = findMockPayosTopUp(id, user.id);
    if (!item) {
      return fail(404, "TOPUP_NOT_FOUND", "Top-up not found.");
    }

    // Refusal precedence per 13.10 AC 6
    if (item.status !== "SUCCESSFUL") {
      return fail(409, "TOPUP_REFUND_NOT_ALLOWED", "Top-up cannot be refunded.", {
        details: { reason: "NOT_SUCCESSFUL" },
      });
    }
    if (item.mismatchResolution === "CREDIT") {
      return fail(409, "TOPUP_REFUND_NOT_ALLOWED", "Top-up cannot be refunded.", {
        details: { reason: "MISMATCH_CREDITED" },
      });
    }
    if (item.refund?.request?.status === "WITHDRAWN") {
      return fail(409, "TOPUP_REFUND_NOT_ALLOWED", "Top-up cannot be refunded.", {
        details: { reason: "WITHDRAWN" },
      });
    }
    if (item.refund?.request) {
      return fail(409, "TOPUP_REFUND_ALREADY_REQUESTED", "Top-up refund has already been requested.");
    }

    const deadline = item.refundDeadline ?? (item.paidAt ? new Date(Date.parse(item.paidAt) + 24 * 3600 * 1000).toISOString() : null);
    if (deadline && Date.now() >= Date.parse(deadline)) {
      return fail(409, "TOPUP_REFUND_NOT_ALLOWED", "Top-up cannot be refunded.", {
        details: { reason: "DEADLINE_PASSED" },
      });
    }

    // Eligibility check
    const forcedNotEligible = getActiveScenario() === "refund-not-eligible";
    const wallet = walletOf(user);
    let eligibility: "ELIGIBLE" | "NOT_ELIGIBLE" = "ELIGIBLE";
    let ineligibleReason: "SPENT_SINCE_TOP_UP" | "INSUFFICIENT_AVAILABLE" | null = null;

    if (forcedNotEligible) {
      eligibility = "NOT_ELIGIBLE";
      ineligibleReason = "SPENT_SINCE_TOP_UP";
    } else if (wallet.available < item.points) {
      eligibility = "NOT_ELIGIBLE";
      ineligibleReason = "INSUFFICIENT_AVAILABLE";
    }

    if (eligibility === "ELIGIBLE") {
      holdTopUpRefund(user, {
        points: item.points,
        topUpId: item.id,
        orderCode: item.orderCode,
      });
    }

    const destination: UserTopUpRefundDestinationView = item.counterAccount
      ? {
          bankId: item.counterAccount.bankId,
          bankName: item.counterAccount.bankName,
          holderName: item.counterAccount.holderName,
          accountNumber: item.counterAccount.accountNumber,
          last4: item.counterAccount.accountNumber ? item.counterAccount.accountNumber.slice(-4) : null,
          verified: Boolean(
            item.counterAccount.bankId &&
            item.counterAccount.accountNumber &&
            item.counterAccount.holderName,
          ),
        }
      : item.refund?.destination ?? {
          bankId: "970436",
          bankName: "Vietcombank",
          holderName: "TRAN THI A",
          accountNumber: "0123456789",
          last4: "6789",
          verified: true,
        };

    const reqDto: UserTopUpRefundRequest = {
      id: mockId(),
      status: "REQUESTED",
      eligibility,
      ineligibleReason,
      reason: parsed.data.reason,
      points: item.points,
      amountVnd: item.amountVnd,
      destination,
      submittedAt: nowIso(),
      withdrawnAt: null,
    };

    payosTopUps.update((all) => {
      const list = all[user.id] ?? [];
      const target = list.find((it) => it.id === id);
      if (target) {
        target.refund = {
          canRequest: false,
          unavailableReason: "ALREADY_REQUESTED",
          destination,
          request: reqDto,
        };
      }
    });

    return ok({ request: reqDto, replayed: false });
  }),

  // POST /economy/top-ups/payos/:id/refund-request/withdraw
  http.post(apiUrl("/economy/top-ups/payos/:id/refund-request/withdraw"), async ({ params, request }) => {
    const forced = await applyScenario("top-up");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;

    const id = String(params.id);
    payosTopUpsOf(user);
    const item = findMockPayosTopUp(id, user.id);
    if (!item || !item.refund?.request) {
      return fail(404, "TOPUP_REFUND_NOT_FOUND", "Refund request not found.");
    }

    const currentReq = item.refund.request;
    if (currentReq.status === "REFUNDED" || currentReq.status === "REJECTED") {
      return fail(409, "REFUND_ALREADY_RESOLVED", "Refund request is already resolved.");
    }

    if (currentReq.status === "WITHDRAWN") {
      return ok({ request: currentReq, replayed: true });
    }

    if (currentReq.eligibility === "ELIGIBLE") {
      withdrawTopUpRefund(user, {
        points: item.points,
        topUpId: item.id,
        orderCode: item.orderCode,
      });
    }

    const withdrawnReq: UserTopUpRefundRequest = {
      ...currentReq,
      status: "WITHDRAWN",
      withdrawnAt: nowIso(),
    };

    payosTopUps.update((all) => {
      const list = all[user.id] ?? [];
      const target = list.find((it) => it.id === id);
      if (target) {
        target.refund = {
          canRequest: false,
          unavailableReason: "WITHDRAWN",
          destination: target.refund?.destination ?? currentReq.destination,
          request: withdrawnReq,
        };
      }
    });

    return ok({ request: withdrawnReq, replayed: false });
  }),
];

function toUserTopUpDto(item: MockPayosTopUp): PayosTopUpDto {
  const isSuccessful = item.status === "SUCCESSFUL";
  const deadline =
    isSuccessful && item.paidAt
      ? new Date(Date.parse(item.paidAt) + 24 * 3600 * 1000).toISOString()
      : null;
  const refundDeadline = item.refundDeadline ?? deadline;

  let destination: UserTopUpRefundDestinationView | null = null;
  if (item.counterAccount) {
    const verified = Boolean(
      item.counterAccount.bankId &&
      item.counterAccount.accountNumber &&
      item.counterAccount.holderName,
    );
    destination = {
      bankId: item.counterAccount.bankId,
      bankName: item.counterAccount.bankName,
      holderName: item.counterAccount.holderName,
      accountNumber: item.counterAccount.accountNumber,
      last4: item.counterAccount.accountNumber ? item.counterAccount.accountNumber.slice(-4) : null,
      verified,
    };
  } else if (item.refund?.destination) {
    destination = item.refund.destination;
  } else if (isSuccessful) {
    destination = {
      bankId: "970436",
      bankName: "Vietcombank",
      holderName: "TRAN THI A",
      accountNumber: "0123456789",
      last4: "6789",
      verified: true,
    };
  }

  const now = Date.now();
  let canRequest = false;
  let unavailableReason: TopUpRefundUnavailableReason | null = null;

  if (!isSuccessful) {
    canRequest = false;
    unavailableReason = "NOT_SUCCESSFUL";
  } else if (item.mismatchResolution === "CREDIT") {
    canRequest = false;
    unavailableReason = "MISMATCH_CREDITED";
  } else if (item.refund?.request?.status === "WITHDRAWN") {
    canRequest = false;
    unavailableReason = "WITHDRAWN";
  } else if (item.refund?.request) {
    canRequest = false;
    unavailableReason = "ALREADY_REQUESTED";
  } else if (refundDeadline && now >= Date.parse(refundDeadline)) {
    canRequest = false;
    unavailableReason = "DEADLINE_PASSED";
  } else {
    canRequest = true;
    unavailableReason = null;
  }

  return {
    ...item,
    refundDeadline,
    refund: {
      canRequest: item.refund?.canRequest ?? canRequest,
      unavailableReason:
        item.refund?.unavailableReason !== undefined
          ? item.refund.unavailableReason
          : unavailableReason,
      destination,
      request: item.refund?.request ?? null,
    },
  };
}

