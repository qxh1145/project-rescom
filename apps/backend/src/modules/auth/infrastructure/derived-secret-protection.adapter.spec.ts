import { DerivedSecretProtectionAdapter } from './derived-secret-protection.adapter';
import { EnvService } from '../../../common/config/env.service';

describe('DerivedSecretProtectionAdapter', () => {
  let adapter: DerivedSecretProtectionAdapter;

  beforeEach(() => {
    const envService = new EnvService({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
      AUTH_SECRET_PROTECTION_KEY:
        'super_secure_root_secret_protection_key_32chars!',
      AUTH_SECRET_KEY_VERSION: 1,
    });
    adapter = new DerivedSecretProtectionAdapter(envService);
  });

  it('should hash and verify refresh secret correctly with constant-time compare', () => {
    const secret = 'test-refresh-secret-12345';
    const digest = adapter.hashRefreshSecret(secret);

    expect(digest).toBeDefined();
    expect(adapter.verifyRefreshSecret(secret, digest)).toBe(true);
    expect(adapter.verifyRefreshSecret('wrong-secret', digest)).toBe(false);
  });

  it('should hash and verify csrf token correctly', () => {
    const token = 'test-csrf-token-abc';
    const digest = adapter.hashCsrfToken(token);

    expect(digest).toBeDefined();
    expect(adapter.verifyCsrfToken(token, digest)).toBe(true);
    expect(adapter.verifyCsrfToken('wrong-token', digest)).toBe(false);
  });

  it('should hash and verify oauth secret correctly', () => {
    const secret = 'test-oauth-secret-xyz';
    const digest = adapter.hashOAuthSecret(secret);

    expect(digest).toBeDefined();
    expect(adapter.verifyOAuthSecret(secret, digest)).toBe(true);
    expect(adapter.verifyOAuthSecret('wrong-oauth-secret', digest)).toBe(false);
  });

  it('should encrypt and decrypt PKCE verifier round-trip using AES-256-GCM', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const encrypted = adapter.encryptPkceVerifier(verifier);

    expect(encrypted).toBeDefined();
    expect(encrypted).not.toEqual(verifier);

    const decrypted = adapter.decryptPkceVerifier(encrypted);
    expect(decrypted).toEqual(verifier);
  });

  it('should fail decryption if ciphertext or auth tag is tampered', () => {
    const verifier = 'some-pkce-verifier';
    const encrypted = adapter.encryptPkceVerifier(verifier);
    const parts = encrypted.split('.');
    // Tamper with ciphertext
    const tampered = `${parts[0]}.${parts[1]}.tamperedData`;

    expect(() => adapter.decryptPkceVerifier(tampered)).toThrow();
  });
});
