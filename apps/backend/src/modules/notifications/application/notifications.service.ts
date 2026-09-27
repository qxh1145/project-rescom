import {
  ListNotificationsQuery,
  MarkAllNotificationsReadResultDto,
  MarkNotificationReadResultDto,
  NotificationListDto,
  NotificationUnreadCountDto,
  PublishNotificationCommand,
  publishNotificationCommandSchema,
} from '@rescom/schemas';
import { NotificationRepositoryPort } from './ports/notification-repository.port';
import {
  NotificationPublisherPort,
  NotificationPublishResult,
} from './ports/notification-publisher.port';
import { NotificationNotFoundException } from './exceptions/notification.exceptions';

/** Framework-free sink for publish failures (wired to Nest's Logger in the module). */
export interface NotificationFailureLogger {
  warn(message: string): void;
}

/**
 * Notifications application service (Story 9.6, FR-57).
 *
 * - As `NotificationPublisherPort` it records notification intent for other
 *   contexts, idempotently and without ever failing the caller.
 * - As the read side it serves the owner-scoped notification center.
 */
export class NotificationsService implements NotificationPublisherPort {
  constructor(
    private readonly repository: NotificationRepositoryPort,
    private readonly logger?: NotificationFailureLogger,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async publish(
    command: PublishNotificationCommand,
  ): Promise<NotificationPublishResult> {
    try {
      const parsed = publishNotificationCommandSchema.safeParse(command);
      if (!parsed.success) {
        this.reportFailure(
          command,
          parsed.error.errors[0]?.message ?? 'invalid notification command',
        );
        return 'FAILED';
      }

      const created = await this.repository.createIfAbsent(parsed.data);
      return created ? 'CREATED' : 'DUPLICATE';
    } catch (error) {
      this.reportFailure(
        command,
        error instanceof Error ? error.message : String(error),
      );
      return 'FAILED';
    }
  }

  async list(
    userId: string,
    query: ListNotificationsQuery,
  ): Promise<NotificationListDto> {
    const [items, total, unreadCount] = await Promise.all([
      this.repository.listForUser(userId, query),
      this.repository.countForUser(userId, { unreadOnly: query.unreadOnly }),
      this.repository.countForUser(userId, { unreadOnly: true }),
    ]);

    return {
      items: items.map((notification) => notification.toDto()),
      unreadCount,
      total,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + items.length < total,
    };
  }

  async getUnreadCount(userId: string): Promise<NotificationUnreadCountDto> {
    return {
      unreadCount: await this.repository.countForUser(userId, {
        unreadOnly: true,
      }),
    };
  }

  async markRead(
    userId: string,
    notificationId: string,
  ): Promise<MarkNotificationReadResultDto> {
    const notification = await this.repository.markRead(
      userId,
      notificationId,
      this.clock(),
    );
    if (!notification) {
      throw new NotificationNotFoundException();
    }

    const { unreadCount } = await this.getUnreadCount(userId);
    return { notification: notification.toDto(), unreadCount };
  }

  async markAllRead(
    userId: string,
  ): Promise<MarkAllNotificationsReadResultDto> {
    const updatedCount = await this.repository.markAllRead(
      userId,
      this.clock(),
    );
    const { unreadCount } = await this.getUnreadCount(userId);
    return { updatedCount, unreadCount };
  }

  private reportFailure(
    command: Partial<PublishNotificationCommand>,
    reason: string,
  ): void {
    try {
      this.logger?.warn(
        `Notification ${command?.type ?? 'UNKNOWN'} (${command?.dedupeKey ?? 'no-key'}) was not recorded: ${reason}`,
      );
    } catch {
      // Logging must never break the source workflow either.
    }
  }
}
