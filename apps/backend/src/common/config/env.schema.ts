import { z } from 'zod';
import {
  DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY,
  EMAIL_DELIVERY_MODES,
  PARTICIPATION_RATE_LIMIT_POLICY_VERSION,
  PARTICIPATION_RATE_LIMIT_POLICY_VERSION_PATTERN,
  hasDefaultParticipationRateLimitValues,
} from '@rescom/schemas';

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Review L8: the host of the address in `EMAIL_FROM` (`Name <a@host>` or
 * `a@host`), used as the Message-ID domain when none is configured.
 */
export function emailFromDomain(from: string | undefined): string | undefined {
  return from?.match(/@([A-Za-z0-9.-]+)>?\s*$/)?.[1]?.toLowerCase();
}

function checkNoCredentialsOrFragmentOrWildcard(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return false;
    if (parsed.hash) return false;
    if (parsed.hostname.includes('*')) return false;
    return true;
  } catch {
    return false;
  }
}

// BE-9: z.coerce.boolean() treats ANY non-empty string (including "false"
// and "0") as truthy, so env values meant to disable a flag silently enable
// it instead. This accepts real booleans plus the common textual forms and
// rejects anything else, so misconfigured env values fail validation loudly
// rather than flipping the flag on.
const BOOLEAN_ENV_TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const BOOLEAN_ENV_FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

function booleanEnv(defaultValue: boolean) {
  return z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value, ctx) => {
      if (typeof value === 'boolean') {
        return value;
      }
      const normalized = value.trim().toLowerCase();
      if (BOOLEAN_ENV_TRUE_VALUES.has(normalized)) {
        return true;
      }
      if (BOOLEAN_ENV_FALSE_VALUES.has(normalized)) {
        return false;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'must be a boolean-like value: true/false, 1/0, yes/no, or on/off (case-insensitive)',
      });
      return z.NEVER;
    });
}

// IR.1 inventory section 3 items 5-6: the .env.example placeholders are long
// enough to pass the length checks, so production refuses them by prefix.
// `change_?me` also catches the CHANGE_ME* values of deploy/.env.prod.example.
const PLACEHOLDER_SECRET_PATTERN = /^(replace_with_|change_?me|example)/i;
const DEFAULT_CREDENTIAL_VALUES = ['minioadmin', 'rescom_password', 'change_me'];

function isPlaceholderSecret(value: string | undefined): boolean {
  return value !== undefined && PLACEHOLDER_SECRET_PATTERN.test(value.trim());
}

const TOPUP_PLACEHOLDER_ACCOUNT_NUMBER = '0000000000';
const TOPUP_PLACEHOLDER_ACCOUNT_NAME = 'RESCOM DEMO';

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z
      .string()
      .min(32, 'JWT_SECRET must be at least 32 characters long'),
    JWT_ACCESS_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(1, 'JWT_ACCESS_TTL_SECONDS must be at least 1 second')
      .max(900, 'JWT_ACCESS_TTL_SECONDS cannot exceed 900 seconds')
      .default(900),
    BCRYPT_ROUNDS: z.coerce
      .number()
      .int()
      .min(12, 'BCRYPT_ROUNDS must be at least 12')
      .max(14, 'BCRYPT_ROUNDS cannot exceed 14')
      .default(12),
    FRONTEND_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((val) =>
        val
          .split(',')
          .map((origin) => origin.trim().replace(/\/+$/, ''))
          .filter((origin) => origin.length > 0),
      )
      .refine(
        (origins) => origins.length > 0,
        'FRONTEND_ORIGINS must contain at least one valid origin',
      )
      .refine(
        (origins) => !origins.includes('*'),
        'Wildcard origin (*) is strictly forbidden when credentials are enabled',
      ),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),

    // Rate Limiting & Throttling
    RATE_LIMIT_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(86400)
      .default(60),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(100),
    AUTH_RATE_LIMIT_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(86400)
      .default(60),
    AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(10),

    // Story 8.2: bot protection (FR-46, NFR-4, AD-6). Centrally versioned
    // policy (decision E8-D4): the values below run under
    // PARTICIPATION_RATE_LIMIT_POLICY_VERSION (default
    // `participation-rate-limit-v1` = the provisional defaults, dev/test only;
    // required in production). Launch values await PRD OQ-16.
    // REDIS_DISABLED_SINGLE_REPLICA = PostgreSQL durable completion counts +
    // per-process request counters (one API replica only). REDIS_SHARED needs
    // the Redis counter store, which is not installed in this build yet.
    ABUSE_CONTROL_PROFILE: z
      .enum(['REDIS_DISABLED_SINGLE_REPLICA', 'REDIS_SHARED'])
      .default('REDIS_DISABLED_SINGLE_REPLICA'),
    PARTICIPATION_COMPLETION_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY.completionLimit),
    PARTICIPATION_COMPLETION_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(604800)
      .default(DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY.completionWindowSeconds),
    PARTICIPATION_BURST_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY.burstLimit),
    PARTICIPATION_BURST_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3600)
      .default(DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY.burstWindowSeconds),
    // Decision E8-D4 (option B): the name stamped on every participation 429
    // and RATE_LIMIT FraudLog entry. Unset -> `participation-rate-limit-v1`
    // outside production; production must set it explicitly.
    PARTICIPATION_RATE_LIMIT_POLICY_VERSION: z
      .string()
      .trim()
      .regex(
        PARTICIPATION_RATE_LIMIT_POLICY_VERSION_PATTERN,
        'PARTICIPATION_RATE_LIMIT_POLICY_VERSION must be 1-64 characters: letters or digits first, then letters, digits, ".", "_", ":" or "-"',
      )
      .optional(),

    // System Monitoring & Metrics Logging
    SYSTEM_METRICS_LOG_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .min(0, 'SYSTEM_METRICS_LOG_INTERVAL_SECONDS must be at least 0')
      .default(30),

    // Story IR.2b (AD-5 amendment, AD-17): the in-process scheduler and the
    // Outbox dispatcher. Off by default; exactly one replica may enable it
    // (Story 11.1 sets it in docker-compose.prod.yml). Never starts under
    // NODE_ENV=test. Per-job cadences and leases are code constants.
    SCHEDULER_ENABLED: booleanEnv(false),
    SCHEDULER_TICK_SECONDS: z.coerce.number().int().min(1).max(300).default(15),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),

    // Story IR.4b part B + plan 5.4: email (critical notifications, password
    // reset). `capture` keeps sent mail in memory (local/test), `smtp` uses
    // the portable SMTP sender (Mailpit locally, a provider later; AD-23),
    // `disabled` sends nothing. Production refuses `capture` and `disabled`.
    // Secrets only through the environment.
    EMAIL_DELIVERY_MODE: z.enum(EMAIL_DELIVERY_MODES).optional(),
    EMAIL_FROM: z.string().trim().min(3).max(320).optional(),
    EMAIL_REPLY_TO: z.string().trim().email().max(320).optional(),
    // Base of links in emails (reset link, wallet). Defaults to the first
    // FRONTEND_ORIGINS entry; when set, its origin must be one of them.
    EMAIL_APP_BASE_URL: z
      .string()
      .refine(isValidUrl, 'EMAIL_APP_BASE_URL must be a valid URL')
      .refine(
        checkNoCredentialsOrFragmentOrWildcard,
        'EMAIL_APP_BASE_URL must not contain credentials, fragments, or wildcard hosts',
      )
      .refine(
        (value) => !isValidUrl(value) || !new URL(value).search,
        'EMAIL_APP_BASE_URL must not contain a query string',
      )
      .optional(),
    EMAIL_MESSAGE_ID_DOMAIN: z
      .string()
      .trim()
      .regex(
        /^[a-z0-9.-]+$/i,
        'EMAIL_MESSAGE_ID_DOMAIN must be a bare host name',
      )
      // Unset: the domain of EMAIL_FROM (review L8), else rescom.local outside production.
      .optional(),
    EMAIL_SEND_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60000)
      .default(10000),
    SMTP_HOST: z.string().trim().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    // true = implicit TLS (465); false = STARTTLS, required unless
    // SMTP_REQUIRE_TLS=false (local Mailpit only; refused in production).
    SMTP_SECURE: booleanEnv(false),
    SMTP_REQUIRE_TLS: booleanEnv(true),
    SMTP_USERNAME: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),

    // Story 1.2: Session and Keyed Secret Configuration
    SESSION_ABSOLUTE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(1, 'SESSION_ABSOLUTE_TTL_SECONDS must be at least 1 second')
      .max(
        2592000,
        'SESSION_ABSOLUTE_TTL_SECONDS cannot exceed 30 days (2592000s)',
      )
      .default(2592000),
    OAUTH_INTENT_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60, 'OAUTH_INTENT_TTL_SECONDS must be at least 60 seconds')
      .max(600, 'OAUTH_INTENT_TTL_SECONDS cannot exceed 600 seconds')
      .default(600),
    AUTH_SECRET_PROTECTION_KEY: z
      .string()
      .min(32, 'AUTH_SECRET_PROTECTION_KEY must be at least 32 characters long')
      .optional(),
    AUTH_SECRET_KEY_VERSION: z.coerce.number().int().min(1).default(1),
    // Story 4.5 AC2.3: dedicated HMAC key for External completion-code
    // verifiers. Falls back to JWT_SECRET when unset; set it so rotating
    // JWT_SECRET does not invalidate every live completion code.
    COMPLETION_CODE_HMAC_SECRET: z
      .string()
      .min(
        32,
        'COMPLETION_CODE_HMAC_SECRET must be at least 32 characters long',
      )
      .optional(),
    // Epic 5 review P22: HMAC key of the guest storage capability bound to a
    // survey attempt. Falls back to JWT_SECRET when unset.
    STORAGE_CAPABILITY_SECRET: z
      .string()
      .min(32, 'STORAGE_CAPABILITY_SECRET must be at least 32 characters long')
      .optional(),

    // Story 1.2: Google OAuth Configuration
    GOOGLE_CLIENT_ID: z.string().min(1).default('rescom-google-client-id'),
    GOOGLE_CLIENT_SECRET: z
      .string()
      .min(1)
      .default('rescom-google-client-secret'),
    GOOGLE_REDIRECT_URI: z
      .string()
      .refine(isValidUrl, 'GOOGLE_REDIRECT_URI must be a valid URL')
      .refine(
        checkNoCredentialsOrFragmentOrWildcard,
        'GOOGLE_REDIRECT_URI must not contain credentials, fragments, or wildcard hosts',
      )
      .default('http://localhost:4000/auth/google/callback'),
    AUTH_FRONTEND_SUCCESS_URL: z
      .string()
      .refine(isValidUrl, 'AUTH_FRONTEND_SUCCESS_URL must be a valid URL')
      .refine(
        checkNoCredentialsOrFragmentOrWildcard,
        'AUTH_FRONTEND_SUCCESS_URL must not contain credentials, fragments, or wildcard hosts',
      )
      .default('http://localhost:3000/auth/callback'),
    AUTH_FRONTEND_ERROR_URL: z
      .string()
      .refine(isValidUrl, 'AUTH_FRONTEND_ERROR_URL must be a valid URL')
      .refine(
        checkNoCredentialsOrFragmentOrWildcard,
        'AUTH_FRONTEND_ERROR_URL must not contain credentials, fragments, or wildcard hosts',
      )
      .default('http://localhost:3000/auth/error'),

    // Story 5.3: private S3-compatible storage and malware scanning
    STORAGE_ENDPOINT: z.string().url().default('http://localhost:9000'),
    STORAGE_REGION: z.string().min(1).default('us-east-1'),
    STORAGE_BUCKET: z.string().min(3).default('rescom-private-storage'),
    STORAGE_ACCESS_KEY_ID: z.string().min(1).default('minioadmin'),
    STORAGE_SECRET_ACCESS_KEY: z.string().min(8).default('minioadmin'),
    STORAGE_FORCE_PATH_STYLE: booleanEnv(true),
    MALWARE_SCANNER_HOST: z.string().min(1).default('127.0.0.1'),
    MALWARE_SCANNER_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .default(3310),
    MALWARE_SCANNER_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(120000)
      .default(30000),

    // Story 6.6: platform bank account shown on manual top-up instructions (FR-34)
    TOPUP_BANK_NAME: z.string().trim().min(1).max(100).default('Vietcombank'),
    TOPUP_BANK_BIN: z
      .string()
      .regex(/^\d{6}$/, 'TOPUP_BANK_BIN must be a 6-digit NAPAS bank BIN')
      .default('970436'),
    TOPUP_BANK_ACCOUNT_NUMBER: z
      .string()
      .regex(/^\d{6,19}$/, 'TOPUP_BANK_ACCOUNT_NUMBER must contain 6-19 digits')
      .default(TOPUP_PLACEHOLDER_ACCOUNT_NUMBER),
    TOPUP_BANK_ACCOUNT_NAME: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .default(TOPUP_PLACEHOLDER_ACCOUNT_NAME),
  })
  .superRefine((data, ctx) => {
    const isProduction = data.NODE_ENV === 'production';

    if (data.ABUSE_CONTROL_PROFILE === 'REDIS_SHARED') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ABUSE_CONTROL_PROFILE'],
        message:
          'REDIS_SHARED requires the Redis rate-limit counter store, which is not installed in this build; run one API replica with REDIS_DISABLED_SINGLE_REPLICA',
      });
    }

    // Decision E8-D4: `participation-rate-limit-v1` names the provisional
    // default values only — custom values need their own version name, so
    // rate-limit evidence is never mislabelled.
    if (
      data.PARTICIPATION_RATE_LIMIT_POLICY_VERSION ===
        PARTICIPATION_RATE_LIMIT_POLICY_VERSION &&
      !hasDefaultParticipationRateLimitValues({
        completionLimit: data.PARTICIPATION_COMPLETION_LIMIT,
        completionWindowSeconds: data.PARTICIPATION_COMPLETION_WINDOW_SECONDS,
        burstLimit: data.PARTICIPATION_BURST_LIMIT,
        burstWindowSeconds: data.PARTICIPATION_BURST_WINDOW_SECONDS,
      })
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PARTICIPATION_RATE_LIMIT_POLICY_VERSION'],
        message: `PARTICIPATION_RATE_LIMIT_POLICY_VERSION "${PARTICIPATION_RATE_LIMIT_POLICY_VERSION}" names the default participation limits; name a new policy version for custom PARTICIPATION_* values`,
      });
    }

    // Production secret check
    if (isProduction) {
      if (!data.PARTICIPATION_RATE_LIMIT_POLICY_VERSION) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PARTICIPATION_RATE_LIMIT_POLICY_VERSION'],
          message:
            'PARTICIPATION_RATE_LIMIT_POLICY_VERSION is required in production: name the approved participation rate-limit policy (PRD Open Question 16)',
        });
      }

      if (data.TRUST_PROXY_HOPS < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['TRUST_PROXY_HOPS'],
          message:
            'TRUST_PROXY_HOPS must explicitly trust the production reverse proxy',
        });
      }

      if (!data.AUTH_SECRET_PROTECTION_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_SECRET_PROTECTION_KEY'],
          message: 'AUTH_SECRET_PROTECTION_KEY is required in production',
        });
      }

      if (
        data.GOOGLE_CLIENT_ID === 'rescom-google-client-id' ||
        data.GOOGLE_CLIENT_SECRET === 'rescom-google-client-secret'
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GOOGLE_CLIENT_ID'],
          message:
            'Production requires explicit, non-default GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET',
        });
      }

      if (
        data.STORAGE_ACCESS_KEY_ID === 'minioadmin' ||
        data.STORAGE_SECRET_ACCESS_KEY === 'minioadmin'
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STORAGE_ACCESS_KEY_ID'],
          message: 'Production requires explicit object-storage credentials',
        });
      }

      if (
        data.TOPUP_BANK_ACCOUNT_NUMBER === TOPUP_PLACEHOLDER_ACCOUNT_NUMBER ||
        data.TOPUP_BANK_ACCOUNT_NAME === TOPUP_PLACEHOLDER_ACCOUNT_NAME
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['TOPUP_BANK_ACCOUNT_NUMBER'],
          message:
            'Production requires the real top-up bank account (TOPUP_BANK_ACCOUNT_NUMBER and TOPUP_BANK_ACCOUNT_NAME)',
        });
      }

      const placeholderSecrets: [string, string | undefined][] = [
        ['JWT_SECRET', data.JWT_SECRET],
        ['AUTH_SECRET_PROTECTION_KEY', data.AUTH_SECRET_PROTECTION_KEY],
        ['COMPLETION_CODE_HMAC_SECRET', data.COMPLETION_CODE_HMAC_SECRET],
        ['STORAGE_CAPABILITY_SECRET', data.STORAGE_CAPABILITY_SECRET],
        ['GOOGLE_CLIENT_ID', data.GOOGLE_CLIENT_ID],
        ['GOOGLE_CLIENT_SECRET', data.GOOGLE_CLIENT_SECRET],
        ['STORAGE_ACCESS_KEY_ID', data.STORAGE_ACCESS_KEY_ID],
        ['STORAGE_SECRET_ACCESS_KEY', data.STORAGE_SECRET_ACCESS_KEY],
        ['SMTP_USERNAME', data.SMTP_USERNAME],
        ['SMTP_PASSWORD', data.SMTP_PASSWORD],
      ];
      for (const [key, value] of placeholderSecrets) {
        if (isPlaceholderSecret(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is a placeholder value (replace_with_*, change_me*/changeme*, example*); production requires a real secret`,
          });
        }
      }

      if (
        DEFAULT_CREDENTIAL_VALUES.some((credential) =>
          data.DATABASE_URL.toLowerCase().includes(credential),
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message:
            'DATABASE_URL uses a default development credential; production requires its own database password',
        });
      }

      // Production URLs must be HTTPS
      const urlsToCheck: [string, string][] = [
        ['GOOGLE_REDIRECT_URI', data.GOOGLE_REDIRECT_URI],
        ['AUTH_FRONTEND_SUCCESS_URL', data.AUTH_FRONTEND_SUCCESS_URL],
        ['AUTH_FRONTEND_ERROR_URL', data.AUTH_FRONTEND_ERROR_URL],
      ];

      for (const [key, val] of urlsToCheck) {
        try {
          const parsed = new URL(val);
          if (parsed.protocol !== 'https:') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: `${key} must use HTTPS in production`,
            });
          }
        } catch {
          // Handled by base refinements
        }
      }
    }

    // AUTH_FRONTEND_SUCCESS_URL & AUTH_FRONTEND_ERROR_URL origins must belong to FRONTEND_ORIGINS
    const checkFrontendOrigin = (key: string, urlStr: string) => {
      try {
        const parsed = new URL(urlStr);
        if (!data.FRONTEND_ORIGINS.includes(parsed.origin)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} origin (${parsed.origin}) must be listed in FRONTEND_ORIGINS`,
          });
        }
      } catch {
        // Handled by base refinements
      }
    };

    checkFrontendOrigin(
      'AUTH_FRONTEND_SUCCESS_URL',
      data.AUTH_FRONTEND_SUCCESS_URL,
    );
    checkFrontendOrigin(
      'AUTH_FRONTEND_ERROR_URL',
      data.AUTH_FRONTEND_ERROR_URL,
    );

    // Story IR.4b B-T4 / plan 5.4: email delivery.
    if (data.EMAIL_APP_BASE_URL) {
      checkFrontendOrigin('EMAIL_APP_BASE_URL', data.EMAIL_APP_BASE_URL);
    }
    const emailMode =
      data.EMAIL_DELIVERY_MODE ?? (isProduction ? undefined : 'capture');
    if (isProduction) {
      if (emailMode !== 'smtp') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_DELIVERY_MODE'],
          message:
            'EMAIL_DELIVERY_MODE=smtp is required in production (capture keeps mail in memory, disabled sends none)',
        });
      }
      if (!data.EMAIL_APP_BASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_APP_BASE_URL'],
          message: 'EMAIL_APP_BASE_URL is required in production',
        });
      } else if (
        isValidUrl(data.EMAIL_APP_BASE_URL) &&
        new URL(data.EMAIL_APP_BASE_URL).protocol !== 'https:'
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_APP_BASE_URL'],
          message: 'EMAIL_APP_BASE_URL must use HTTPS in production',
        });
      }
      if (!data.EMAIL_MESSAGE_ID_DOMAIN && !emailFromDomain(data.EMAIL_FROM)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_MESSAGE_ID_DOMAIN'],
          message:
            'Production needs EMAIL_MESSAGE_ID_DOMAIN or an EMAIL_FROM address with a domain',
        });
      }
      if (!data.SMTP_SECURE && !data.SMTP_REQUIRE_TLS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SMTP_REQUIRE_TLS'],
          message:
            'SMTP_REQUIRE_TLS=false is for local Mailpit only; production needs TLS',
        });
      }
    }
    if (emailMode === 'smtp') {
      const required: [string, unknown][] = [
        ['SMTP_HOST', data.SMTP_HOST],
        ['EMAIL_FROM', data.EMAIL_FROM],
        ...(isProduction
          ? ([
              ['SMTP_USERNAME', data.SMTP_USERNAME],
              ['SMTP_PASSWORD', data.SMTP_PASSWORD],
            ] as [string, unknown][])
          : []),
      ];
      for (const [key, value] of required) {
        if (!value) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when EMAIL_DELIVERY_MODE=smtp`,
          });
        }
      }
      if (Boolean(data.SMTP_USERNAME) !== Boolean(data.SMTP_PASSWORD)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SMTP_USERNAME'],
          message: 'Set both SMTP_USERNAME and SMTP_PASSWORD, or neither',
        });
      }
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;
