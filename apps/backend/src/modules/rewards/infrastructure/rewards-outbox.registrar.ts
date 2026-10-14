import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { OutboxHandlerRegistry } from '../../../common/scheduler/outbox/outbox-handler';
import { VoucherExpiryNotificationHandler } from '../application/voucher-expiry-notification.handler';
import { CodeIssueNotificationHandler } from '../application/code-issue-notification.handler';

@Injectable()
export class RewardsOutboxRegistrar implements OnModuleInit {
  constructor(
    private readonly voucherExpiryHandler: VoucherExpiryNotificationHandler,
    private readonly codeIssueHandler: CodeIssueNotificationHandler,
    @Optional() private readonly handlers?: OutboxHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.handlers?.register(this.voucherExpiryHandler);
    this.handlers?.register(this.codeIssueHandler);
  }
}
