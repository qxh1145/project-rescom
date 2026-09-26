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
import { SurveyQuotaFullException } from '../../participation/application/exceptions/participation.exceptions';
import { RESERVATION_EXPIRY_MS } from '@rescom/schemas';

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
    captchaValidator = new CaptchaValidatorService({ isProduction: false });
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
    responseRepo.registerForm({
      id: publishedInternalId,
      status: 'PUBLISHED',
      type: 'INTERNAL',
      expectedCompletions: 100,
    });

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

    describe('Bug 3.3: quota under the form lock', () => {
      function setQuota(expectedCompletions: number, status = 'PUBLISHED') {
        responseRepo.registerForm({
          id: publishedInternalId,
          status,
          type: 'INTERNAL',
          expectedCompletions,
        });
      }

      it('rejects a guest with SurveyQuotaFullException (409) once the quota is full', async () => {
        setQuota(1);
        await service.submitGuestResponse(
          publishedInternalId,
          validPayload,
          '10.1.0.1',
        );

        await expect(
          service.submitGuestResponse(
            publishedInternalId,
            validPayload,
            '10.1.0.2',
          ),
        ).rejects.toThrow(SurveyQuotaFullException);
      });

      it('counts unexpired paid reservations like reserveAttempt does, and ignores expired ones', async () => {
        setQuota(1);
        responseRepo.recordActiveAttempt(
          publishedInternalId,
          new Date(Date.now() - RESERVATION_EXPIRY_MS - 1000),
        );
        await expect(
          service.submitGuestResponse(
            publishedInternalId,
            validPayload,
            '10.1.0.3',
          ),
        ).resolves.toMatchObject({ status: 'SUBMITTED' });

        setQuota(2);
        responseRepo.recordActiveAttempt(publishedInternalId, new Date());
        await expect(
          service.submitGuestResponse(
            publishedInternalId,
            validPayload,
            '10.1.0.4',
          ),
        ).rejects.toThrow(SurveyQuotaFullException);
      });

      it('a guest filling the last slot makes the shared completion count reach the quota (paid starts then see QUOTA_FULL)', async () => {
        setQuota(2);
        await responseRepo.recordResponse({
          formId: publishedInternalId,
          formVersionId: 'v1',
          respondentId: 'paid-user',
          status: 'VALIDATED',
        });

        await service.submitGuestResponse(
          publishedInternalId,
          validPayload,
          '10.1.0.5',
        );

        const counts = await responseRepo.getCompletedCountsByFormIds([
          publishedInternalId,
        ]);
        expect(counts.get(publishedInternalId)).toBe(2);
      });

      it('maps NOT_OPEN (form closed before the lock) to FormNotFoundException', async () => {
        setQuota(100, 'CLOSED');
        await expect(
          service.submitGuestResponse(
            publishedInternalId,
            validPayload,
            '10.1.0.6',
          ),
        ).rejects.toThrow(FormNotFoundException);
      });

      it('persists through createGuestResponseWithinQuota with the reservation cutoff', async () => {
        const spy = jest.spyOn(responseRepo, 'createGuestResponseWithinQuota');
        const before = Date.now();

        await service.submitGuestResponse(
          publishedInternalId,
          validPayload,
          '10.1.0.7',
        );

        const params = spy.mock.calls[0][0];
        expect(params).toMatchObject({
          formId: publishedInternalId,
          formVersionId: 'v1',
          ipAddress: '10.1.0.7',
          answers: { q1: 'Alice Guest', q2: 9 },
        });
        expect(params.cutoffDate.getTime()).toBeGreaterThanOrEqual(
          before - RESERVATION_EXPIRY_MS,
        );
        expect(params.cutoffDate.getTime()).toBeLessThanOrEqual(
          Date.now() - RESERVATION_EXPIRY_MS,
        );
      });
    });

    describe('Bug 3.3: strict answer validation', () => {
      it('rejects unknown block ids with per-block details', async () => {
        const error = await service
          .submitGuestResponse(
            publishedInternalId,
            {
              answers: { q1: 'Alice', injected: 'x' },
              captchaToken: 'test-turnstile-token',
            },
            '10.2.0.1',
          )
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(InvalidGuestSubmissionException);
        expect((error as InvalidGuestSubmissionException).details).toEqual({
          injected: expect.stringContaining('Unrecognized block ID'),
        });
      });

      it('rejects duplicate block answers', async () => {
        const error = await service
          .submitGuestResponse(
            publishedInternalId,
            {
              answers: [
                { blockId: 'q1', value: 'Alice' },
                { blockId: 'q1', value: 'Bob' },
              ] as unknown as Record<string, unknown>,
              captchaToken: 'test-turnstile-token',
            },
            '10.2.0.2',
          )
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(InvalidGuestSubmissionException);
        expect((error as InvalidGuestSubmissionException).details?.q1).toMatch(
          /Duplicate block ID/,
        );
      });

      it('rejects a numeric string for a number block (no coercion)', async () => {
        await expect(
          service.submitGuestResponse(
            publishedInternalId,
            {
              answers: { q1: 'Alice', q2: '9' },
              captchaToken: 'test-turnstile-token',
            },
            '10.2.0.3',
          ),
        ).rejects.toThrow(InvalidGuestSubmissionException);
      });
    });

    describe('Bug 3.3: rate-limit slot', () => {
      it('acquires the slot before any form lookup or write', async () => {
        const acquire = jest.spyOn(rateLimiter, 'tryAcquire');
        const findById = jest.spyOn(formRepo, 'findById');
        const create = jest.spyOn(
          responseRepo,
          'createGuestResponseWithinQuota',
        );

        await service.submitGuestResponse(
          publishedInternalId,
          validPayload,
          '10.3.0.1',
        );

        expect(acquire).toHaveBeenCalledWith('10.3.0.1');
        expect(acquire.mock.invocationCallOrder[0]).toBeLessThan(
          findById.mock.invocationCallOrder[0],
        );
        expect(acquire.mock.invocationCallOrder[0]).toBeLessThan(
          create.mock.invocationCallOrder[0],
        );
      });

      it('does no database work once the IP is limited', async () => {
        const ip = '10.3.0.2';
        for (let i = 0; i < 3; i++) {
          await service.submitGuestResponse(
            publishedInternalId,
            validPayload,
            ip,
          );
        }
        const findById = jest.spyOn(formRepo, 'findById');
        const create = jest.spyOn(
          responseRepo,
          'createGuestResponseWithinQuota',
        );

        await expect(
          service.submitGuestResponse(publishedInternalId, validPayload, ip),
        ).rejects.toThrow(GuestRateLimitExceededException);
        expect(findById).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
      });

      it('keeps the slot on client errors (invalid answers)', async () => {
        const ip = '10.3.0.3';
        for (let i = 0; i < 3; i++) {
          await expect(
            service.submitGuestResponse(
              publishedInternalId,
              { answers: { q2: 1 }, captchaToken: 'test-turnstile-token' },
              ip,
            ),
          ).rejects.toThrow(InvalidGuestSubmissionException);
        }

        await expect(
          service.submitGuestResponse(publishedInternalId, validPayload, ip),
        ).rejects.toThrow(GuestRateLimitExceededException);
      });

      it('keeps the slot on a rejected CAPTCHA token', async () => {
        const ip = '10.3.0.5';
        for (let i = 0; i < 3; i++) {
          await expect(
            service.submitGuestResponse(
              publishedInternalId,
              { ...validPayload, captchaToken: 'invalid-captcha-token' },
              ip,
            ),
          ).rejects.toThrow(CaptchaVerificationFailedException);
        }

        await expect(
          service.submitGuestResponse(publishedInternalId, validPayload, ip),
        ).rejects.toThrow(GuestRateLimitExceededException);
      });

      it('gives the slot back when no CAPTCHA provider is configured (review F6)', async () => {
        const productionService = new PublicFormsService(
          formRepo,
          responseRepo,
          new CaptchaValidatorService({ isProduction: true }),
          rateLimiter,
        );
        const ip = '10.3.0.6';
        for (let i = 0; i < 4; i++) {
          await expect(
            productionService.submitGuestResponse(
              publishedInternalId,
              validPayload,
              ip,
            ),
          ).rejects.toThrow('CAPTCHA_PROVIDER_NOT_CONFIGURED');
        }

        // Once the server is fixed, the guest still has all three slots.
        await expect(
          service.submitGuestResponse(publishedInternalId, validPayload, ip),
        ).resolves.toMatchObject({ status: 'SUBMITTED' });
        expect(rateLimiter.tryAcquire(ip)).toBe(true);
        expect(rateLimiter.tryAcquire(ip)).toBe(true);
        expect(rateLimiter.tryAcquire(ip)).toBe(false);
      });

      it('gives the slot back on an unexpected failure', async () => {
        const ip = '10.3.0.4';
        jest
          .spyOn(responseRepo, 'createGuestResponseWithinQuota')
          .mockRejectedValueOnce(new Error('connection lost'))
          .mockRejectedValueOnce(new Error('connection lost'))
          .mockRejectedValueOnce(new Error('connection lost'));
        for (let i = 0; i < 3; i++) {
          await expect(
            service.submitGuestResponse(publishedInternalId, validPayload, ip),
          ).rejects.toThrow('connection lost');
        }

        await expect(
          service.submitGuestResponse(publishedInternalId, validPayload, ip),
        ).resolves.toMatchObject({ status: 'SUBMITTED' });
      });
    });
  });
});
