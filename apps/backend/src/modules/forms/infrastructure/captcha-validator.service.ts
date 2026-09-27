import { Injectable, Logger, Optional } from '@nestjs/common';
import { CAPTCHA_PROVIDER_NOT_CONFIGURED } from '../application/exceptions/form.exceptions';

export interface CaptchaValidatorConfig {
  isProduction: boolean;
}

/**
 * Guest CAPTCHA check (Bug 3.3).
 *
 * There is no CAPTCHA provider integration (no Turnstile secret or verify
 * call), so the validator cannot prove a token is genuine:
 * - test / development: every non-empty token passes except the explicit
 *   failure tokens (`invalid-captcha-token`, `bad-token`); the
 *   `test-turnstile-token` / `mock-turnstile-token` fixtures are accepted
 *   here only.
 * - production: fails closed. Every token is rejected with
 *   `CAPTCHA_PROVIDER_NOT_CONFIGURED` (surfaced as
 *   `CaptchaVerificationFailedException`), so guest submissions are disabled
 *   until a real verifier is integrated. A warning is logged once at startup.
 *
 * The environment comes from `EnvService` (see `forms.module.ts`); without a
 * config it falls back to `NODE_ENV` (unit tests).
 */
@Injectable()
export class CaptchaValidatorService {
  private readonly logger = new Logger(CaptchaValidatorService.name);
  private readonly isProduction: boolean;

  constructor(@Optional() config?: CaptchaValidatorConfig) {
    this.isProduction =
      config?.isProduction ?? process.env.NODE_ENV === 'production';

    if (this.isProduction) {
      this.logger.warn(
        'Guest CAPTCHA has no provider configured: every guest submission is rejected (fail closed).',
      );
    }
  }

  async validateToken(
    token?: string,
    _remoteIp?: string,
  ): Promise<{ isValid: boolean; error?: string }> {
    if (!token || token.trim() === '') {
      return { isValid: false, error: 'CAPTCHA_TOKEN_MISSING' };
    }

    if (this.isProduction) {
      return { isValid: false, error: CAPTCHA_PROVIDER_NOT_CONFIGURED };
    }

    const trimmed = token.trim();

    // Known test/mock failure tokens
    if (trimmed === 'invalid-captcha-token' || trimmed === 'bad-token') {
      return { isValid: false, error: 'CAPTCHA_VERIFICATION_FAILED' };
    }

    // Test and development (the only non-production NODE_ENVs) pass through.
    return { isValid: true };
  }
}
