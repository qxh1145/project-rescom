import {
  INTEGRITY_CONSENT_PURPOSE,
  integrityConsentSchema,
} from '@rescom/schemas';
import { IntegrityConsentService } from './integrity-consent.service';
import { IntegrityConsentVersionMismatchException } from './exceptions/integrity-consent.exceptions';
import { InMemoryIntegrityConsentRepository } from '../infrastructure/in-memory-integrity-consent.repository';

describe('IntegrityConsentService (Figma 14 notice)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  let repository: InMemoryIntegrityConsentRepository;
  let clock: Date;
  let service: IntegrityConsentService;

  beforeEach(() => {
    repository = new InMemoryIntegrityConsentRepository();
    clock = new Date('2026-10-01T08:00:00.000Z');
    service = new IntegrityConsentService({
      repository,
      currentNoticeVersion: 2,
      now: () => clock,
    });
  });

  it('reports a user who never accepted', async () => {
    const consent = await service.getConsent(userId);
    expect(consent).toEqual({
      currentVersion: 2,
      acceptedVersion: null,
      acceptedAt: null,
    });
    expect(integrityConsentSchema.safeParse(consent).success).toBe(true);
  });

  it('records the current notice once and replays the original time', async () => {
    const first = await service.acceptConsent(userId, { noticeVersion: 2 });
    expect(first).toEqual({
      currentVersion: 2,
      acceptedVersion: 2,
      acceptedAt: '2026-10-01T08:00:00.000Z',
    });

    clock = new Date('2026-10-02T09:00:00.000Z');
    await expect(
      service.acceptConsent(userId, { noticeVersion: 2 }),
    ).resolves.toEqual(first);
    await expect(service.getConsent(userId)).resolves.toEqual(first);
    expect(repository.records).toHaveLength(1);
    expect(repository.records[0].purpose).toBe(INTEGRITY_CONSENT_PURPOSE);
  });

  it('refuses an old or unknown notice version without recording it', async () => {
    for (const noticeVersion of [1, 3]) {
      const error = await service
        .acceptConsent(userId, { noticeVersion })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(IntegrityConsentVersionMismatchException);
      expect(
        (error as IntegrityConsentVersionMismatchException).currentVersion,
      ).toBe(2);
    }
    expect(repository.records).toHaveLength(0);
  });

  it('reads the highest accepted, not revoked, version', async () => {
    repository.records.push(
      {
        id: 'a',
        userId,
        purpose: INTEGRITY_CONSENT_PURPOSE,
        noticeVersion: 1,
        grantedAt: new Date('2026-09-01T00:00:00.000Z'),
        revokedAt: null,
      },
      {
        id: 'b',
        userId,
        purpose: INTEGRITY_CONSENT_PURPOSE,
        noticeVersion: 2,
        grantedAt: new Date('2026-09-15T00:00:00.000Z'),
        revokedAt: new Date('2026-09-20T00:00:00.000Z'),
      },
      {
        id: 'c',
        userId,
        purpose: 'OTHER_PURPOSE',
        noticeVersion: 5,
        grantedAt: new Date('2026-09-15T00:00:00.000Z'),
        revokedAt: null,
      },
    );

    await expect(service.getConsent(userId)).resolves.toEqual({
      currentVersion: 2,
      acceptedVersion: 1,
      acceptedAt: '2026-09-01T00:00:00.000Z',
    });

    // Accepting the revoked current version again grants it anew.
    await expect(
      service.acceptConsent(userId, { noticeVersion: 2 }),
    ).resolves.toEqual({
      currentVersion: 2,
      acceptedVersion: 2,
      acceptedAt: '2026-10-01T08:00:00.000Z',
    });
  });

  it('defaults to the shared notice version', async () => {
    const shared = new IntegrityConsentService({ repository });
    await expect(shared.getConsent(userId)).resolves.toMatchObject({
      currentVersion: 1,
    });
  });
});
