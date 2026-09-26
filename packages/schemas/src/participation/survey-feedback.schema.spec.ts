import {
  SURVEY_FEEDBACK_ALREADY_SUBMITTED_CODE,
  SURVEY_FEEDBACK_ATTEMPT_NOT_FOUND_CODE,
  SURVEY_FEEDBACK_COMMENT_MAX_LENGTH,
  SURVEY_FEEDBACK_ISSUE_TAGS,
  SURVEY_FEEDBACK_NOT_ALLOWED_CODE,
  SURVEY_FEEDBACK_RATING_MAX,
  SURVEY_FEEDBACK_RATING_MIN,
  SURVEY_FEEDBACK_SUBMITTED_EVENT_TYPE,
  SURVEY_FEEDBACK_VALIDATION_STATUSES,
  isSameSurveyFeedbackContent,
  normalizeSurveyFeedbackComment,
  submitSurveyFeedbackInputSchema,
  submitSurveyFeedbackResultSchema,
  surveyFeedbackSchema,
  surveyFeedbackStatusSchema,
  surveyFeedbackSubmittedEventPayloadSchema,
} from './survey-feedback.schema';
import * as rootExports from '../index';

describe('Story 9.2: survey feedback contracts (FR-43)', () => {
  const feedback = {
    id: '11111111-1111-4111-8111-111111111111',
    attemptId: '22222222-2222-4222-8222-222222222222',
    formId: '33333333-3333-4333-8333-333333333333',
    formVersionId: '44444444-4444-4444-8444-444444444444',
    formType: 'INTERNAL' as const,
    rating: 4,
    comment: 'Câu hỏi rõ ràng.',
    issueTags: ['LONGER_THAN_ESTIMATED' as const],
    validationStatus: 'PENDING' as const,
    submittedAt: '2026-09-26T10:00:00.000Z',
  };

  it('exposes stable constants, codes and enum parity lists', () => {
    expect(SURVEY_FEEDBACK_RATING_MIN).toBe(1);
    expect(SURVEY_FEEDBACK_RATING_MAX).toBe(5);
    expect(SURVEY_FEEDBACK_COMMENT_MAX_LENGTH).toBe(500);
    expect(SURVEY_FEEDBACK_SUBMITTED_EVENT_TYPE).toBe('SurveyFeedbackSubmitted');
    expect(SURVEY_FEEDBACK_ATTEMPT_NOT_FOUND_CODE).toBe(
      'FEEDBACK_ATTEMPT_NOT_FOUND',
    );
    expect(SURVEY_FEEDBACK_NOT_ALLOWED_CODE).toBe('FEEDBACK_NOT_ALLOWED');
    expect(SURVEY_FEEDBACK_ALREADY_SUBMITTED_CODE).toBe(
      'FEEDBACK_ALREADY_SUBMITTED',
    );
    // Must equal the Prisma enums SurveyFeedbackIssueTag / SurveyFeedbackValidationStatus.
    expect([...SURVEY_FEEDBACK_ISSUE_TAGS]).toEqual([
      'UNCLEAR_QUESTIONS',
      'LONGER_THAN_ESTIMATED',
      'MISLEADING_DESCRIPTION',
      'TECHNICAL_ISSUE',
    ]);
    expect([...SURVEY_FEEDBACK_VALIDATION_STATUSES]).toEqual([
      'PENDING',
      'ACCEPTED',
      'EXCLUDED',
    ]);
  });

  it('is exported from the package root', () => {
    expect(rootExports.submitSurveyFeedbackInputSchema).toBe(
      submitSurveyFeedbackInputSchema,
    );
    expect(rootExports.surveyFeedbackStatusSchema).toBe(
      surveyFeedbackStatusSchema,
    );
  });

  describe('normalizeSurveyFeedbackComment', () => {
    it('trims and turns blank comments into null', () => {
      expect(normalizeSurveyFeedbackComment('  hay  ')).toBe('hay');
      expect(normalizeSurveyFeedbackComment('   \n\t ')).toBeNull();
      expect(normalizeSurveyFeedbackComment('')).toBeNull();
    });

    it('normalizes line endings and strips control characters but keeps text as-is', () => {
      expect(normalizeSurveyFeedbackComment('a\r\nb\rc')).toBe('a\nb\nc');
      expect(normalizeSurveyFeedbackComment('x\u0000y\u0007z\u007f')).toBe('xyz');
      expect(normalizeSurveyFeedbackComment('tab\there')).toBe('tab\there');
      // Invisible / direction-changing spoofing characters and C1 controls.
      expect(
        normalizeSurveyFeedbackComment(
          'a\u202Eb\u2066c\u2069d\u200Be\uFEFFf\u0085g\u200Fh',
        ),
      ).toBe('abcdefgh');
      expect(normalizeSurveyFeedbackComment('\u200B \u202E')).toBeNull();
      // Emoji joiners stay intact.
      expect(normalizeSurveyFeedbackComment('👩\u200D💻')).toBe('👩\u200D💻');
      // Plain text: markup is neither stripped nor interpreted.
      expect(normalizeSurveyFeedbackComment('<b>đậm</b>')).toBe('<b>đậm</b>');
    });

    it('removes lone surrogates but keeps valid emoji pairs (review P8)', () => {
      expect(normalizeSurveyFeedbackComment('\uD83D')).toBeNull();
      expect(normalizeSurveyFeedbackComment('ok\uDE00')).toBe('ok');
      expect(normalizeSurveyFeedbackComment('vui 😀\uD83D')).toBe('vui 😀');
    });

    it('normalizes to NFC so decomposed Vietnamese is not longer (review P8)', () => {
      const decomposed = 'Tiếng Việt'.normalize('NFD');
      expect(decomposed.length).toBeGreaterThan('Tiếng Việt'.length);
      const normalized = normalizeSurveyFeedbackComment(decomposed);
      expect(normalized).toBe('Tiếng Việt'.normalize('NFC'));
      expect(normalized).toHaveLength('Tiếng Việt'.normalize('NFC').length);
    });

    it('turns comments with no visible character into null (review P8)', () => {
      expect(normalizeSurveyFeedbackComment('\u200D\u200C\u200D')).toBeNull();
      expect(normalizeSurveyFeedbackComment('\u3164')).toBeNull();
      expect(normalizeSurveyFeedbackComment(' \u115F\u1160\uFFA0\u2800 ')).toBeNull();
      expect(normalizeSurveyFeedbackComment('\uFE0F\u034F\uFE0F')).toBeNull();
      // Visible text keeps its joiners and variation selectors.
      expect(normalizeSurveyFeedbackComment('a\u200Db')).toBe('a\u200Db');
      expect(normalizeSurveyFeedbackComment('❤\uFE0F')).toBe('❤\uFE0F');
    });

    it('strips further invisible characters and tag characters (review P8)', () => {
      expect(
        normalizeSurveyFeedbackComment(
          'a\u061Cb\u180Ec\u2061d\u2064e\uFFF9f\uFFFBg\u00ADh',
        ),
      ).toBe('abcdefgh');
      expect(
        normalizeSurveyFeedbackComment('ok\u{E0041}\u{E0042}\u{E007F}!'),
      ).toBe('ok!');
    });

    it('re-normalizes to NFC after stripping (review P8)', () => {
      // A soft hyphen between "e" and a combining acute accent.
      expect(normalizeSurveyFeedbackComment('e\u00AD\u0301')).toBe('\u00E9');
    });

    it('stores line and paragraph separators as LF (review P8)', () => {
      expect(normalizeSurveyFeedbackComment('a\u2028b\u2029c')).toBe('a\nb\nc');
    });
  });

  describe('submitSurveyFeedbackInputSchema', () => {
    it('accepts a rating-only submission with defaults', () => {
      expect(submitSurveyFeedbackInputSchema.parse({ rating: 5 })).toEqual({
        rating: 5,
        comment: null,
        issueTags: [],
      });
    });

    it('accepts every integer rating from 1 to 5', () => {
      for (let rating = 1; rating <= 5; rating += 1) {
        expect(
          submitSurveyFeedbackInputSchema.safeParse({ rating }).success,
        ).toBe(true);
      }
    });

    it.each([0, 6, 3.5, -1, '4', null, undefined])(
      'rejects rating %p',
      (rating) => {
        expect(
          submitSurveyFeedbackInputSchema.safeParse({ rating }).success,
        ).toBe(false);
      },
    );

    it('normalizes the comment and maps blank to null', () => {
      expect(
        submitSurveyFeedbackInputSchema.parse({
          rating: 3,
          comment: '  Hơi dài so với ước tính.  ',
        }).comment,
      ).toBe('Hơi dài so với ước tính.');
      expect(
        submitSurveyFeedbackInputSchema.parse({ rating: 3, comment: '   ' })
          .comment,
      ).toBeNull();
      expect(
        submitSurveyFeedbackInputSchema.parse({ rating: 3, comment: null })
          .comment,
      ).toBeNull();
    });

    it('enforces the comment length after normalization', () => {
      const max = 'a'.repeat(SURVEY_FEEDBACK_COMMENT_MAX_LENGTH);
      expect(
        submitSurveyFeedbackInputSchema.safeParse({
          rating: 2,
          comment: `   ${max}   `,
        }).success,
      ).toBe(true);
      expect(
        submitSurveyFeedbackInputSchema.safeParse({
          rating: 2,
          comment: `${max}b`,
        }).success,
      ).toBe(false);
      expect(
        submitSurveyFeedbackInputSchema.safeParse({
          rating: 2,
          comment: 'x'.repeat(5000),
        }).success,
      ).toBe(false);
    });

    it('de-duplicates issue tags into canonical order', () => {
      expect(
        submitSurveyFeedbackInputSchema.parse({
          rating: 1,
          issueTags: ['TECHNICAL_ISSUE', 'UNCLEAR_QUESTIONS', 'TECHNICAL_ISSUE'],
        }).issueTags,
      ).toEqual(['UNCLEAR_QUESTIONS', 'TECHNICAL_ISSUE']);
    });

    it('rejects unknown tags, too many tags, and unknown keys', () => {
      expect(
        submitSurveyFeedbackInputSchema.safeParse({
          rating: 1,
          issueTags: ['SPAM'],
        }).success,
      ).toBe(false);
      expect(
        submitSurveyFeedbackInputSchema.safeParse({
          rating: 1,
          issueTags: [
            'UNCLEAR_QUESTIONS',
            'LONGER_THAN_ESTIMATED',
            'MISLEADING_DESCRIPTION',
            'TECHNICAL_ISSUE',
            'TECHNICAL_ISSUE',
          ],
        }).success,
      ).toBe(false);
      expect(
        submitSurveyFeedbackInputSchema.safeParse({
          rating: 4,
          respondentId: 'someone-else',
        }).success,
      ).toBe(false);
    });
  });

  describe('DTO schemas', () => {
    it('accepts a feedback DTO and never carries respondent identity', () => {
      expect(surveyFeedbackSchema.parse(feedback)).toEqual(feedback);
      expect(
        surveyFeedbackSchema.safeParse({ ...feedback, respondentId: 'u-1' })
          .success,
      ).toBe(false);
    });

    it('treats ids as opaque strings', () => {
      expect(
        surveyFeedbackSchema.safeParse({ ...feedback, attemptId: 'att-123' })
          .success,
      ).toBe(true);
      expect(
        surveyFeedbackSchema.safeParse({ ...feedback, attemptId: '' }).success,
      ).toBe(false);
    });

    it('validates status and submit result envelopes', () => {
      expect(
        surveyFeedbackStatusSchema.parse({
          attemptId: feedback.attemptId,
          state: 'SUBMITTED',
          feedback,
        }).state,
      ).toBe('SUBMITTED');
      expect(
        surveyFeedbackStatusSchema.safeParse({
          attemptId: feedback.attemptId,
          state: 'ELIGIBLE',
          feedback: null,
        }).success,
      ).toBe(true);
      expect(
        surveyFeedbackStatusSchema.safeParse({
          attemptId: feedback.attemptId,
          state: 'MAYBE',
          feedback: null,
        }).success,
      ).toBe(false);
      expect(
        submitSurveyFeedbackResultSchema.parse({ feedback, replayed: false })
          .replayed,
      ).toBe(false);
    });

    it('validates the SurveyFeedbackSubmitted event payload without comment text', () => {
      const payload = {
        schemaVersion: 1,
        feedbackId: feedback.id,
        attemptId: feedback.attemptId,
        responseId: '55555555-5555-4555-8555-555555555555',
        formId: feedback.formId,
        formVersionId: feedback.formVersionId,
        formType: 'INTERNAL',
        respondentId: '66666666-6666-4666-8666-666666666666',
        rating: 4,
        issueTags: ['TECHNICAL_ISSUE'],
        hasComment: true,
        validationStatus: 'PENDING',
        submittedAt: feedback.submittedAt,
      };
      expect(surveyFeedbackSubmittedEventPayloadSchema.parse(payload)).toEqual(
        payload,
      );
      expect(
        surveyFeedbackSubmittedEventPayloadSchema.safeParse({
          ...payload,
          comment: 'leak',
        }).success,
      ).toBe(false);
      expect(
        surveyFeedbackSubmittedEventPayloadSchema.safeParse({
          ...payload,
          validationStatus: 'ACCEPTED',
        }).success,
      ).toBe(false);
    });
  });

  describe('isSameSurveyFeedbackContent', () => {
    const stored = {
      rating: 4,
      comment: 'Ổn',
      issueTags: ['UNCLEAR_QUESTIONS', 'TECHNICAL_ISSUE'] as const,
    };

    it('treats a normalized identical submission as the same', () => {
      expect(
        isSameSurveyFeedbackContent(
          stored,
          submitSurveyFeedbackInputSchema.parse({
            rating: 4,
            comment: '  Ổn ',
            issueTags: ['TECHNICAL_ISSUE', 'UNCLEAR_QUESTIONS'],
          }),
        ),
      ).toBe(true);
    });

    it('detects any content difference', () => {
      expect(
        isSameSurveyFeedbackContent(stored, {
          rating: 5,
          comment: 'Ổn',
          issueTags: ['UNCLEAR_QUESTIONS', 'TECHNICAL_ISSUE'],
        }),
      ).toBe(false);
      expect(
        isSameSurveyFeedbackContent(stored, {
          rating: 4,
          comment: null,
          issueTags: ['UNCLEAR_QUESTIONS', 'TECHNICAL_ISSUE'],
        }),
      ).toBe(false);
      expect(
        isSameSurveyFeedbackContent(stored, {
          rating: 4,
          comment: 'Ổn',
          issueTags: ['UNCLEAR_QUESTIONS'],
        }),
      ).toBe(false);
    });
  });
});
