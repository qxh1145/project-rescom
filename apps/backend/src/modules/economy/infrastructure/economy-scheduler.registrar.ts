import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ScheduledJobRegistry } from '../../../common/scheduler/scheduled-job';
import { RewardSettlementCoordinator } from '../application/reward-settlement.coordinator';
import { StarterPointsCoordinator } from '../application/starter-points.coordinator';
import { PendingReleaseJob } from './jobs/pending-release.job';
import { StarterExpiryJob } from './jobs/starter-expiry.job';

/**
 * Story IR.2b: Economy's scheduled jobs. The `InternalRewardRequested`
 * handler is registered by Participation, which owns the Response read it
 * checks (review LOW-15). The registries are optional so a test module
 * without the global SchedulerModule still builds.
 */
@Injectable()
export class EconomySchedulerRegistrar implements OnModuleInit {
  constructor(
    private readonly rewards: RewardSettlementCoordinator,
    private readonly starterPoints: StarterPointsCoordinator,
    @Optional() private readonly jobs?: ScheduledJobRegistry,
  ) {}

  onModuleInit(): void {
    this.jobs?.register(new PendingReleaseJob(this.rewards));
    this.jobs?.register(new StarterExpiryJob(this.starterPoints));
  }
}
