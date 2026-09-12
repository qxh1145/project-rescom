import {
  registerSchema,
  loginSchema,
  sanitizedUserSchema,
  authSuccessEnvelopeSchema,
  apiErrorEnvelopeSchema,
  googleCallbackQuerySchema,
  googleLinkStartSchema,
  googleLinkDeleteSchema,
} from '@rescom/schemas';

describe('Auth Schemas & Contracts', () => {
  describe('registerSchema', () => {
    it('should validate and normalize a valid registration request', () => {
      const input = {
        email: '  Test.User@Example.COM  ',
        password: 'ValidPassword123!',
      };

      const result = registerSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('test.user@example.com');
        // Password must be preserved exactly as supplied, never trimmed or normalized
        expect(result.data.password).toBe('ValidPassword123!');
      }
    });

    it('should reject malformed emails', () => {
      const malformedEmails = [
        'not-an-email',
        '@example.com',
        'user@',
        'user@.com',
        'user name@domain.com',
      ];

      for (const email of malformedEmails) {
        const result = registerSchema.safeParse({
          email,
          password: 'ValidPassword123!',
        });
        expect(result.success).toBe(false);
      }
    });

    it('should reject emails longer than 254 characters', () => {
      const longEmail = 'a'.repeat(245) + '@example.com'; // > 254 chars
      expect(longEmail.length).toBeGreaterThan(254);

      const result = registerSchema.safeParse({
        email: longEmail,
        password: 'ValidPassword123!',
      });
      expect(result.success).toBe(false);
    });

    it('should reject passwords shorter than 12 grapheme clusters', () => {
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        password: '12345678901',
      });
      expect(result.success).toBe(false);
    });

    it('should accept passwords with exactly 12 grapheme clusters', () => {
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        password: '123456789012',
      });
      expect(result.success).toBe(true);
    });

    it('should count composed Unicode sequences as single grapheme clusters', () => {
      const elevenGraphemes = 'e\u0301'.repeat(11);
      expect(elevenGraphemes.length).toBe(22);
      expect(
        registerSchema.safeParse({
          email: 'user@example.com',
          password: elevenGraphemes,
        }).success,
      ).toBe(false);

      const twelveGraphemes = 'e\u0301'.repeat(12);
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        password: twelveGraphemes,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.password).toBe(twelveGraphemes);
      }
    });

    it('should reject passwords exceeding 72 UTF-8 bytes', () => {
      const longAsciiPassword = 'a'.repeat(73);
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        password: longAsciiPassword,
      });
      expect(result.success).toBe(false);
    });

    it('should correctly evaluate Unicode byte boundaries for passwords', () => {
      // Each '🔥' emoji is 4 UTF-8 bytes. 19 emojis = 76 bytes > 72 bytes, but only 19 characters!
      const unicodePassword = '🔥'.repeat(19);
      expect(unicodePassword.length).toBe(38); // UTF-16 surrogate pairs
      expect(new TextEncoder().encode(unicodePassword).length).toBe(76);

      const result = registerSchema.safeParse({
        email: 'user@example.com',
        password: unicodePassword,
      });
      expect(result.success).toBe(false);

      // 18 emojis = 72 bytes <= 72 bytes
      const validUnicodePassword = '🔥'.repeat(18);
      expect(new TextEncoder().encode(validUnicodePassword).length).toBe(72);
      const validResult = registerSchema.safeParse({
        email: 'user@example.com',
        password: validUnicodePassword,
      });
      expect(validResult.success).toBe(true);
    });

    it('should correctly accept exactly 254 character valid emails', () => {
      const local = 'a'.repeat(64);
      const domain = ['b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.');
      const exactEmail = `${local}@${domain}`;
      expect(exactEmail.length).toBe(254);

      const result = registerSchema.safeParse({
        email: exactEmail,
        password: 'ValidPassword123!',
      });
      expect(result.success).toBe(true);
    });

    it('should reject 255 character emails', () => {
      const local = 'a'.repeat(64);
      const domain = ['b'.repeat(63), 'c'.repeat(63), 'd'.repeat(62)].join('.');
      const oversizedEmail = `${local}@${domain}`;
      expect(oversizedEmail.length).toBe(255);

      const result = registerSchema.safeParse({
        email: oversizedEmail,
        password: 'ValidPassword123!',
      });
      expect(result.success).toBe(false);
    });

    it('should enforce the 64 character email local-part boundary', () => {
      const validResult = registerSchema.safeParse({
        email: `${'a'.repeat(64)}@example.com`,
        password: 'ValidPassword123!',
      });
      expect(validResult.success).toBe(true);

      const invalidResult = registerSchema.safeParse({
        email: `${'a'.repeat(65)}@example.com`,
        password: 'ValidPassword123!',
      });
      expect(invalidResult.success).toBe(false);
    });

    it('should enforce the 63 character email domain-label boundary', () => {
      const validResult = registerSchema.safeParse({
        email: `user@${'a'.repeat(63)}.com`,
        password: 'ValidPassword123!',
      });
      expect(validResult.success).toBe(true);

      const invalidResult = registerSchema.safeParse({
        email: `user@${'a'.repeat(64)}.com`,
        password: 'ValidPassword123!',
      });
      expect(invalidResult.success).toBe(false);
    });

    it('should handle multi-byte Vietnamese and CJK characters at exact byte boundaries', () => {
      // Vietnamese 2-byte UTF-8 character 'đ': 36 * 2 = 72 bytes <= 72 bytes
      const vn72Bytes = 'đ'.repeat(36);
      expect(new TextEncoder().encode(vn72Bytes).length).toBe(72);
      expect(
        registerSchema.safeParse({ email: 'u@e.com', password: vn72Bytes })
          .success,
      ).toBe(true);

      // 36 * 2 + 1 = 73 bytes > 72 bytes
      const vn73Bytes = 'đ'.repeat(36) + 'a';
      expect(new TextEncoder().encode(vn73Bytes).length).toBe(73);
      expect(
        registerSchema.safeParse({ email: 'u@e.com', password: vn73Bytes })
          .success,
      ).toBe(false);

      // CJK 3-byte character '字': 24 * 3 = 72 bytes <= 72 bytes
      const cjk72Bytes = '字'.repeat(24);
      expect(new TextEncoder().encode(cjk72Bytes).length).toBe(72);
      expect(
        registerSchema.safeParse({ email: 'u@e.com', password: cjk72Bytes })
          .success,
      ).toBe(true);

      // 24 * 3 + 1 = 73 bytes > 72 bytes
      const cjk73Bytes = '字'.repeat(24) + 'a';
      expect(new TextEncoder().encode(cjk73Bytes).length).toBe(73);
      expect(
        registerSchema.safeParse({ email: 'u@e.com', password: cjk73Bytes })
          .success,
      ).toBe(false);
    });

    it('should preserve whitespace in passwords exactly without trimming or normalizing', () => {
      const untrimmedPassword = '   Password with spaces   ';
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        password: untrimmedPassword,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.password).toBe(untrimmedPassword);
      }
    });

    it('should reject lone UTF-16 surrogates in registration passwords', () => {
      for (const password of [
        `ValidPassword${'\ud800'}`,
        `ValidPassword${'\udc00'}`,
        `${'\ud800'}ValidPassword`,
        `${'\udc00'}ValidPassword`,
      ]) {
        expect(
          registerSchema.safeParse({ email: 'user@example.com', password })
            .success,
        ).toBe(false);
      }
    });

    it('should strictly reject unknown request fields and prototype injection', () => {
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        password: 'ValidPassword123!',
        extraField: 'not_allowed',
        role: 'ADMIN',
      });
      expect(result.success).toBe(false);

      const protoInjection = JSON.parse(
        '{"email":"user@example.com","password":"ValidPassword123!","__proto__":{"admin":true}}',
      );
      const protoResult = registerSchema.safeParse(protoInjection);
      // Prototype injection keys are strictly rejected by Zod schema
      expect(protoResult.success).toBe(false);
    });
  });

  describe('loginSchema', () => {
    it('should accept valid login inputs and normalize email', () => {
      const result = loginSchema.safeParse({
        email: '  User@Example.COM ',
        password: 'AnyPassword!',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('user@example.com');
        expect(result.data.password).toBe('AnyPassword!');
      }
    });

    it('should reject unknown fields in login', () => {
      const result = loginSchema.safeParse({
        email: 'user@example.com',
        password: 'password',
        unexpected: 123,
      });
      expect(result.success).toBe(false);
    });

    it('should enforce the bcrypt 72 UTF-8 byte password boundary', () => {
      const exactPassword = 'a'.repeat(72);
      expect(new TextEncoder().encode(exactPassword).length).toBe(72);
      expect(
        loginSchema.safeParse({
          email: 'user@example.com',
          password: exactPassword,
        }).success,
      ).toBe(true);

      const prefixAndSuffix = `${exactPassword}different-suffix`;
      const result = loginSchema.safeParse({
        email: 'user@example.com',
        password: prefixAndSuffix,
      });
      expect(result.success).toBe(false);
    });

    it('should reject lone UTF-16 surrogates in login passwords', () => {
      for (const password of ['\ud800', '\udc00', `valid${'\ud800'}password`]) {
        expect(
          loginSchema.safeParse({ email: 'user@example.com', password })
            .success,
        ).toBe(false);
      }
    });

    it('should apply shared email part-length rules during login', () => {
      expect(
        loginSchema.safeParse({
          email: `${'a'.repeat(64)}@${'b'.repeat(63)}.com`,
          password: 'AnyPassword!',
        }).success,
      ).toBe(true);
      expect(
        loginSchema.safeParse({
          email: `${'a'.repeat(65)}@example.com`,
          password: 'AnyPassword!',
        }).success,
      ).toBe(false);
      expect(
        loginSchema.safeParse({
          email: `user@${'b'.repeat(64)}.com`,
          password: 'AnyPassword!',
        }).success,
      ).toBe(false);
    });
  });

  describe('sanitizedUserSchema and Response Envelopes', () => {
    it('should validate sanitized user projection without passwordHash or tokens', () => {
      const validUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: 'user@example.com',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      };
      const result = sanitizedUserSchema.safeParse(validUser);
      expect(result.success).toBe(true);

      // Extra fields like passwordHash must be rejected
      const dirtyUser = {
        ...validUser,
        passwordHash: 'secret_hash',
      };
      const dirtyResult = sanitizedUserSchema.safeParse(dirtyUser);
      expect(dirtyResult.success).toBe(false);
    });

    it('should validate standard success envelope', () => {
      const envelope = {
        data: {
          user: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            email: 'user@example.com',
            role: 'RESPONDENT',
            status: 'ACTIVE',
          },
        },
        error: null,
        meta: {},
      };
      const result = authSuccessEnvelopeSchema.safeParse(envelope);
      expect(result.success).toBe(true);
    });

    it('should validate standard error envelope', () => {
      const envelope = {
        data: null,
        error: {
          code: 'AUTH_INVALID_REGISTRATION_INPUT',
          message: 'Invalid input policy',
        },
        meta: {},
      };
      const result = apiErrorEnvelopeSchema.safeParse(envelope);
      expect(result.success).toBe(true);
    });
  });

  describe('Google OAuth Schemas', () => {
    describe('googleCallbackQuerySchema', () => {
      it('should validate successful callback with code', () => {
        const query = {
          state: 'valid-state-value',
          code: 'valid-auth-code',
          scope: 'email openid',
          iss: 'https://accounts.google.com',
          extra_param: 'safely_ignored',
        };
        const result = googleCallbackQuerySchema.safeParse(query);
        expect(result.success).toBe(true);
      });

      it('should validate error callback with error parameter', () => {
        const query = {
          state: 'valid-state-value',
          error: 'access_denied',
          error_description: 'The user denied request',
        };
        const result = googleCallbackQuerySchema.safeParse(query);
        expect(result.success).toBe(true);
      });

      it('should reject when both code and error are provided', () => {
        const query = {
          state: 'valid-state-value',
          code: 'valid-auth-code',
          error: 'access_denied',
        };
        const result = googleCallbackQuerySchema.safeParse(query);
        expect(result.success).toBe(false);
      });

      it('should reject when neither code nor error is provided', () => {
        const query = {
          state: 'valid-state-value',
        };
        const result = googleCallbackQuerySchema.safeParse(query);
        expect(result.success).toBe(false);
      });

      it('should reject array/duplicate parameters', () => {
        const query = {
          state: ['state1', 'state2'],
          code: 'valid-code',
        };
        const result = googleCallbackQuerySchema.safeParse(query);
        expect(result.success).toBe(false);
      });

      it('should reject missing state', () => {
        const query = {
          code: 'valid-code',
        };
        const result = googleCallbackQuerySchema.safeParse(query);
        expect(result.success).toBe(false);
      });
    });

    describe('googleLinkStartSchema and googleLinkDeleteSchema', () => {
      it('should accept valid currentPassword', () => {
        const body = { currentPassword: 'Password12345!' };
        expect(googleLinkStartSchema.safeParse(body).success).toBe(true);
        expect(googleLinkDeleteSchema.safeParse(body).success).toBe(true);
      });

      it('should reject extra fields', () => {
        const body = {
          currentPassword: 'Password12345!',
          extra: 'field',
        };
        expect(googleLinkStartSchema.safeParse(body).success).toBe(false);
        expect(googleLinkDeleteSchema.safeParse(body).success).toBe(false);
      });

      it('should reject empty password', () => {
        const body = { currentPassword: '' };
        expect(googleLinkStartSchema.safeParse(body).success).toBe(false);
        expect(googleLinkDeleteSchema.safeParse(body).success).toBe(false);
      });
    });
  });
});
