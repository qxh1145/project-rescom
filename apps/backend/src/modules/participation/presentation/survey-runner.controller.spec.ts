import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  HTTP_CODE_METADATA,
} from '@nestjs/common/constants';
import {
  ATTEMPT_NOT_FOUND_CODE,
  ATTEMPT_NOT_IN_PROGRESS_CODE,
  INTEGRITY_CONSENT_VERSION_MISMATCH_CODE,
  SURVEY_NOT_FOUND_CODE,
  attemptNotInProgressDetailsSchema,
} from '@rescom/schemas';
import { SurveyRunnerController } from './survey-runner.controller';
import { SurveyRunnerReadService } from '../application/survey-runner-read.service';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { HttpExceptionFilter } from '../../../common/http/http-exception.filter';
import { IS_PUBLIC_KEY } from '../../../common/security/public.decorator';
import {
  AttemptNotFoundException,
  AttemptNotInProgressException,
  SurveyNotFoundException,
} from '../application/exceptions/participation.exceptions';
import { IntegrityConsentVersionMismatchException } from '../application/exceptions/integrity-consent.exceptions';

describe('Story IR.2a: SurveyRunnerController', () => {
  let service: jest.Mocked<
    Pick<
      SurveyRunnerReadService,
      | 'getSurveySummary'
      | 'getAttemptDetails'
      | 'getAttemptOutcome'
      | 'cancelAttempt'
    >
  >;
  let controller: SurveyRunnerController;

  const user = { id: '11111111-1111-4111-8111-111111111111' } as any;
  const attemptId = '22222222-2222-4222-8222-222222222222';
  const proto = SurveyRunnerController.prototype;

  beforeEach(() => {
    service = {
      getSurveySummary: jest.fn(),
      getAttemptDetails: jest.fn(),
      getAttemptOutcome: jest.fn(),
      cancelAttempt: jest.fn(),
    };
    controller = new SurveyRunnerController(
      service as unknown as SurveyRunnerReadService,
    );
  });

  it('requires a session on the class and opens only the survey summary', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SurveyRunnerController),
    ).toEqual([SessionAuthGuard]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.getSurveySummary)).toBe(
      true,
    );
    for (const handler of [
      proto.getAttempt,
      proto.getAttemptOutcome,
      proto.cancelAttempt,
    ]) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
    }
  });

  it('marks the per-user attempt reads Cache-Control: no-store', () => {
    for (const handler of [proto.getAttempt, proto.getAttemptOutcome]) {
      expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toEqual([
        { name: 'Cache-Control', value: 'no-store' },
      ]);
    }
    expect(
      Reflect.getMetadata(HEADERS_METADATA, proto.getSurveySummary),
    ).toBeUndefined();
  });

  it('guards the cancel with CSRF + JSON-only and answers 200', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.cancelAttempt)).toEqual([
      CsrfGuard,
      JsonOnlyGuard,
    ]);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.cancelAttempt)).toBe(
      HttpStatus.OK,
    );
  });

  it('wraps every read in the success envelope', async () => {
    service.getSurveySummary.mockResolvedValue({ id: 's' } as any);
    service.getAttemptDetails.mockResolvedValue({ attemptId } as any);
    service.getAttemptOutcome.mockResolvedValue({ attemptId } as any);

    await expect(controller.getSurveySummary('s')).resolves.toEqual({
      data: { id: 's' },
      error: null,
      meta: {},
    });
    await expect(controller.getAttempt(attemptId, user)).resolves.toEqual({
      data: { attemptId },
      error: null,
      meta: {},
    });
    await expect(
      controller.getAttemptOutcome(attemptId, user),
    ).resolves.toMatchObject({ data: { attemptId } });
    expect(service.getAttemptDetails).toHaveBeenCalledWith(attemptId, user.id);
    expect(service.getAttemptOutcome).toHaveBeenCalledWith(attemptId, user.id);
  });

  it('cancels on behalf of the caller with a valid Idempotency-Key', async () => {
    const cancelled = {
      attemptId,
      status: 'ABANDONED' as const,
      closedReason: 'CANCELLED' as const,
      closedAt: '2026-10-01T08:00:00.000Z',
    };
    service.cancelAttempt.mockResolvedValue(cancelled);

    await expect(
      controller.cancelAttempt(attemptId, user, {}, 'cancel-3f2a9c1b'),
    ).resolves.toEqual({ data: cancelled, error: null, meta: {} });
    expect(service.cancelAttempt).toHaveBeenCalledWith(attemptId, user.id);
  });

  it.each([
    ['missing', undefined],
    ['too short', 'abc'],
    ['illegal characters', 'cancel key with spaces'],
    ['too long', 'k'.repeat(129)],
  ])(
    'refuses a %s Idempotency-Key with 400 INVALID_IDEMPOTENCY_KEY',
    async (_label, key) => {
      const error = await controller
        .cancelAttempt(attemptId, user, {}, key)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'INVALID_IDEMPOTENCY_KEY',
      });
      expect(service.cancelAttempt).not.toHaveBeenCalled();
    },
  );
});

describe('Story IR.2a: HttpExceptionFilter mappings', () => {
  function capture(exception: unknown) {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({}),
      }),
    } as unknown as ArgumentsHost;
    new HttpExceptionFilter().catch(exception, host);
    return {
      status: response.status.mock.calls[0][0],
      body: response.json.mock.calls[0][0],
    };
  }

  it('maps SURVEY_NOT_FOUND and ATTEMPT_NOT_FOUND to 404', () => {
    expect(capture(new SurveyNotFoundException())).toEqual({
      status: HttpStatus.NOT_FOUND,
      body: {
        data: null,
        error: { code: SURVEY_NOT_FOUND_CODE, message: 'Survey not found.' },
        meta: {},
      },
    });
    expect(capture(new AttemptNotFoundException())).toMatchObject({
      status: HttpStatus.NOT_FOUND,
      body: { error: { code: ATTEMPT_NOT_FOUND_CODE } },
    });
  });

  it('maps ATTEMPT_NOT_IN_PROGRESS to 409 with its details', () => {
    const details = {
      status: 'IN_PROGRESS' as const,
      closedReason: 'EXPIRED' as const,
    };
    const { status, body } = capture(
      new AttemptNotInProgressException(details),
    );

    expect(status).toBe(HttpStatus.CONFLICT);
    expect(body.error.code).toBe(ATTEMPT_NOT_IN_PROGRESS_CODE);
    expect(body.error.details).toEqual(details);
    expect(
      attemptNotInProgressDetailsSchema.safeParse(body.error.details).success,
    ).toBe(true);
  });

  it('maps INTEGRITY_CONSENT_VERSION_MISMATCH to 409 with the current version', () => {
    expect(
      capture(new IntegrityConsentVersionMismatchException(2)),
    ).toMatchObject({
      status: HttpStatus.CONFLICT,
      body: {
        error: {
          code: INTEGRITY_CONSENT_VERSION_MISMATCH_CODE,
          details: { currentVersion: 2 },
        },
      },
    });
  });
});
