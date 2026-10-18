import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ScheduledJobRegistry } from '../../../common/scheduler/scheduled-job';
import { OutboxHandlerRegistry } from '../../../common/scheduler/outbox/outbox-handler';
import { RewardSettlementCoordinator } from '../../economy/application/reward-settlement.coordinator';
import { InternalRewardRequestedHandler } from '../../economy/infrastructure/outbox/internal-reward-requested.handler';
import {
  PARTICIPATION_REPOSITORY_PORT,
  ParticipationRepositoryPort,
} from '../application/ports/participation-repository.port';
import {
  NOTIFICATION_PUBLISHER_PORT,
  NotificationPublisherPort,
} from '../../notifications/application/ports/notification-publisher.port';
import { MissingCodeResolvedNotificationHandler } from '../application/missing-code-resolved-notification.handler';
import { ReservationExpiryJob } from './jobs/reservation-expiry.job';

/**
 * Story IR.2b / 14.1: registers `reservation-expiry`, `InternalRewardRequested`,
 * and `MissingCodeResolvedNotificationHandler` Outbox handlers.
 */
@Injectable()
export class ParticipationSchedulerRegistrar implements OnModuleInit {
  constructor(
    @Inject(PARTICIPATION_REPOSITORY_PORT)
    private readonly participationRepository: ParticipationRepositoryPort,
    private readonly rewards: RewardSettlementCoordinator,
    @Optional()
    @Inject(NOTIFICATION_PUBLISHER_PORT)
    private readonly notifications?: NotificationPublisherPort,
    @Optional() private readonly jobs?: ScheduledJobRegistry,
    @Optional() private readonly handlers?: OutboxHandlerRegistry,
  ) {}

  onModuleInit(): void {
    // Story IR.2b Task 5 + review LOW-15: the reward recovery handler checks
    // the Response through this context's repository before paying.
    this.handlers?.register(
      new InternalRewardRequestedHandler(
        this.rewards,
        this.participationRepository,
      ),
    );
    if (this.notifications) {
      this.handlers?.register(
        new MissingCodeResolvedNotificationHandler(this.notifications),
      );
    }
    this.jobs?.register(new ReservationExpiryJob(this.participationRepository));
  }
}
