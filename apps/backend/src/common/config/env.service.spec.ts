import { EnvService } from './env.service';

describe('EnvService', () => {
  const validBaseEnv = {
    NODE_ENV: 'test',
    PORT: '4000',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
    JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
    JWT_ACCESS_TTL_SECONDS: '900',
    BCRYPT_ROUNDS: '12',
    FRONTEND_ORIGINS: 'http://localhost:3000,http://127.0.0.1:3000',
  };
  // Story IR.4b B-T4: production refuses to start without SMTP email.
  // IR.5 E3.1: production also requires the scheduler, so it rides along.
  const productionEmailEnv = {
    SCHEDULER_ENABLED: 'true',
    EMAIL_DELIVERY_MODE: 'smtp',
    EMAIL_FROM: 'Rescom <no-reply@rescom.io>',
    EMAIL_APP_BASE_URL: 'https://app.rescom.io',
    SMTP_HOST: 'smtp.example.com',
    SMTP_USERNAME: 'smtp-user',
    SMTP_PASSWORD: 'smtp-password',
  };

  it('should initialize successfully with valid configuration', () => {
    const service = new EnvService(validBaseEnv);
    expect(service.port).toBe(4000);
    expect(service.databaseUrl).toBe(validBaseEnv.DATABASE_URL);
    expect(service.jwtSecret).toBe(validBaseEnv.JWT_SECRET);
    expect(service.jwtAccessTtlSeconds).toBe(900);
    expect(service.bcryptRounds).toBe(12);
    expect(service.frontendOrigins).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ]);
    expect(service.isTest).toBe(true);
    expect(service.isProduction).toBe(false);
    expect(service.trustProxyHops).toBe(0);
    expect(service.rateLimitTtlSeconds).toBe(60);
    expect(service.rateLimitMaxRequests).toBe(100);
    expect(service.authRateLimitTtlSeconds).toBe(60);
    expect(service.authRateLimitMaxRequests).toBe(10);
  });

  it('should fail if DATABASE_URL is missing', () => {
    const env = { ...validBaseEnv, DATABASE_URL: '' };
    expect(() => new EnvService(env)).toThrow(/DATABASE_URL is required/);
  });

  it('should fail if JWT_SECRET is less than 32 characters', () => {
    const env = { ...validBaseEnv, JWT_SECRET: 'short_secret_under_32' };
    expect(() => new EnvService(env)).toThrow(
      /JWT_SECRET must be at least 32 characters long/,
    );
  });

  it('should fail if BCRYPT_ROUNDS is less than 12', () => {
    const env = { ...validBaseEnv, BCRYPT_ROUNDS: '10' };
    expect(() => new EnvService(env)).toThrow(
      /BCRYPT_ROUNDS must be at least 12/,
    );
  });

  it('should accept BCRYPT_ROUNDS at the operational maximum of 14', () => {
    const service = new EnvService({
      ...validBaseEnv,
      BCRYPT_ROUNDS: '14',
    });

    expect(service.bcryptRounds).toBe(14);
  });

  it('should reject BCRYPT_ROUNDS above the operational maximum of 14', () => {
    const env = { ...validBaseEnv, BCRYPT_ROUNDS: '15' };

    expect(() => new EnvService(env)).toThrow(/BCRYPT_ROUNDS cannot exceed 14/);
  });

  it('should reject wildcard (*) in FRONTEND_ORIGINS', () => {
    const env = {
      ...validBaseEnv,
      FRONTEND_ORIGINS: 'http://localhost:3000,*',
    };
    expect(() => new EnvService(env)).toThrow(
      /Wildcard origin \(\*\) is strictly forbidden/,
    );
  });

  it('should use default values when optional fields are omitted', () => {
    const minimalEnv = {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
    };
    const service = new EnvService(minimalEnv);
    expect(service.nodeEnv).toBe('development');
    expect(service.port).toBe(4000);
    expect(service.jwtAccessTtlSeconds).toBe(900);
    expect(service.bcryptRounds).toBe(12);
    expect(service.frontendOrigins).toEqual(['http://localhost:3000']);
  });

  describe('AC12: Google OAuth & Session configuration validation', () => {
    it('requires an explicit trusted proxy hop in production', () => {
      const productionEnv = {
        ...validBaseEnv,
        NODE_ENV: 'production',
        AUTH_SECRET_PROTECTION_KEY:
          'super_secret_protection_key_at_least_32_chars!',
        GOOGLE_CLIENT_ID: 'real-client-id',
        GOOGLE_CLIENT_SECRET: 'real-client-secret',
        FRONTEND_ORIGINS: 'https://app.rescom.io',
        GOOGLE_REDIRECT_URI: 'https://api.rescom.io/auth/google/callback',
        AUTH_FRONTEND_SUCCESS_URL: 'https://app.rescom.io/callback',
        AUTH_FRONTEND_ERROR_URL: 'https://app.rescom.io/error',
        STORAGE_ACCESS_KEY_ID: 'production-storage-key',
        STORAGE_SECRET_ACCESS_KEY: 'production-storage-secret',
        TOPUP_BANK_ACCOUNT_NUMBER: '1234567890',
        TOPUP_BANK_ACCOUNT_NAME: 'CONG TY RESCOM',
        PARTICIPATION_RATE_LIMIT_POLICY_VERSION: 'participation-rate-limit-v1',
        ...productionEmailEnv,
      };

      expect(() => new EnvService(productionEnv)).toThrow(
        /TRUST_PROXY_HOPS must explicitly trust the production reverse proxy/,
      );
      expect(
        new EnvService({ ...productionEnv, TRUST_PROXY_HOPS: '1' })
          .trustProxyHops,
      ).toBe(1);
    });

    it('should reject URLs with credentials or fragments', () => {
      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            GOOGLE_REDIRECT_URI:
              'http://user:pass@localhost:4000/auth/google/callback',
          }),
      ).toThrow(/must not contain credentials, fragments, or wildcard hosts/);

      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            AUTH_FRONTEND_SUCCESS_URL: 'http://localhost:3000/auth#fragment',
          }),
      ).toThrow(/must not contain credentials, fragments, or wildcard hosts/);
    });

    it('should reject frontend redirect URL whose origin is not in FRONTEND_ORIGINS', () => {
      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            FRONTEND_ORIGINS: 'http://localhost:3000',
            AUTH_FRONTEND_SUCCESS_URL: 'http://evil.com/callback',
          }),
      ).toThrow(/must be listed in FRONTEND_ORIGINS/);
    });

    it('should enforce TTL bounds', () => {
      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            OAUTH_INTENT_TTL_SECONDS: '30',
          }),
      ).toThrow(/OAUTH_INTENT_TTL_SECONDS must be at least 60 seconds/);

      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            OAUTH_INTENT_TTL_SECONDS: '700',
          }),
      ).toThrow(/OAUTH_INTENT_TTL_SECONDS cannot exceed 600 seconds/);

      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            SESSION_ABSOLUTE_TTL_SECONDS: '0',
          }),
      ).toThrow(/SESSION_ABSOLUTE_TTL_SECONDS must be at least 1 second/);

      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            SESSION_ABSOLUTE_TTL_SECONDS: '3000000',
          }),
      ).toThrow(/cannot exceed 30 days/);
    });

    it('should require AUTH_SECRET_PROTECTION_KEY in production', () => {
      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            NODE_ENV: 'production',
            GOOGLE_CLIENT_ID: 'real-client-id',
            GOOGLE_CLIENT_SECRET: 'real-client-secret',
            FRONTEND_ORIGINS: 'https://app.rescom.io',
            GOOGLE_REDIRECT_URI: 'https://api.rescom.io/auth/google/callback',
            AUTH_FRONTEND_SUCCESS_URL: 'https://app.rescom.io/callback',
            AUTH_FRONTEND_ERROR_URL: 'https://app.rescom.io/error',
          }),
      ).toThrow(/AUTH_SECRET_PROTECTION_KEY is required in production/);
    });

    it('should require HTTPS in production', () => {
      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            NODE_ENV: 'production',
            AUTH_SECRET_PROTECTION_KEY:
              'super_secret_protection_key_at_least_32_chars!',
            GOOGLE_CLIENT_ID: 'real-client-id',
            GOOGLE_CLIENT_SECRET: 'real-client-secret',
            FRONTEND_ORIGINS: 'https://app.rescom.io',
            GOOGLE_REDIRECT_URI: 'http://api.rescom.io/auth/google/callback',
            AUTH_FRONTEND_SUCCESS_URL: 'https://app.rescom.io/callback',
            AUTH_FRONTEND_ERROR_URL: 'https://app.rescom.io/error',
          }),
      ).toThrow(/must use HTTPS in production/);
    });
  });

  describe('IR.1: production refuses placeholder and default credentials', () => {
    const productionEnv = {
      ...validBaseEnv,
      NODE_ENV: 'production',
      TRUST_PROXY_HOPS: '1',
      AUTH_SECRET_PROTECTION_KEY:
        'super_secret_protection_key_at_least_32_chars!',
      COMPLETION_CODE_HMAC_SECRET: 'real_completion_code_hmac_secret_32_chars!',
      STORAGE_CAPABILITY_SECRET: 'real_storage_capability_secret_32_chars!',
      GOOGLE_CLIENT_ID: 'real-client-id',
      GOOGLE_CLIENT_SECRET: 'real-client-secret',
      FRONTEND_ORIGINS: 'https://app.rescom.io',
      GOOGLE_REDIRECT_URI: 'https://api.rescom.io/auth/google/callback',
      AUTH_FRONTEND_SUCCESS_URL: 'https://app.rescom.io/callback',
      AUTH_FRONTEND_ERROR_URL: 'https://app.rescom.io/error',
      STORAGE_ACCESS_KEY_ID: 'production-storage-key',
      STORAGE_SECRET_ACCESS_KEY: 'production-storage-secret',
      TOPUP_BANK_ACCOUNT_NUMBER: '1234567890',
      TOPUP_BANK_ACCOUNT_NAME: 'CONG TY RESCOM',
      PARTICIPATION_RATE_LIMIT_POLICY_VERSION: 'participation-rate-limit-v1',
      ...productionEmailEnv,
    };

    it('accepts a valid production configuration', () => {
      expect(new EnvService(productionEnv).isProduction).toBe(true);
    });

    const placeholderCases: [string, string][] = [
      [
        'JWT_SECRET',
        'replace_with_at_least_32_characters_secret_for_local_dev_only',
      ],
      ['JWT_SECRET', 'changeme_changeme_changeme_changeme_changeme'],
      ['GOOGLE_CLIENT_ID', 'CHANGE_ME'],
      ['SMTP_PASSWORD', 'CHANGE_ME'],
      ['STORAGE_ACCESS_KEY_ID', 'CHANGE_ME_min_3_chars'],
      ['JWT_SECRET', 'example_secret_example_secret_example_secret'],
      [
        'AUTH_SECRET_PROTECTION_KEY',
        'replace_with_at_least_32_characters_key_for_protection_only',
      ],
      [
        'COMPLETION_CODE_HMAC_SECRET',
        'replace_with_at_least_32_characters_completion_code_key',
      ],
      [
        'STORAGE_CAPABILITY_SECRET',
        'replace_with_at_least_32_characters_storage_capability_key',
      ],
      ['GOOGLE_CLIENT_ID', 'replace_with_google_client_id'],
      ['GOOGLE_CLIENT_SECRET', 'replace_with_google_client_secret'],
      ['SMTP_USERNAME', 'replace_with_smtp_username'],
      ['SMTP_PASSWORD', 'replace_with_smtp_password'],
    ];

    it.each(placeholderCases)('refuses placeholder %s (%s)', (key, value) => {
      expect(() => new EnvService({ ...productionEnv, [key]: value })).toThrow(
        new RegExp(`${key} is a placeholder value`),
      );
    });

    it('accepts the same placeholders outside production', () => {
      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            JWT_SECRET:
              'replace_with_at_least_32_characters_secret_for_local_dev_only',
          }),
      ).not.toThrow();
    });

    it.each(['STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY'])(
      'refuses default minioadmin %s',
      (key) => {
        expect(
          () => new EnvService({ ...productionEnv, [key]: 'minioadmin' }),
        ).toThrow(/object-storage credentials/);
      },
    );

    it('refuses the default database password', () => {
      expect(
        () =>
          new EnvService({
            ...productionEnv,
            DATABASE_URL:
              'postgresql://rescom_admin:rescom_password@db:5432/rescom_db',
          }),
      ).toThrow(/DATABASE_URL uses a default development credential/);
    });

    it('refuses the unedited CHANGE_ME database password of the deploy template', () => {
      expect(
        () =>
          new EnvService({
            ...productionEnv,
            DATABASE_URL:
              'postgresql://rescom:CHANGE_ME_db_password_hex_only@postgres:5432/rescom',
          }),
      ).toThrow(/DATABASE_URL uses a default development credential/);
    });
  });

  describe('Story 6.6: top-up bank configuration', () => {
    it('provides safe development defaults', () => {
      const service = new EnvService(validBaseEnv);
      expect(service.topUpBankName).toBe('Vietcombank');
      expect(service.topUpBankBin).toBe('970436');
      expect(service.topUpBankAccountNumber).toBe('0000000000');
      expect(service.topUpBankAccountName).toBe('RESCOM DEMO');
    });

    it('accepts explicit values and rejects malformed BIN/account numbers', () => {
      const service = new EnvService({
        ...validBaseEnv,
        TOPUP_BANK_NAME: 'MB Bank',
        TOPUP_BANK_BIN: '970422',
        TOPUP_BANK_ACCOUNT_NUMBER: '0123456789012',
        TOPUP_BANK_ACCOUNT_NAME: 'CONG TY RESCOM',
      });
      expect(service.topUpBankBin).toBe('970422');
      expect(service.topUpBankAccountNumber).toBe('0123456789012');

      expect(
        () => new EnvService({ ...validBaseEnv, TOPUP_BANK_BIN: '97042' }),
      ).toThrow(/TOPUP_BANK_BIN/);
      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            TOPUP_BANK_ACCOUNT_NUMBER: '12-34',
          }),
      ).toThrow(/TOPUP_BANK_ACCOUNT_NUMBER/);
    });

    it('refuses the placeholder bank account in production', () => {
      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            NODE_ENV: 'production',
            TRUST_PROXY_HOPS: '1',
            AUTH_SECRET_PROTECTION_KEY:
              'super_secret_protection_key_at_least_32_chars!',
            GOOGLE_CLIENT_ID: 'real-client-id',
            GOOGLE_CLIENT_SECRET: 'real-client-secret',
            FRONTEND_ORIGINS: 'https://app.rescom.io',
            GOOGLE_REDIRECT_URI: 'https://api.rescom.io/auth/google/callback',
            AUTH_FRONTEND_SUCCESS_URL: 'https://app.rescom.io/callback',
            AUTH_FRONTEND_ERROR_URL: 'https://app.rescom.io/error',
            STORAGE_ACCESS_KEY_ID: 'production-storage-key',
            STORAGE_SECRET_ACCESS_KEY: 'production-storage-secret',
          }),
      ).toThrow(/Production requires the real top-up bank account/);
    });
  });

  describe('Story 8.2: participation rate-limit policy (FR-46, AD-6)', () => {
    it('defaults to the provisional central policy and the single-replica profile', () => {
      const service = new EnvService(validBaseEnv);
      expect(service.abuseControlProfile).toBe('REDIS_DISABLED_SINGLE_REPLICA');
      expect(service.participationRateLimitPolicy).toEqual({
        completionLimit: 20,
        completionWindowSeconds: 3600,
        burstLimit: 10,
        burstWindowSeconds: 60,
        policyVersion: 'participation-rate-limit-v1',
      });
    });

    it('accepts explicit limits', () => {
      const service = new EnvService({
        ...validBaseEnv,
        PARTICIPATION_COMPLETION_LIMIT: '5',
        PARTICIPATION_COMPLETION_WINDOW_SECONDS: '600',
        PARTICIPATION_BURST_LIMIT: '3',
        PARTICIPATION_BURST_WINDOW_SECONDS: '30',
      });
      expect(service.participationRateLimitPolicy).toEqual({
        completionLimit: 5,
        completionWindowSeconds: 600,
        burstLimit: 3,
        burstWindowSeconds: 30,
        // Outside production an unset version falls back to the default name.
        policyVersion: 'participation-rate-limit-v1',
      });
    });

    it('rejects non-positive limits', () => {
      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            PARTICIPATION_COMPLETION_LIMIT: '0',
          }),
      ).toThrow(/PARTICIPATION_COMPLETION_LIMIT/);
      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            PARTICIPATION_BURST_WINDOW_SECONDS: '0',
          }),
      ).toThrow(/PARTICIPATION_BURST_WINDOW_SECONDS/);
    });

    describe('decision E8-D4: explicit policy version', () => {
      const productionEnv = {
        ...validBaseEnv,
        NODE_ENV: 'production',
        TRUST_PROXY_HOPS: '1',
        AUTH_SECRET_PROTECTION_KEY:
          'super_secret_protection_key_at_least_32_chars!',
        GOOGLE_CLIENT_ID: 'real-client-id',
        GOOGLE_CLIENT_SECRET: 'real-client-secret',
        FRONTEND_ORIGINS: 'https://app.rescom.io',
        GOOGLE_REDIRECT_URI: 'https://api.rescom.io/auth/google/callback',
        AUTH_FRONTEND_SUCCESS_URL: 'https://app.rescom.io/callback',
        AUTH_FRONTEND_ERROR_URL: 'https://app.rescom.io/error',
        STORAGE_ACCESS_KEY_ID: 'production-storage-key',
        STORAGE_SECRET_ACCESS_KEY: 'production-storage-secret',
        TOPUP_BANK_ACCOUNT_NUMBER: '1234567890',
        TOPUP_BANK_ACCOUNT_NAME: 'CONG TY RESCOM',
        ...productionEmailEnv,
      };

      it('is required in production', () => {
        expect(() => new EnvService(productionEnv)).toThrow(
          /PARTICIPATION_RATE_LIMIT_POLICY_VERSION is required in production/,
        );
      });

      it('names the policy in production, also for tuned values', () => {
        const service = new EnvService({
          ...productionEnv,
          PARTICIPATION_RATE_LIMIT_POLICY_VERSION:
            ' participation-rate-limit-2026-10-pilot ',
          PARTICIPATION_COMPLETION_LIMIT: '15',
        });
        expect(service.participationRateLimitPolicyVersion).toBe(
          'participation-rate-limit-2026-10-pilot',
        );
        expect(service.participationRateLimitPolicy).toMatchObject({
          completionLimit: 15,
          policyVersion: 'participation-rate-limit-2026-10-pilot',
        });
      });

      it('accepts the default name for the default values in production', () => {
        const service = new EnvService({
          ...productionEnv,
          PARTICIPATION_RATE_LIMIT_POLICY_VERSION:
            'participation-rate-limit-v1',
        });
        expect(service.participationRateLimitPolicy.policyVersion).toBe(
          'participation-rate-limit-v1',
        );
      });

      it('refuses the default name for custom values in any environment', () => {
        for (const env of [validBaseEnv, productionEnv]) {
          expect(
            () =>
              new EnvService({
                ...env,
                PARTICIPATION_RATE_LIMIT_POLICY_VERSION:
                  'participation-rate-limit-v1',
                PARTICIPATION_BURST_LIMIT: '25',
              }),
          ).toThrow(/names the default participation limits/);
        }
      });

      it('rejects a malformed version name', () => {
        for (const version of ['has space', '-dash-first', 'x'.repeat(65)]) {
          expect(
            () =>
              new EnvService({
                ...validBaseEnv,
                PARTICIPATION_RATE_LIMIT_POLICY_VERSION: version,
              }),
          ).toThrow(/PARTICIPATION_RATE_LIMIT_POLICY_VERSION/);
        }
      });
    });

    it('refuses the REDIS_SHARED profile until a Redis counter store is installed', () => {
      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            ABUSE_CONTROL_PROFILE: 'REDIS_SHARED',
          }),
      ).toThrow(/ABUSE_CONTROL_PROFILE/);
      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            ABUSE_CONTROL_PROFILE: 'SOMETHING',
          }),
      ).toThrow(/ABUSE_CONTROL_PROFILE/);
    });
  });

  describe('Epic 5 review P22: storage capability secret', () => {
    it('falls back to JWT_SECRET when no dedicated secret is configured', () => {
      const service = new EnvService(validBaseEnv);
      expect(service.storageCapabilitySecret).toBe(validBaseEnv.JWT_SECRET);
    });

    it('uses the dedicated STORAGE_CAPABILITY_SECRET when set', () => {
      const secret = 'dedicated_storage_capability_secret_32_chars_min!!';
      const service = new EnvService({
        ...validBaseEnv,
        STORAGE_CAPABILITY_SECRET: secret,
      });
      expect(service.storageCapabilitySecret).toBe(secret);
    });

    it('rejects a short STORAGE_CAPABILITY_SECRET', () => {
      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            STORAGE_CAPABILITY_SECRET: 'too-short',
          }),
      ).toThrow(/STORAGE_CAPABILITY_SECRET/);
    });
  });

  describe('BE-9: STORAGE_FORCE_PATH_STYLE boolean parsing', () => {
    it('defaults to true when unset', () => {
      const service = new EnvService(validBaseEnv);
      expect(service.storageForcePathStyle).toBe(true);
    });

    it('parses "false" as false', () => {
      const service = new EnvService({
        ...validBaseEnv,
        STORAGE_FORCE_PATH_STYLE: 'false',
      });
      expect(service.storageForcePathStyle).toBe(false);
    });

    it('parses "0" as false', () => {
      const service = new EnvService({
        ...validBaseEnv,
        STORAGE_FORCE_PATH_STYLE: '0',
      });
      expect(service.storageForcePathStyle).toBe(false);
    });

    it('parses "true" as true', () => {
      const service = new EnvService({
        ...validBaseEnv,
        STORAGE_FORCE_PATH_STYLE: 'true',
      });
      expect(service.storageForcePathStyle).toBe(true);
    });

    it('accepts case-insensitive/trimmed textual forms (1/yes/on, no/off)', () => {
      expect(
        new EnvService({
          ...validBaseEnv,
          STORAGE_FORCE_PATH_STYLE: ' 1 ',
        }).storageForcePathStyle,
      ).toBe(true);
      expect(
        new EnvService({
          ...validBaseEnv,
          STORAGE_FORCE_PATH_STYLE: 'YES',
        }).storageForcePathStyle,
      ).toBe(true);
      expect(
        new EnvService({
          ...validBaseEnv,
          STORAGE_FORCE_PATH_STYLE: 'On',
        }).storageForcePathStyle,
      ).toBe(true);
      expect(
        new EnvService({
          ...validBaseEnv,
          STORAGE_FORCE_PATH_STYLE: 'NO',
        }).storageForcePathStyle,
      ).toBe(false);
      expect(
        new EnvService({
          ...validBaseEnv,
          STORAGE_FORCE_PATH_STYLE: 'Off',
        }).storageForcePathStyle,
      ).toBe(false);
    });

    it('rejects a garbage value instead of silently coercing it to true', () => {
      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            STORAGE_FORCE_PATH_STYLE: 'garbage',
          }),
      ).toThrow(/STORAGE_FORCE_PATH_STYLE/);
    });
  });

  describe('Story IR.2b scheduler settings', () => {
    it('defaults to disabled, 15 s ticks and 8 Outbox attempts', () => {
      const service = new EnvService(validBaseEnv);
      expect(service.schedulerEnabled).toBe(false);
      expect(service.schedulerTickSeconds).toBe(15);
      expect(service.outboxMaxAttempts).toBe(8);
    });

    it.each([
      ['true', true],
      ['1', true],
      ['on', true],
      ['false', false],
      ['0', false],
      ['off', false],
    ])(
      'reads SCHEDULER_ENABLED=%s as %s (never z.coerce.boolean)',
      (raw, expected) => {
        expect(
          new EnvService({ ...validBaseEnv, SCHEDULER_ENABLED: raw })
            .schedulerEnabled,
        ).toBe(expected);
      },
    );

    it('refuses SCHEDULER_ENABLED=false (or unset) in production (IR.5 E3.1)', () => {
      const production = {
        ...validBaseEnv,
        NODE_ENV: 'production',
        TRUST_PROXY_HOPS: '1',
        AUTH_SECRET_PROTECTION_KEY:
          'super_secret_protection_key_at_least_32_chars!',
        COMPLETION_CODE_HMAC_SECRET:
          'real_completion_code_hmac_secret_32_chars!',
        STORAGE_CAPABILITY_SECRET: 'real_storage_capability_secret_32_chars!',
        GOOGLE_CLIENT_ID: 'real-client-id',
        GOOGLE_CLIENT_SECRET: 'real-client-secret',
        FRONTEND_ORIGINS: 'https://app.rescom.io',
        GOOGLE_REDIRECT_URI: 'https://api.rescom.io/auth/google/callback',
        AUTH_FRONTEND_SUCCESS_URL: 'https://app.rescom.io/callback',
        AUTH_FRONTEND_ERROR_URL: 'https://app.rescom.io/error',
        STORAGE_ACCESS_KEY_ID: 'production-storage-key',
        STORAGE_SECRET_ACCESS_KEY: 'production-storage-secret',
        TOPUP_BANK_ACCOUNT_NUMBER: '1234567890',
        TOPUP_BANK_ACCOUNT_NAME: 'CONG TY RESCOM',
        PARTICIPATION_RATE_LIMIT_POLICY_VERSION: 'participation-rate-limit-v1',
        ...productionEmailEnv,
      };
      expect(new EnvService(production).schedulerEnabled).toBe(true);
      expect(
        () => new EnvService({ ...production, SCHEDULER_ENABLED: 'false' }),
      ).toThrow(/SCHEDULER_ENABLED must be true in production/);
      const { SCHEDULER_ENABLED: _unset, ...unset } = production;
      expect(() => new EnvService(unset)).toThrow(
        /SCHEDULER_ENABLED must be true in production/,
      );
    });

    it('rejects an invalid flag and out-of-range bounds', () => {
      expect(
        () => new EnvService({ ...validBaseEnv, SCHEDULER_ENABLED: 'maybe' }),
      ).toThrow(/SCHEDULER_ENABLED/);
      expect(
        () => new EnvService({ ...validBaseEnv, SCHEDULER_TICK_SECONDS: '0' }),
      ).toThrow(/SCHEDULER_TICK_SECONDS/);
      expect(
        () =>
          new EnvService({ ...validBaseEnv, SCHEDULER_TICK_SECONDS: '301' }),
      ).toThrow(/SCHEDULER_TICK_SECONDS/);
      expect(
        () => new EnvService({ ...validBaseEnv, OUTBOX_MAX_ATTEMPTS: '51' }),
      ).toThrow(/OUTBOX_MAX_ATTEMPTS/);
      expect(
        new EnvService({ ...validBaseEnv, OUTBOX_MAX_ATTEMPTS: '3' })
          .outboxMaxAttempts,
      ).toBe(3);
    });
  });

  describe('Story IR.4b B-T4 / plan 5.4: email delivery', () => {
    const productionBase = {
      ...validBaseEnv,
      NODE_ENV: 'production',
      TRUST_PROXY_HOPS: '1',
      AUTH_SECRET_PROTECTION_KEY:
        'super_secret_protection_key_at_least_32_chars!',
      GOOGLE_CLIENT_ID: 'real-client-id',
      GOOGLE_CLIENT_SECRET: 'real-client-secret',
      FRONTEND_ORIGINS: 'https://app.rescom.io',
      GOOGLE_REDIRECT_URI: 'https://api.rescom.io/auth/google/callback',
      AUTH_FRONTEND_SUCCESS_URL: 'https://app.rescom.io/callback',
      AUTH_FRONTEND_ERROR_URL: 'https://app.rescom.io/error',
      STORAGE_ACCESS_KEY_ID: 'production-storage-key',
      STORAGE_SECRET_ACCESS_KEY: 'production-storage-secret',
      TOPUP_BANK_ACCOUNT_NUMBER: '1234567890',
      TOPUP_BANK_ACCOUNT_NAME: 'CONG TY RESCOM',
      PARTICIPATION_RATE_LIMIT_POLICY_VERSION: 'participation-rate-limit-v1',
    };

    it('defaults to capture with links on the first frontend origin outside production', () => {
      const service = new EnvService(validBaseEnv);
      expect(service.emailDeliveryMode).toBe('capture');
      expect(service.emailAppBaseUrl).toBe('http://localhost:3000');
      expect(service.emailReplyTo).toBeNull();
      expect(service.emailSendTimeoutMs).toBe(10000);
      expect(service.smtp).toMatchObject({
        port: 587,
        secure: false,
        requireTls: true,
        username: null,
        password: null,
      });
    });

    it('accepts local Mailpit SMTP without credentials or TLS', () => {
      const service = new EnvService({
        ...validBaseEnv,
        EMAIL_DELIVERY_MODE: 'smtp',
        EMAIL_FROM: 'Rescom <no-reply@rescom.local>',
        SMTP_HOST: 'localhost',
        SMTP_PORT: '1025',
        SMTP_REQUIRE_TLS: 'false',
        EMAIL_APP_BASE_URL: 'http://127.0.0.1:3000/',
      });
      expect(service.emailDeliveryMode).toBe('smtp');
      expect(service.smtp).toMatchObject({
        host: 'localhost',
        port: 1025,
        requireTls: false,
      });
      expect(service.emailAppBaseUrl).toBe('http://127.0.0.1:3000');
    });

    it('requires host and sender for smtp, and both credentials or neither', () => {
      expect(
        () => new EnvService({ ...validBaseEnv, EMAIL_DELIVERY_MODE: 'smtp' }),
      ).toThrow(/SMTP_HOST is required.*EMAIL_FROM is required/);
      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            EMAIL_DELIVERY_MODE: 'smtp',
            SMTP_HOST: 'localhost',
            EMAIL_FROM: 'a@b.co',
            SMTP_USERNAME: 'only-user',
          }),
      ).toThrow(/Set both SMTP_USERNAME and SMTP_PASSWORD/);
    });

    it('derives the Message-ID domain from EMAIL_FROM unless set (L8)', () => {
      expect(new EnvService(validBaseEnv).emailMessageIdDomain).toBe(
        'rescom.local',
      );
      expect(
        new EnvService({
          ...validBaseEnv,
          EMAIL_FROM: 'Rescom <No-Reply@Mail.Rescom.VN>',
        }).emailMessageIdDomain,
      ).toBe('mail.rescom.vn');
      expect(
        new EnvService({
          ...validBaseEnv,
          EMAIL_FROM: 'no-reply@rescom.vn',
          EMAIL_MESSAGE_ID_DOMAIN: 'msg.rescom.vn',
        }).emailMessageIdDomain,
      ).toBe('msg.rescom.vn');
    });

    it('rejects a link base with a query string or fragment (L10)', () => {
      for (const value of [
        'http://localhost:3000/?a=1',
        'http://localhost:3000/#x',
      ]) {
        expect(
          () => new EnvService({ ...validBaseEnv, EMAIL_APP_BASE_URL: value }),
        ).toThrow(/EMAIL_APP_BASE_URL must not contain/);
      }
    });

    it('rejects a link base outside FRONTEND_ORIGINS', () => {
      expect(
        () =>
          new EnvService({
            ...validBaseEnv,
            EMAIL_APP_BASE_URL: 'https://evil.example',
          }),
      ).toThrow(/EMAIL_APP_BASE_URL origin/);
    });

    it('refuses capture, disabled and an unset mode in production', () => {
      for (const mode of [undefined, 'capture', 'disabled']) {
        expect(
          () =>
            new EnvService({
              ...productionBase,
              ...productionEmailEnv,
              EMAIL_DELIVERY_MODE: mode,
            }),
        ).toThrow(/EMAIL_DELIVERY_MODE=smtp is required in production/);
      }
    });

    it('requires credentials, HTTPS links and TLS in production', () => {
      expect(
        () =>
          new EnvService({
            ...productionBase,
            ...productionEmailEnv,
            SMTP_USERNAME: undefined,
            SMTP_PASSWORD: undefined,
          }),
      ).toThrow(/SMTP_USERNAME is required/);
      expect(
        () =>
          new EnvService({
            ...productionBase,
            ...productionEmailEnv,
            EMAIL_APP_BASE_URL: undefined,
          }),
      ).toThrow(/EMAIL_APP_BASE_URL is required in production/);
      expect(
        () =>
          new EnvService({
            ...productionBase,
            ...productionEmailEnv,
            SMTP_REQUIRE_TLS: 'false',
          }),
      ).toThrow(/SMTP_REQUIRE_TLS=false is for local Mailpit only/);
      expect(
        () =>
          new EnvService({
            ...productionBase,
            ...productionEmailEnv,
            EMAIL_FROM: 'Rescom',
          }),
      ).toThrow(/Production needs EMAIL_MESSAGE_ID_DOMAIN/);
      expect(
        new EnvService({ ...productionBase, ...productionEmailEnv })
          .emailDeliveryMode,
      ).toBe('smtp');
    });
  });
});
