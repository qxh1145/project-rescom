import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { EnvService } from '../../../common/config/env.service';
import { PayosAvailability } from '../application/payos-availability';
import {
  PayosTopUpRepositoryPort,
  PAYOS_TOP_UP_REPOSITORY_PORT,
} from '../application/ports/payos-top-up-repository.port';
import {
  ADMIN_CAPABILITY_PORT,
  AdminCapabilityPort,
} from '../application/ports/admin-capability.port';
import {
  NOTIFICATION_PUBLISHER_PORT,
  NotificationPublisherPort,
} from '../../notifications/application/ports/notification-publisher.port';

@Injectable()
export class PayosEnableGuard implements OnApplicationBootstrap {
  private readonly logger = new Logger(PayosEnableGuard.name);
  constructor(
    private readonly env: EnvService,
    private readonly availability: PayosAvailability,
    @Inject(PAYOS_TOP_UP_REPOSITORY_PORT)
    private readonly repository: PayosTopUpRepositoryPort,
    @Inject(ADMIN_CAPABILITY_PORT) private readonly admins: AdminCapabilityPort,
    @Optional()
    @Inject(NOTIFICATION_PUBLISHER_PORT)
    private readonly notifications?: NotificationPublisherPort,
  ) {}
  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.payosEnabled) return;
    try {
      const count = await this.repository.countManualPending();
      if (count === 0) {
        this.availability.open();
        this.logger.log('PayOS checkout enabled');
        return;
      }
      this.logger.error(
        `PAYOS_ENABLED=true but ${count} manual PENDING top-up(s) exist; PayOS stays off until a restart with none`,
      );
      const ids = await this.admins.listActiveAdminIds();
      const dedupeKey = `payos-enable-blocked:${new Date().toISOString().slice(0, 10)}`;
      for (const userId of ids)
        await this.notifications
          ?.publish({
            userId,
            type: 'WARNING',
            message: `PayOS chưa bật: còn ${count} yêu cầu nạp thủ công đang chờ duyệt. Duyệt/từ chối hết rồi khởi động lại backend.`,
            dedupeKey,
          })
          .catch((error: unknown) =>
            this.logger.error(
              `PayOS enable alert to admin ${userId} failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
    } catch (error) {
      this.logger.error(
        `PayOS enable check failed; checkout stays off: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
