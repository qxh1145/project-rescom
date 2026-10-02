import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { HttpExceptionFilter } from './http-exception.filter';
import {
  ConcurrentLedgerCommandException,
  DownstreamJournalExistsException,
  PendingCreditNotFoundException,
  PendingRewardForbiddenException,
  PendingRewardNotMaturedException,
  InvalidTopUpRequestException,
  TopUpAdminCapabilityRequiredException,
  TopUpAlreadyReviewedException,
  TopUpPendingLimitExceededException,
  TopUpReferenceConflictException,
  TopUpRequestNotFoundException,
  TopUpSelfReviewForbiddenException,
} from '../../modules/economy/application/exceptions/economy.exceptions';
import {
  FormNotInModerationQueueException,
  InvalidModerationRequestException,
  ModerationAdminCapabilityRequiredException,
  ModerationAlreadyDecidedException,
  ModerationSelfReviewForbiddenException,
  ModerationVersionMismatchException,
} from '../../modules/moderation/application/exceptions/moderation.exceptions';
import {
  FormInModerationException,
  FormModerationRequiredException,
  FormNotReopenableException,
  FormPublishedFieldsImmutableException,
  ModerationEscrowNotFundedException,
  PricingRewardOutOfBandException,
} from '../../modules/forms/application/exceptions/form.exceptions';
import { DemographicProfileRequiredException } from '../../modules/users/application/exceptions/demographics.exceptions';
import {
  ParticipationRateLimitedException,
  RewardNotSettleableException,
  SubmissionTooFastException,
  SurveyRewardUnavailableException,
  ConflictingActiveAttemptException,
  TelemetryRejectedException,
  SelfParticipationForbiddenException,
  SurveyNotFoundException,
  AttemptNotFoundException,
  AttemptNotInProgressException,
} from '../../modules/participation/application/exceptions/participation.exceptions';
import {
  SurveyFeedbackAlreadySubmittedException,
  SurveyFeedbackAttemptNotFoundException,
  SurveyFeedbackNotAllowedException,
} from '../../modules/participation/application/exceptions/survey-feedback.exceptions';

describe('HttpExceptionFilter (Unit Tests)', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  function createMockHost(mockResponse: any): ArgumentsHost {
    return {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => ({}),
      }),
    } as any;
  }

  it('should map ThrottlerException to HTTP 429 with standard RATE_LIMIT_EXCEEDED envelope', () => {
    const mockJson = jest.fn();
    const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    const mockResponse = {
      status: mockStatus,
      headersSent: false,
    };

    const host = createMockHost(mockResponse);
    const exception = new ThrottlerException(
      'Too many requests. Please try again later.',
    );

    filter.catch(exception, host);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(mockJson).toHaveBeenCalledWith({
      data: null,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
      },
      meta: {},
    });
  });

  it('should do nothing if response.headersSent is true', () => {
    const mockJson = jest.fn();
    const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    const mockResponse = {
      status: mockStatus,
      headersSent: true,
    };

    const host = createMockHost(mockResponse);
    const exception = new ThrottlerException('Blocked');

    filter.catch(exception, host);

    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockJson).not.toHaveBeenCalled();
  });

  it.each([
    [
      new InvalidTopUpRequestException(),
      HttpStatus.BAD_REQUEST,
      'TOPUP_INVALID_REQUEST',
    ],
    [
      new TopUpRequestNotFoundException('33333333-3333-4333-8333-333333333333'),
      HttpStatus.NOT_FOUND,
      'TOPUP_NOT_FOUND',
    ],
    [
      new TopUpAdminCapabilityRequiredException(),
      HttpStatus.FORBIDDEN,
      'TOPUP_ADMIN_CAPABILITY_REQUIRED',
    ],
    [
      new TopUpSelfReviewForbiddenException(),
      HttpStatus.FORBIDDEN,
      'TOPUP_SELF_REVIEW_FORBIDDEN',
    ],
    [
      new TopUpAlreadyReviewedException(
        '33333333-3333-4333-8333-333333333333',
        'REJECTED',
      ),
      HttpStatus.CONFLICT,
      'TOPUP_ALREADY_REVIEWED',
    ],
    [
      new TopUpPendingLimitExceededException(3),
      HttpStatus.CONFLICT,
      'TOPUP_PENDING_LIMIT_REACHED',
    ],
    [
      new TopUpReferenceConflictException(),
      HttpStatus.CONFLICT,
      'TOPUP_REFERENCE_CONFLICT',
    ],
  ])(
    'maps Story 6.6 top-up exception %# to its HTTP status and code',
    (exception, expectedStatus, expectedCode) => {
      const mockJson = jest.fn();
      const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
      filter.catch(
        exception,
        createMockHost({ status: mockStatus, headersSent: false }),
      );

      expect(mockStatus).toHaveBeenCalledWith(expectedStatus);
      expect(mockJson.mock.calls[0][0].error.code).toBe(expectedCode);
    },
  );

  it.each([
    [
      new ConcurrentLedgerCommandException('publish:v1'),
      HttpStatus.CONFLICT,
      'LEDGER_COMMAND_IN_PROGRESS',
    ],
    [
      new DownstreamJournalExistsException(
        'external-completion:33333333-3333-4333-8333-333333333333',
        'release-pending:33333333-3333-4333-8333-333333333333',
      ),
      HttpStatus.CONFLICT,
      'LEDGER_DOWNSTREAM_JOURNAL_EXISTS',
    ],
    [
      new PendingCreditNotFoundException(
        '33333333-3333-4333-8333-333333333333',
      ),
      HttpStatus.NOT_FOUND,
      'PENDING_CREDIT_NOT_FOUND',
    ],
    [
      new PendingRewardForbiddenException(),
      HttpStatus.FORBIDDEN,
      'PENDING_REWARD_FORBIDDEN',
    ],
    [
      new SurveyRewardUnavailableException(),
      HttpStatus.CONFLICT,
      'SURVEY_REWARD_UNAVAILABLE',
    ],
    [
      new RewardNotSettleableException(),
      HttpStatus.CONFLICT,
      'REWARD_NOT_SETTLEABLE',
    ],
  ])(
    'maps Epic 6 review exception %# to its HTTP status and code',
    (exception, expectedStatus, expectedCode) => {
      const mockJson = jest.fn();
      const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
      filter.catch(
        exception,
        createMockHost({ status: mockStatus, headersSent: false }),
      );

      expect(mockStatus).toHaveBeenCalledWith(expectedStatus);
      const body = mockJson.mock.calls[0][0];
      expect(body.error.code).toBe(expectedCode);
      // No Publisher balances leak into these responses (P11).
      expect(body.error.details).toBeUndefined();
    },
  );

  it('maps PENDING_REWARD_NOT_MATURED to 409 with the maturity time (Epic 6 review P2)', () => {
    const mockJson = jest.fn();
    const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    const maturesAt = new Date('2026-09-28T10:00:00.000Z');
    filter.catch(
      new PendingRewardNotMaturedException(
        '33333333-3333-4333-8333-333333333333',
        maturesAt,
      ),
      createMockHost({ status: mockStatus, headersSent: false }),
    );

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    const body = mockJson.mock.calls[0][0];
    expect(body.error.code).toBe('PENDING_REWARD_NOT_MATURED');
    expect(body.error.details).toEqual({ maturesAt: maturesAt.toISOString() });
  });

  it.each([
    [
      new InvalidModerationRequestException('bad'),
      HttpStatus.BAD_REQUEST,
      'MODERATION_INVALID_REQUEST',
    ],
    [
      new ModerationAdminCapabilityRequiredException(),
      HttpStatus.FORBIDDEN,
      'MODERATION_ADMIN_CAPABILITY_REQUIRED',
    ],
    [
      new ModerationSelfReviewForbiddenException(),
      HttpStatus.FORBIDDEN,
      'MODERATION_SELF_REVIEW_FORBIDDEN',
    ],
    [
      new FormNotInModerationQueueException('f', 'PUBLISHED'),
      HttpStatus.CONFLICT,
      'FORM_NOT_IN_MODERATION_QUEUE',
    ],
    [
      new ModerationVersionMismatchException('f'),
      HttpStatus.CONFLICT,
      'MODERATION_VERSION_MISMATCH',
    ],
    [
      new ModerationAlreadyDecidedException('f', 'APPROVED'),
      HttpStatus.CONFLICT,
      'MODERATION_ALREADY_DECIDED',
    ],
    [
      new FormModerationRequiredException('f'),
      HttpStatus.CONFLICT,
      'FORM_MODERATION_REQUIRED',
    ],
    [
      new FormNotReopenableException('f'),
      HttpStatus.CONFLICT,
      'FORM_NOT_REOPENABLE',
    ],
    [
      new FormInModerationException('f'),
      HttpStatus.CONFLICT,
      'FORM_IN_MODERATION',
    ],
  ])(
    'maps Story 8.1 moderation exception %# to its HTTP status and code',
    (exception, expectedStatus, expectedCode) => {
      const mockJson = jest.fn();
      const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
      filter.catch(
        exception,
        createMockHost({ status: mockStatus, headersSent: false }),
      );

      expect(mockStatus).toHaveBeenCalledWith(expectedStatus);
      expect(mockJson.mock.calls[0][0].error.code).toBe(expectedCode);
    },
  );

  it('maps FORM_NOT_REOPENABLE to 409 with the reason and close kind (decision E8-D1)', () => {
    const mockJson = jest.fn();
    const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    filter.catch(
      new FormNotReopenableException('f', {
        reason: 'CLOSED_BY_ADMIN_OR_MODERATION',
        closeKind: 'ADMIN',
      }),
      createMockHost({ status: mockStatus, headersSent: false }),
    );

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    const body = mockJson.mock.calls[0][0];
    expect(body.error.code).toBe('FORM_NOT_REOPENABLE');
    expect(body.error.details).toEqual({
      reason: 'CLOSED_BY_ADMIN_OR_MODERATION',
      closeKind: 'ADMIN',
    });
  });

  it('maps FORM_PUBLISHED_FIELDS_IMMUTABLE to 409 with the frozen fields (decision D2)', () => {
    const mockJson = jest.fn();
    const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    filter.catch(
      new FormPublishedFieldsImmutableException('f', [
        'type',
        'rewardPerResponse',
      ]),
      createMockHost({ status: mockStatus, headersSent: false }),
    );

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    const body = mockJson.mock.calls[0][0];
    expect(body.error.code).toBe('FORM_PUBLISHED_FIELDS_IMMUTABLE');
    expect(body.error.details).toEqual({
      fields: ['type', 'rewardPerResponse'],
    });
  });

  it('maps MODERATION_ESCROW_NOT_FUNDED to 409 with the shortfall (Epic 8 review P2)', () => {
    const mockJson = jest.fn();
    const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    filter.catch(
      new ModerationEscrowNotFundedException('f', 250),
      createMockHost({ status: mockStatus, headersSent: false }),
    );

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    const body = mockJson.mock.calls[0][0];
    expect(body.error.code).toBe('MODERATION_ESCROW_NOT_FUNDED');
    expect(body.error.details).toEqual({ shortfall: 250 });
  });

  it('maps PRICING_REWARD_OUT_OF_BAND to 400 with the band { min, max, suggested } (decision E6-D2)', () => {
    const mockJson = jest.fn();
    const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    filter.catch(
      new PricingRewardOutOfBandException(
        50,
        { min: 15, max: 25, suggested: 15 },
        '10–15 min',
      ),
      createMockHost({ status: mockStatus, headersSent: false }),
    );

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const body = mockJson.mock.calls[0][0];
    expect(body.error.code).toBe('PRICING_REWARD_OUT_OF_BAND');
    expect(body.error.details).toEqual({ min: 15, max: 25, suggested: 15 });
    expect(body.error.message).toContain('15–25');
  });

  it.each([
    [
      new SurveyFeedbackAttemptNotFoundException(),
      HttpStatus.NOT_FOUND,
      'FEEDBACK_ATTEMPT_NOT_FOUND',
    ],
    [
      new SurveyFeedbackNotAllowedException(),
      HttpStatus.CONFLICT,
      'FEEDBACK_NOT_ALLOWED',
    ],
    [
      new SurveyFeedbackAlreadySubmittedException(),
      HttpStatus.CONFLICT,
      'FEEDBACK_ALREADY_SUBMITTED',
    ],
  ])(
    'maps Story 9.2 feedback exception %# to its HTTP status and code',
    (exception, expectedStatus, expectedCode) => {
      const mockJson = jest.fn();
      const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
      filter.catch(
        exception,
        createMockHost({ status: mockStatus, headersSent: false }),
      );

      expect(mockStatus).toHaveBeenCalledWith(expectedStatus);
      expect(mockJson.mock.calls[0][0].error.code).toBe(expectedCode);
      expect(mockJson.mock.calls[0][0].error.message).toBe(exception.message);
    },
  );

  it('maps SelfParticipationForbiddenException to 403 SELF_PARTICIPATION_FORBIDDEN (decision E4-DN2)', () => {
    const mockJson = jest.fn();
    const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    filter.catch(
      new SelfParticipationForbiddenException(),
      createMockHost({ status: mockStatus, headersSent: false }),
    );

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    const body = mockJson.mock.calls[0][0];
    expect(body.data).toBeNull();
    expect(body.error.code).toBe('SELF_PARTICIPATION_FORBIDDEN');
    expect(body.error.message).toMatch(/survey you published/);
  });

  it('maps DemographicProfileRequiredException to 403 with the missing fields (Story 7.1)', () => {
    const mockJson = jest.fn();
    const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    filter.catch(
      new DemographicProfileRequiredException([
        'occupation',
        'specificInterests',
      ]),
      createMockHost({ status: mockStatus, headersSent: false }),
    );

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    const body = mockJson.mock.calls[0][0];
    expect(body.data).toBeNull();
    expect(body.error.code).toBe('DEMOGRAPHIC_PROFILE_REQUIRED');
    expect(body.error.details).toEqual({
      missingFields: ['occupation', 'specificInterests'],
    });
  });

  describe('Story 8.2 bot protection', () => {
    function createResponse() {
      const json = jest.fn();
      const status = jest.fn().mockReturnValue({ json });
      const setHeader = jest.fn();
      return {
        response: { status, setHeader, headersSent: false },
        status,
        json,
        setHeader,
      };
    }

    it('maps SUBMISSION_TOO_FAST to 422 with structured details and Retry-After', () => {
      const { response, status, json, setHeader } = createResponse();
      const details = {
        requiredSeconds: 10,
        elapsedSeconds: 3,
        remainingSeconds: 7,
        retryAfterSeconds: 7,
        earliestSubmitAt: '2026-09-26T10:00:10.000Z',
        questionCount: 5,
        secondsPerQuestion: 2,
        publisherMinimumSeconds: 4,
        policyVersion: 'time-barrier-v1',
      };

      filter.catch(
        new SubmissionTooFastException('Too fast.', details),
        createMockHost(response),
      );

      expect(status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(setHeader).toHaveBeenCalledWith('Retry-After', '7');
      expect(json).toHaveBeenCalledWith({
        data: null,
        error: { code: 'SUBMISSION_TOO_FAST', message: 'Too fast.', details },
        meta: {},
      });
    });

    it('maps PARTICIPATION_RATE_LIMITED to 429 with details and Retry-After', () => {
      const { response, status, json, setHeader } = createResponse();
      const details = {
        scope: 'COMPLETIONS' as const,
        limit: 20,
        windowSeconds: 3600,
        retryAfterSeconds: 120,
        retryAt: '2026-09-26T12:02:00.000Z',
        policyVersion: 'participation-rate-limit-v1',
      };

      filter.catch(
        new ParticipationRateLimitedException(details),
        createMockHost(response),
      );

      expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
      expect(setHeader).toHaveBeenCalledWith('Retry-After', '120');
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'PARTICIPATION_RATE_LIMITED',
            details,
          }),
        }),
      );
    });

    it('keeps a detail-less SUBMISSION_TOO_FAST response without Retry-After', () => {
      const { response, status, setHeader } = createResponse();

      filter.catch(new SubmissionTooFastException(), createMockHost(response));

      expect(status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(setHeader).not.toHaveBeenCalled();
    });
  });

  describe('Epic 5 review', () => {
    function createResponse() {
      const json = jest.fn();
      const status = jest.fn().mockReturnValue({ json });
      return {
        response: { status, setHeader: jest.fn(), headersSent: false },
        status,
        json,
      };
    }

    it('maps CONFLICTING_ACTIVE_ATTEMPT to 409 with the caller-owned attempt details (P24)', () => {
      const { response, status, json } = createResponse();
      const details = {
        attemptId: '11111111-1111-4111-8111-111111111111',
        responseId: null,
        formVersionId: '22222222-2222-4222-8222-222222222222',
        type: 'EXTERNAL' as const,
        expiresAt: '2026-09-26T12:30:00.000Z',
      };

      filter.catch(
        new ConflictingActiveAttemptException(undefined, details),
        createMockHost(response),
      );

      expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'CONFLICTING_ACTIVE_ATTEMPT',
            details,
          }),
        }),
      );
    });

    it('maps TELEMETRY_REJECTED to 400 (P8/P14)', () => {
      const { response, status, json } = createResponse();

      filter.catch(new TelemetryRejectedException(), createMockHost(response));

      expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'TELEMETRY_REJECTED' }),
        }),
      );
    });

    it.each([
      [new SurveyNotFoundException(), 'SURVEY_NOT_FOUND'],
      [new AttemptNotFoundException(), 'ATTEMPT_NOT_FOUND'],
    ])('maps %p to 404 (IR.2a)', (exception, code) => {
      const { response, status, json } = createResponse();

      filter.catch(exception, createMockHost(response));

      expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code }),
        }),
      );
    });

    it('maps ATTEMPT_NOT_IN_PROGRESS to 409 with its details (IR.2a)', () => {
      const { response, status, json } = createResponse();
      const details = {
        status: 'ABANDONED',
        closedReason: 'CANCELLED',
      } as const;

      filter.catch(
        new AttemptNotInProgressException(details),
        createMockHost(response),
      );

      expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'ATTEMPT_NOT_IN_PROGRESS',
            details,
          }),
        }),
      );
    });
  });
});
