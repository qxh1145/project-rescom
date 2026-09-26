import {
  SurveyFeedbackEntity,
  SurveyFeedbackProps,
} from './survey-feedback.entity';

describe('Story 9.2: SurveyFeedbackEntity', () => {
  const base: SurveyFeedbackProps = {
    id: '11111111-1111-4111-8111-111111111111',
    attemptId: '22222222-2222-4222-8222-222222222222',
    responseId: '33333333-3333-4333-8333-333333333333',
    formId: '44444444-4444-4444-8444-444444444444',
    formVersionId: '55555555-5555-4555-8555-555555555555',
    respondentId: '66666666-6666-4666-8666-666666666666',
    formType: 'INTERNAL',
    rating: 4,
    comment: '<i>plain</i>',
    issueTags: ['TECHNICAL_ISSUE'],
    validationStatus: 'PENDING',
    validatedAt: null,
    submittedAt: new Date('2026-09-26T10:00:00.000Z'),
  };

  it.each([0, 6, 2.5])('rejects rating %p', (rating) => {
    expect(() => new SurveyFeedbackEntity({ ...base, rating })).toThrow(
      /rating/,
    );
  });

  it('rejects empty or over-long comments', () => {
    expect(() => new SurveyFeedbackEntity({ ...base, comment: '' })).toThrow(
      /comment/,
    );
    expect(
      () => new SurveyFeedbackEntity({ ...base, comment: 'x'.repeat(501) }),
    ).toThrow(/comment/);
  });

  it('rejects a Response link on External feedback', () => {
    expect(
      () => new SurveyFeedbackEntity({ ...base, formType: 'EXTERNAL' }),
    ).toThrow(/External/);
  });

  it('requires the Response link on Internal feedback', () => {
    expect(
      () => new SurveyFeedbackEntity({ ...base, responseId: null }),
    ).toThrow(/Internal/);
  });

  it('exposes an owner DTO without respondent or response identity', () => {
    const dto = new SurveyFeedbackEntity(base).toDto();
    expect(dto).toEqual({
      id: base.id,
      attemptId: base.attemptId,
      formId: base.formId,
      formVersionId: base.formVersionId,
      formType: 'INTERNAL',
      rating: 4,
      comment: '<i>plain</i>',
      issueTags: ['TECHNICAL_ISSUE'],
      validationStatus: 'PENDING',
      submittedAt: '2026-09-26T10:00:00.000Z',
    });
    expect(dto).not.toHaveProperty('respondentId');
    expect(dto).not.toHaveProperty('responseId');
  });

  it('compares content for replays', () => {
    const entity = new SurveyFeedbackEntity(base);
    expect(
      entity.hasSameContent({
        rating: 4,
        comment: '<i>plain</i>',
        issueTags: ['TECHNICAL_ISSUE'],
      }),
    ).toBe(true);
    expect(
      entity.hasSameContent({
        rating: 4,
        comment: '<i>plain</i>',
        issueTags: [],
      }),
    ).toBe(false);
  });
});
