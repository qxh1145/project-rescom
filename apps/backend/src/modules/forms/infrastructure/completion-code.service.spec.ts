import { CompletionCodeService } from './completion-code.service';
import { EnvService } from '../../../common/config/env.service';

describe('CompletionCodeService', () => {
  let service: CompletionCodeService;
  const testSecret = 'test_super_secure_jwt_secret_key_at_least_32_chars!';
  const formVersionId = '11111111-2222-4333-8444-555555555555';
  const otherVersionId = '99999999-8888-4777-8666-555555555555';

  beforeEach(() => {
    const envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://localhost:5432/test',
      JWT_SECRET: testSecret,
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: 'http://localhost:3000',
    });
    service = new CompletionCodeService(envService);
  });

  describe('generateSixDigitCode', () => {
    it('generates a 6-digit numeric string', () => {
      const code = service.generateSixDigitCode();
      expect(code).toMatch(/^\d{6}$/);
      const num = parseInt(code, 10);
      expect(num).toBeGreaterThanOrEqual(100000);
      expect(num).toBeLessThan(1000000);
    });

    it('generates distinct codes across calls', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 20; i++) {
        codes.add(service.generateSixDigitCode());
      }
      expect(codes.size).toBeGreaterThan(15);
    });
  });

  describe('computeVerifier', () => {
    it('computes a keyed HMAC verifier with v1 prefix', () => {
      const verifier = service.computeVerifier(formVersionId, '654321');
      expect(verifier).toMatch(/^v1:[a-f0-9]{64}$/);
    });

    it('produces identical verifier for identical inputs', () => {
      const v1 = service.computeVerifier(formVersionId, '123456');
      const v2 = service.computeVerifier(formVersionId, '123456');
      expect(v1).toBe(v2);
    });

    it('binds HMAC verifier to formVersionId', () => {
      const v1 = service.computeVerifier(formVersionId, '123456');
      const v2 = service.computeVerifier(otherVersionId, '123456');
      expect(v1).not.toBe(v2);
    });

    it('produces different verifier for different completion codes', () => {
      const v1 = service.computeVerifier(formVersionId, '111111');
      const v2 = service.computeVerifier(formVersionId, '222222');
      expect(v1).not.toBe(v2);
    });
  });

  describe('parseVerifier', () => {
    it('parses valid verifier format', () => {
      const parsed = service.parseVerifier(
        'v1:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      );
      expect(parsed).toEqual({
        keyVersion: 'v1',
        digest:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      });
    });

    it('returns null for empty or invalid strings', () => {
      expect(service.parseVerifier(null)).toBeNull();
      expect(service.parseVerifier('')).toBeNull();
      expect(service.parseVerifier('invalid')).toBeNull();
      expect(service.parseVerifier(':digest')).toBeNull();
      expect(service.parseVerifier('v1:')).toBeNull();
    });
  });

  describe('verifyCode', () => {
    it('returns true when candidate code matches stored verifier for exact formVersionId', () => {
      const code = '582914';
      const verifier = service.computeVerifier(formVersionId, code);

      const isValid = service.verifyCode(formVersionId, code, verifier);
      expect(isValid).toBe(true);
    });

    it('returns false when candidate code is incorrect', () => {
      const verifier = service.computeVerifier(formVersionId, '582914');
      const isValid = service.verifyCode(formVersionId, '999999', verifier);
      expect(isValid).toBe(false);
    });

    it('returns false when formVersionId does not match (binding check)', () => {
      const code = '582914';
      const verifier = service.computeVerifier(formVersionId, code);

      const isValid = service.verifyCode(otherVersionId, code, verifier);
      expect(isValid).toBe(false);
    });

    it('returns false for candidate codes that are not 6 digits', () => {
      const verifier = service.computeVerifier(formVersionId, '123456');
      expect(service.verifyCode(formVersionId, '12345', verifier)).toBe(false);
      expect(service.verifyCode(formVersionId, '1234567', verifier)).toBe(
        false,
      );
      expect(service.verifyCode(formVersionId, 'abcdef', verifier)).toBe(false);
    });

    it('returns false for null or corrupted verifiers', () => {
      expect(service.verifyCode(formVersionId, '123456', null)).toBe(false);
      expect(service.verifyCode(formVersionId, '123456', 'corrupted')).toBe(
        false,
      );
    });
  });
});
