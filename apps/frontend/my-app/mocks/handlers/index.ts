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
import { formsBuilderHandlers } from "./forms-builder";
import { formsCreateHandlers } from "./forms-create";
import { formsManageHandlers } from "./forms-manage";
import { formsResultsHandlers } from "./forms-results";
import { marketplaceHandlers } from "./marketplace";
import { notificationHandlers } from "./notifications";
import { participationHandlers } from "./participation";
import { externalParticipationHandlers } from "./participation-external";
import { internalParticipationHandlers } from "./participation-internal";
import { productTourHandlers } from "./product-tours";
import { profileHandlers } from "./profile";
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
  ...demographicsHandlers,
  ...economyHandlers,
  ...engagementHandlers,
  ...formsBuilderHandlers,
  ...formsCreateHandlers,
  ...formsManageHandlers,
  ...formsResultsHandlers,
  ...marketplaceHandlers,
  ...notificationHandlers,
  ...participationHandlers,
  ...internalParticipationHandlers,
  ...externalParticipationHandlers,
  ...productTourHandlers,
  ...profileHandlers,
  ...topUpHandlers,
];
