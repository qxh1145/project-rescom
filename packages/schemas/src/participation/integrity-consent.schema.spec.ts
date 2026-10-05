import {
  INTEGRITY_CONSENT_NOTICE_VERSION,
  INTEGRITY_CONSENT_PURPOSE,
  INTEGRITY_CONSENT_VERSION_MISMATCH_CODE,
  acceptIntegrityConsentInputSchema,
  integrityConsentSchema,
  integrityConsentVersionMismatchDetailsSchema,
} from './integrity-consent.schema';
import * as rootExports from '../index';

describe('Integrity consent contracts (Figma 14 notice)', () => {
  it('exposes the purpose, the current notice version and the error code', () => {
    expect(INTEGRITY_CONSENT_PURPOSE).toBe('INTEGRITY_TELEMETRY');
    expect(INTEGRITY_CONSENT_NOTICE_VERSION).toBe(1);
    expect(INTEGRITY_CONSENT_VERSION_MISMATCH_CODE).toBe(
      'INTEGRITY_CONSENT_VERSION_MISMATCH',
    );
    expect(rootExports.integrityConsentSchema).toBe(integrityConsentSchema);
  });

  it('accepts a consent status before and after the acceptance', () => {
    expect(
      integrityConsentSchema.safeParse({
        currentVersion: 1,
        acceptedVersion: null,
        acceptedAt: null,
      }).success,
    ).toBe(true);
    expect(
      integrityConsentSchema.safeParse({
        currentVersion: 1,
        acceptedVersion: 1,
        acceptedAt: '2026-10-01T08:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('sets acceptedVersion and acceptedAt together and rejects unknown keys', () => {
    expect(
      integrityConsentSchema.safeParse({
        currentVersion: 1,
        acceptedVersion: 1,
        acceptedAt: null,
      }).success,
    ).toBe(false);
    expect(
      integrityConsentSchema.safeParse({
        currentVersion: 1,
        acceptedVersion: null,
        acceptedAt: null,
        userId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false);
  });

  it('accepts only a positive integer notice version in the request', () => {
    expect(
      acceptIntegrityConsentInputSchema.safeParse({ noticeVersion: 1 }).success,
    ).toBe(true);
    for (const body of [
      {},
      { noticeVersion: 0 },
      { noticeVersion: 1.5 },
      { noticeVersion: '1' },
      { noticeVersion: 1, purpose: 'OTHER' },
    ]) {
      expect(acceptIntegrityConsentInputSchema.safeParse(body).success).toBe(
        false,
      );
    }
  });

  it('describes a version mismatch', () => {
    expect(
      integrityConsentVersionMismatchDetailsSchema.safeParse({
        currentVersion: 2,
      }).success,
    ).toBe(true);
  });
});
