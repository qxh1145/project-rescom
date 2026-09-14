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
} from '../../modules/auth/application/exceptions/auth.exceptions';
import {
  UserNotFoundException,
  CannotLockSelfException,
  CannotLockLastAdminException,
  CannotDemoteSelfException,
  CannotDemoteLastAdminException,
} from '../../modules/users/application/exceptions/user-admin.exceptions';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred.';
    let details: any = undefined;

    if (exception instanceof EmailAlreadyRegisteredException) {
      status = HttpStatus.CONFLICT;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof InvalidCredentialsException) {
      status = HttpStatus.UNAUTHORIZED;
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
      exception instanceof ForbiddenResourceException
    ) {
      status = HttpStatus.FORBIDDEN;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof UserNotFoundException) {
      status = HttpStatus.NOT_FOUND;
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

    const envelope = createErrorEnvelope(code, message, details);
    response.status(status).json(envelope);
  }
}
