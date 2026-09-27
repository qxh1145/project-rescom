import {
  isSurveyTargetingMatch,
  isProfileCompleted,
  SurveyTargetingCriteria,
  DemographicProfileDto,
} from '@rescom/schemas';

describe('Story 4.2: Automated Marketplace Matching Logic', () => {
  const baseProfile: DemographicProfileDto = {
    userId: '11111111-1111-4111-8111-111111111111',
    age: 22,
    gender: 'FEMALE',
    location: 'Hanoi',
    occupation: 'Student',
    fieldOfStudy: 'Computer Science',
    householdIncome: '10M-20M',
  };

  describe('isSurveyTargetingMatch - open to all', () => {
    it('should match when targeting is null', () => {
      expect(isSurveyTargetingMatch(null, baseProfile)).toBe(true);
    });

    it('should match when targeting is undefined', () => {
      expect(isSurveyTargetingMatch(undefined, baseProfile)).toBe(true);
    });

    it('should match when targeting is empty object', () => {
      expect(isSurveyTargetingMatch({}, baseProfile)).toBe(true);
    });

    it('should match open survey even if profile is null', () => {
      expect(isSurveyTargetingMatch(null, null)).toBe(true);
      expect(isSurveyTargetingMatch({}, null)).toBe(true);
    });
  });

  describe('isSurveyTargetingMatch - missing profile for targeted survey', () => {
    const targetedSurvey: SurveyTargetingCriteria = {
      ageRange: { min: 18, max: 25 },
    };

    it('should return false if profile is null or undefined for targeted survey', () => {
      expect(isSurveyTargetingMatch(targetedSurvey, null)).toBe(false);
      expect(isSurveyTargetingMatch(targetedSurvey, undefined)).toBe(false);
    });
  });

  describe('isSurveyTargetingMatch - ageRange', () => {
    const ageTargeting: SurveyTargetingCriteria = {
      ageRange: { min: 18, max: 25 },
    };

    it('should match when age is within range', () => {
      expect(
        isSurveyTargetingMatch(ageTargeting, { ...baseProfile, age: 20 }),
      ).toBe(true);
    });

    it('should match exact boundaries', () => {
      expect(
        isSurveyTargetingMatch(ageTargeting, { ...baseProfile, age: 18 }),
      ).toBe(true);
      expect(
        isSurveyTargetingMatch(ageTargeting, { ...baseProfile, age: 25 }),
      ).toBe(true);
    });

    it('should reject when age is below minimum', () => {
      expect(
        isSurveyTargetingMatch(ageTargeting, { ...baseProfile, age: 17 }),
      ).toBe(false);
    });

    it('should reject when age is above maximum', () => {
      expect(
        isSurveyTargetingMatch(ageTargeting, { ...baseProfile, age: 26 }),
      ).toBe(false);
    });

    it('should reject when age is missing on profile', () => {
      expect(
        isSurveyTargetingMatch(ageTargeting, { ...baseProfile, age: null }),
      ).toBe(false);
      expect(
        isSurveyTargetingMatch(ageTargeting, {
          ...baseProfile,
          age: undefined,
        }),
      ).toBe(false);
    });
  });

  describe('isSurveyTargetingMatch - locations', () => {
    const locationTargeting: SurveyTargetingCriteria = {
      locations: ['Hanoi', 'Ho Chi Minh City', 'Da Nang'],
    };

    it('should match when location is in allowlist', () => {
      expect(
        isSurveyTargetingMatch(locationTargeting, {
          ...baseProfile,
          location: 'Hanoi',
        }),
      ).toBe(true);
      expect(
        isSurveyTargetingMatch(locationTargeting, {
          ...baseProfile,
          location: 'Da Nang',
        }),
      ).toBe(true);
    });

    it('should match case-insensitively and trim whitespace', () => {
      expect(
        isSurveyTargetingMatch(locationTargeting, {
          ...baseProfile,
          location: '  hanoi  ',
        }),
      ).toBe(true);
      expect(
        isSurveyTargetingMatch(locationTargeting, {
          ...baseProfile,
          location: 'HO CHI MINH CITY',
        }),
      ).toBe(true);
    });

    it('should reject when location is not in allowlist', () => {
      expect(
        isSurveyTargetingMatch(locationTargeting, {
          ...baseProfile,
          location: 'Hai Phong',
        }),
      ).toBe(false);
    });

    it('should reject when location is missing or empty', () => {
      expect(
        isSurveyTargetingMatch(locationTargeting, {
          ...baseProfile,
          location: null,
        }),
      ).toBe(false);
      expect(
        isSurveyTargetingMatch(locationTargeting, {
          ...baseProfile,
          location: '   ',
        }),
      ).toBe(false);
    });
  });

  describe('isSurveyTargetingMatch - genders', () => {
    const genderTargeting: SurveyTargetingCriteria = {
      genders: ['FEMALE', 'OTHER'],
    };

    it('should match when gender is in allowlist', () => {
      expect(
        isSurveyTargetingMatch(genderTargeting, {
          ...baseProfile,
          gender: 'FEMALE',
        }),
      ).toBe(true);
      expect(
        isSurveyTargetingMatch(genderTargeting, {
          ...baseProfile,
          gender: 'OTHER',
        }),
      ).toBe(true);
    });

    it('should reject when gender is not in allowlist', () => {
      expect(
        isSurveyTargetingMatch(genderTargeting, {
          ...baseProfile,
          gender: 'MALE',
        }),
      ).toBe(false);
      expect(
        isSurveyTargetingMatch(genderTargeting, {
          ...baseProfile,
          gender: 'PREFER_NOT_TO_SAY',
        }),
      ).toBe(false);
    });

    it('should reject when gender is missing', () => {
      expect(
        isSurveyTargetingMatch(genderTargeting, {
          ...baseProfile,
          gender: null,
        }),
      ).toBe(false);
    });
  });

  describe('isSurveyTargetingMatch - occupations', () => {
    const occupationTargeting: SurveyTargetingCriteria = {
      occupations: ['Student', 'Software Engineer'],
    };

    it('should match when occupation is in allowlist', () => {
      expect(
        isSurveyTargetingMatch(occupationTargeting, {
          ...baseProfile,
          occupation: 'Student',
        }),
      ).toBe(true);
    });

    it('should match case-insensitively', () => {
      expect(
        isSurveyTargetingMatch(occupationTargeting, {
          ...baseProfile,
          occupation: 'software engineer',
        }),
      ).toBe(true);
    });

    it('should reject when occupation is not in allowlist', () => {
      expect(
        isSurveyTargetingMatch(occupationTargeting, {
          ...baseProfile,
          occupation: 'Teacher',
        }),
      ).toBe(false);
    });

    it('should reject when occupation is missing', () => {
      expect(
        isSurveyTargetingMatch(occupationTargeting, {
          ...baseProfile,
          occupation: null,
        }),
      ).toBe(false);
    });
  });

  describe('isSurveyTargetingMatch - fieldOfStudy', () => {
    const fieldTargeting: SurveyTargetingCriteria = {
      fieldOfStudy: ['Computer Science', 'Data Science'],
    };

    it('should match when fieldOfStudy is in allowlist', () => {
      expect(
        isSurveyTargetingMatch(fieldTargeting, {
          ...baseProfile,
          fieldOfStudy: 'Computer Science',
        }),
      ).toBe(true);
    });

    it('should match case-insensitively', () => {
      expect(
        isSurveyTargetingMatch(fieldTargeting, {
          ...baseProfile,
          fieldOfStudy: 'data science',
        }),
      ).toBe(true);
    });

    it('should reject when fieldOfStudy is not in allowlist', () => {
      expect(
        isSurveyTargetingMatch(fieldTargeting, {
          ...baseProfile,
          fieldOfStudy: 'Economics',
        }),
      ).toBe(false);
    });

    it('should reject when fieldOfStudy is missing', () => {
      expect(
        isSurveyTargetingMatch(fieldTargeting, {
          ...baseProfile,
          fieldOfStudy: null,
        }),
      ).toBe(false);
    });
  });

  describe('isSurveyTargetingMatch - multi-criteria (logical AND)', () => {
    const complexTargeting: SurveyTargetingCriteria = {
      ageRange: { min: 18, max: 25 },
      locations: ['Hanoi'],
      genders: ['FEMALE'],
      occupations: ['Student'],
    };

    it('should match when ALL criteria are met', () => {
      expect(isSurveyTargetingMatch(complexTargeting, baseProfile)).toBe(true);
    });

    it('should reject if any single criterion fails', () => {
      // Age fails
      expect(
        isSurveyTargetingMatch(complexTargeting, { ...baseProfile, age: 30 }),
      ).toBe(false);
      // Location fails
      expect(
        isSurveyTargetingMatch(complexTargeting, {
          ...baseProfile,
          location: 'HCMC',
        }),
      ).toBe(false);
      // Gender fails
      expect(
        isSurveyTargetingMatch(complexTargeting, {
          ...baseProfile,
          gender: 'MALE',
        }),
      ).toBe(false);
      // Occupation fails
      expect(
        isSurveyTargetingMatch(complexTargeting, {
          ...baseProfile,
          occupation: 'Doctor',
        }),
      ).toBe(false);
    });
  });

  describe('isSurveyTargetingMatch - Unicode and whitespace normalization', () => {
    // "Hà Nội" composed (NFC, Windows/Android keyboards) vs decomposed (NFD,
    // macOS input): canonically equivalent, different code points.
    const hanoiNfc = 'Hà Nội'.normalize('NFC');
    const hanoiNfd = 'Hà Nội'.normalize('NFD');

    it('uses distinct code points for the NFC and NFD fixtures', () => {
      expect(hanoiNfc).not.toBe(hanoiNfd);
    });

    it('matches canonically equivalent locations (NFC target, NFD profile)', () => {
      expect(
        isSurveyTargetingMatch(
          { locations: [hanoiNfc] },
          { ...baseProfile, location: hanoiNfd },
        ),
      ).toBe(true);
    });

    it('matches canonically equivalent occupations and fields of study (NFD target, NFC profile)', () => {
      const occupationNfc = 'Sinh viên đại học'.normalize('NFC');
      const fieldNfc = 'Công nghệ thông tin'.normalize('NFC');
      expect(
        isSurveyTargetingMatch(
          {
            occupations: [occupationNfc.normalize('NFD')],
            fieldOfStudy: [fieldNfc.normalize('NFD')],
          },
          { ...baseProfile, occupation: occupationNfc, fieldOfStudy: fieldNfc },
        ),
      ).toBe(true);
    });

    it('collapses repeated internal whitespace on both sides', () => {
      expect(
        isSurveyTargetingMatch(
          { locations: ['Ho  Chi\tMinh City'] },
          { ...baseProfile, location: '  ho chi   minh city ' },
        ),
      ).toBe(true);
      expect(
        isSurveyTargetingMatch(
          { occupations: ['Software   Engineer'] },
          { ...baseProfile, occupation: 'software engineer' },
        ),
      ).toBe(true);
    });

    it('lower-cases Vietnamese capitals with diacritics', () => {
      expect(
        isSurveyTargetingMatch(
          { locations: ['ĐÀ NẴNG'] },
          { ...baseProfile, location: 'đà nẵng' },
        ),
      ).toBe(true);
    });

    it('still rejects different places (no diacritic folding)', () => {
      expect(
        isSurveyTargetingMatch(
          { locations: [hanoiNfc] },
          { ...baseProfile, location: 'Ha Noi' },
        ),
      ).toBe(false);
    });

    it('treats empty criterion arrays as no criterion (open to all)', () => {
      const emptyCriteria: SurveyTargetingCriteria = {
        locations: [],
        genders: [],
        occupations: [],
        fieldOfStudy: [],
      };
      expect(isSurveyTargetingMatch(emptyCriteria, baseProfile)).toBe(true);
      expect(isSurveyTargetingMatch(emptyCriteria, null)).toBe(true);
      expect(
        isSurveyTargetingMatch(
          { locations: [], ageRange: { min: 30, max: 40 } },
          baseProfile,
        ),
      ).toBe(false);
    });
  });

  describe('isProfileCompleted', () => {
    it('should return true only when every FR-6 field is present (Story 7.1)', () => {
      expect(isProfileCompleted(baseProfile)).toBe(false);
      expect(
        isProfileCompleted({ ...baseProfile, specificInterests: ['AI'] }),
      ).toBe(true);
    });

    it('should return false when profile is null or empty', () => {
      expect(isProfileCompleted(null)).toBe(false);
      expect(isProfileCompleted(undefined)).toBe(false);
      expect(isProfileCompleted({})).toBe(false);
    });

    it('should return false when any core field is missing', () => {
      expect(isProfileCompleted({ ...baseProfile, age: null })).toBe(false);
      expect(isProfileCompleted({ ...baseProfile, gender: null })).toBe(false);
      expect(isProfileCompleted({ ...baseProfile, location: '' })).toBe(false);
      expect(
        isProfileCompleted({
          ...baseProfile,
          specificInterests: ['AI'],
          householdIncome: null,
        }),
      ).toBe(false);
    });
  });
});
