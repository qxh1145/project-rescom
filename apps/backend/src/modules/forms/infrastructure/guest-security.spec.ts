import { CaptchaValidatorService } from './captcha-validator.service';
import { GuestSubmissionRateLimiter } from './guest-submission-rate-limiter';

describe('Story 4.4: Guest Security Infrastructure', () => {
  describe('CaptchaValidatorService', () => {
    let service: CaptchaValidatorService;

    beforeEach(() => {
      service = new CaptchaValidatorService({
        isTest: true,
      });
    });

    it('should reject missing or empty token', async () => {
      expect((await service.validateToken(undefined)).isValid).toBe(false);
      expect((await service.validateToken('')).isValid).toBe(false);
      expect((await service.validateToken('   ')).isValid).toBe(false);
    });

    it('should accept valid test tokens in test mode', async () => {
      expect(
        (await service.validateToken('test-turnstile-token')).isValid,
      ).toBe(true);
      expect(
        (await service.validateToken('mock-turnstile-token')).isValid,
      ).toBe(true);
      expect((await service.validateToken('valid-token-123')).isValid).toBe(
        true,
      );
    });

    it('should reject explicit invalid tokens', async () => {
      expect(
        (await service.validateToken('invalid-captcha-token')).isValid,
      ).toBe(false);
    });
  });

  describe('GuestSubmissionRateLimiter', () => {
    let limiter: GuestSubmissionRateLimiter;

    beforeEach(() => {
      // 3 per window
      limiter = new GuestSubmissionRateLimiter({
        limit: 3,
        windowMs: 60 * 1000,
      });
    });

    it('should allow up to 3 submissions from the same IP', async () => {
      const ip = '192.168.1.50';

      const check1 = await limiter.checkRateLimit(ip);
      expect(check1.isAllowed).toBe(true);
      expect(check1.remaining).toBe(3);
      await limiter.recordSubmission(ip);

      const check2 = await limiter.checkRateLimit(ip);
      expect(check2.isAllowed).toBe(true);
      expect(check2.remaining).toBe(2);
      await limiter.recordSubmission(ip);

      const check3 = await limiter.checkRateLimit(ip);
      expect(check3.isAllowed).toBe(true);
      expect(check3.remaining).toBe(1);
      await limiter.recordSubmission(ip);

      // 4th attempt should be blocked
      const check4 = await limiter.checkRateLimit(ip);
      expect(check4.isAllowed).toBe(false);
      expect(check4.remaining).toBe(0);
    });

    it('should track different IPs independently', async () => {
      const ip1 = '10.0.0.1';
      const ip2 = '10.0.0.2';

      for (let i = 0; i < 3; i++) {
        await limiter.recordSubmission(ip1);
      }

      expect((await limiter.checkRateLimit(ip1)).isAllowed).toBe(false);
      expect((await limiter.checkRateLimit(ip2)).isAllowed).toBe(true);
      expect((await limiter.checkRateLimit(ip2)).remaining).toBe(3);
    });
  });
});
