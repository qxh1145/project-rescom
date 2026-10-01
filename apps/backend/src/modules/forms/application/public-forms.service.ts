import { FormRepositoryPort } from './ports/form-repository.port';
import type { FormsService } from './forms.service';
import { SurveyResponseRepositoryPort } from '../../marketplace/application/ports/survey-response.repository.port';
import { CaptchaValidatorService } from '../infrastructure/captcha-validator.service';
import { GuestSubmissionRateLimiter } from '../infrastructure/guest-submission-rate-limiter';
import {
  CAPTCHA_PROVIDER_NOT_CONFIGURED,
  FormNotFoundException,
  PublicFormAccessDisabledException,
  CaptchaVerificationFailedException,
  GuestRateLimitExceededException,
  InvalidGuestSubmissionException,
} from './exceptions/form.exceptions';
import { SurveyQuotaFullException } from '../../participation/application/exceptions/participation.exceptions';
import {
  PublicFormDetailsDto,
  GuestSubmissionInput,
  GuestSubmissionResponseDto,
  validateAnswersAgainstFormDefinition,
  RESERVATION_EXPIRY_MS,
  FormBlock,
  FormSettings,
  FormIntegrityMetadata,
  toRespondentFormBlocks,
} from '@rescom/schemas';

export class PublicFormsService {
  constructor(
    private readonly formRepository: FormRepositoryPort,
    private readonly responseRepository: SurveyResponseRepositoryPort,
    private readonly captchaValidator: CaptchaValidatorService,
    private readonly rateLimiter: GuestSubmissionRateLimiter,
    /**
     * Plan 2.3: closes the survey (QUOTA) and refunds its leftover Escrow
     * when a guest fills the last slot, in the guest submission transaction.
     */
    private readonly quotaCloser?: Pick<FormsService, 'closeFormIfQuotaMet'>,
  ) {}

  async getPublicForm(formId: string): Promise<PublicFormDetailsDto> {
    const formWithVer = await this.formRepository.findById(formId);

    if (
      !formWithVer ||
      formWithVer.form.status !== 'PUBLISHED' ||
      formWithVer.form.type !== 'INTERNAL'
    ) {
      throw new FormNotFoundException(formId);
    }

    const schemaJson = formWithVer.currentVersion.schemaJson;
    const settings: FormSettings = schemaJson?.settings || {
      shuffleBlocks: false,
      progressBar: true,
      requireAuth: false,
      allowPublicAccess: true,
      submitButtonText: 'Submit',
    };

    if (settings.requireAuth === true || settings.allowPublicAccess === false) {
      throw new PublicFormAccessDisabledException(
        'Public guest access is disabled for this form',
      );
    }

    const blocks: FormBlock[] = schemaJson?.blocks || [];
    const metadata: FormIntegrityMetadata = schemaJson?.metadata || {
      expectedEffortSeconds: 60,
      minTimeBarrierSeconds: 15,
    };

    return {
      id: formWithVer.form.id,
      title: formWithVer.form.title,
      description: formWithVer.form.description,
      type: 'INTERNAL',
      versionNumber: formWithVer.currentVersion.versionNumber,
      // Review MEDIUM-1: never the integrity config (attention-check answers).
      blocks: toRespondentFormBlocks(blocks),
      sections: schemaJson?.sections,
      settings,
      metadata,
      publicUrl: `/f/${formWithVer.form.id}`,
      publishedAt: formWithVer.currentVersion.publishedAt
        ? formWithVer.currentVersion.publishedAt.toISOString()
        : null,
    };
  }

  /**
   * Bug 3.3: the per-IP slot is taken atomically before any other work.
   * Release policy: a client error (rate limit aside: bad CAPTCHA, closed or
   * private form, invalid answers, full quota) keeps the slot, so the
   * endpoint cannot be probed for free; an unexpected failure (e.g. the
   * database) or a server without a CAPTCHA provider
   * (`CAPTCHA_PROVIDER_NOT_CONFIGURED`, review F6) gives the slot back, since
   * the guest did nothing wrong.
   */
  async submitGuestResponse(
    formId: string,
    input: GuestSubmissionInput,
    ipAddress: string,
  ): Promise<GuestSubmissionResponseDto> {
    if (!this.rateLimiter.tryAcquire(ipAddress)) {
      throw new GuestRateLimitExceededException(
        'GUEST_RATE_LIMIT_EXCEEDED: Maximum 3 guest submissions per 24 hours allowed from this IP',
      );
    }

    try {
      return await this.submitWithAcquiredSlot(formId, input, ipAddress);
    } catch (error) {
      if (!isGuestClientError(error)) {
        this.rateLimiter.release(ipAddress);
      }
      throw error;
    }
  }

  private async submitWithAcquiredSlot(
    formId: string,
    input: GuestSubmissionInput,
    ipAddress: string,
  ): Promise<GuestSubmissionResponseDto> {
    const captchaCheck = await this.captchaValidator.validateToken(
      input.captchaToken,
      ipAddress,
    );
    if (!captchaCheck.isValid) {
      throw new CaptchaVerificationFailedException(
        captchaCheck.error || 'CAPTCHA_VERIFICATION_FAILED',
      );
    }

    const formWithVer = await this.formRepository.findById(formId);
    // Review LOW-8: a survey closed because its sample target was met is
    // "full" for a guest too, not "not found".
    if (
      formWithVer?.form.isClosed() &&
      formWithVer.form.closeKind === 'QUOTA' &&
      formWithVer.form.type === 'INTERNAL'
    ) {
      throw new SurveyQuotaFullException();
    }
    if (
      !formWithVer ||
      formWithVer.form.status !== 'PUBLISHED' ||
      formWithVer.form.type !== 'INTERNAL'
    ) {
      throw new FormNotFoundException(formId);
    }

    const schemaJson = formWithVer.currentVersion.schemaJson;
    const settings: FormSettings = schemaJson?.settings || {};
    if (settings.requireAuth === true || settings.allowPublicAccess === false) {
      throw new PublicFormAccessDisabledException(
        'Public guest access is disabled for this form',
      );
    }

    // Strict server-side validation, same as authenticated submissions
    // (unknown block ids, duplicates, type strictness).
    const blocks: FormBlock[] = schemaJson?.blocks || [];
    const validation = validateAnswersAgainstFormDefinition(
      blocks,
      input.answers,
    );
    if (!validation.isValid) {
      const firstError =
        Object.values(validation.errors)[0] ||
        'Validation failed for one or more answers';
      throw new InvalidGuestSubmissionException(firstError, validation.errors);
    }

    // Persisted under the form row lock with the paid-respondent quota
    // (zero escrow deducted, zero reward awarded).
    const result = await this.responseRepository.createGuestResponseWithinQuota(
      {
        formId: formWithVer.form.id,
        formVersionId: formWithVer.currentVersion.id,
        answers: validation.normalizedAnswers,
        ipAddress,
        telemetry: input.telemetry,
        cutoffDate: new Date(Date.now() - RESERVATION_EXPIRY_MS),
        ...(this.quotaCloser
          ? {
              afterCreate: async () => {
                await this.quotaCloser?.closeFormIfQuotaMet(
                  formWithVer.form.id,
                  new Date(),
                );
              },
            }
          : {}),
      },
    );
    if (result.outcome === 'NOT_OPEN') {
      throw new FormNotFoundException(formId);
    }
    if (result.outcome === 'QUOTA_FULL') {
      throw new SurveyQuotaFullException();
    }

    const submission = result.response;
    return {
      submissionId: submission.id,
      formId: submission.formId,
      status: 'SUBMITTED',
      isGuest: true,
      rewardEarned: 0,
      integrityStatus: 'ASSESSED',
      respondentReliability: 'NOT_AVAILABLE',
      submittedAt: submission.submittedAt.toISOString(),
    };
  }
}

/** Errors caused by the guest's request: they keep the rate-limit slot. */
function isGuestClientError(error: unknown): boolean {
  return (
    (error instanceof CaptchaVerificationFailedException &&
      error.message !== CAPTCHA_PROVIDER_NOT_CONFIGURED) ||
    error instanceof FormNotFoundException ||
    error instanceof PublicFormAccessDisabledException ||
    error instanceof InvalidGuestSubmissionException ||
    error instanceof SurveyQuotaFullException
  );
}
