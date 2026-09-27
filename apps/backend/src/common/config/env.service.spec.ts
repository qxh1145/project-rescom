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
});
