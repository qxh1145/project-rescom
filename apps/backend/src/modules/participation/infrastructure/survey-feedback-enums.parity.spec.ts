import { $Enums } from '@prisma/client';
import {
  SURVEY_FEEDBACK_ISSUE_TAGS,
  SURVEY_FEEDBACK_VALIDATION_STATUSES,
} from '@rescom/schemas';

/**
 * Epic 9 review P12: the shared Zod lists must equal the generated Prisma
 * enums (issue tags in exact order — it is the canonical tag order).
 */
describe('Survey feedback enum parity (Story 9.2 AC1.2, AC1.3)', () => {
  it('SURVEY_FEEDBACK_ISSUE_TAGS equals the Prisma SurveyFeedbackIssueTag enum', () => {
    expect([...SURVEY_FEEDBACK_ISSUE_TAGS]).toEqual(
      Object.values($Enums.SurveyFeedbackIssueTag),
    );
  });

  it('SURVEY_FEEDBACK_VALIDATION_STATUSES equals the Prisma SurveyFeedbackValidationStatus enum', () => {
    expect([...SURVEY_FEEDBACK_VALIDATION_STATUSES]).toEqual(
      Object.values($Enums.SurveyFeedbackValidationStatus),
    );
  });
});
