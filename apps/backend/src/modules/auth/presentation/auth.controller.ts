import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Header,
  UsePipes,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from '@rescom/schemas';
import { AuthService } from '../application/auth.service';
import { SessionService } from '../application/session.service';
import { PasswordResetService } from '../application/password-reset.service';
import { EnvService } from '../../../common/config/env.service';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { validateRequestOrigin } from '../../../common/http/origin-check.helper';
import {
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  OAUTH_INTENT_COOKIE_NAME,
  getAuthCookieOptions,
  getRefreshCookieOptions,
  getOAuthIntentClearCookieOptions,
  clearAuthCookies,
  clearLegacyAuthCookies,
} from './cookie-options.helper';
import {
  InvalidCsrfTokenException,
  InvalidRefreshTokenException,
  UnauthorizedSessionException,
  SessionRevokedException,
  SessionExpiredException,
  UserLockedException,
  PasswordResetTokenInvalidException,
} from '../application/exceptions/auth.exceptions';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { CurrentUser } from './decorators';
import { AuthenticatedUser } from './types/authenticated-request.type';

@Controller(['auth', 'api/auth'])
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly envService: EnvService,
    private readonly sessionService?: SessionService,
    private readonly passwordResetService?: PasswordResetService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @UseGuards(JsonOnlyGuard)
  @UsePipes(
    new ZodValidationPipe(registerSchema, 'AUTH_INVALID_REGISTRATION_INPUT'),
  )
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(dto);

    res.cookie(
      AUTH_COOKIE_NAME,
      result.accessToken || result.token,
      getAuthCookieOptions(this.envService),
    );

    if (result.refreshToken) {
      res.cookie(
        REFRESH_COOKIE_NAME,
        result.refreshToken,
        getRefreshCookieOptions(this.envService),
      );
      clearLegacyAuthCookies(res, this.envService);
    }

    return createSuccessEnvelope({ user: result.user });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(loginSchema, 'AUTH_INVALID_LOGIN_INPUT'))
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto);

    res.cookie(
      AUTH_COOKIE_NAME,
      result.accessToken || result.token,
      getAuthCookieOptions(this.envService),
    );

    if (result.refreshToken) {
      res.cookie(
        REFRESH_COOKIE_NAME,
        result.refreshToken,
        getRefreshCookieOptions(this.envService),
      );
      clearLegacyAuthCookies(res, this.envService);
    }

    return createSuccessEnvelope({ user: result.user });
  }

  /**
   * Plan 5.4: always 202 with the same body and about the same time, whether
   * or not the address has an account (no enumeration). Anonymous like login:
   * JSON only (a cross-site form cannot send it without a CORS preflight), no
   * CSRF token, on the strict `auth` throttler bucket; the service adds
   * 3 links per hour per (account, IP) and 10 per account.
   */
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @UseGuards(JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(forgotPasswordSchema, 'AUTH_INVALID_INPUT'))
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.passwordResetService?.requestReset(dto.email, req.ip);
    return createSuccessEnvelope({ accepted: true as const });
  }

  /**
   * Plan 5.4: redeems a reset token (invalid, expired and used answer the
   * same 400 `PASSWORD_RESET_TOKEN_INVALID`), sets the new password and
   * revokes every session of the account. This browser's cookies are cleared
   * too: the user signs in again with the new password.
   */
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(resetPasswordSchema, 'AUTH_INVALID_INPUT'))
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.passwordResetService) {
      throw new PasswordResetTokenInvalidException();
    }
    await this.passwordResetService.resetPassword(dto);
    clearAuthCookies(res, this.envService);
    return createSuccessEnvelope({ passwordReset: true as const });
  }

  // Plan 0.1: csrf, refresh, me and logout are session upkeep that runs on
  // every page load, so they skip the strict `auth` bucket (credential checks
  // only) and stay on `default`.
  @Get('csrf')
  @SkipThrottle({ auth: true })
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async getCsrf(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    validateRequestOrigin(req, this.envService);

    const accessToken = req.cookies?.[AUTH_COOKIE_NAME];
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];

    if (!accessToken && !refreshToken) {
      throw new UnauthorizedSessionException(
        'Session or refresh cookie required',
      );
    }

    if (!this.sessionService) {
      throw new UnauthorizedSessionException('Session service unavailable');
    }

    let csrfToken: string;
    try {
      ({ csrfToken } = await this.sessionService.rotateCsrf({
        accessToken,
        refreshToken,
      }));
    } catch (err) {
      if (
        err instanceof SessionRevokedException ||
        err instanceof InvalidRefreshTokenException ||
        err instanceof SessionExpiredException ||
        err instanceof UserLockedException
      ) {
        clearAuthCookies(res, this.envService);
      }
      throw err;
    }

    return createSuccessEnvelope({ csrfToken });
  }

  @Post('refresh')
  @SkipThrottle({ auth: true })
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    validateRequestOrigin(req, this.envService, { requireOrigin: true });

    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) {
      throw new InvalidRefreshTokenException();
    }

    const csrfToken = req.headers['x-csrf-token'];
    if (!csrfToken || typeof csrfToken !== 'string') {
      throw new InvalidCsrfTokenException();
    }

    if (!this.sessionService) {
      throw new InvalidRefreshTokenException();
    }

    let rotated;
    try {
      rotated = await this.sessionService.refreshSession(
        refreshToken,
        csrfToken,
      );
    } catch (err) {
      if (
        err instanceof SessionRevokedException ||
        err instanceof InvalidRefreshTokenException ||
        err instanceof SessionExpiredException ||
        err instanceof UserLockedException
      ) {
        clearAuthCookies(res, this.envService);
      }
      throw err;
    }

    res.cookie(
      AUTH_COOKIE_NAME,
      rotated.accessToken,
      getAuthCookieOptions(this.envService),
    );

    res.cookie(
      REFRESH_COOKIE_NAME,
      rotated.refreshToken,
      getRefreshCookieOptions(this.envService),
    );
    clearLegacyAuthCookies(res, this.envService);

    return createSuccessEnvelope({ csrfToken: rotated.csrfToken });
  }

  @Get('me')
  @SkipThrottle({ auth: true })
  @UseGuards(SessionAuthGuard)
  @Header('Cache-Control', 'no-store')
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    return createSuccessEnvelope(user);
  }

  @Post('logout')
  @SkipThrottle({ auth: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    validateRequestOrigin(req, this.envService);

    const accessToken = req.cookies?.[AUTH_COOKIE_NAME];
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    const csrfToken = req.headers['x-csrf-token'];

    if (this.sessionService) {
      await this.sessionService.logout({
        accessToken,
        refreshToken,
        csrfToken: typeof csrfToken === 'string' ? csrfToken : undefined,
      });
    }

    clearAuthCookies(res, this.envService);
    res.clearCookie(
      OAUTH_INTENT_COOKIE_NAME,
      getOAuthIntentClearCookieOptions(this.envService),
    );
  }
}
