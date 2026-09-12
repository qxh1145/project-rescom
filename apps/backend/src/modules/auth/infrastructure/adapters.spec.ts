import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { BcryptPasswordHasherAdapter } from './bcrypt-password-hasher.adapter';
import { NestJwtTokenAdapter } from './nest-jwt-token.adapter';
import { EnvService } from '../../../common/config/env.service';

describe('Auth Infrastructure Adapters', () => {
  const mockEnvService = {
    jwtSecret: 'at_least_32_characters_super_secure_jwt_secret_key!',
    jwtAccessTtlSeconds: 900,
    bcryptRounds: 12,
  } as EnvService;

  describe('BcryptPasswordHasherAdapter', () => {
    let hasher: BcryptPasswordHasherAdapter;

    beforeEach(() => {
      hasher = new BcryptPasswordHasherAdapter(mockEnvService);
    });

    it('should hash a password and correctly verify it', async () => {
      const password = 'CorrectPassword123!';
      const hash = await hasher.hash(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.startsWith('$2a$12$') || hash.startsWith('$2b$12$')).toBe(
        true,
      );

      const isMatch = await hasher.compare(password, hash);
      expect(isMatch).toBe(true);

      const isWrong = await hasher.compare('WrongPassword123!', hash);
      expect(isWrong).toBe(false);

      const isDummy = await hasher.compareDummy('AnyPassword123!');
      expect(isDummy).toBe(false);

      const isCorruptSafe = await hasher.compare('AnyPassword', 'invalid-hash');
      expect(isCorruptSafe).toBe(false);
    });

    it('should create and reuse a dummy hash at the configured work factor', async () => {
      const firstDummyHash = Reflect.get(hasher, 'dummyHash') as string;

      await hasher.compareDummy('FirstPassword123!');
      await hasher.compareDummy('SecondPassword123!');
      const secondDummyHash = Reflect.get(hasher, 'dummyHash') as string;

      expect(bcrypt.getRounds(firstDummyHash)).toBe(
        mockEnvService.bcryptRounds,
      );
      expect(secondDummyHash).toBe(firstDummyHash);
    });

    it('should propagate unexpected bcrypt comparison failures', async () => {
      await expect(
        hasher.compare('AnyPassword123!', null as unknown as string),
      ).rejects.toThrow(/Illegal arguments/);
    });

    it('should propagate dummy comparison failures', async () => {
      Reflect.set(hasher, 'dummyHash', null);

      await expect(hasher.compareDummy('AnyPassword123!')).rejects.toThrow(
        /Illegal arguments/,
      );
    });
  });

  describe('NestJwtTokenAdapter', () => {
    let jwtService: JwtService;
    let tokenAdapter: NestJwtTokenAdapter;

    beforeEach(() => {
      jwtService = new JwtService({});
      tokenAdapter = new NestJwtTokenAdapter(jwtService, mockEnvService);
    });

    it('should sign a token containing only sub, sessionId, sessionVersion, plus iat and exp', async () => {
      const sub = '123e4567-e89b-12d3-a456-426614174000';
      const sessionId = '223e4567-e89b-12d3-a456-426614174001';
      const sessionVersion = 1;
      const token = await tokenAdapter.signToken({
        sub,
        sessionId,
        sessionVersion,
      });

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      // Verify token with secret
      const decoded = jwtService.verify(token, {
        secret: mockEnvService.jwtSecret,
        algorithms: ['HS256'],
      });

      expect(decoded.sub).toBe(sub);
      expect(decoded.sessionId).toBe(sessionId);
      expect(decoded.sessionVersion).toBe(sessionVersion);
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
      expect(decoded.exp - decoded.iat).toBe(
        mockEnvService.jwtAccessTtlSeconds,
      );
      // Ensure claims match AC8 specification
      const keys = Object.keys(decoded);
      expect(keys.sort()).toEqual([
        'exp',
        'iat',
        'sessionId',
        'sessionVersion',
        'sub',
      ]);

      const verified = await tokenAdapter.verifyToken(token);
      expect(verified.sub).toBe(sub);
      expect(verified.sessionId).toBe(sessionId);
      expect(verified.sessionVersion).toBe(sessionVersion);
    });
  });
});
