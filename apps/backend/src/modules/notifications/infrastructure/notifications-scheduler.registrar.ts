import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { OutboxHandlerRegistry } from '../../../common/scheduler/outbox/outbox-handler';
import { EmailDeliveryHandler } from '../application/email-delivery.handler';

/**
 * Story IR.4b B-T7: registers `notifications.email-delivery` with the IR.2b
 * Outbox registry. Optional so a test module without the global
 * SchedulerModule still builds.
 */
@Injectable()
export class NotificationsSchedulerRegistrar implements OnModuleInit {
  constructor(
    private readonly emailDelivery: EmailDeliveryHandler,
    @Optional() private readonly handlers?: OutboxHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.handlers?.register(this.emailDelivery);
  }
}
