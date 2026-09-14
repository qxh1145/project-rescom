import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { SessionService } from '../../application/session.service';
import { EnvService } from '../../../../common/config/env.service';
import { AUTH_COOKIE_NAME, clearAuthCookies } from '../cookie-options.helper';
import { IS_PUBLIC_KEY } from '../../../../common/security/public.decorator';
import {
  UnauthorizedSessionException,
  InvalidTokenException,
  SessionExpiredException,
  SessionRevokedException,
  UserLockedException,
} from '../../application/exceptions/auth.exceptions';
import {
  AuthenticatedRequest,
  AuthenticatedUser,
} from '../types/authenticated-request.type';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly sessionService: SessionService,
    private readonly envService: EnvService,
    @Optional() private readonly reflector?: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector &&
      typeof context.getHandler === 'function' &&
      typeof context.getClass === 'function'
    ) {
      const isPublic = this.reflector.getAllAndOverride<boolean>(
        IS_PUBLIC_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (isPublic) {
        return true;
      }
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const accessToken = req.cookies?.[AUTH_COOKIE_NAME];

    if (!accessToken) {
      clearAuthCookies(res, this.envService);
      res.setHeader('Cache-Control', 'no-store');
      throw new UnauthorizedSessionException('Access token cookie required');
    }

    try {
      const { user, session } =
        await this.sessionService.validateSession(accessToken);

      const authenticatedUser: AuthenticatedUser = {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
      };

      const authReq = req as AuthenticatedRequest;
      authReq.user = authenticatedUser;
      authReq.session = session;

      return true;
    } catch (err) {
      if (this.isKnownAuthFailure(err)) {
        clearAuthCookies(res, this.envService);
        res.setHeader('Cache-Control', 'no-store');
      }
      throw err;
    }
  }

  private isKnownAuthFailure(err: unknown): boolean {
    return (
      err instanceof UnauthorizedSessionException ||
      err instanceof InvalidTokenException ||
      err instanceof SessionExpiredException ||
      err instanceof SessionRevokedException ||
      err instanceof UserLockedException
    );
  }
}
