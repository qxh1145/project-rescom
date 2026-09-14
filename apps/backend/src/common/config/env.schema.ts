import { z } from 'zod';

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
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
          .map((origin) => origin.trim())
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

    // System Monitoring & Metrics Logging
    SYSTEM_METRICS_LOG_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .min(0, 'SYSTEM_METRICS_LOG_INTERVAL_SECONDS must be at least 0')
      .default(30),

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
  })
  .superRefine((data, ctx) => {
    const isProduction = data.NODE_ENV === 'production';

    // Production secret check
    if (isProduction) {
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
  });

export type EnvConfig = z.infer<typeof envSchema>;
