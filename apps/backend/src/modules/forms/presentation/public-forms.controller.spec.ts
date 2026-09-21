import { PublicFormsController } from './public-forms.controller';
import { PublicFormsService } from '../application/public-forms.service';
import { InMemoryFormRepository } from '../infrastructure/in-memory-form.repository';
import { InMemorySurveyResponseRepository } from '../../marketplace/infrastructure/in-memory-survey-response.repository';
import { CaptchaValidatorService } from '../infrastructure/captcha-validator.service';
import { GuestSubmissionRateLimiter } from '../infrastructure/guest-submission-rate-limiter';
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';

describe('PublicFormsController', () => {
  let controller: PublicFormsController;
  let service: PublicFormsService;
  let formRepo: InMemoryFormRepository;
  let responseRepo: InMemorySurveyResponseRepository;
  let captchaValidator: CaptchaValidatorService;
  let rateLimiter: GuestSubmissionRateLimiter;

  const formId = '11111111-1111-4111-8111-111111111111';
  const publisherId = '22222222-2222-4222-8222-222222222222';

  beforeEach(async () => {
    formRepo = new InMemoryFormRepository();
    responseRepo = new InMemorySurveyResponseRepository();
    captchaValidator = new CaptchaValidatorService({ isTest: true });
    rateLimiter = new GuestSubmissionRateLimiter();

    service = new PublicFormsService(
      formRepo,
      responseRepo,
      captchaValidator,
      rateLimiter,
    );
    controller = new PublicFormsController(service);

    const now = new Date();
    const form = new FormEntity(
      formId,
      publisherId,
      'INTERNAL',
      'PUBLISHED',
      'Public Poll',
      'Survey description',
      0,
      100,
      now,
      now,
    );
    const version = new FormVersionEntity(
      'v1',
      formId,
      1,
      {
        blocks: [
          {
            id: 'q1',
            type: 'text',
            title: 'Your City',
            required: true,
            order: 0,
          },
        ],
        settings: {
          allowPublicAccess: true,
          requireAuth: false,
        },
      } as any,
      null,
      true,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(form, version);
  });

  it('should return public form wrapped in success envelope', async () => {
    const envelope = await controller.getPublicForm(formId);
    expect(envelope.error).toBeNull();
    expect(envelope.data).toBeDefined();
    expect(envelope.data!.id).toBe(formId);
    expect(envelope.data!.title).toBe('Public Poll');
  });

  it('should process guest submission and return envelope', async () => {
    const mockReq: any = {
      headers: { 'x-forwarded-for': '127.0.0.1' },
      ip: '127.0.0.1',
    };

    const envelope = await controller.submitGuestResponse(
      formId,
      {
        answers: { q1: 'Hanoi' },
        captchaToken: 'test-turnstile-token',
      },
      mockReq,
    );

    expect(envelope.error).toBeNull();
    expect(envelope.data).toBeDefined();
    expect(envelope.data!.status).toBe('SUBMITTED');
    expect(envelope.data!.isGuest).toBe(true);
    expect(envelope.data!.rewardEarned).toBe(0);
    expect(envelope.data!.respondentReliability).toBe('NOT_AVAILABLE');
  });
});
