import { z } from 'zod';
import type { NotificationType } from './notification.schema';

/**
 * Story IR.4b part B (FR-57 email): the notification types that also send an
 * email. Nothing else does. `COMPLAINT_RESOLVED` joins only when Story 8.5
 * ships a complaint-resolution producer.
 */
export const EMAIL_NOTIFICATION_TYPES = [
  'TOPUP_SUCCESS',
  'TOPUP_REJECTED',
  'ACCOUNT_LOCKED',
  'ACCOUNT_UNLOCKED',
] as const satisfies readonly NotificationType[];

export type EmailNotificationType = (typeof EMAIL_NOTIFICATION_TYPES)[number];

export const emailNotificationTypeSchema = z.enum(EMAIL_NOTIFICATION_TYPES);

export function isEmailNotificationType(
  type: string,
): type is EmailNotificationType {
  return (EMAIL_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

/** Outbox `eventType` written next to a created email-type notification. */
export const NOTIFICATION_EMAIL_REQUESTED_EVENT = 'NotificationEmailRequested';
export const NOTIFICATION_EMAIL_REQUESTED_SCHEMA_VERSION = 1;

/**
 * Outbox payload of `NotificationEmailRequested` (B7): identifiers only, never
 * an address, subject or body. The recipient is resolved at send time.
 */
export const notificationEmailRequestedPayloadSchema = z
  .object({
    schemaVersion: z.literal(NOTIFICATION_EMAIL_REQUESTED_SCHEMA_VERSION),
    notificationId: z.string().uuid(),
    userId: z.string().uuid(),
    type: emailNotificationTypeSchema,
  })
  .strict();

export type NotificationEmailRequestedPayload = z.infer<
  typeof notificationEmailRequestedPayloadSchema
>;

/** Outbox idempotency key and `email_deliveries.idempotency_key` of one notification. */
export function notificationEmailKey(notificationId: string): string {
  return `notification-email:${notificationId}`;
}

/** Mirrors the Prisma `EmailDeliveryStatus` enum (parity spec in the backend). */
export const EMAIL_DELIVERY_STATUSES = [
  'SENDING',
  'SENT',
  'FAILED',
  'UNCONFIRMED',
  'SKIPPED',
] as const;

export const emailDeliveryStatusSchema = z.enum(EMAIL_DELIVERY_STATUSES);

export type EmailDeliveryStatus = z.infer<typeof emailDeliveryStatusSchema>;

/** `EMAIL_DELIVERY_MODE`: no-op, in-memory capture (local/test) or SMTP. */
export const EMAIL_DELIVERY_MODES = ['disabled', 'capture', 'smtp'] as const;

export type EmailDeliveryMode = (typeof EMAIL_DELIVERY_MODES)[number];
