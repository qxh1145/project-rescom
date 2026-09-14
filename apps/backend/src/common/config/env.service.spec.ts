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
});
