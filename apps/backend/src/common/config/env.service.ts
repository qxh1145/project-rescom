import { Injectable, Optional } from '@nestjs/common';
import { envSchema, EnvConfig } from './env.schema';

@Injectable()
export class EnvService {
  private readonly config: EnvConfig;

  constructor(@Optional() customEnv?: Record<string, unknown>) {
    const rawEnv = customEnv ?? process.env;
    const result = envSchema.safeParse(rawEnv);

    if (!result.success) {
      const formattedErrors = result.error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join('; ');
      throw new Error(`Configuration validation failed: ${formattedErrors}`);
    }

    this.config = result.data;
  }

  get nodeEnv(): string {
    return this.config.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.config.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.config.NODE_ENV === 'test';
  }

  get port(): number {
    return this.config.PORT;
  }

  get databaseUrl(): string {
    return this.config.DATABASE_URL;
  }

  get jwtSecret(): string {
    return this.config.JWT_SECRET;
  }

  get jwtAccessTtlSeconds(): number {
    return this.config.JWT_ACCESS_TTL_SECONDS;
  }

  get bcryptRounds(): number {
    return this.config.BCRYPT_ROUNDS;
  }

  get frontendOrigins(): string[] {
    return this.config.FRONTEND_ORIGINS;
  }

  get sessionAbsoluteTtlSeconds(): number {
    return this.config.SESSION_ABSOLUTE_TTL_SECONDS;
  }

  get oauthIntentTtlSeconds(): number {
    return this.config.OAUTH_INTENT_TTL_SECONDS;
  }

  get secretProtectionKey(): string {
    return this.config.AUTH_SECRET_PROTECTION_KEY || this.config.JWT_SECRET;
  }

  get secretKeyVersion(): number {
    return this.config.AUTH_SECRET_KEY_VERSION;
  }

  get googleClientId(): string {
    return this.config.GOOGLE_CLIENT_ID;
  }

  get googleClientSecret(): string {
    return this.config.GOOGLE_CLIENT_SECRET;
  }

  get googleRedirectUri(): string {
    return this.config.GOOGLE_REDIRECT_URI;
  }

  get authFrontendSuccessUrl(): string {
    return this.config.AUTH_FRONTEND_SUCCESS_URL;
  }

  get authFrontendErrorUrl(): string {
    return this.config.AUTH_FRONTEND_ERROR_URL;
  }

  get raw(): EnvConfig {
    return this.config;
  }
}
