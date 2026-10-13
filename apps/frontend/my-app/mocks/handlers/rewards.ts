import { HttpResponse, http, type RequestHandler } from "msw";
import {
  IDEMPOTENCY_KEY_HEADER,
  createCodeIssueReportSchema,
  createRedemptionQuoteSchema,
  idempotencyKeySchema,
  redeemVoucherSchema,
  redemptionHistoryQuerySchema,
  voucherCatalogQuerySchema,
} from "@rescom/schemas";
import { apiUrl, isHybridMocking } from "@/lib/api/config";
import { recordTransaction, updateWallet, walletOf } from "../data/economy";
import {
  catalogOf,
  claimDemoRewards,
  createVoucherQuote,
  flashSalesAt,
  historyOf,
  markTicketUsed,
  redemptionByKey,
  redeemVoucherQuote,
  reportCodeIssue,
  ticketOf,
  ticketsOf,
  undoTicketUse,
  voucherOf,
} from "../data/rewards";
import { getMockSessionUser } from "../db/session";
import { fail, missingCsrf, ok, unauthorized } from "../envelope";
import { HYBRID_MEMBER } from "../hybrid";
import { applyScenario, getActiveScenario } from "../scenarios";

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

const userOfRequest = async () => {
  const user = isHybridMocking ? HYBRID_MEMBER : await getMockSessionUser();
  if (user) claimDemoRewards(user);
  return user;
};
const viewerOf = (user: NonNullable<Awaited<ReturnType<typeof userOfRequest>>>) => {
  const { available, pending } = walletOf(user);
  return { available, pending };
};

function respond(outcome: { ok: true; result: unknown } | { ok: false; status: number; code: string; details?: unknown }, successStatus: number) {
  return outcome.ok ? ok(outcome.result, successStatus) : fail(outcome.status, outcome.code, outcome.code, { details: outcome.details });
}

/** ASSUMED API CONTRACT: user-facing Rewards mock, pending backend Stories 12.7–12.10. */
export const rewardHandlers: RequestHandler[] = [
  // ASSUMED API CONTRACT: GET /rewards/vouchers.
  http.get(apiUrl("/rewards/vouchers"), async ({ request }) => {
    const forced = await applyScenario("rewards");
    if (forced) return forced;
    const user = await userOfRequest();
    if (!user) return unauthorized();
    const query = voucherCatalogQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return fail(400, "VALIDATION_ERROR", "Invalid catalog query.", { details: query.error.format() });
    return ok(catalogOf(user.id, viewerOf(user), query.data));
  }),

  // ASSUMED API CONTRACT: GET /rewards/vouchers/:id.
  http.get(apiUrl("/rewards/vouchers/:id"), async ({ params }) => {
    const forced = await applyScenario("rewards");
    if (forced) return forced;
    const user = await userOfRequest();
    if (!user) return unauthorized();
    const voucher = voucherOf(String(params.id), viewerOf(user));
    return voucher ? ok(voucher) : fail(404, "VOUCHER_NOT_FOUND", "Voucher not found.");
  }),

  // ASSUMED API CONTRACT: GET /rewards/flash-sales.
  http.get(apiUrl("/rewards/flash-sales"), async () => {
    const forced = await applyScenario("rewards");
    if (forced) return forced;
    const user = await userOfRequest();
    if (!user) return unauthorized();
    return ok(flashSalesAt(Date.now()));
  }),

  // ASSUMED API CONTRACT: POST /rewards/quotes.
  http.post(apiUrl("/rewards/quotes"), async ({ request }) => {
    const forced = await applyScenario("rewards");
    if (forced) return forced;
    const user = await userOfRequest();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const parsed = createRedemptionQuoteSchema.safeParse(await readJson(request));
    if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid quote request.", { details: parsed.error.format() });
    return respond(createVoucherQuote(user.id, parsed.data.voucherId, viewerOf(user)), 201);
  }),

  // ASSUMED API CONTRACT: POST /rewards/redemptions (Idempotency-Key required).
  http.post(apiUrl("/rewards/redemptions"), async ({ request }) => {
    const forced = await applyScenario("rewards");
    if (forced) return forced;
    const user = await userOfRequest();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const parsed = redeemVoucherSchema.safeParse(await readJson(request));
    const key = idempotencyKeySchema.safeParse(request.headers.get(IDEMPOTENCY_KEY_HEADER));
    if (!parsed.success || !key.success) return fail(400, "VALIDATION_ERROR", "Invalid redemption request.");
    const scenario = getActiveScenario();
    const forcedCode = scenario.startsWith("rewards-") && scenario !== "rewards-redeem-lost"
      ? scenario.slice("rewards-".length).replaceAll("-", "_").toUpperCase()
      : undefined;
    const outcome = redeemVoucherQuote(user.id, parsed.data.quoteId, viewerOf(user), Date.now(), key.data, forcedCode);
    if (outcome.ok && !outcome.replayed) {
      updateWallet(user, wallet => { wallet.available -= outcome.result.pointsSpent; });
      recordTransaction(user, {
        kind: "VOUCHER_REDEMPTION", amount: -outcome.result.pointsSpent, status: "AVAILABLE",
        note: outcome.result.ticket.title, surveyId: null, attemptId: null, releasesAt: null,
        redemptionKey: key.data,
      });
    }
    if (scenario === "rewards-redeem-lost" && outcome.ok && !outcome.replayed) return HttpResponse.error();
    return respond(outcome, 201);
  }),

  // ASSUMED API CONTRACT: GET /rewards/redemptions/by-key/:key.
  http.get(apiUrl("/rewards/redemptions/by-key/:key"), async ({ params }) => {
    const forced = await applyScenario("rewards");
    if (forced) return forced;
    const user = await userOfRequest();
    if (!user) return unauthorized();
    const key = idempotencyKeySchema.safeParse(String(params.key));
    if (!key.success) return fail(400, "VALIDATION_ERROR", "Invalid idempotency key.");
    const outcome = redemptionByKey(user.id, key.data);
    return outcome ? respond(outcome, 201) : fail(404, "REDEMPTION_NOT_FOUND", "Redemption not found.");
  }),

  // ASSUMED API CONTRACT: GET /rewards/my-vouchers.
  http.get(apiUrl("/rewards/my-vouchers"), async () => {
    const forced = await applyScenario("rewards");
    if (forced) return forced;
    const user = await userOfRequest();
    if (!user) return unauthorized();
    return ok(ticketsOf(user.id));
  }),

  // ASSUMED API CONTRACT: GET /rewards/my-vouchers/:id (404 TICKET_NOT_FOUND).
  http.get(apiUrl("/rewards/my-vouchers/:id"), async ({ params }) => {
    const forced = await applyScenario("rewards");
    if (forced) return forced;
    const user = await userOfRequest();
    if (!user) return unauthorized();
    const ticket = ticketOf(user.id, String(params.id));
    return ticket ? ok(ticket) : fail(404, "TICKET_NOT_FOUND", "TICKET_NOT_FOUND");
  }),

  // ASSUMED API CONTRACT: POST /rewards/my-vouchers/:id/use (idempotent; 404, 409 TICKET_EXPIRED | TICKET_REFUNDED).
  http.post(apiUrl("/rewards/my-vouchers/:id/use"), async ({ request, params }) => {
    const forced = await applyScenario("rewards");
    if (forced) return forced;
    const user = await userOfRequest();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    return respond(markTicketUsed(user.id, String(params.id)), 200);
  }),

  // ASSUMED API CONTRACT: POST /rewards/my-vouchers/:id/undo-use (idempotent; 404, 409 UNDO_WINDOW_CLOSED | TICKET_REFUNDED).
  http.post(apiUrl("/rewards/my-vouchers/:id/undo-use"), async ({ request, params }) => {
    const forced = await applyScenario("rewards");
    if (forced) return forced;
    const user = await userOfRequest();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    return respond(undoTicketUse(user.id, String(params.id)), 200);
  }),

  // ASSUMED API CONTRACT: POST /rewards/my-vouchers/:id/issues (201; 400, 404, 409 TICKET_EXPIRED / CODE_ISSUE_ALREADY_OPEN / TICKET_REFUNDED).
  http.post(apiUrl("/rewards/my-vouchers/:id/issues"), async ({ request, params }) => {
    const forced = await applyScenario("rewards");
    if (forced) return forced;
    const user = await userOfRequest();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const parsed = createCodeIssueReportSchema.safeParse(await readJson(request));
    if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid code issue report.", { details: parsed.error.format() });
    return respond(reportCodeIssue(user.id, String(params.id), parsed.data), 201);
  }),

  // ASSUMED API CONTRACT: GET /rewards/redemptions?limit&offset (history, newest first).
  http.get(apiUrl("/rewards/redemptions"), async ({ request }) => {
    const forced = await applyScenario("rewards");
    if (forced) return forced;
    const user = await userOfRequest();
    if (!user) return unauthorized();
    const query = redemptionHistoryQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return fail(400, "VALIDATION_ERROR", "Invalid history query.", { details: query.error.format() });
    return ok(historyOf(user.id, query.data));
  }),
];
