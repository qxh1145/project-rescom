import { maskAuditMetadata, MASKED_PLACEHOLDER } from './audit-metadata-mask';

describe('maskAuditMetadata (AC 7)', () => {
  it('returns null or undefined as-is', () => {
    expect(maskAuditMetadata(null)).toBeNull();
    expect(maskAuditMetadata(undefined)).toBeUndefined();
  });

  it('masks suffix variants of secret and bank-account keys', () => {
    const masked = maskAuditMetadata({
      currentPassword: 'p1',
      old_password: 'p2',
      clientSecret: 's1',
      refreshTokenHash: 'h1',
      reset_token_hash: 'h2',
      bankAccountNo: '0123456789',
      account_no: '12',
      tokenId: 'tok_1',
      sessionId: 'ses_1',
    });

    expect(masked).toEqual({
      currentPassword: MASKED_PLACEHOLDER,
      old_password: MASKED_PLACEHOLDER,
      clientSecret: MASKED_PLACEHOLDER,
      refreshTokenHash: MASKED_PLACEHOLDER,
      reset_token_hash: MASKED_PLACEHOLDER,
      bankAccountNo: '••••6789',
      account_no: MASKED_PLACEHOLDER,
      tokenId: 'tok_1',
      sessionId: 'ses_1',
    });
  });

  it('masks every deny-list key regardless of casing or delimiters', () => {
    const input = {
      password: 'plain_password',
      PASSWORD: 'UPPER_PASSWORD',
      password_hash: 'hash_123',
      passwordHash: 'hash_456',
      new_password: 'new_pass_123',
      newPassword: 'new_pass_456',
      token: 'some_secret_token',
      access_token: 'jwt_access',
      accessToken: 'jwt_access_camel',
      refresh_token: 'jwt_refresh',
      refreshToken: 'jwt_refresh_camel',
      id_token: 'oidc_id_token',
      idToken: 'oidc_id_token_camel',
      reset_token: 'pwd_reset_token',
      resetToken: 'pwd_reset_token_camel',
      token_hash: 'hashed_tok',
      tokenHash: 'hashed_tok_camel',
      secret: 'app_secret',
      otp: '123456',
      cookie: 'session_cookie=val',
      authorization: 'Bearer secret_token',
    };

    const masked = maskAuditMetadata(input);

    for (const key of Object.keys(input)) {
      expect(masked[key as keyof typeof masked]).toBe(MASKED_PLACEHOLDER);
    }
  });

  it('masks bank account keys keeping last 4 digits, or masks fully when fewer than 4 digits', () => {
    const input = {
      accountNumber: '0123456789',
      account_number: '9876543210',
      bankAccount: '123-456-7890',
      bank_account_number: '1234',
      shortBank: '123', // not a bank key name
    };

    const masked = maskAuditMetadata(input);

    expect(masked.accountNumber).toBe('••••6789');
    expect(masked.account_number).toBe('••••3210');
    expect(masked.bankAccount).toBe('••••7890');
    expect(masked.bank_account_number).toBe('••••1234');
    expect(masked.shortBank).toBe('123'); // key not in bank list

    const shortInput = {
      bankAccount: '99',
      accountNumber: null,
    };
    const shortMasked = maskAuditMetadata(shortInput);
    expect(shortMasked.bankAccount).toBe(MASKED_PLACEHOLDER);
    expect(shortMasked.accountNumber).toBe(MASKED_PLACEHOLDER);
  });

  it('preserves non-matching opaque id keys, non-secret codes, and safe fields', () => {
    const input = {
      tokenId: '550e8400-e29b-41d4-a716-446655440000',
      sessionId: 'sess_abc123',
      intentId: 'intent_456',
      changeId: 'chg_789',
      eventId: 'evt_101',
      formId: 'form_202',
      code: 'AUTH_FAILED',
      reason: 'Admin lock account',
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
    };

    const masked = maskAuditMetadata(input);
    expect(masked).toEqual(input);
  });

  it('recursively masks nested objects and arrays without mutating original', () => {
    const original = {
      nested: {
        password: 'nested_secret',
        safe: 'stay',
        deep: {
          refreshToken: 'deep_refresh',
          deepSafe: 42,
        },
      },
      list: [
        { otp: '654321', note: 'test' },
        { innerList: [{ secret: 'top_secret', id: 1 }] },
      ],
    };

    const clone = JSON.parse(JSON.stringify(original));
    const masked = maskAuditMetadata(original);

    // Original not mutated
    expect(original).toEqual(clone);

    expect(masked.nested.password).toBe(MASKED_PLACEHOLDER);
    expect(masked.nested.safe).toBe('stay');
    expect(masked.nested.deep.refreshToken).toBe(MASKED_PLACEHOLDER);
    expect(masked.nested.deep.deepSafe).toBe(42);
    expect(masked.list[0].otp).toBe(MASKED_PLACEHOLDER);
    expect(masked.list[0].note).toBe('test');
    const secondItem = masked.list[1] as {
      innerList: Array<{ secret: string; id: number }>;
    };
    expect(secondItem.innerList[0]?.secret).toBe(MASKED_PLACEHOLDER);
    expect(secondItem.innerList[0]?.id).toBe(1);
  });

  it('handles array metadata at top level', () => {
    const input = [
      { token: 'abc', val: 1 },
      { account_number: '1111222233334444', name: 'Nguyen Van A' },
    ];
    const masked = maskAuditMetadata(input);
    expect(masked).toEqual([
      { token: MASKED_PLACEHOLDER, val: 1 },
      { account_number: '••••4444', name: 'Nguyen Van A' },
    ]);
  });
});
