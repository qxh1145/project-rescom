import { z } from 'zod';
import { replaceLoneSurrogates } from '../common/unicode-text';

/**
 * In-app notification contracts (Story 9.6, FR-57).
 *
 * `NOTIFICATION_TYPES` must stay identical to the Prisma `NotificationType`
 * enum (apps/backend/prisma/schema.prisma).
 *
 * `REWARD_EARNED` (decision E9-D2, 2026-09-26): FR-57 "Points earned" — an
 * Internal survey reward credited instantly to the Available balance.
 */
export const NOTIFICATION_TYPES = [
  'SURVEY_APPROVED',
  'SURVEY_REJECTED',
  'ESCROW_RELEASED',
  'TOPUP_SUCCESS',
  'REWARD_EARNED',
  'REWARD_PENDING',
  'REWARD_RELEASED',
  'ACCOUNT_ACTIVATED',
  'WARNING',
] as const;

export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const NOTIFICATION_LIST_DEFAULT_LIMIT = 20;
export const NOTIFICATION_LIST_MAX_LIMIT = 50;
export const NOTIFICATION_MESSAGE_MAX_LENGTH = 500;
export const NOTIFICATION_DEDUPE_KEY_MAX_LENGTH = 200;
/**
 * Upper bound on `offset` (Epic 9 review P10): larger values would overflow
 * the database `skip` and surface as a 500 instead of a 400.
 */
export const NOTIFICATION_LIST_MAX_OFFSET = 10_000;

export const notificationSchema = z.object({
  id: z.string().uuid(),
  type: notificationTypeSchema,
  message: z.string().min(1).max(NOTIFICATION_MESSAGE_MAX_LENGTH),
  isRead: z.boolean(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
});

export type NotificationDto = z.infer<typeof notificationSchema>;

const queryBooleanSchema = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform((value) => value === 'true'),
]);

/** Query-string tolerant list parameters for `GET /notifications`. */
export const listNotificationsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int('limit must be an integer')
      .min(1, 'limit must be at least 1')
      .max(
        NOTIFICATION_LIST_MAX_LIMIT,
        `limit must be at most ${NOTIFICATION_LIST_MAX_LIMIT}`,
      )
      .default(NOTIFICATION_LIST_DEFAULT_LIMIT),
    offset: z.coerce
      .number()
      .int('offset must be an integer')
      .min(0, 'offset cannot be negative')
      .max(
        NOTIFICATION_LIST_MAX_OFFSET,
        `offset must be at most ${NOTIFICATION_LIST_MAX_OFFSET}`,
      )
      .default(0),
    unreadOnly: queryBooleanSchema.default(false),
  })
  .strict();

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type ListNotificationsQueryInput = z.input<
  typeof listNotificationsQuerySchema
>;

export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  unreadCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

export type NotificationListDto = z.infer<typeof notificationListSchema>;

export const notificationUnreadCountSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
});

export type NotificationUnreadCountDto = z.infer<
  typeof notificationUnreadCountSchema
>;

export const markNotificationReadResultSchema = z.object({
  notification: notificationSchema,
  unreadCount: z.number().int().nonnegative(),
});

export type MarkNotificationReadResultDto = z.infer<
  typeof markNotificationReadResultSchema
>;

export const markAllNotificationsReadResultSchema = z.object({
  updatedCount: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
});

export type MarkAllNotificationsReadResultDto = z.infer<
  typeof markAllNotificationsReadResultSchema
>;

/**
 * Command other bounded contexts send to the Notifications publisher port.
 * `dedupeKey` is the stable identity of the source event (usually the Ledger
 * idempotency key) so a replay can never create a duplicate notification.
 * A lone UTF-16 surrogate in `message` (e.g. an emoji split by a producer's
 * truncation) is replaced with U+FFFD so the database accepts the row
 * (Epic 9 review P9).
 */
export const publishNotificationCommandSchema = z.object({
  userId: z.string().uuid('userId must be a valid UUID'),
  type: notificationTypeSchema,
  message: z
    .string()
    .trim()
    .min(1, 'message is required')
    .max(NOTIFICATION_MESSAGE_MAX_LENGTH)
    .transform(replaceLoneSurrogates),
  dedupeKey: z
    .string()
    .trim()
    .min(1, 'dedupeKey is required')
    .max(NOTIFICATION_DEDUPE_KEY_MAX_LENGTH),
});

export type PublishNotificationCommand = z.infer<
  typeof publishNotificationCommandSchema
>;
