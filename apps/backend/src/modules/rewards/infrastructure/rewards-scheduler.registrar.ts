import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ScheduledJobRegistry } from '../../../common/scheduler/scheduled-job';
import { FlashSaleLifecycleService } from '../application/flash-sale-lifecycle.service';
import { FlashSaleLifecycleJob } from './flash-sale-lifecycle.job';

@Injectable()
export class RewardsSchedulerRegistrar implements OnModuleInit {
  constructor(
    private readonly lifecycle: FlashSaleLifecycleService,
    @Optional() private readonly jobs?: ScheduledJobRegistry,
  ) {}

  onModuleInit(): void {
    this.jobs?.register(new FlashSaleLifecycleJob(this.lifecycle));
  }
}
