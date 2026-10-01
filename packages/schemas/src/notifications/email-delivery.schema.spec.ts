import {
  EMAIL_DELIVERY_MODES,
  EMAIL_DELIVERY_STATUSES,
  EMAIL_NOTIFICATION_TYPES,
  NOTIFICATION_EMAIL_REQUESTED_EVENT,
  NOTIFICATION_TYPES,
  isEmailNotificationType,
  notificationEmailKey,
  notificationEmailRequestedPayloadSchema,
} from './index';
import * as rootExports from '../index';

describe('Email delivery contracts (Story IR.4b part B)', () => {
  const notificationId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const payload = {
    schemaVersion: 1,
    notificationId,
    userId,
    type: 'TOPUP_REJECTED',
  };

  it('lists exactly the four critical types, all of them notification types (B2)', () => {
    expect([...EMAIL_NOTIFICATION_TYPES]).toEqual([
      'TOPUP_SUCCESS',
      'TOPUP_REJECTED',
      'ACCOUNT_LOCKED',
      'ACCOUNT_UNLOCKED',
    ]);
    for (const type of EMAIL_NOTIFICATION_TYPES) {
      expect(NOTIFICATION_TYPES).toContain(type);
    }
  });

  it('tells email types apart from in-app-only types', () => {
    expect(isEmailNotificationType('ACCOUNT_LOCKED')).toBe(true);
    expect(isEmailNotificationType('WARNING')).toBe(false);
    expect(isEmailNotificationType('REWARD_EARNED')).toBe(false);
    expect(isEmailNotificationType('NOT_A_TYPE')).toBe(false);
  });

  it('accepts an identifiers-only payload (B7)', () => {
    expect(notificationEmailRequestedPayloadSchema.parse(payload)).toEqual(
      payload,
    );
  });

  it('rejects extra keys such as an address or a body', () => {
    expect(
      notificationEmailRequestedPayloadSchema.safeParse({
        ...payload,
        email: 'someone@example.com',
      }).success,
    ).toBe(false);
  });

  it('rejects another schema version, a non-email type and malformed ids', () => {
    for (const bad of [
      { ...payload, schemaVersion: 2 },
      { ...payload, type: 'WARNING' },
      { ...payload, notificationId: 'nope' },
      { ...payload, userId: undefined },
    ]) {
      expect(notificationEmailRequestedPayloadSchema.safeParse(bad).success).toBe(
        false,
      );
    }
  });

  it('builds the per-notification idempotency key', () => {
    expect(notificationEmailKey(notificationId)).toBe(
      `notification-email:${notificationId}`,
    );
    expect(NOTIFICATION_EMAIL_REQUESTED_EVENT).toBe('NotificationEmailRequested');
  });

  it('exposes the statuses and modes from the package root', () => {
    expect([...EMAIL_DELIVERY_STATUSES]).toEqual([
      'SENDING',
      'SENT',
      'FAILED',
      'UNCONFIRMED',
      'SKIPPED',
    ]);
    expect([...EMAIL_DELIVERY_MODES]).toEqual(['disabled', 'capture', 'smtp']);
    expect(rootExports.EMAIL_NOTIFICATION_TYPES).toBe(EMAIL_NOTIFICATION_TYPES);
  });
});
