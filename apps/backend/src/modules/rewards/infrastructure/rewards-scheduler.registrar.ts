import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ScheduledJobRegistry } from '../../../common/scheduler/scheduled-job';
import { FlashSaleLifecycleService } from '../application/flash-sale-lifecycle.service';
import { FlashSaleLifecycleJob } from './flash-sale-lifecycle.job';
import { VoucherReminderService } from '../application/voucher-reminder.service';
import { VoucherReminderJob } from './voucher-reminder.job';

@Injectable()
export class RewardsSchedulerRegistrar implements OnModuleInit {
  constructor(
    private readonly lifecycle: FlashSaleLifecycleService,
    private readonly reminderService: VoucherReminderService,
    @Optional() private readonly jobs?: ScheduledJobRegistry,
  ) {}

  onModuleInit(): void {
    this.jobs?.register(new FlashSaleLifecycleJob(this.lifecycle));
    this.jobs?.register(new VoucherReminderJob(this.reminderService));
  }
}
