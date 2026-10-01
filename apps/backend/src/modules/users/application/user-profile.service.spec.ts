import { userProfileSchema } from '@rescom/schemas';
import { UserProfileService } from './user-profile.service';
import { UserProfileValidationException } from './exceptions/user-profile.exceptions';
import { InMemoryUserProfileRepository } from '../infrastructure/in-memory-user-profile.repository';
import { InMemoryUserRepository } from '../infrastructure/in-memory-user.repository';
import { InMemoryDemographicProfileRepository } from '../infrastructure/in-memory-demographic-profile.repository';

describe('UserProfileService (Story IR.4b part A, FR-9)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const empty = {
    displayName: null,
    birthYear: null,
    school: null,
    schoolYear: null,
    goal: null,
  };
  let now: Date;
  let repository: InMemoryUserProfileRepository;
  let service: UserProfileService;

  beforeEach(() => {
    now = new Date('2026-06-15T03:00:00.000Z');
    repository = new InMemoryUserProfileRepository(() => now);
    service = new UserProfileService(repository, () => now);
  });

  async function expectValidationError(
    promise: Promise<unknown>,
    field: string,
  ) {
    const error = await promise.then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(UserProfileValidationException);
    const exception = error as UserProfileValidationException;
    expect(exception.code).toBe('VALIDATION_ERROR');
    expect(
      (exception.details as Record<string, { _errors: string[] }>)[field]
        ._errors.length,
    ).toBeGreaterThan(0);
  }

  it('returns every field null for a user without a stored profile', async () => {
    await expect(service.getOwnProfile(userId)).resolves.toEqual(empty);
  });

  it('saves the onboarding extras and returns the shared response shape', async () => {
    const saved = await service.updateOwnProfile(userId, {
      displayName: '  Linh Nguyễn ',
      birthYear: 2005,
      school: 'Trường Đại học FPT – Đà Nẵng',
      schoolYear: 'Năm 3',
      goal: 'BOTH',
    });

    expect(saved).toEqual({
      displayName: 'Linh Nguyễn',
      birthYear: 2005,
      school: 'Trường Đại học FPT – Đà Nẵng',
      schoolYear: 'Năm 3',
      goal: 'BOTH',
    });
    expect(userProfileSchema.parse(saved)).toEqual(saved);
    await expect(service.getOwnProfile(userId)).resolves.toEqual(saved);
  });

  it('keeps absent keys, clears null keys and stores blank text as null', async () => {
    await service.updateOwnProfile(userId, {
      displayName: 'Linh',
      birthYear: 2005,
      school: 'ĐH FPT',
      schoolYear: 'Năm 3',
      goal: 'EARN',
    });

    const updated = await service.updateOwnProfile(userId, {
      goal: 'COLLECT',
      school: null,
      displayName: '   ',
    });

    expect(updated).toEqual({
      displayName: null,
      birthYear: 2005,
      school: null,
      schoolYear: 'Năm 3',
      goal: 'COLLECT',
    });
  });

  it('treats an empty patch as a no-op: no row is created and nothing moves', async () => {
    await expect(service.updateOwnProfile(userId, {})).resolves.toEqual(empty);
    await expect(repository.findByUserId(userId)).resolves.toBeNull();

    await service.updateOwnProfile(userId, { displayName: 'Linh' });
    const before = await repository.findByUserId(userId);
    now = new Date('2026-06-16T03:00:00.000Z');

    await expect(service.updateOwnProfile(userId, {})).resolves.toMatchObject({
      displayName: 'Linh',
    });
    expect((await repository.findByUserId(userId))?.updatedAt).toEqual(
      before?.updatedAt,
    );
  });

  it('accepts birth years that give an age of 13 to 100 in the clock year', async () => {
    await expect(
      service.updateOwnProfile(userId, { birthYear: 2013 }),
    ).resolves.toMatchObject({ birthYear: 2013 });
    await expect(
      service.updateOwnProfile(userId, { birthYear: 1926 }),
    ).resolves.toMatchObject({ birthYear: 1926 });
    await expect(
      service.updateOwnProfile(userId, { birthYear: null }),
    ).resolves.toMatchObject({ birthYear: null });
  });

  it.each([2014, 1925, 2030])(
    'rejects birth year %i with 400 VALIDATION_ERROR and saves nothing',
    async (birthYear) => {
      await expectValidationError(
        service.updateOwnProfile(userId, { birthYear, goal: 'EARN' }),
        'birthYear',
      );
      await expect(repository.findByUserId(userId)).resolves.toBeNull();
    },
  );

  it('derives the year from the injected clock in Vietnam time (UTC+7)', async () => {
    // 2026-12-31 16:59:59 UTC is still 2026 in Vietnam: born 2014 is 12.
    now = new Date('2026-12-31T16:59:59.000Z');
    await expectValidationError(
      service.updateOwnProfile(userId, { birthYear: 2014 }),
      'birthYear',
    );

    // One second later it is 2027-01-01 in Vietnam: born 2014 is 13.
    now = new Date('2026-12-31T17:00:00.000Z');
    await expect(
      service.updateOwnProfile(userId, { birthYear: 2014 }),
    ).resolves.toMatchObject({ birthYear: 2014 });
  });

  it('validates input from callers that skip the HTTP pipe', async () => {
    await expectValidationError(
      service.updateOwnProfile(userId, {
        displayName: 'x'.repeat(51),
      }),
      'displayName',
    );
    await expectValidationError(
      service.updateOwnProfile(userId, {
        schoolYear: 'Năm 9' as never,
      }),
      'schoolYear',
    );
    const unknownKey = await service
      .updateOwnProfile(userId, { role: 'ADMIN' } as never)
      .then(
        () => null,
        (cause: unknown) => cause,
      );
    expect(unknownKey).toBeInstanceOf(UserProfileValidationException);
    await expect(repository.findByUserId(userId)).resolves.toBeNull();
  });

  it('never changes the role, the status or the demographic profile (AC A5/A6)', async () => {
    const users = new InMemoryUserRepository();
    const demographics = new InMemoryDemographicProfileRepository();
    const respondent = await users.create({
      email: 'respondent@example.com',
      passwordHash: 'hash',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    const publisher = await users.create({
      email: 'publisher@example.com',
      passwordHash: 'hash',
      role: 'PUBLISHER',
      status: 'ACTIVE',
    });
    await demographics.upsert(respondent.id, { age: 21, location: 'Hà Nội' });

    await service.updateOwnProfile(respondent.id, {
      goal: 'COLLECT',
      birthYear: 1990,
    });
    await service.updateOwnProfile(publisher.id, { goal: 'EARN' });

    await expect(users.findById(respondent.id)).resolves.toMatchObject({
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    await expect(users.findById(publisher.id)).resolves.toMatchObject({
      role: 'PUBLISHER',
      status: 'ACTIVE',
    });
    // `birthYear` never rewrites the matching `age`.
    await expect(
      demographics.findByUserId(respondent.id),
    ).resolves.toMatchObject({ age: 21, location: 'Hà Nội' });
  });
});
