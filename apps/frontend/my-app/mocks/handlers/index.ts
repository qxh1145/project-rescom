import { HttpHandler } from "msw";
import { API_BASE_URL } from "@/lib/api/config";
import { ROUTE_ALLOWLIST } from "../route-allowlist";
import { adminHandlers } from "./admin";
import { adminDisputeHandlers } from "./admin-disputes";
import { adminFraudLogHandlers } from "./admin-fraud-log";
import { adminModerationHandlers } from "./admin-moderation";
import { adminOverviewHandlers } from "./admin-overview";
import { adminQualityHandlers } from "./admin-quality";
import { adminTopUpHandlers } from "./admin-top-ups";
import { adminTransactionHandlers } from "./admin-transactions";
import { adminUserHandlers } from "./admin-users";
import { authHandlers } from "./auth";
import { demographicsHandlers } from "./demographics";
import { economyHandlers } from "./economy";
import { engagementHandlers } from "./engagement";
import { formsAiHandlers } from "./forms-ai";
import { formsAnalyticsHandlers } from "./forms-analytics";
import { formsBuilderHandlers } from "./forms-builder";
import { formsCreateHandlers } from "./forms-create";
import { formsManageHandlers } from "./forms-manage";
import { formsResultsHandlers } from "./forms-results";
import { marketplaceHandlers } from "./marketplace";
import { notificationHandlers } from "./notifications";
import { participationHandlers } from "./participation";
import { passwordResetHandlers } from "./password-reset";
import { externalParticipationHandlers } from "./participation-external";
import { internalParticipationHandlers } from "./participation-internal";
import { productTourHandlers } from "./product-tours";
import { profileHandlers } from "./profile";
import { storageHandlers } from "./storage";
import { topUpHandlers } from "./top-up";

/** One array per domain file; each phase adds its own module here. */
export const handlers = [
  ...adminHandlers,
  ...adminOverviewHandlers,
  ...adminModerationHandlers,
  ...adminTopUpHandlers,
  ...adminDisputeHandlers,
  ...adminQualityHandlers,
  ...adminUserHandlers,
  ...adminFraudLogHandlers,
  ...adminTransactionHandlers,
  ...authHandlers,
  ...passwordResetHandlers,
  ...demographicsHandlers,
  ...economyHandlers,
  ...engagementHandlers,
  ...formsAiHandlers,
  ...formsBuilderHandlers,
  ...formsCreateHandlers,
  ...formsManageHandlers,
  ...formsResultsHandlers,
  ...formsAnalyticsHandlers,
  ...marketplaceHandlers,
  ...notificationHandlers,
  ...participationHandlers,
  ...internalParticipationHandlers,
  ...externalParticipationHandlers,
  ...productTourHandlers,
  ...profileHandlers,
  ...storageHandlers,
  ...topUpHandlers,
];

/** `METHOD /path` with every `:param` name reduced to `:param` (the allowlist's names need not match). */
const routeKey = (route: string) => route.replace(/:[A-Za-z_]\w*/g, ":param");
const DEFERRED_ROUTES = new Set(Object.keys(ROUTE_ALLOWLIST.DEFERRED_KEEP_MOCK).map(routeKey));

/**
 * `NEXT_PUBLIC_API_MOCKING=hybrid` (gate G): only the handlers of the deferred
 * PRD routes, read from `ROUTE_ALLOWLIST.DEFERRED_KEEP_MOCK` (the one list).
 * They never read the mock session (`mocks/hybrid.ts`).
 */
export const hybridHandlers = handlers.filter(
  (handler) =>
    handler instanceof HttpHandler &&
    typeof handler.info.path === "string" &&
    handler.info.path.startsWith(`${API_BASE_URL}/`) &&
    DEFERRED_ROUTES.has(routeKey(`${String(handler.info.method)} ${handler.info.path.slice(API_BASE_URL.length)}`)),
);
