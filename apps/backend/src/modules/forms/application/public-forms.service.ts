import { FormRepositoryPort } from './ports/form-repository.port';
import { SurveyResponseRepositoryPort } from '../../marketplace/application/ports/survey-response.repository.port';
import { CaptchaValidatorService } from '../infrastructure/captcha-validator.service';
import { GuestSubmissionRateLimiter } from '../infrastructure/guest-submission-rate-limiter';
import {
  FormNotFoundException,
  PublicFormAccessDisabledException,
  CaptchaVerificationFailedException,
  GuestRateLimitExceededException,
  InvalidGuestSubmissionException,
} from './exceptions/form.exceptions';
import {
  PublicFormDetailsDto,
  GuestSubmissionInput,
  GuestSubmissionResponseDto,
  validateAllAnswers,
  FormBlock,
  FormSettings,
  FormIntegrityMetadata,
} from '@rescom/schemas';

export class PublicFormsService {
  constructor(
    private readonly formRepository: FormRepositoryPort,
    private readonly responseRepository: SurveyResponseRepositoryPort,
    private readonly captchaValidator: CaptchaValidatorService,
    private readonly rateLimiter: GuestSubmissionRateLimiter,
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
      blocks,
      settings,
      metadata,
      publicUrl: `/f/${formWithVer.form.id}`,
      publishedAt: formWithVer.currentVersion.publishedAt
        ? formWithVer.currentVersion.publishedAt.toISOString()
        : null,
    };
  }

  async submitGuestResponse(
    formId: string,
    input: GuestSubmissionInput,
    ipAddress: string,
  ): Promise<GuestSubmissionResponseDto> {
    // 1. Check IP rate limit (default max 3 per 24 hours)
    const rateCheck = await this.rateLimiter.checkRateLimit(ipAddress);
    if (!rateCheck.isAllowed) {
      throw new GuestRateLimitExceededException(
        'GUEST_RATE_LIMIT_EXCEEDED: Maximum 3 guest submissions per 24 hours allowed from this IP',
      );
    }

    // 2. Validate CAPTCHA token
    const captchaCheck = await this.captchaValidator.validateToken(
      input.captchaToken,
      ipAddress,
    );
    if (!captchaCheck.isValid) {
      throw new CaptchaVerificationFailedException(
        captchaCheck.error || 'CAPTCHA_VERIFICATION_FAILED',
      );
    }

    // 3. Verify form eligibility
    const formWithVer = await this.formRepository.findById(formId);
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

    // 4. Validate all answers against block questions
    const blocks: FormBlock[] = schemaJson?.blocks || [];
    const validation = validateAllAnswers(blocks, input.answers);
    if (!validation.isValid) {
      const firstError =
        Object.values(validation.errors)[0] ||
        'Validation failed for one or more answers';
      throw new InvalidGuestSubmissionException(firstError);
    }

    // 5. Persist guest submission (zero escrow points deducted, zero reward awarded)
    const submission = await this.responseRepository.createGuestSubmission({
      formId: formWithVer.form.id,
      formVersionId: formWithVer.currentVersion.id,
      answers: input.answers,
      ipAddress,
      telemetry: input.telemetry,
    });

    // 6. Record rate limit hit for this IP
    await this.rateLimiter.recordSubmission(ipAddress);

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
