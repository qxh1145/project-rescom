import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Header,
  UseGuards,
  UsePipes,
  Inject,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { GoogleOAuthService } from '../application/google-oauth.service';
import { SessionService } from '../application/session.service';
import { EnvService } from '../../../common/config/env.service';
import {
  SECRET_PROTECTION_PORT,
  SecretProtectionPort,
} from '../application/ports/secret-protection.port';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { validateRequestOrigin } from '../../../common/http/origin-check.helper';
import {
  googleCallbackQuerySchema,
  googleLinkStartSchema,
  googleLinkDeleteSchema,
  GoogleLinkStartDto,
  GoogleLinkDeleteDto,
} from '@rescom/schemas';
import {
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  OAUTH_INTENT_COOKIE_NAME,
  getAuthCookieOptions,
  getRefreshCookieOptions,
  getOAuthIntentCookieOptions,
  getOAuthIntentClearCookieOptions,
} from './cookie-options.helper';
import { InvalidCsrfTokenException } from '../application/exceptions/auth.exceptions';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { CurrentUser, CurrentSession } from './decorators';
import { AuthenticatedUser } from './types/authenticated-request.type';
import { Session } from '../domain/session.entity';

@Controller('auth/google')
export class GoogleOAuthController {
  constructor(
    private readonly googleOAuthService: GoogleOAuthService,
    private readonly sessionService: SessionService,
    private readonly envService: EnvService,
    @Inject(SECRET_PROTECTION_PORT)
    private readonly secretProtection: SecretProtectionPort,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async initiateLogin(@Req() req: Request, @Res() res: Response) {
    const existingCookie = req.cookies?.[OAUTH_INTENT_COOKIE_NAME];
    const { authorizationUrl, intentCookie } =
      await this.googleOAuthService.initiateLogin(existingCookie);

    res.cookie(
      OAUTH_INTENT_COOKIE_NAME,
      intentCookie,
      getOAuthIntentCookieOptions(this.envService),
    );

    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(HttpStatus.FOUND, authorizationUrl);
  }

  @Get('callback')
  @Header('Cache-Control', 'no-store')
  async handleCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query() rawQuery: Record<string, unknown>,
  ) {
    res.setHeader('Cache-Control', 'no-store');

    // Always clear intent cookie on any terminal callback path
    res.clearCookie(
      OAUTH_INTENT_COOKIE_NAME,
      getOAuthIntentClearCookieOptions(this.envService),
    );

    const parsedQuery = googleCallbackQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      return res.redirect(
        HttpStatus.SEE_OTHER,
        `${this.envService.authFrontendErrorUrl}?error=AUTH_INVALID_OAUTH_INTENT`,
      );
    }

    const rawIntentCookie = req.cookies?.[OAUTH_INTENT_COOKIE_NAME];
    const result = await this.googleOAuthService.handleCallback(
      parsedQuery.data,
      rawIntentCookie,
    );

    if (result.sessionTokens) {
      res.cookie(
        AUTH_COOKIE_NAME,
        result.sessionTokens.accessToken,
        getAuthCookieOptions(this.envService),
      );
      res.cookie(
        REFRESH_COOKIE_NAME,
        result.sessionTokens.refreshToken,
        getRefreshCookieOptions(this.envService),
      );
    }

    return res.redirect(HttpStatus.SEE_OTHER, result.redirectUrl);
  }

  @Post('link/start')
  @Header('Cache-Control', 'no-store')
  @UseGuards(JsonOnlyGuard, SessionAuthGuard)
  @UsePipes(new ZodValidationPipe(googleLinkStartSchema, 'AUTH_INVALID_INPUT'))
  async linkStart(
    @Req() req: Request,
    @Res() res: Response,
    @Body() dto: GoogleLinkStartDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSession() session: Session,
  ) {
    validateRequestOrigin(req, this.envService, { requireOrigin: true });

    const csrfToken = req.headers['x-csrf-token'];
    if (
      !csrfToken ||
      typeof csrfToken !== 'string' ||
      !this.secretProtection.verifyCsrfToken(csrfToken, session.csrfDigest)
    ) {
      throw new InvalidCsrfTokenException();
    }

    const { authorizationUrl, intentCookie } =
      await this.googleOAuthService.initiateLink(user.id, dto.currentPassword);

    res.cookie(
      OAUTH_INTENT_COOKIE_NAME,
      intentCookie,
      getOAuthIntentCookieOptions(this.envService),
    );

    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(HttpStatus.SEE_OTHER, authorizationUrl);
  }

  @Delete('link')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @UseGuards(JsonOnlyGuard, SessionAuthGuard)
  @UsePipes(new ZodValidationPipe(googleLinkDeleteSchema, 'AUTH_INVALID_INPUT'))
  async linkDelete(
    @Req() req: Request,
    @Res({ passthrough: true }) _res: Response,
    @Body() dto: GoogleLinkDeleteDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSession() session: Session,
  ) {
    validateRequestOrigin(req, this.envService, { requireOrigin: true });

    const csrfToken = req.headers['x-csrf-token'];
    if (
      !csrfToken ||
      typeof csrfToken !== 'string' ||
      !this.secretProtection.verifyCsrfToken(csrfToken, session.csrfDigest)
    ) {
      throw new InvalidCsrfTokenException();
    }

    await this.googleOAuthService.unlink(user.id, dto.currentPassword);
  }
}
