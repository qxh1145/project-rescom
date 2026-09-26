import {
  NOTIFICATION_LIST_DEFAULT_LIMIT,
  NOTIFICATION_LIST_MAX_LIMIT,
  NOTIFICATION_LIST_MAX_OFFSET,
  NOTIFICATION_MESSAGE_MAX_LENGTH,
  NOTIFICATION_TYPES,
  listNotificationsQuerySchema,
  markAllNotificationsReadResultSchema,
  markNotificationReadResultSchema,
  notificationListSchema,
  notificationSchema,
  notificationTypeSchema,
  notificationUnreadCountSchema,
  publishNotificationCommandSchema,
} from './index';
import * as rootExports from '../index';

describe('Notification contracts (Story 9.6, FR-57)', () => {
  const notificationId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';

  const validNotification = {
    id: notificationId,
    type: 'REWARD_RELEASED',
    message: '+20 points were released to your Available balance.',
    isRead: false,
    createdAt: '2026-09-26T09:00:00.000Z',
    readAt: null,
  };

  it('is exported from the package root', () => {
    expect(rootExports.notificationSchema).toBe(notificationSchema);
    expect(rootExports.publishNotificationCommandSchema).toBe(
      publishNotificationCommandSchema,
    );
  });

  describe('notificationTypeSchema', () => {
    it('matches the Prisma NotificationType enum exactly', () => {
      expect([...NOTIFICATION_TYPES]).toEqual([
        'SURVEY_APPROVED',
        'SURVEY_REJECTED',
        'ESCROW_RELEASED',
        'TOPUP_SUCCESS',
        'REWARD_EARNED',
        'REWARD_PENDING',
        'REWARD_RELEASED',
        'ACCOUNT_ACTIVATED',
        'WARNING',
      ]);
    });

    it('decision E9-D2: accepts REWARD_EARNED (FR-57 "Points earned" for Internal instant credits)', () => {
      expect(notificationTypeSchema.safeParse('REWARD_EARNED').success).toBe(
        true,
      );
    });

    it('rejects unknown types', () => {
      expect(notificationTypeSchema.safeParse('POINTS_EARNED').success).toBe(
        false,
      );
    });
  });

  describe('notificationSchema', () => {
    it('accepts an unread notification', () => {
      expect(notificationSchema.safeParse(validNotification).success).toBe(
        true,
      );
    });

    it('accepts a read notification with readAt', () => {
      const result = notificationSchema.safeParse({
        ...validNotification,
        isRead: true,
        readAt: '2026-09-26T09:05:00.000Z',
      });
      expect(result.success).toBe(true);
    });

    it('rejects a non-uuid id and a malformed createdAt', () => {
      expect(
        notificationSchema.safeParse({ ...validNotification, id: 'n-1' })
          .success,
      ).toBe(false);
      expect(
        notificationSchema.safeParse({
          ...validNotification,
          createdAt: 'yesterday',
        }).success,
      ).toBe(false);
    });
  });

  describe('listNotificationsQuerySchema', () => {
    it('applies defaults for an empty query', () => {
      const result = listNotificationsQuerySchema.parse({});
      expect(result).toEqual({
        limit: NOTIFICATION_LIST_DEFAULT_LIMIT,
        offset: 0,
        unreadOnly: false,
      });
    });

    it('coerces query-string values', () => {
      const result = listNotificationsQuerySchema.parse({
        limit: '5',
        offset: '10',
        unreadOnly: 'true',
      });
      expect(result).toEqual({ limit: 5, offset: 10, unreadOnly: true });
    });

    it('accepts boolean unreadOnly and "false"', () => {
      expect(
        listNotificationsQuerySchema.parse({ unreadOnly: false }).unreadOnly,
      ).toBe(false);
      expect(
        listNotificationsQuerySchema.parse({ unreadOnly: 'false' }).unreadOnly,
      ).toBe(false);
    });

    it('rejects out-of-range limits, negative offsets and junk flags', () => {
      expect(listNotificationsQuerySchema.safeParse({ limit: '0' }).success).toBe(
        false,
      );
      expect(
        listNotificationsQuerySchema.safeParse({
          limit: String(NOTIFICATION_LIST_MAX_LIMIT + 1),
        }).success,
      ).toBe(false);
      expect(
        listNotificationsQuerySchema.safeParse({ limit: '2.5' }).success,
      ).toBe(false);
      expect(
        listNotificationsQuerySchema.safeParse({ offset: '-1' }).success,
      ).toBe(false);
      expect(
        listNotificationsQuerySchema.safeParse({ unreadOnly: 'yes' }).success,
      ).toBe(false);
    });

    it('bounds offset so a huge value is a validation error, not a 500 (review P10)', () => {
      expect(NOTIFICATION_LIST_MAX_OFFSET).toBe(10_000);
      expect(
        listNotificationsQuerySchema.parse({ offset: '10000' }).offset,
      ).toBe(10_000);
      expect(
        listNotificationsQuerySchema.safeParse({ offset: '10001' }).success,
      ).toBe(false);
      expect(
        listNotificationsQuerySchema.safeParse({ offset: '1e20' }).success,
      ).toBe(false);
    });

    it('rejects unknown query keys', () => {
      expect(
        listNotificationsQuerySchema.safeParse({ userId }).success,
      ).toBe(false);
    });
  });

  describe('response DTOs', () => {
    it('validates a list response', () => {
      const result = notificationListSchema.safeParse({
        items: [validNotification],
        unreadCount: 1,
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      });
      expect(result.success).toBe(true);
    });

    it('rejects a negative unread count', () => {
      expect(
        notificationUnreadCountSchema.safeParse({ unreadCount: -1 }).success,
      ).toBe(false);
    });

    it('validates mark-read results', () => {
      expect(
        markNotificationReadResultSchema.safeParse({
          notification: {
            ...validNotification,
            isRead: true,
            readAt: '2026-09-26T09:05:00.000Z',
          },
          unreadCount: 0,
        }).success,
      ).toBe(true);
      expect(
        markAllNotificationsReadResultSchema.safeParse({
          updatedCount: 3,
          unreadCount: 0,
        }).success,
      ).toBe(true);
    });
  });

  describe('publishNotificationCommandSchema', () => {
    const command = {
      userId,
      type: 'ACCOUNT_ACTIVATED',
      message: '  Your starter points were unlocked.  ',
      dedupeKey: ' starter-unlock:abc ',
    };

    it('trims message and dedupe key', () => {
      const result = publishNotificationCommandSchema.parse(command);
      expect(result.message).toBe('Your starter points were unlocked.');
      expect(result.dedupeKey).toBe('starter-unlock:abc');
    });

    it('rejects blank messages, overlong messages and missing dedupe keys', () => {
      expect(
        publishNotificationCommandSchema.safeParse({ ...command, message: '   ' })
          .success,
      ).toBe(false);
      expect(
        publishNotificationCommandSchema.safeParse({
          ...command,
          message: 'x'.repeat(NOTIFICATION_MESSAGE_MAX_LENGTH + 1),
        }).success,
      ).toBe(false);
      expect(
        publishNotificationCommandSchema.safeParse({ ...command, dedupeKey: '' })
          .success,
      ).toBe(false);
    });

    it('replaces a lone surrogate in the message with U+FFFD (review P9)', () => {
      const result = publishNotificationCommandSchema.parse({
        ...command,
        message: 'Survey "Khảo sát \uD83D..." was approved.',
      });
      expect(result.message).toBe('Survey "Khảo sát \uFFFD..." was approved.');
      expect(
        publishNotificationCommandSchema.parse({
          ...command,
          message: 'Emoji 😀 stays',
        }).message,
      ).toBe('Emoji 😀 stays');
    });

    it('rejects a non-uuid target user', () => {
      expect(
        publishNotificationCommandSchema.safeParse({
          ...command,
          userId: 'user-1',
        }).success,
      ).toBe(false);
    });
  });
});
