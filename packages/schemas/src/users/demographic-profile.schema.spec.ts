import {
  DEMOGRAPHIC_ONBOARDING_NEXT_STEPS,
  DEMOGRAPHIC_PROFILE_REQUIRED_CODE,
  REQUIRED_DEMOGRAPHIC_FIELDS,
  demographicProfileStatusSchema,
  demographicSurveySubmissionResultSchema,
  getMissingDemographicFields,
  isProfileCompleted,
  submitDemographicSurveySchema,
  updateDemographicProfileSchema,
} from './demographic-profile.schema';

describe('Demographic profile completeness (Story 7.1, FR-6)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const complete = {
    userId,
    age: 21,
    gender: 'FEMALE' as const,
    location: 'Đà Nẵng',
    occupation: 'Sinh viên đại học',
    fieldOfStudy: 'Công nghệ thông tin',
    householdIncome: 'Dưới 5 triệu VNĐ/tháng',
    specificInterests: ['Trí tuệ nhân tạo (AI)'],
  };

  it('lists every FR-6 field as required', () => {
    expect([...REQUIRED_DEMOGRAPHIC_FIELDS]).toEqual([
      'age',
      'gender',
      'location',
      'occupation',
      'fieldOfStudy',
      'householdIncome',
      'specificInterests',
    ]);
    expect(DEMOGRAPHIC_PROFILE_REQUIRED_CODE).toBe(
      'DEMOGRAPHIC_PROFILE_REQUIRED',
    );
  });

  it('treats a fully populated profile as complete', () => {
    expect(getMissingDemographicFields(complete)).toEqual([]);
    expect(isProfileCompleted(complete)).toBe(true);
  });

  it('reports every field as missing for an absent profile', () => {
    expect(getMissingDemographicFields(null)).toEqual([
      ...REQUIRED_DEMOGRAPHIC_FIELDS,
    ]);
    expect(getMissingDemographicFields(undefined)).toHaveLength(7);
    expect(isProfileCompleted(null)).toBe(false);
    expect(isProfileCompleted({})).toBe(false);
  });

  it('no longer treats the old age/gender/location subset as complete', () => {
    const legacy = {
      userId,
      age: 22,
      gender: 'MALE' as const,
      location: 'Hanoi',
    };
    expect(isProfileCompleted(legacy)).toBe(false);
    expect(getMissingDemographicFields(legacy)).toEqual([
      'occupation',
      'fieldOfStudy',
      'householdIncome',
      'specificInterests',
    ]);
  });

  it.each([
    ['age', { age: null }],
    ['age', { age: 12 }],
    ['age', { age: 101 }],
    ['age', { age: 20.5 }],
    ['gender', { gender: null }],
    ['location', { location: '   ' }],
    ['occupation', { occupation: '' }],
    ['fieldOfStudy', { fieldOfStudy: null }],
    ['householdIncome', { householdIncome: ' ' }],
    ['specificInterests', { specificInterests: [] }],
    ['specificInterests', { specificInterests: ['  '] }],
    ['specificInterests', { specificInterests: null }],
    ['specificInterests', { specificInterests: { gender: 'MALE' } }],
  ])('flags %s as missing for %j', (field, override) => {
    const profile = { ...complete, ...override };
    expect(getMissingDemographicFields(profile)).toEqual([field]);
    expect(isProfileCompleted(profile)).toBe(false);
  });

  describe('submitDemographicSurveySchema (strict mandatory survey)', () => {
    const input = {
      age: 21,
      gender: 'FEMALE',
      location: '  Đà Nẵng ',
      occupation: 'Sinh viên đại học',
      fieldOfStudy: 'Công nghệ thông tin',
      householdIncome: 'Dưới 5 triệu VNĐ/tháng',
      specificInterests: [' Trí tuệ nhân tạo (AI) ', 'Du lịch & Ẩm thực'],
    };

    it('accepts a complete submission and trims values', () => {
      const parsed = submitDemographicSurveySchema.parse(input);
      expect(parsed.location).toBe('Đà Nẵng');
      expect(parsed.specificInterests).toEqual([
        'Trí tuệ nhân tạo (AI)',
        'Du lịch & Ẩm thực',
      ]);
      expect(isProfileCompleted({ userId, ...parsed })).toBe(true);
    });

    it.each(REQUIRED_DEMOGRAPHIC_FIELDS.map((field) => [field]))(
      'rejects a submission without %s',
      (field) => {
        const partial: Record<string, unknown> = { ...input };
        delete partial[field];
        expect(submitDemographicSurveySchema.safeParse(partial).success).toBe(
          false,
        );
      },
    );

    it('rejects null, blank and out-of-range values', () => {
      expect(
        submitDemographicSurveySchema.safeParse({ ...input, gender: null })
          .success,
      ).toBe(false);
      expect(
        submitDemographicSurveySchema.safeParse({ ...input, occupation: '  ' })
          .success,
      ).toBe(false);
      expect(
        submitDemographicSurveySchema.safeParse({ ...input, age: 12 }).success,
      ).toBe(false);
      expect(
        submitDemographicSurveySchema.safeParse({
          ...input,
          specificInterests: [],
        }).success,
      ).toBe(false);
      expect(
        submitDemographicSurveySchema.safeParse({
          ...input,
          specificInterests: ['   '],
        }).success,
      ).toBe(false);
      expect(
        submitDemographicSurveySchema.safeParse({
          ...input,
          specificInterests: Array.from({ length: 31 }, (_, i) => `i${i}`),
        }).success,
      ).toBe(false);
    });

    it('rejects unknown keys', () => {
      expect(
        submitDemographicSurveySchema.safeParse({ ...input, role: 'ADMIN' })
          .success,
      ).toBe(false);
    });

    it('keeps the partial update schema permissive (FR-9 edits)', () => {
      expect(updateDemographicProfileSchema.safeParse({ age: 30 }).success).toBe(
        true,
      );
    });
  });

  describe('updateDemographicProfileSchema (partial FR-9 edits)', () => {
    it('accepts partial updates and explicit null clears', () => {
      expect(
        updateDemographicProfileSchema.safeParse({ location: 'Hà Nội' })
          .success,
      ).toBe(true);
      expect(
        updateDemographicProfileSchema.safeParse({
          occupation: null,
          specificInterests: null,
        }).success,
      ).toBe(true);
      expect(updateDemographicProfileSchema.safeParse({}).success).toBe(true);
    });

    it('rejects unknown or misspelled keys instead of silently stripping them', () => {
      expect(
        updateDemographicProfileSchema.safeParse({ occuption: 'Student' })
          .success,
      ).toBe(false);
      expect(
        updateDemographicProfileSchema.safeParse({ age: 30, role: 'ADMIN' })
          .success,
      ).toBe(false);
    });

    it('bounds the interest list to 30 items of at most 100 characters', () => {
      expect(
        updateDemographicProfileSchema.safeParse({
          specificInterests: Array.from({ length: 30 }, (_, i) => `i${i}`),
        }).success,
      ).toBe(true);
      expect(
        updateDemographicProfileSchema.safeParse({
          specificInterests: Array.from({ length: 31 }, (_, i) => `i${i}`),
        }).success,
      ).toBe(false);
      expect(
        updateDemographicProfileSchema.safeParse({
          specificInterests: ['x'.repeat(101)],
        }).success,
      ).toBe(false);
      expect(
        updateDemographicProfileSchema.safeParse({ specificInterests: ['  '] })
          .success,
      ).toBe(false);
    });

    it('trims interest items and keeps the legacy record variant', () => {
      const parsed = updateDemographicProfileSchema.parse({
        specificInterests: ['  AI  '],
      });
      expect(parsed.specificInterests).toEqual(['AI']);
      expect(
        updateDemographicProfileSchema.safeParse({
          specificInterests: { travel: true },
        }).success,
      ).toBe(true);
    });
  });

  describe('response contracts', () => {
    const profile = {
      id: '22222222-2222-4222-8222-222222222222',
      ...complete,
      createdAt: '2026-09-26T10:00:00.000Z',
      updatedAt: '2026-09-26T10:00:00.000Z',
    };

    it('parses the profile status payload', () => {
      const parsed = demographicProfileStatusSchema.parse({
        profile,
        isComplete: true,
        missingFields: [],
      });
      expect(parsed.isComplete).toBe(true);
    });

    it('rejects unknown missing field names', () => {
      expect(
        demographicProfileStatusSchema.safeParse({
          profile,
          isComplete: false,
          missingFields: ['academicYear'],
        }).success,
      ).toBe(false);
    });

    it('parses the submission result with a next step', () => {
      expect([...DEMOGRAPHIC_ONBOARDING_NEXT_STEPS]).toEqual([
        'MARKETPLACE_ACTIVATION',
        'COMPLETED',
      ]);
      const parsed = demographicSurveySubmissionResultSchema.parse({
        profile,
        isComplete: true,
        missingFields: [],
        nextStep: 'MARKETPLACE_ACTIVATION',
      });
      expect(parsed.nextStep).toBe('MARKETPLACE_ACTIVATION');
      expect(
        demographicSurveySubmissionResultSchema.safeParse({
          profile,
          isComplete: true,
          missingFields: [],
          nextStep: 'DASHBOARD',
        }).success,
      ).toBe(false);
    });
  });
});
