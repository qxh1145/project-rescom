import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { EnvService } from '../../../common/config/env.service';
import { ScheduledJobRegistry } from '../../../common/scheduler/scheduled-job';
import { FlashSaleLifecycleService } from '../application/flash-sale-lifecycle.service';
import { FlashSaleLifecycleJob } from './flash-sale-lifecycle.job';
import { VoucherReminderService } from '../application/voucher-reminder.service';
import { VoucherReminderJob } from './voucher-reminder.job';

@Injectable()
export class RewardsSchedulerRegistrar implements OnModuleInit {
  constructor(
    private readonly env: EnvService,
    private readonly lifecycle: FlashSaleLifecycleService,
    private readonly reminderService: VoucherReminderService,
    @Optional() private readonly jobs?: ScheduledJobRegistry,
  ) {}

  onModuleInit(): void {
    if (!this.env.rewardsEnabled) return;
    this.jobs?.register(new FlashSaleLifecycleJob(this.lifecycle));
    this.jobs?.register(new VoucherReminderJob(this.reminderService));
  }
}
