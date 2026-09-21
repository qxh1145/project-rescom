import { PublicFormsService } from './public-forms.service';
import { InMemoryFormRepository } from '../infrastructure/in-memory-form.repository';
import { InMemorySurveyResponseRepository } from '../../marketplace/infrastructure/in-memory-survey-response.repository';
import { CaptchaValidatorService } from '../infrastructure/captcha-validator.service';
import { GuestSubmissionRateLimiter } from '../infrastructure/guest-submission-rate-limiter';
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';
import {
  FormNotFoundException,
  PublicFormAccessDisabledException,
  CaptchaVerificationFailedException,
  GuestRateLimitExceededException,
  InvalidGuestSubmissionException,
} from './exceptions/form.exceptions';

describe('PublicFormsService', () => {
  let service: PublicFormsService;
  let formRepo: InMemoryFormRepository;
  let responseRepo: InMemorySurveyResponseRepository;
  let captchaValidator: CaptchaValidatorService;
  let rateLimiter: GuestSubmissionRateLimiter;

  const publisherId = '11111111-1111-4111-8111-111111111111';
  const publishedInternalId = '22222222-2222-4222-8222-222222222222';
  const privateFormId = '33333333-3333-4333-8333-333333333333';
  const draftFormId = '44444444-4444-4444-8444-444444444444';
  const externalFormId = '55555555-5555-4555-8555-555555555555';

  beforeEach(async () => {
    formRepo = new InMemoryFormRepository();
    responseRepo = new InMemorySurveyResponseRepository();
    captchaValidator = new CaptchaValidatorService({ isTest: true });
    rateLimiter = new GuestSubmissionRateLimiter({ limit: 3, windowMs: 60000 });

    service = new PublicFormsService(
      formRepo,
      responseRepo,
      captchaValidator,
      rateLimiter,
    );

    const now = new Date();

    // 1. Published Internal Form with Public Access Enabled
    const f1 = new FormEntity(
      publishedInternalId,
      publisherId,
      'INTERNAL',
      'PUBLISHED',
      'Customer Satisfaction Survey',
      'Help us improve our service',
      10,
      100,
      now,
      now,
    );
    const v1 = new FormVersionEntity(
      'v1',
      publishedInternalId,
      1,
      {
        blocks: [
          {
            id: 'q1',
            type: 'text',
            title: 'Your Name',
            required: true,
            order: 0,
          },
          {
            id: 'q2',
            type: 'number',
            title: 'Your Rating (1-10)',
            required: false,
            order: 1,
          },
        ],
        settings: {
          shuffleBlocks: false,
          progressBar: true,
          requireAuth: false,
          allowPublicAccess: true,
          submitButtonText: 'Send Feedback',
        },
        metadata: {
          expectedEffortSeconds: 60,
          minTimeBarrierSeconds: 10,
        },
      } as any,
      null,
      true,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(f1, v1);

    // 2. Published Internal Form with Public Access Disabled (requireAuth: true)
    const f2 = new FormEntity(
      privateFormId,
      publisherId,
      'INTERNAL',
      'PUBLISHED',
      'Internal Employee Survey',
      'Members only',
      15,
      50,
      now,
      now,
    );
    const v2 = new FormVersionEntity(
      'v2',
      privateFormId,
      1,
      {
        blocks: [
          {
            id: 'q1',
            type: 'text',
            title: 'Employee ID',
            required: true,
            order: 0,
          },
        ],
        settings: {
          requireAuth: true,
          allowPublicAccess: false,
        },
      } as any,
      null,
      true,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(f2, v2);

    // 3. Draft Form
    const f3 = new FormEntity(
      draftFormId,
      publisherId,
      'INTERNAL',
      'DRAFT',
      'Draft Survey',
      null,
      10,
      50,
      now,
      now,
    );
    const v3 = new FormVersionEntity(
      'v3',
      draftFormId,
      1,
      { blocks: [] } as any,
      null,
      false,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(f3, v3);

    // 4. External Form
    const f4 = new FormEntity(
      externalFormId,
      publisherId,
      'EXTERNAL',
      'PUBLISHED',
      'Google Forms Survey',
      null,
      10,
      50,
      now,
      now,
    );
    const v4 = new FormVersionEntity(
      'v4',
      externalFormId,
      1,
      { blocks: [] } as any,
      null,
      true,
      'https://forms.google.com/xyz',
      null,
      now,
      now,
    );
    await formRepo.create(f4, v4);
  });

  describe('getPublicForm', () => {
    it('should return public form details for published internal form with public access', async () => {
      const publicForm = await service.getPublicForm(publishedInternalId);
      expect(publicForm.id).toBe(publishedInternalId);
      expect(publicForm.title).toBe('Customer Satisfaction Survey');
      expect(publicForm.type).toBe('INTERNAL');
      expect(publicForm.blocks).toHaveLength(2);
      expect(publicForm.settings.allowPublicAccess).toBe(true);
    });

    it('should throw NotFoundException if form does not exist', async () => {
      await expect(
        service.getPublicForm('99999999-9999-4999-8999-999999999999'),
      ).rejects.toThrow(FormNotFoundException);
    });

    it('should throw NotFoundException if form is DRAFT', async () => {
      await expect(service.getPublicForm(draftFormId)).rejects.toThrow(
        FormNotFoundException,
      );
    });

    it('should throw NotFoundException if form is EXTERNAL', async () => {
      await expect(service.getPublicForm(externalFormId)).rejects.toThrow(
        FormNotFoundException,
      );
    });

    it('should throw ForbiddenException if public access is disabled', async () => {
      await expect(service.getPublicForm(privateFormId)).rejects.toThrow(
        PublicFormAccessDisabledException,
      );
    });
  });

  describe('submitGuestResponse', () => {
    const validPayload = {
      answers: {
        q1: 'Alice Guest',
        q2: 9,
      },
      captchaToken: 'test-turnstile-token',
    };
    const clientIp = '192.168.1.100';

    it('should successfully submit guest response with 0 reward and NOT_AVAILABLE reliability', async () => {
      const res = await service.submitGuestResponse(
        publishedInternalId,
        validPayload,
        clientIp,
      );

      expect(res.submissionId).toBeDefined();
      expect(res.formId).toBe(publishedInternalId);
      expect(res.status).toBe('SUBMITTED');
      expect(res.isGuest).toBe(true);
      expect(res.rewardEarned).toBe(0);
      expect(res.respondentReliability).toBe('NOT_AVAILABLE');
      expect(res.integrityStatus).toBe('ASSESSED');
    });

    it('should reject submission if required question is missing', async () => {
      await expect(
        service.submitGuestResponse(
          publishedInternalId,
          {
            answers: { q2: 5 }, // q1 is required!
            captchaToken: 'test-turnstile-token',
          },
          clientIp,
        ),
      ).rejects.toThrow(InvalidGuestSubmissionException);
    });

    it('should reject submission if captcha token is invalid', async () => {
      await expect(
        service.submitGuestResponse(
          publishedInternalId,
          {
            ...validPayload,
            captchaToken: 'invalid-captcha-token',
          },
          clientIp,
        ),
      ).rejects.toThrow(CaptchaVerificationFailedException);
    });

    it('should enforce IP rate limit after 3 submissions', async () => {
      const ip = '10.0.0.50';

      // 3 successful submissions
      for (let i = 0; i < 3; i++) {
        await service.submitGuestResponse(
          publishedInternalId,
          validPayload,
          ip,
        );
      }

      // 4th submission should throw 429
      await expect(
        service.submitGuestResponse(publishedInternalId, validPayload, ip),
      ).rejects.toThrow(GuestRateLimitExceededException);
    });
  });
});
