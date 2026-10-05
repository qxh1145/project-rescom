import { PrismaIntegrityConsentRepository } from './prisma-integrity-consent.repository';

describe('PrismaIntegrityConsentRepository', () => {
  const key = {
    userId: '11111111-1111-4111-8111-111111111111',
    purpose: 'INTEGRITY_TELEMETRY',
    noticeVersion: 1,
  };
  const grantedAt = new Date('2026-10-01T08:00:00.000Z');

  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: '22222222-2222-4222-8222-222222222222',
      ...key,
      grantedAt: new Date('2026-09-30T08:00:00.000Z'),
      revokedAt: null,
      ...overrides,
    };
  }

  function setup(stored = row()) {
    const integrityConsent = {
      findFirst: jest.fn().mockResolvedValue(stored),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(stored),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    return {
      integrityConsent,
      repository: new PrismaIntegrityConsentRepository({
        integrityConsent,
      } as any),
    };
  }

  it('reads the highest accepted, not revoked, version of the purpose', async () => {
    const { integrityConsent, repository } = setup();

    await expect(
      repository.findLatestAccepted(key.userId, key.purpose),
    ).resolves.toMatchObject({ noticeVersion: 1, revokedAt: null });
    expect(integrityConsent.findFirst).toHaveBeenCalledWith({
      where: { userId: key.userId, purpose: key.purpose, revokedAt: null },
      orderBy: { noticeVersion: 'desc' },
    });
  });

  it('inserts with ON CONFLICT DO NOTHING and keeps the first acceptance', async () => {
    const { integrityConsent, repository } = setup();

    const accepted = await repository.accept({ ...key, grantedAt });

    expect(integrityConsent.createMany).toHaveBeenCalledWith({
      data: [{ ...key, grantedAt }],
      skipDuplicates: true,
    });
    expect(integrityConsent.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { userId_purpose_noticeVersion: key },
    });
    expect(accepted.grantedAt).toEqual(new Date('2026-09-30T08:00:00.000Z'));
    expect(integrityConsent.updateMany).not.toHaveBeenCalled();
  });

  it('grants a revoked acceptance again', async () => {
    const revoked = row({ revokedAt: new Date('2026-09-30T09:00:00.000Z') });
    const { integrityConsent, repository } = setup(revoked);
    integrityConsent.findUniqueOrThrow
      .mockResolvedValueOnce(revoked)
      .mockResolvedValueOnce(row({ grantedAt }));

    const accepted = await repository.accept({ ...key, grantedAt });

    expect(integrityConsent.updateMany).toHaveBeenCalledWith({
      where: { id: revoked.id, revokedAt: { not: null } },
      data: { revokedAt: null, grantedAt },
    });
    expect(accepted).toMatchObject({ grantedAt, revokedAt: null });
  });
});
