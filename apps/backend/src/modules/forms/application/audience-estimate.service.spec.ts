import { createHmac } from 'crypto';
import {
  DemographicProfileDto,
  SurveyTargetingCriteria,
  toAudienceEstimate,
} from '@rescom/schemas';
import {
  AUDIENCE_CACHE_TTL_MS,
  AudienceEstimateRateLimitedError,
  AudienceEstimateService,
  audienceVariants,
  normalizeAudienceTargeting,
} from './audience-estimate.service';
import { InMemoryAudienceProfileSource } from '../infrastructure/in-memory-audience-profile.source';
import { InMemoryRateLimitCounterStore } from '../../../common/security/in-memory-rate-limit-counter.store';

const PUBLISHER = 'publisher-0000';
const NOISE_KEY = 'test-noise-key';
const NOW = new Date('2026-10-01T08:00:00.000Z');

function profile(
  userId: string,
  overrides: Partial<DemographicProfileDto> = {},
): DemographicProfileDto {
  return {
    id: `profile-${userId}`,
    userId,
    age: 20,
    gender: 'FEMALE',
    location: 'Hà Nội',
    occupation: 'Sinh viên',
    fieldOfStudy: 'Kinh tế',
    householdIncome: 'Dưới 5 triệu',
    specificInterests: ['Công nghệ'],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function seed(
  source: InMemoryAudienceProfileSource,
  count: number,
  prefix: string,
  overrides: Partial<DemographicProfileDto> = {},
) {
  for (let i = 0; i < count; i += 1) {
    const userId = `${prefix}-${String(i).padStart(4, '0')}`;
    source.add(userId, profile(userId, overrides));
  }
}

/** The documented noise: HMAC(key, normalized targeting | UTC day) → [-3, 3]. */
function expectedNoise(targeting: SurveyTargetingCriteria, now = NOW): number {
  const key = JSON.stringify(normalizeAudienceTargeting(targeting));
  const digest = createHmac('sha256', NOISE_KEY)
    .update(`${key}|${now.toISOString().slice(0, 10)}`)
    .digest();
  return (digest.readUInt32BE(0) % 7) - 3;
}

function expected(exact: number, targeting: SurveyTargetingCriteria) {
  return toAudienceEstimate(Math.max(10, exact + expectedNoise(targeting)));
}

describe('AudienceEstimateService (plan 5.5)', () => {
  let source: InMemoryAudienceProfileSource;
  let now: Date;
  const logger = { log: jest.fn(), warn: jest.fn() };

  const service = (extra: Record<string, unknown> = {}) =>
    new AudienceEstimateService(source, {
      noiseKey: NOISE_KEY,
      now: () => now,
      logger,
      ...extra,
    });

  beforeEach(() => {
    source = new InMemoryAudienceProfileSource();
    now = NOW;
    logger.log.mockReset();
    logger.warn.mockReset();
  });

  it('counts complete profiles matching the shared rules, plus deterministic noise', async () => {
    seed(source, 23, 'f-hn', { gender: 'FEMALE', location: 'Hà Nội' });
    seed(source, 30, 'm-hn', { gender: 'MALE', location: 'Hà Nội' });
    // Same city typed with other spacing/case: `normalizeTargetingText` folds it.
    seed(source, 4, 'f-hn2', { gender: 'FEMALE', location: '  hà   nội ' });
    seed(source, 50, 'f-dn', { gender: 'FEMALE', location: 'Đà Nẵng' });
    const targeting = { genders: ['FEMALE' as const], locations: ['Hà Nội'] };

    const result = await service().estimate(PUBLISHER, targeting);
    expect(result).toEqual(expected(27, targeting));
    // Same targeting written differently: same key, same noise, same answer.
    await expect(
      service().estimate(PUBLISHER, {
        locations: [' HÀ NỘI', 'hà nội'],
        genders: ['FEMALE'],
      }),
    ).resolves.toEqual(result);
  });

  it('never counts incomplete (not onboarded) profiles', async () => {
    seed(source, 40, 'ok');
    seed(source, 40, 'no-income', { householdIncome: null });
    seed(source, 40, 'no-interests', { specificInterests: [] });

    await expect(service().estimate(PUBLISHER, {})).resolves.toEqual(
      expected(40, {}),
    );
  });

  it('hides a group smaller than the minimum (k-anonymity)', async () => {
    seed(source, 9, 'few', { fieldOfStudy: 'Y khoa' });
    seed(source, 100, 'many', { fieldOfStudy: 'Kinh tế' });

    for (const fieldOfStudy of [['Y khoa'], ['Dược']]) {
      await expect(
        service().estimate(PUBLISHER, { fieldOfStudy }),
      ).resolves.toEqual({ estimatedRespondents: null, minimumReportable: 10 });
    }
  });

  it('suppresses an OR-ed list when any single value is under the minimum', async () => {
    seed(source, 40, 'hn', { location: 'Hà Nội' });
    seed(source, 3, 'hue', { location: 'Huế' });
    seed(source, 12, 'dn', { location: 'Đà Nẵng' });

    await expect(
      service().estimate(PUBLISHER, { locations: ['Hà Nội', 'Huế'] }),
    ).resolves.toEqual({ estimatedRespondents: null, minimumReportable: 10 });
    const both = { locations: ['Hà Nội', 'Đà Nẵng'] };
    await expect(service().estimate(PUBLISHER, both)).resolves.toEqual(
      expected(52, both),
    );
    expect(audienceVariants(normalizeAudienceTargeting(both))).toHaveLength(3);
  });

  it('never counts the asking publisher', async () => {
    seed(source, 9, 'young', { age: 19 });
    source.add(PUBLISHER, profile(PUBLISHER, { age: 19 }));

    // 10 profiles match, 9 without the caller: under the minimum.
    await expect(
      service().estimate(PUBLISHER, { ageRange: { min: 18, max: 22 } }),
    ).resolves.toEqual({ estimatedRespondents: null, minimumReportable: 10 });
    expect(source.queries[0]).toMatchObject({
      afterUserId: null,
      ageRange: { min: 18, max: 22 },
    });
  });

  it('walks pages with the keyset cursor and stops at the row cap', async () => {
    seed(source, 25, 'p');
    await service({ pageSize: 10 }).estimate(PUBLISHER, {});
    expect(source.queries.map((query) => query.afterUserId)).toEqual([
      null,
      'p-0009',
      'p-0019',
    ]);
    expect(logger.warn).not.toHaveBeenCalled();

    source.queries.length = 0;
    await service({ pageSize: 10, maxRows: 15 }).estimate(PUBLISHER, {
      genders: ['FEMALE'],
    });
    expect(source.queries.map((query) => query.limit)).toEqual([10, 5]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('capped at 15'),
    );
  });

  it('caches counts per normalized targeting for the TTL', async () => {
    seed(source, 30, 'p');
    const estimates = service();
    await estimates.estimate(PUBLISHER, { locations: ['Hà Nội'] });
    await estimates.estimate(PUBLISHER, { locations: ['hà nội '] });
    expect(source.queries).toHaveLength(1);

    now = new Date(NOW.getTime() + AUDIENCE_CACHE_TTL_MS + 1);
    await estimates.estimate(PUBLISHER, { locations: ['Hà Nội'] });
    expect(source.queries).toHaveLength(2);
  });

  it('rate-limits each user to 30 estimates per hour', async () => {
    seed(source, 30, 'p');
    const estimates = service({
      counterStore: new InMemoryRateLimitCounterStore(),
    });
    for (let i = 0; i < 30; i += 1) {
      await estimates.estimate(PUBLISHER, {});
    }
    const error = await estimates
      .estimate(PUBLISHER, {})
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AudienceEstimateRateLimitedError);
    expect((error as AudienceEstimateRateLimitedError).retryAfterSeconds).toBe(
      3600,
    );
    // Another user has their own window.
    await expect(estimates.estimate('other-user', {})).resolves.toBeDefined();
  });

  it('logs each estimate without targeting values', async () => {
    seed(source, 30, 'p');
    await service().estimate(PUBLISHER, { locations: ['Hà Nội'] });
    const line = logger.log.mock.calls[0][0] as string;
    expect(line).toContain('AUDIENCE_ESTIMATE');
    expect(line).toContain('"criteria":["locations"]');
    expect(line).not.toMatch(/hà nội|Hà Nội/i);
  });
});
