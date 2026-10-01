import { Injectable, Optional } from '@nestjs/common';
import {
  type EmailDeliveryMode,
  PARTICIPATION_RATE_LIMIT_POLICY_VERSION,
  type ParticipationRateLimitPolicy,
} from '@rescom/schemas';
import { emailFromDomain, envSchema, EnvConfig } from './env.schema';

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

  get trustProxyHops(): number {
    return this.config.TRUST_PROXY_HOPS;
  }

  get systemMetricsLogIntervalSeconds(): number {
    return this.config.SYSTEM_METRICS_LOG_INTERVAL_SECONDS;
  }

  /** Story IR.2b: run the in-process scheduler + Outbox dispatcher. */
  get schedulerEnabled(): boolean {
    return this.config.SCHEDULER_ENABLED;
  }

  get schedulerTickSeconds(): number {
    return this.config.SCHEDULER_TICK_SECONDS;
  }

  get outboxMaxAttempts(): number {
    return this.config.OUTBOX_MAX_ATTEMPTS;
  }

  /** Story IR.4b B-T4: `capture` outside production when unset (production requires `smtp`). */
  get emailDeliveryMode(): EmailDeliveryMode {
    return this.config.EMAIL_DELIVERY_MODE ?? 'capture';
  }

  get emailFrom(): string {
    return this.config.EMAIL_FROM ?? 'Rescom <no-reply@rescom.local>';
  }

  get emailReplyTo(): string | null {
    return this.config.EMAIL_REPLY_TO ?? null;
  }

  /** Base of email links, without a trailing slash. */
  get emailAppBaseUrl(): string {
    return (this.config.EMAIL_APP_BASE_URL ?? this.config.FRONTEND_ORIGINS[0])
      .trim()
      .replace(/\/+$/, '');
  }

  get emailMessageIdDomain(): string {
    return (
      this.config.EMAIL_MESSAGE_ID_DOMAIN ??
      emailFromDomain(this.config.EMAIL_FROM) ??
      'rescom.local'
    );
  }

  get emailSendTimeoutMs(): number {
    return this.config.EMAIL_SEND_TIMEOUT_MS;
  }

  get smtp(): {
    host: string;
    port: number;
    secure: boolean;
    requireTls: boolean;
    username: string | null;
    password: string | null;
  } {
    return {
      host: this.config.SMTP_HOST ?? 'localhost',
      port: this.config.SMTP_PORT,
      secure: this.config.SMTP_SECURE,
      requireTls: this.config.SMTP_REQUIRE_TLS,
      username: this.config.SMTP_USERNAME ?? null,
      password: this.config.SMTP_PASSWORD ?? null,
    };
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

  /**
   * HMAC key for External completion-code verifiers (Story 4.5 AC2.3): the
   * dedicated secret when configured, otherwise JWT_SECRET.
   */
  get completionCodeHmacSecret(): string {
    return this.config.COMPLETION_CODE_HMAC_SECRET || this.config.JWT_SECRET;
  }

  /**
   * HMAC key of the storage capability that binds guest uploads to a survey
   * attempt (Epic 5 review P22): the dedicated secret when configured,
   * otherwise JWT_SECRET. Minting (Participation) and verification (Storage)
   * both read this getter.
   */
  get storageCapabilitySecret(): string {
    return this.config.STORAGE_CAPABILITY_SECRET || this.config.JWT_SECRET;
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

  get storageEndpoint(): string {
    return this.config.STORAGE_ENDPOINT;
  }

  get storageRegion(): string {
    return this.config.STORAGE_REGION;
  }

  get storageBucket(): string {
    return this.config.STORAGE_BUCKET;
  }

  get storageAccessKeyId(): string {
    return this.config.STORAGE_ACCESS_KEY_ID;
  }

  get storageSecretAccessKey(): string {
    return this.config.STORAGE_SECRET_ACCESS_KEY;
  }

  get storageForcePathStyle(): boolean {
    return this.config.STORAGE_FORCE_PATH_STYLE;
  }

  get malwareScannerHost(): string {
    return this.config.MALWARE_SCANNER_HOST;
  }

  get malwareScannerPort(): number {
    return this.config.MALWARE_SCANNER_PORT;
  }

  get malwareScannerTimeoutMs(): number {
    return this.config.MALWARE_SCANNER_TIMEOUT_MS;
  }

  get topUpBankName(): string {
    return this.config.TOPUP_BANK_NAME;
  }

  get topUpBankBin(): string {
    return this.config.TOPUP_BANK_BIN;
  }

  get topUpBankAccountNumber(): string {
    return this.config.TOPUP_BANK_ACCOUNT_NUMBER;
  }

  get topUpBankAccountName(): string {
    return this.config.TOPUP_BANK_ACCOUNT_NAME;
  }

  get rateLimitTtlSeconds(): number {
    return this.config.RATE_LIMIT_TTL_SECONDS;
  }

  get rateLimitMaxRequests(): number {
    return this.config.RATE_LIMIT_MAX_REQUESTS;
  }

  get authRateLimitTtlSeconds(): number {
    return this.config.AUTH_RATE_LIMIT_TTL_SECONDS;
  }

  get authRateLimitMaxRequests(): number {
    return this.config.AUTH_RATE_LIMIT_MAX_REQUESTS;
  }

  /** AD-6 abuse-control profile declared by this deployment (Story 8.2). */
  get abuseControlProfile(): EnvConfig['ABUSE_CONTROL_PROFILE'] {
    return this.config.ABUSE_CONTROL_PROFILE;
  }

  /**
   * Name of the participation rate-limit policy this deployment runs
   * (decision E8-D4): explicit in production, `participation-rate-limit-v1`
   * (the provisional defaults) otherwise.
   */
  get participationRateLimitPolicyVersion(): string {
    return (
      this.config.PARTICIPATION_RATE_LIMIT_POLICY_VERSION ??
      PARTICIPATION_RATE_LIMIT_POLICY_VERSION
    );
  }

  /** Centrally versioned participation rate-limit policy (FR-46, Story 8.2). */
  get participationRateLimitPolicy(): ParticipationRateLimitPolicy {
    return {
      completionLimit: this.config.PARTICIPATION_COMPLETION_LIMIT,
      completionWindowSeconds:
        this.config.PARTICIPATION_COMPLETION_WINDOW_SECONDS,
      burstLimit: this.config.PARTICIPATION_BURST_LIMIT,
      burstWindowSeconds: this.config.PARTICIPATION_BURST_WINDOW_SECONDS,
      policyVersion: this.participationRateLimitPolicyVersion,
    };
  }

  get raw(): EnvConfig {
    return this.config;
  }
}
