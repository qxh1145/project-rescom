import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { OutboxHandlerRegistry } from '../../../common/scheduler/outbox/outbox-handler';
import { TopUpNotificationHandler } from '../application/top-up-notification.handler';
import { ScheduledJobRegistry } from '../../../common/scheduler/scheduled-job';
import { RewardSettlementCoordinator } from '../application/reward-settlement.coordinator';
import { StarterPointsCoordinator } from '../application/starter-points.coordinator';
import { PendingReleaseJob } from './jobs/pending-release.job';
import { StarterExpiryJob } from './jobs/starter-expiry.job';
import { PayosReconcileJob } from './jobs/payos-reconcile.job';
import { PayosTopUpService } from '../application/payos-top-up.service';
import {
  PAYOS_TOP_UP_REPOSITORY_PORT,
  PayosTopUpRepositoryPort,
} from '../application/ports/payos-top-up-repository.port';
import {
  PAYMENT_PROVIDER_PORT,
  PaymentProviderPort,
} from '../application/ports/payment-provider.port';
import { TopUpAdminAlerts } from '../application/top-up-admin-alerts';
import { TopUpAdminAlertHandler } from './top-up-admin-alert.handler';

/**
 * Story IR.2b & Story 13.5: Economy's scheduled jobs and outbox handlers.
 * The registries are optional so a test module without the global SchedulerModule
 * still builds.
 */
@Injectable()
export class EconomySchedulerRegistrar implements OnModuleInit {
  constructor(
    private readonly rewards: RewardSettlementCoordinator,
    private readonly starterPoints: StarterPointsCoordinator,
    private readonly topUpNotification: TopUpNotificationHandler,
    private readonly payosTopUpService: PayosTopUpService,
    @Inject(PAYOS_TOP_UP_REPOSITORY_PORT)
    private readonly payosTopUpRepository: PayosTopUpRepositoryPort,
    @Inject(PAYMENT_PROVIDER_PORT)
    private readonly paymentProvider: PaymentProviderPort,
    private readonly adminAlerts: TopUpAdminAlerts,
    @Optional() private readonly adminAlertHandler?: TopUpAdminAlertHandler,
    @Optional() private readonly jobs?: ScheduledJobRegistry,
    @Optional() private readonly handlers?: OutboxHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.handlers?.register(this.topUpNotification);
    if (this.adminAlertHandler) {
      this.handlers?.register(this.adminAlertHandler);
    }
    this.jobs?.register(new PendingReleaseJob(this.rewards));
    this.jobs?.register(new StarterExpiryJob(this.starterPoints));
    this.jobs?.register(
      new PayosReconcileJob(
        this.payosTopUpService,
        this.payosTopUpRepository,
        this.paymentProvider,
        this.adminAlerts,
      ),
    );
  }
}
