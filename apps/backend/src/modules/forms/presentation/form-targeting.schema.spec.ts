/**
 * Story 4.1: Survey Targeting Criteria Schema — Specification Tests
 * Tests surveyTargetingSchema Zod validation rules imported from @rescom/schemas.
 */
import {
  surveyTargetingSchema,
  SurveyTargetingCriteria,
  genderEnum,
  GENDER_OPTIONS,
} from '@rescom/schemas';

describe('Story 4.1: surveyTargetingSchema Specification', () => {
  // ── Empty / open-to-all ──────────────────────────────────────────────────

  it('should accept an empty object (open-to-all, no targeting)', () => {
    const result = surveyTargetingSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });

  it('should reject undefined (strict schema requires object, not undefined)', () => {
    const result = surveyTargetingSchema.safeParse(undefined);
    expect(result.success).toBe(false);
  });

  // ── ageRange ─────────────────────────────────────────────────────────────

  describe('ageRange', () => {
    it('should accept a valid age range', () => {
      const result = surveyTargetingSchema.safeParse({
        ageRange: { min: 18, max: 25 },
      });
      expect(result.success).toBe(true);
    });

    it('should accept min === max (single age)', () => {
      const result = surveyTargetingSchema.safeParse({
        ageRange: { min: 21, max: 21 },
      });
      expect(result.success).toBe(true);
    });

    it('should reject when min > max (cross-field validation)', () => {
      const result = surveyTargetingSchema.safeParse({
        ageRange: { min: 30, max: 20 },
      });
      expect(result.success).toBe(false);
      const issues = result.success ? [] : result.error.issues;
      expect(issues[0].message).toMatch(/min must be less than or equal to/i);
    });

    it('should reject min below 13', () => {
      const result = surveyTargetingSchema.safeParse({
        ageRange: { min: 12, max: 25 },
      });
      expect(result.success).toBe(false);
    });

    it('should reject max above 100', () => {
      const result = surveyTargetingSchema.safeParse({
        ageRange: { min: 18, max: 101 },
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer age values', () => {
      const result = surveyTargetingSchema.safeParse({
        ageRange: { min: 18.5, max: 25 },
      });
      expect(result.success).toBe(false);
    });

    it('should accept omitting ageRange (no age restriction)', () => {
      const result = surveyTargetingSchema.safeParse({ locations: ['Hanoi'] });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ageRange).toBeUndefined();
      }
    });
  });

  // ── locations ─────────────────────────────────────────────────────────────

  describe('locations', () => {
    it('should accept a valid locations array', () => {
      const result = surveyTargetingSchema.safeParse({
        locations: ['Hanoi', 'Ho Chi Minh City', 'Da Nang'],
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty string entries in locations', () => {
      const result = surveyTargetingSchema.safeParse({
        locations: ['Hanoi', ''],
      });
      expect(result.success).toBe(false);
    });

    it('should reject entries exceeding 100 chars', () => {
      const result = surveyTargetingSchema.safeParse({
        locations: ['A'.repeat(101)],
      });
      expect(result.success).toBe(false);
    });

    it('should reject arrays with more than 50 entries', () => {
      const result = surveyTargetingSchema.safeParse({
        locations: Array.from({ length: 51 }, (_, i) => `City ${i}`),
      });
      expect(result.success).toBe(false);
    });

    it('should accept exactly 50 entries', () => {
      const result = surveyTargetingSchema.safeParse({
        locations: Array.from({ length: 50 }, (_, i) => `City ${i}`),
      });
      expect(result.success).toBe(true);
    });
  });

  // ── genders ───────────────────────────────────────────────────────────────

  describe('genders', () => {
    it('should accept valid gender values', () => {
      const result = surveyTargetingSchema.safeParse({
        genders: ['MALE', 'FEMALE'],
      });
      expect(result.success).toBe(true);
    });

    it('should accept all four gender values', () => {
      const result = surveyTargetingSchema.safeParse({
        genders: ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'],
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid gender string', () => {
      const result = surveyTargetingSchema.safeParse({
        genders: ['MALE', 'UNKNOWN'],
      });
      expect(result.success).toBe(false);
    });

    it('should reject lowercase gender values', () => {
      const result = surveyTargetingSchema.safeParse({
        genders: ['male'],
      });
      expect(result.success).toBe(false);
    });
  });

  // ── occupations ───────────────────────────────────────────────────────────

  describe('occupations', () => {
    it('should accept valid occupations array', () => {
      const result = surveyTargetingSchema.safeParse({
        occupations: ['Student', 'Software Engineer', 'Healthcare Worker'],
      });
      expect(result.success).toBe(true);
    });

    it('should reject more than 50 occupations', () => {
      const result = surveyTargetingSchema.safeParse({
        occupations: Array.from({ length: 51 }, (_, i) => `Job ${i}`),
      });
      expect(result.success).toBe(false);
    });
  });

  // ── fieldOfStudy ──────────────────────────────────────────────────────────

  describe('fieldOfStudy', () => {
    it('should accept valid fieldOfStudy array', () => {
      const result = surveyTargetingSchema.safeParse({
        fieldOfStudy: [
          'Computer Science',
          'Medicine',
          'Business Administration',
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should reject more than 50 fieldOfStudy entries', () => {
      const result = surveyTargetingSchema.safeParse({
        fieldOfStudy: Array.from({ length: 51 }, (_, i) => `Field ${i}`),
      });
      expect(result.success).toBe(false);
    });
  });

  // ── Full targeting object ─────────────────────────────────────────────────

  it('should accept a complete valid targeting object with all fields', () => {
    const fullTargeting: SurveyTargetingCriteria = {
      ageRange: { min: 18, max: 25 },
      locations: ['Hanoi', 'Ho Chi Minh City'],
      genders: ['MALE', 'FEMALE'],
      occupations: ['Student'],
      fieldOfStudy: ['Computer Science', 'Information Technology'],
    };

    const result = surveyTargetingSchema.safeParse(fullTargeting);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ageRange).toEqual({ min: 18, max: 25 });
      expect(result.data.locations).toEqual(['Hanoi', 'Ho Chi Minh City']);
      expect(result.data.genders).toEqual(['MALE', 'FEMALE']);
      expect(result.data.occupations).toEqual(['Student']);
      expect(result.data.fieldOfStudy).toEqual([
        'Computer Science',
        'Information Technology',
      ]);
    }
  });

  // ── Strict mode (no extra fields) ─────────────────────────────────────────

  it('should reject unknown extra fields (strict mode)', () => {
    const result = surveyTargetingSchema.safeParse({
      locations: ['Hanoi'],
      unknownField: 'should fail',
    });
    expect(result.success).toBe(false);
  });

  // ── genderEnum standalone & GENDER_OPTIONS ─────────────────────────────────

  describe('genderEnum and GENDER_OPTIONS', () => {
    it('should export genderEnum with all four values', () => {
      expect(genderEnum.options).toEqual([
        'MALE',
        'FEMALE',
        'OTHER',
        'PREFER_NOT_TO_SAY',
      ]);
    });

    it('should export GENDER_OPTIONS with matching entries', () => {
      expect(GENDER_OPTIONS).toHaveLength(4);
      expect(GENDER_OPTIONS.map((g) => g.value)).toEqual([
        'MALE',
        'FEMALE',
        'OTHER',
        'PREFER_NOT_TO_SAY',
      ]);
    });
  });
});
