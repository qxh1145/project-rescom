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
import {
  registerSchema,
  loginSchema,
  RegisterDto,
  LoginDto,
} from '@rescom/schemas';
import { AuthService } from '../application/auth.service';
import { SessionService } from '../application/session.service';
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
} from './cookie-options.helper';
import {
  InvalidCsrfTokenException,
  InvalidRefreshTokenException,
  UnauthorizedSessionException,
  SessionRevokedException,
  SessionExpiredException,
  UserLockedException,
} from '../application/exceptions/auth.exceptions';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { CurrentUser } from './decorators';
import { AuthenticatedUser } from './types/authenticated-request.type';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly envService: EnvService,
    private readonly sessionService?: SessionService,
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
    }

    return createSuccessEnvelope({ user: result.user });
  }

  @Get('csrf')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async getCsrf(@Req() req: Request) {
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

    const { csrfToken } = await this.sessionService.rotateCsrf({
      accessToken,
      refreshToken,
    });

    return createSuccessEnvelope({ csrfToken });
  }

  @Post('refresh')
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

    return createSuccessEnvelope({ csrfToken: rotated.csrfToken });
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  @Header('Cache-Control', 'no-store')
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    return createSuccessEnvelope(user);
  }

  @Post('logout')
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
