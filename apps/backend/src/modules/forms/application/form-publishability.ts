import {
  checkPublishRewardBand,
  checkSurveyFitsReservationWindow,
  describeReservationWindowViolation,
  externalSurveyUrlSchema,
  formDefinitionSchema,
  formIntegrityMetadataSchema,
  parseStoredTargeting,
  RESERVATION_EXPIRY_MINUTES,
  resolveRewardBandDurationOptions,
  SURVEY_DURATION_EXCEEDS_RESERVATION_CODE,
} from '@rescom/schemas';
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';
import {
  FormValidationException,
  PricingRewardOutOfBandException,
} from './exceptions/form.exceptions';

/**
 * The publish validations of a Form Version (Stories 2.6/4.5, Epic 4 review
 * P1/P2/P6), shared by every path that can put a survey on its way to the
 * Marketplace (Epic 8 review P2):
 * - `publishForm` (DRAFT → MODERATION_QUEUE);
 * - the Admin legacy move `ESCROW_LOCKED → MODERATION_QUEUE` (pre-8.1 rows
 *   were never validated);
 * - the moderation approval (`MODERATION_QUEUE → PUBLISHED`), which re-checks
 *   the stored row instead of trusting how it entered the queue.
 *
 * Rules: Internal → the whole Form Definition; External → integrity metadata,
 * an HTTPS URL and a stored completion-code verifier; both → the stored
 * targeting criteria parse (fail closed, Epic 4 review P12) and the survey
 * fits the 30-minute attempt reservation (decision E5-D2).
 * Throws `FormValidationException` (HTTP 422).
 */
export function assertFormPublishable(
  form: Pick<FormEntity, 'type'> &
    Partial<Pick<FormEntity, 'estimatedDurationMinutes'>>,
  version: FormVersionEntity,
  externalUrl: string | null = version.externalUrl,
): void {
  if (form.type !== 'EXTERNAL') {
    // Internal surveys: the entire form JSON must satisfy formDefinitionSchema.
    const schemaValidation = formDefinitionSchema.safeParse(version.schemaJson);
    if (!schemaValidation.success) {
      const errorMessages = schemaValidation.error.errors
        .map((e) => `${e.path.join('.') || 'root'}: ${e.message}`)
        .join('; ');
      throw new FormValidationException(
        `Form validation failed before publishing: ${errorMessages}`,
        schemaValidation.error.errors,
      );
    }
  } else {
    // External surveys have no RESCOM question blocks (the questions live on
    // the external platform); only the integrity metadata the time barrier
    // depends on is validated.
    const metadataValidation = formIntegrityMetadataSchema.safeParse(
      version.schemaJson?.metadata ?? {},
    );
    if (!metadataValidation.success) {
      const errorMessages = metadataValidation.error.errors
        .map((e) => `metadata.${e.path.join('.') || 'root'}: ${e.message}`)
        .join('; ');
      throw new FormValidationException(
        `Form validation failed before publishing: ${errorMessages}`,
        metadataValidation.error.errors,
      );
    }

    // A valid HTTPS Google Forms externalUrl (decision E4-DN3). The stored
    // value is re-checked so legacy http:/javascript: or non-Google rows are
    // caught.
    if (!externalUrl) {
      throw new FormValidationException(
        'External surveys require a valid externalUrl before publishing.',
      );
    }
    const urlValidation = externalSurveyUrlSchema.safeParse(externalUrl);
    if (!urlValidation.success) {
      throw new FormValidationException(
        `External surveys require a valid HTTPS Google Forms externalUrl before publishing: ${urlValidation.error.errors[0]?.message ?? 'invalid URL'}`,
        urlValidation.error.errors,
      );
    }
    // The completion code's plaintext is disclosed once, at creation or
    // rotation. Publishing never mints one silently (nobody could see it);
    // a version without a verifier must be rotated first.
    if (!version.completionCode) {
      throw new FormValidationException(
        'Generate a completion code (Rotate Completion Code) before publishing this external survey.',
        [],
        'EXTERNAL_COMPLETION_CODE_REQUIRED',
      );
    }
  }

  // Writes validate targeting, so only a legacy or corrupt row fails here;
  // such a survey would otherwise be matched by nobody (or by everybody).
  if (!parseStoredTargeting(version.targetingJson).ok) {
    throw new FormValidationException(
      'The stored targeting criteria are invalid. Edit the survey targeting before publishing.',
    );
  }

  assertSurveyFitsReservationWindow(form, version);
}

/**
 * Code-review decision E5-D2 (2026-09-26, option A): a survey nobody can
 * finish inside the fixed 30-minute attempt reservation is never published.
 * The effective minimum time — Internal: `computeInternalTimeBarrier`
 * (answerable questions x 2 s AND the publisher minimum); External: the
 * configured minimum — must leave a 5-minute grace (<= 25 min), and the
 * declared effort (`metadata.expectedEffortSeconds`) and estimated duration
 * (`estimatedDurationMinutes`) must fit the 30 minutes. Phase 1 does not
 * support surveys longer than 30 minutes (recorded default of the decision's
 * sub-question). Throws 422 `SURVEY_DURATION_EXCEEDS_RESERVATION` with the
 * violations as details. Drafts stay editable; only publication checks it.
 */
export function assertSurveyFitsReservationWindow(
  form: Pick<FormEntity, 'type'> &
    Partial<Pick<FormEntity, 'estimatedDurationMinutes'>>,
  version: Pick<FormVersionEntity, 'schemaJson'>,
): void {
  const check = checkSurveyFitsReservationWindow({
    type: form.type,
    definition: version.schemaJson,
    estimatedDurationMinutes: form.estimatedDurationMinutes ?? null,
  });
  if (check.fits) {
    return;
  }
  throw new FormValidationException(
    `This survey cannot be published: ${check.violations
      .map(describeReservationWindowViolation)
      .join(
        '; ',
      )}. Every attempt is reserved for ${RESERVATION_EXPIRY_MINUTES} minutes, so the minimum completion time must leave 5 minutes to submit, and the expected effort and estimated duration cannot exceed ${RESERVATION_EXPIRY_MINUTES} minutes. Phase 1 does not support surveys longer than ${RESERVATION_EXPIRY_MINUTES} minutes.`,
    check.violations,
    SURVEY_DURATION_EXCEEDS_RESERVATION_CODE,
  );
}

/**
 * FR-14 reward pricing band, enforced when a Publisher publishes a survey
 * (`publishForm`, External `autoPublish`) — never on drafts, which stay
 * editable (decision E6-D2, Story 6.3 AC1.2):
 * - a free (0-point) Internal survey is exempt (6.3 AC3.1);
 * - every other survey needs an estimated duration (422
 *   `ESTIMATED_DURATION_REQUIRED`) and a reward inside the band of its
 *   effective duration — the longest of `estimatedDurationMinutes`, the
 *   version's `metadata.expectedEffortSeconds` and its required minimum
 *   completion time — minimum AND maximum (400 `PRICING_REWARD_OUT_OF_BAND`,
 *   `{ min, max, suggested }`).
 * The moderation approval and the legacy Admin queue move do not re-check
 * the band: the survey was priced when it was published.
 *
 * `frozenReward` (review F3): a survey that already had a published version
 * keeps its reward (decision D2), so its re-versioned draft is not held to
 * the band minimum; the maximum still applies.
 */
export function assertRewardWithinPricingBand(
  form: Pick<
    FormEntity,
    'type' | 'rewardPerResponse' | 'estimatedDurationMinutes'
  >,
  version: Pick<FormVersionEntity, 'schemaJson'>,
  options: { frozenReward?: boolean } = {},
): void {
  const check = checkPublishRewardBand(form, {
    ...resolveRewardBandDurationOptions(form.type, version.schemaJson),
    frozenReward: options.frozenReward,
  });
  if (check.status === 'DURATION_REQUIRED') {
    throw new FormValidationException(
      'Set the estimated completion time (estimatedDurationMinutes) before publishing a rewarded survey: it selects the FR-14 reward pricing band.',
      [],
      'ESTIMATED_DURATION_REQUIRED',
    );
  }
  if (check.status === 'OUT_OF_BAND') {
    throw new PricingRewardOutOfBandException(
      form.rewardPerResponse,
      check.range,
      check.range.durationBand,
    );
  }
}
