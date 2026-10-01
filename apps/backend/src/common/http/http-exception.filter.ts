import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { createErrorEnvelope } from './response.envelope';
import {
  EmailAlreadyRegisteredException,
  InvalidCredentialsException,
  UnauthorizedSessionException,
  SessionExpiredException,
  SessionRevokedException,
  InvalidRefreshTokenException,
  InvalidTokenException,
  InvalidCsrfTokenException,
  ForbiddenOriginException,
  UserLockedException,
  OAuthIntentInvalidException,
  GoogleAuthCancelledException,
  GoogleProviderUnavailableException,
  InvalidGoogleIdentityException,
  GoogleLinkRequiredException,
  FinalLoginMethodException,
  GoogleIdentityConflictException,
  ForbiddenResourceException,
  PasswordResetTokenInvalidException,
} from '../../modules/auth/application/exceptions/auth.exceptions';
import {
  UserNotFoundException,
  CannotLockSelfException,
  CannotLockLastAdminException,
  CannotDemoteSelfException,
  CannotDemoteLastAdminException,
  UserAdminActorNotActiveAdminException,
} from '../../modules/users/application/exceptions/user-admin.exceptions';
import { DemographicProfileRequiredException } from '../../modules/users/application/exceptions/demographics.exceptions';
import { UserProfileValidationException } from '../../modules/users/application/exceptions/user-profile.exceptions';
import {
  AuditLogNotFoundException,
  ImmutableAuditLogException,
} from '../../modules/admin/application/exceptions/audit-log.exceptions';
import {
  FormNotFoundException,
  FormForbiddenException,
  FormNotInDraftStatusException,
  InvalidFormDraftException,
  InvalidFormStatusTransitionException,
  FormValidationException,
  FormAlreadyPublishedException,
  FormAlreadyClosedException,
  FormNotPublishedException,
  FormConflictException,
  TargetingValidationException,
  FormHasPublishedVersionsException,
  PublicFormAccessDisabledException,
  CaptchaVerificationFailedException,
  GuestRateLimitExceededException,
  InvalidGuestSubmissionException,
  FormModerationRequiredException,
  ModerationEscrowNotFundedException,
  FormNotReopenableException,
  PricingRewardOutOfBandException,
  FormPublishedFieldsImmutableException,
  FormInModerationException,
  IdempotencyKeyConflictException,
  FormVersionNotFoundException,
  InvalidResultsCursorException,
  PublisherAnalyticsLimitExceededException,
} from '../../modules/forms/application/exceptions/form.exceptions';
import {
  ParticipantNotEligibleException,
  SelfParticipationForbiddenException,
  SurveyAlreadyCompletedException,
  SurveyQuotaFullException,
  ConflictingActiveAttemptException,
  SurveyNotAvailableException,
  ResponseNotFoundException,
  AttemptExpiredException,
  InvalidFormSubmissionException,
  SubmissionTooFastException,
  ParticipationRateLimitedException,
  UncleanAttachmentException,
  TelemetryRejectedException,
  InvalidCompletionCodeException,
  AttemptLockedException,
  CompletionCodeLimitReachedException,
  AttemptNotExternalException,
  SurveyRewardUnavailableException,
  RewardNotSettleableException,
  SurveyNotFoundException,
  AttemptNotFoundException,
  AttemptNotInProgressException,
} from '../../modules/participation/application/exceptions/participation.exceptions';
import { IntegrityConsentVersionMismatchException } from '../../modules/participation/application/exceptions/integrity-consent.exceptions';
import {
  SurveyFeedbackAlreadySubmittedException,
  SurveyFeedbackAttemptNotFoundException,
  SurveyFeedbackNotAllowedException,
} from '../../modules/participation/application/exceptions/survey-feedback.exceptions';
import {
  StorageObjectNotFoundException,
  StorageInvalidFileException,
  StorageObjectNotCleanException,
  StorageUnauthorizedAccessException,
  StorageScannerOutageException,
  StorageQuestionFullException,
} from '../../modules/storage/application/exceptions/storage.exceptions';
import {
  UnbalancedJournalException,
  InsufficientBalanceException,
  InsufficientEscrowBalanceException,
  AccountNotFoundException,
  JournalNotFoundException,
  JournalAlreadyReversedException,
  IdempotencyConflictException,
  InvalidLedgerOperationException,
  DisputeHoldActiveException,
  DownstreamJournalExistsException,
  ConcurrentLedgerCommandException,
  PendingCreditNotFoundException,
  PendingRewardNotMaturedException,
  PendingRewardForbiddenException,
  InvalidTopUpRequestException,
  TopUpRequestNotFoundException,
  TopUpAlreadyReviewedException,
  TopUpPendingLimitExceededException,
  TopUpReferenceConflictException,
  TopUpAdminCapabilityRequiredException,
  TopUpSelfReviewForbiddenException,
} from '../../modules/economy/application/exceptions/economy.exceptions';
import { NotificationNotFoundException } from '../../modules/notifications/application/exceptions/notification.exceptions';
import {
  FormNotInModerationQueueException,
  InvalidModerationRequestException,
  ModerationAdminCapabilityRequiredException,
  ModerationAlreadyDecidedException,
  ModerationSelfReviewForbiddenException,
  ModerationVersionMismatchException,
} from '../../modules/moderation/application/exceptions/moderation.exceptions';
import { ThrottlerException } from '@nestjs/throttler';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (response && response.headersSent) {
      return;
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred.';
    let details: any = undefined;
    let retryAfterSeconds: number | undefined = undefined;

    if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      code = 'RATE_LIMIT_EXCEEDED';
      message = 'Too many requests. Please try again later.';
    } else if (exception instanceof EmailAlreadyRegisteredException) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof InvalidCredentialsException) {
      status = HttpStatus.UNAUTHORIZED;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof PasswordResetTokenInvalidException) {
      // Plan 5.4: unknown, malformed, expired and used tokens look the same.
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
    } else if (
      exception instanceof UnauthorizedSessionException ||
      exception instanceof SessionExpiredException ||
      exception instanceof SessionRevokedException ||
      exception instanceof InvalidRefreshTokenException ||
      exception instanceof InvalidTokenException
    ) {
      status = HttpStatus.UNAUTHORIZED;
      code = exception.code;
      message = exception.message;
    } else if (
      exception instanceof InvalidCsrfTokenException ||
      exception instanceof ForbiddenOriginException ||
      exception instanceof UserLockedException ||
      exception instanceof ForbiddenResourceException ||
      exception instanceof FormForbiddenException
    ) {
      status = HttpStatus.FORBIDDEN;
      code = exception.code;
      message = exception.message;
    } else if (
      exception instanceof UserNotFoundException ||
      exception instanceof AuditLogNotFoundException ||
      exception instanceof FormNotFoundException ||
      exception instanceof NotificationNotFoundException ||
      exception instanceof FormVersionNotFoundException
    ) {
      status = HttpStatus.NOT_FOUND;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof InvalidResultsCursorException) {
      // Story IR.4a: malformed responses cursor, or one of another version.
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof PublisherAnalyticsLimitExceededException) {
      // Story IR.4a AC4 (NFR-30): bounded analytics scan.
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = exception.code;
      message = exception.message;
      details = {
        totalResponses: exception.totalResponses,
        limit: exception.limit,
      };
    } else if (
      exception instanceof FormNotInDraftStatusException ||
      exception instanceof FormAlreadyPublishedException ||
      exception instanceof FormAlreadyClosedException ||
      exception instanceof FormNotPublishedException ||
      exception instanceof FormHasPublishedVersionsException ||
      exception instanceof FormModerationRequiredException ||
      exception instanceof FormInModerationException
    ) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof FormPublishedFieldsImmutableException) {
      // Decision D2: pricing is frozen after the first publication.
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
      details = { fields: exception.fields };
    } else if (exception instanceof FormNotReopenableException) {
      // Story 8.1 / decision E8-D1: why the survey cannot be reopened (an
      // Admin takedown or moderation rejection is final; an unapproved
      // version never goes live) and who closed it.
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
      details = { reason: exception.reason, closeKind: exception.closeKind };
    } else if (exception instanceof IdempotencyKeyConflictException) {
      // Phase 5 C6: an Idempotency-Key reused for another request body, or
      // for a survey that changed since it was created.
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
      details = { reason: exception.reason, formId: exception.formId };
    } else if (exception instanceof ModerationEscrowNotFundedException) {
      // Epic 8 review P2: queue entry / approval of an unfunded survey.
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
      details = { shortfall: exception.shortfall };
    } else if (exception instanceof PricingRewardOutOfBandException) {
      // Decision E6-D2: FR-14 pricing band enforced at publish.
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
      details = {
        min: exception.band.min,
        max: exception.band.max,
        suggested: exception.band.suggested,
      };
    } else if (
      exception instanceof InvalidFormDraftException ||
      exception instanceof InvalidFormStatusTransitionException
    ) {
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof FormValidationException) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = exception.code;
      message = exception.message;
      details = exception.errors;
    } else if (exception instanceof TargetingValidationException) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = exception.code;
      message = exception.message;
      details = exception.issues;
    } else if (exception instanceof FormConflictException) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof PublicFormAccessDisabledException) {
      status = HttpStatus.FORBIDDEN;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof CaptchaVerificationFailedException) {
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof GuestRateLimitExceededException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof InvalidGuestSubmissionException) {
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof DemographicProfileRequiredException) {
      // Story 7.1: earning features require the Mandatory Demographic Survey.
      status = HttpStatus.FORBIDDEN;
      code = exception.code;
      message = exception.message;
      details = { missingFields: exception.missingFields };
    } else if (exception instanceof UserProfileValidationException) {
      // Story IR.4b part A: same answer as `ZodValidationPipe`.
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (
      exception instanceof ParticipantNotEligibleException ||
      exception instanceof SelfParticipationForbiddenException
    ) {
      // Decision E4-DN2: a Publisher cannot take their own survey (403).
      status = HttpStatus.FORBIDDEN;
      code = exception.code;
      message = exception.message;
    } else if (
      exception instanceof SurveyAlreadyCompletedException ||
      exception instanceof SurveyQuotaFullException
    ) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof ConflictingActiveAttemptException) {
      // Epic 5 review P24: the caller's own attempt, to resume it.
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (
      exception instanceof SurveyNotAvailableException ||
      exception instanceof ResponseNotFoundException
    ) {
      status = HttpStatus.NOT_FOUND;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof AttemptExpiredException) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof InvalidFormSubmissionException) {
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
      details = exception.validationErrors;
    } else if (exception instanceof SubmissionTooFastException) {
      // Story 8.2: structured countdown data; the attempt was not consumed.
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = exception.code;
      message = exception.message;
      details = exception.details;
      retryAfterSeconds = exception.retryAfterSeconds;
    } else if (exception instanceof ParticipationRateLimitedException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      code = exception.code;
      message = exception.message;
      details = exception.details;
      retryAfterSeconds = exception.retryAfterSeconds;
    } else if (exception instanceof UncleanAttachmentException) {
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof InvalidCompletionCodeException) {
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
      details = { remainingAttempts: exception.remainingAttempts };
    } else if (exception instanceof AttemptLockedException) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof CompletionCodeLimitReachedException) {
      // Decision E5-D1: account+FormVersion completion-code limit.
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (
      exception instanceof AttemptNotExternalException ||
      exception instanceof TelemetryRejectedException
    ) {
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
    } else if (
      // Epic 6 review P1/P11: no Publisher balances in Respondent errors.
      exception instanceof SurveyRewardUnavailableException ||
      exception instanceof RewardNotSettleableException
    ) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof SurveyFeedbackAttemptNotFoundException) {
      // Story 9.2: unknown, guest and other users' attempts look the same.
      status = HttpStatus.NOT_FOUND;
      code = exception.code;
      message = exception.message;
    } else if (
      exception instanceof SurveyFeedbackNotAllowedException ||
      exception instanceof SurveyFeedbackAlreadySubmittedException
    ) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
    } else if (
      // Story IR.2a: unpublished surveys and other users' attempts are 404s
      // that reveal nothing.
      exception instanceof SurveyNotFoundException ||
      exception instanceof AttemptNotFoundException
    ) {
      status = HttpStatus.NOT_FOUND;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof AttemptNotInProgressException) {
      // Story IR.2a: the attempt's status and why it closed.
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof IntegrityConsentVersionMismatchException) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
      details = { currentVersion: exception.currentVersion };
    } else if (exception instanceof StorageObjectNotFoundException) {
      status = HttpStatus.NOT_FOUND;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof StorageInvalidFileException) {
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
    } else if (
      exception instanceof StorageObjectNotCleanException ||
      exception instanceof StorageUnauthorizedAccessException
    ) {
      status = HttpStatus.FORBIDDEN;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof StorageQuestionFullException) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
      details = {
        questionId: exception.questionId,
        maxFiles: exception.maxFiles,
      };
    } else if (exception instanceof StorageScannerOutageException) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof ImmutableAuditLogException) {
      status = HttpStatus.FORBIDDEN;
      code = exception.code;
      message = exception.message;
    } else if (
      exception instanceof CannotLockSelfException ||
      exception instanceof CannotLockLastAdminException ||
      exception instanceof CannotDemoteSelfException ||
      exception instanceof CannotDemoteLastAdminException
    ) {
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof UserAdminActorNotActiveAdminException) {
      status = HttpStatus.FORBIDDEN;
      code = exception.code;
      message = exception.message;
    } else if (
      exception instanceof GoogleIdentityConflictException ||
      exception instanceof GoogleLinkRequiredException
    ) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
    } else if (
      exception instanceof FinalLoginMethodException ||
      exception instanceof OAuthIntentInvalidException ||
      exception instanceof GoogleAuthCancelledException ||
      exception instanceof InvalidGoogleIdentityException
    ) {
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof GoogleProviderUnavailableException) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = exception.code;
      message = exception.message;
    } else if (
      exception instanceof UnbalancedJournalException ||
      exception instanceof InvalidLedgerOperationException
    ) {
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof PendingRewardNotMaturedException) {
      // Epic 6 review P2: server-enforced 48-hour review window (FR-24).
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
      details = { maturesAt: exception.maturesAt.toISOString() };
    } else if (exception instanceof ConcurrentLedgerCommandException) {
      // Epic 6 review P14: retryable; the retry takes the idempotent path.
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof PendingRewardForbiddenException) {
      status = HttpStatus.FORBIDDEN;
      code = exception.code;
      message = exception.message;
    } else if (
      exception instanceof AccountNotFoundException ||
      exception instanceof JournalNotFoundException ||
      exception instanceof PendingCreditNotFoundException
    ) {
      status = HttpStatus.NOT_FOUND;
      code = exception.code;
      message = exception.message;
    } else if (
      exception instanceof InsufficientBalanceException ||
      exception instanceof JournalAlreadyReversedException ||
      exception instanceof IdempotencyConflictException ||
      exception instanceof DisputeHoldActiveException ||
      exception instanceof DownstreamJournalExistsException
    ) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
      if (exception instanceof InsufficientEscrowBalanceException) {
        details = {
          availableBalance: exception.availableBalance,
          requiredAmount: exception.requiredAmount,
        };
      }
    } else if (exception instanceof InvalidTopUpRequestException) {
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof TopUpRequestNotFoundException) {
      status = HttpStatus.NOT_FOUND;
      code = exception.code;
      message = exception.message;
    } else if (
      exception instanceof TopUpAdminCapabilityRequiredException ||
      exception instanceof TopUpSelfReviewForbiddenException
    ) {
      status = HttpStatus.FORBIDDEN;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof TopUpAlreadyReviewedException) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
      details = { currentStatus: exception.currentStatus };
    } else if (exception instanceof TopUpPendingLimitExceededException) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
      details = { maxPendingRequests: exception.maxPendingRequests };
    } else if (exception instanceof TopUpReferenceConflictException) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof InvalidModerationRequestException) {
      status = HttpStatus.BAD_REQUEST;
      code = exception.code;
      message = exception.message;
    } else if (
      exception instanceof ModerationAdminCapabilityRequiredException ||
      exception instanceof ModerationSelfReviewForbiddenException
    ) {
      status = HttpStatus.FORBIDDEN;
      code = exception.code;
      message = exception.message;
    } else if (
      exception instanceof FormNotInModerationQueueException ||
      exception instanceof ModerationVersionMismatchException ||
      exception instanceof ModerationAlreadyDecidedException
    ) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
        code =
          status === 400
            ? 'VALIDATION_ERROR'
            : status === 401
              ? 'AUTH_INVALID_CREDENTIALS'
              : status === 403
                ? 'FORBIDDEN'
                : status === 404
                  ? 'NOT_FOUND'
                  : status === 409
                    ? 'CONFLICT'
                    : status === 429
                      ? 'RATE_LIMIT_EXCEEDED'
                      : 'HTTP_ERROR';
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, any>;
        code =
          resObj.code ||
          (status === 400
            ? 'VALIDATION_ERROR'
            : status === 401
              ? 'AUTH_INVALID_CREDENTIALS'
              : status === 403
                ? 'FORBIDDEN'
                : status === 404
                  ? 'NOT_FOUND'
                  : status === 409
                    ? 'CONFLICT'
                    : status === 429
                      ? 'RATE_LIMIT_EXCEEDED'
                      : 'HTTP_ERROR');
        message = resObj.message || exception.message;
        details = resObj.details;
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled error: ${exception.message}`,
        exception.stack,
      );
      message =
        process.env.NODE_ENV === 'production'
          ? 'An unexpected error occurred.'
          : exception.message;
    } else {
      this.logger.error('Unhandled unknown exception', exception);
    }

    if (
      retryAfterSeconds !== undefined &&
      retryAfterSeconds > 0 &&
      typeof response.setHeader === 'function'
    ) {
      response.setHeader('Retry-After', String(Math.ceil(retryAfterSeconds)));
    }

    const envelope = createErrorEnvelope(code, message, details);
    response.status(status).json(envelope);
  }
}
