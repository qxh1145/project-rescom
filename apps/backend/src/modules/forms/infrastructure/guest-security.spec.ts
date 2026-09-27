import { Logger } from '@nestjs/common';
import { CaptchaValidatorService } from './captcha-validator.service';
import { GuestSubmissionRateLimiter } from './guest-submission-rate-limiter';

describe('Story 4.4: Guest Security Infrastructure', () => {
  describe('CaptchaValidatorService', () => {
    describe('outside production', () => {
      let service: CaptchaValidatorService;

      beforeEach(() => {
        service = new CaptchaValidatorService({ isProduction: false });
      });

      it('should reject missing or empty token', async () => {
        expect((await service.validateToken(undefined)).isValid).toBe(false);
        expect((await service.validateToken('')).isValid).toBe(false);
        expect((await service.validateToken('   ')).isValid).toBe(false);
      });

      it('should accept test and mock tokens', async () => {
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
        expect((await service.validateToken('bad-token')).isValid).toBe(false);
      });
    });

    describe('in production (Bug 3.3: no provider, fail closed)', () => {
      let warn: jest.SpyInstance;

      beforeEach(() => {
        warn = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);
      });

      afterEach(() => warn.mockRestore());

      it('rejects the test/mock fixtures and any long token', async () => {
        const service = new CaptchaValidatorService({ isProduction: true });

        for (const token of [
          'test-turnstile-token',
          'mock-turnstile-token',
          'a-long-random-looking-token-0123456789',
        ]) {
          await expect(service.validateToken(token)).resolves.toEqual({
            isValid: false,
            error: 'CAPTCHA_PROVIDER_NOT_CONFIGURED',
          });
        }
      });

      it('logs the missing provider once, at construction', async () => {
        const service = new CaptchaValidatorService({ isProduction: true });
        await service.validateToken('test-turnstile-token');
        await service.validateToken('another-token-value');

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/no provider configured/);
      });

      it('does not log outside production', () => {
        new CaptchaValidatorService({ isProduction: false });
        expect(warn).not.toHaveBeenCalled();
      });
    });
  });

  describe('GuestSubmissionRateLimiter', () => {
    const windowMs = 60 * 1000;
    let limiter: GuestSubmissionRateLimiter;

    beforeEach(() => {
      limiter = new GuestSubmissionRateLimiter({ limit: 3, windowMs });
    });

    it('should allow up to 3 acquisitions from the same IP, then refuse', () => {
      const ip = '192.168.1.50';
      const now = 1_000_000;

      expect(limiter.tryAcquire(ip, now)).toBe(true);
      expect(limiter.tryAcquire(ip, now + 1)).toBe(true);
      expect(limiter.tryAcquire(ip, now + 2)).toBe(true);
      expect(limiter.tryAcquire(ip, now + 3)).toBe(false);
    });

    it('should track different IPs independently', () => {
      const now = 1_000_000;
      for (let i = 0; i < 3; i++) {
        expect(limiter.tryAcquire('10.0.0.1', now)).toBe(true);
      }

      expect(limiter.tryAcquire('10.0.0.1', now)).toBe(false);
      expect(limiter.tryAcquire('10.0.0.2', now)).toBe(true);
    });

    it('is atomic: concurrent submissions from one IP get exactly `limit` slots', async () => {
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          Promise.resolve().then(() => limiter.tryAcquire('203.0.113.9')),
        ),
      );

      expect(results.filter(Boolean)).toHaveLength(3);
    });

    it('frees a slot once its window has passed', () => {
      const ip = '10.0.0.3';
      const now = 1_000_000;
      for (let i = 0; i < 3; i++) limiter.tryAcquire(ip, now);

      expect(limiter.tryAcquire(ip, now + windowMs - 1)).toBe(false);
      expect(limiter.tryAcquire(ip, now + windowMs)).toBe(true);
    });

    it('release gives back the most recent slot', () => {
      const ip = '10.0.0.4';
      const now = 1_000_000;
      for (let i = 0; i < 3; i++) limiter.tryAcquire(ip, now);

      limiter.release(ip);

      expect(limiter.tryAcquire(ip, now)).toBe(true);
      expect(limiter.tryAcquire(ip, now)).toBe(false);
    });

    it('release of an unknown key is a no-op', () => {
      limiter.release('10.9.9.9');
      expect(limiter.trackedKeyCount).toBe(0);
    });

    it('prunes every expired key on each call', () => {
      const now = 1_000_000;
      limiter.tryAcquire('10.0.1.1', now);
      limiter.tryAcquire('10.0.1.2', now + 10);
      limiter.tryAcquire('10.0.1.3', now + windowMs / 2);
      expect(limiter.trackedKeyCount).toBe(3);

      // Only the first two are fully expired at this instant.
      limiter.tryAcquire('10.0.1.4', now + windowMs + 10);

      expect(limiter.trackedKeyCount).toBe(2);
    });

    it('caps tracked keys and evicts the least recently acquired first', () => {
      const capped = new GuestSubmissionRateLimiter({
        limit: 1,
        windowMs,
        maxTrackedKeys: 3,
      });
      const now = 1_000_000;

      capped.tryAcquire('ip-1', now);
      capped.tryAcquire('ip-2', now + 1);
      capped.tryAcquire('ip-3', now + 2);
      capped.tryAcquire('ip-4', now + 3);

      expect(capped.trackedKeyCount).toBe(3);
      // ip-1 was evicted (its slot is free again); ip-2..ip-4 still limited.
      expect(capped.tryAcquire('ip-4', now + 4)).toBe(false);
      expect(capped.tryAcquire('ip-1', now + 5)).toBe(true);
      expect(capped.trackedKeyCount).toBe(3);
    });
  });
});
