import { authHandlers } from "./auth";
import { demographicsHandlers } from "./demographics";
import { economyHandlers } from "./economy";
import { marketplaceHandlers } from "./marketplace";
import { notificationHandlers } from "./notifications";
import { participationHandlers } from "./participation";
import { externalParticipationHandlers } from "./participation-external";
import { internalParticipationHandlers } from "./participation-internal";
import { profileHandlers } from "./profile";

/** One array per domain file; each phase adds its own module here. */
export const handlers = [
  ...authHandlers,
  ...demographicsHandlers,
  ...economyHandlers,
  ...marketplaceHandlers,
  ...notificationHandlers,
  ...participationHandlers,
  ...internalParticipationHandlers,
  ...externalParticipationHandlers,
  ...profileHandlers,
];
