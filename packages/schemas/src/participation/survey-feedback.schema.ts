import { z } from 'zod';
import { removeLoneSurrogates } from '../common/unicode-text';

/**
 * Story 9.2 — Respondent post-completion feedback (FR-43).
 *
 * One overall 5-star rating (required), an optional plain-text comment and
 * optional issue tags that cover the remaining FR-43 dimensions (question
 * clarity, survey length accuracy, description accuracy, technical issues).
 * Feedback is stored with `validationStatus = PENDING`; the Phase-2 Survey
 * Quality aggregator counts only `ACCEPTED` feedback. Shared by the backend
 * and the frontend mock so both apply the same rules.
 */
export const SURVEY_FEEDBACK_RATING_MIN = 1;
export const SURVEY_FEEDBACK_RATING_MAX = 5;
export const SURVEY_FEEDBACK_COMMENT_MAX_LENGTH = 500;
/** Upper bound on the raw comment before normalization (bounds the work). */
export const SURVEY_FEEDBACK_COMMENT_RAW_MAX_LENGTH = 2000;
export const SURVEY_FEEDBACK_SUBMITTED_EVENT_TYPE = 'SurveyFeedbackSubmitted';

export const SURVEY_FEEDBACK_ATTEMPT_NOT_FOUND_CODE = 'FEEDBACK_ATTEMPT_NOT_FOUND';
export const SURVEY_FEEDBACK_NOT_ALLOWED_CODE = 'FEEDBACK_NOT_ALLOWED';
export const SURVEY_FEEDBACK_ALREADY_SUBMITTED_CODE =
  'FEEDBACK_ALREADY_SUBMITTED';

/** Must equal the Prisma `SurveyFeedbackIssueTag` enum (canonical order). */
export const SURVEY_FEEDBACK_ISSUE_TAGS = [
  'UNCLEAR_QUESTIONS',
  'LONGER_THAN_ESTIMATED',
  'MISLEADING_DESCRIPTION',
  'TECHNICAL_ISSUE',
] as const;

export const surveyFeedbackIssueTagSchema = z.enum(SURVEY_FEEDBACK_ISSUE_TAGS);

export type SurveyFeedbackIssueTag = z.infer<
  typeof surveyFeedbackIssueTagSchema
>;

/** Must equal the Prisma `SurveyFeedbackValidationStatus` enum. */
export const SURVEY_FEEDBACK_VALIDATION_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'EXCLUDED',
] as const;

export const surveyFeedbackValidationStatusSchema = z.enum(
  SURVEY_FEEDBACK_VALIDATION_STATUSES,
);

export type SurveyFeedbackValidationStatus = z.infer<
  typeof surveyFeedbackValidationStatusSchema
>;

export const surveyFeedbackStateSchema = z.enum([
  'ELIGIBLE',
  'SUBMITTED',
  'NOT_ELIGIBLE',
]);

export type SurveyFeedbackState = z.infer<typeof surveyFeedbackStateSchema>;

// C0 controls except TAB (\u0009) and LF (\u000A), DEL and C1 controls,
// plus invisible/direction-changing characters usable for text spoofing or
// hidden-text smuggling: soft hyphen, Arabic letter mark, Mongolian vowel
// separator, bidi marks/embeddings/overrides/isolates, zero-width space,
// word joiner, invisible math operators, BOM and interlinear annotation
// controls. ZWNJ/ZWJ (\u200C/\u200D) are kept because emoji sequences and
// some scripts use them.
const DISALLOWED_COMMENT_CHARACTERS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFFF9-\uFFFB]/g;

/** Unicode tag characters (U+E0000–U+E007F): invisible text smuggling. */
const TAG_CHARACTERS = /[\u{E0000}-\u{E007F}]/gu;

/** Line and paragraph separators render as line breaks: store them as LF. */
const LINE_BREAKS = /\r\n?|[\u2028\u2029]/g;

/**
 * Characters that render as nothing (joiners, combining grapheme joiner,
 * variation selectors, Khmer/Mongolian invisibles, Hangul/Braille blanks) plus
 * whitespace. A comment made only of these carries no visible text and is
 * stored as `null`; inside visible text they are kept (e.g. ZWJ in emoji).
 */
const INVISIBLE_OR_BLANK =
  /[\s\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180D\u200C\u200D\u2800\u3164\uFE00-\uFE0F\uFFA0]/g;

/**
 * Plain-text comment normalization (Epic 9 review P8): lone UTF-16 surrogates
 * removed (the database rejects them), Unicode NFC, CRLF/CR/U+2028/U+2029 →
 * LF, control and invisible spoofing characters removed, trimmed; a comment
 * with no visible character → null. Markup is kept verbatim (never
 * interpreted as HTML).
 */
export function normalizeSurveyFeedbackComment(raw: string): string | null {
  const normalized = removeLoneSurrogates(raw)
    .normalize('NFC')
    .replace(LINE_BREAKS, '\n')
    .replace(DISALLOWED_COMMENT_CHARACTERS, '')
    .replace(TAG_CHARACTERS, '')
    // Removing a character can leave a non-NFC sequence (e.g. a soft hyphen
    // between a letter and a combining mark): normalize once more.
    .normalize('NFC')
    .trim();
  if (normalized.replace(INVISIBLE_OR_BLANK, '').length === 0) {
    return null;
  }
  return normalized;
}

function toCanonicalIssueTags(
  tags: readonly SurveyFeedbackIssueTag[],
): SurveyFeedbackIssueTag[] {
  const selected = new Set(tags);
  return SURVEY_FEEDBACK_ISSUE_TAGS.filter((tag) => selected.has(tag));
}

const opaqueIdSchema = z.string().min(1);

const ratingSchema = z
  .number({
    required_error: 'rating is required',
    invalid_type_error: 'rating must be a number',
  })
  .int('rating must be an integer')
  .min(SURVEY_FEEDBACK_RATING_MIN, 'rating must be between 1 and 5')
  .max(SURVEY_FEEDBACK_RATING_MAX, 'rating must be between 1 and 5');

/** `POST /attempts/:attemptId/feedback` body. */
export const submitSurveyFeedbackInputSchema = z
  .object({
    rating: ratingSchema,
    comment: z
      .string()
      .max(
        SURVEY_FEEDBACK_COMMENT_RAW_MAX_LENGTH,
        `comment must be at most ${SURVEY_FEEDBACK_COMMENT_MAX_LENGTH} characters`,
      )
      .nullable()
      .optional()
      .transform((value) =>
        value == null ? null : normalizeSurveyFeedbackComment(value),
      )
      .refine(
        (value) =>
          value === null || value.length <= SURVEY_FEEDBACK_COMMENT_MAX_LENGTH,
        `comment must be at most ${SURVEY_FEEDBACK_COMMENT_MAX_LENGTH} characters`,
      ),
    issueTags: z
      .array(surveyFeedbackIssueTagSchema)
      .max(
        SURVEY_FEEDBACK_ISSUE_TAGS.length,
        `issueTags accepts at most ${SURVEY_FEEDBACK_ISSUE_TAGS.length} tags`,
      )
      .optional()
      .transform((tags) => toCanonicalIssueTags(tags ?? [])),
  })
  .strict();

export type SubmitSurveyFeedbackInput = z.input<
  typeof submitSurveyFeedbackInputSchema
>;
export type SubmitSurveyFeedbackCommand = z.output<
  typeof submitSurveyFeedbackInputSchema
>;

/** The caller's own feedback. Never carries respondent identity. */
export const surveyFeedbackSchema = z
  .object({
    id: opaqueIdSchema,
    attemptId: opaqueIdSchema,
    formId: opaqueIdSchema,
    formVersionId: opaqueIdSchema,
    formType: z.enum(['INTERNAL', 'EXTERNAL']),
    rating: ratingSchema,
    comment: z.string().min(1).max(SURVEY_FEEDBACK_COMMENT_MAX_LENGTH).nullable(),
    issueTags: z.array(surveyFeedbackIssueTagSchema),
    validationStatus: surveyFeedbackValidationStatusSchema,
    submittedAt: z.string().datetime(),
  })
  .strict();

export type SurveyFeedbackDto = z.infer<typeof surveyFeedbackSchema>;

/** `GET /attempts/:attemptId/feedback`: whether the prompt should be shown. */
export const surveyFeedbackStatusSchema = z
  .object({
    attemptId: opaqueIdSchema,
    state: surveyFeedbackStateSchema,
    feedback: surveyFeedbackSchema.nullable(),
  })
  .strict();

export type SurveyFeedbackStatusDto = z.infer<typeof surveyFeedbackStatusSchema>;

/** `replayed: true` = an identical earlier submission was returned (no new row). */
export const submitSurveyFeedbackResultSchema = z
  .object({
    feedback: surveyFeedbackSchema,
    replayed: z.boolean(),
  })
  .strict();

export type SubmitSurveyFeedbackResultDto = z.infer<
  typeof submitSurveyFeedbackResultSchema
>;

/**
 * `SurveyFeedbackSubmitted` Outbox payload (schema version 1). Consumed by the
 * Phase-2 Survey Quality validator; carries no comment text (minimization).
 */
export const surveyFeedbackSubmittedEventPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    feedbackId: z.string().uuid(),
    attemptId: z.string().uuid(),
    responseId: z.string().uuid().nullable(),
    formId: z.string().uuid(),
    formVersionId: z.string().uuid(),
    formType: z.enum(['INTERNAL', 'EXTERNAL']),
    respondentId: z.string().uuid(),
    rating: ratingSchema,
    issueTags: z.array(surveyFeedbackIssueTagSchema),
    hasComment: z.boolean(),
    validationStatus: z.literal('PENDING'),
    submittedAt: z.string().datetime(),
  })
  .strict();

export type SurveyFeedbackSubmittedEventPayload = z.infer<
  typeof surveyFeedbackSubmittedEventPayloadSchema
>;

export interface SurveyFeedbackContent {
  rating: number;
  comment: string | null;
  issueTags: readonly SurveyFeedbackIssueTag[];
}

/**
 * Replay rule: an already-stored feedback matches a (parsed) submission when
 * rating, normalized comment and tag set are equal.
 */
export function isSameSurveyFeedbackContent(
  stored: SurveyFeedbackContent,
  submitted: SurveyFeedbackContent,
): boolean {
  const storedTags = toCanonicalIssueTags(stored.issueTags);
  const submittedTags = toCanonicalIssueTags(submitted.issueTags);
  return (
    stored.rating === submitted.rating &&
    (stored.comment ?? null) === (submitted.comment ?? null) &&
    storedTags.length === submittedTags.length &&
    storedTags.every((tag, index) => tag === submittedTags[index])
  );
}
