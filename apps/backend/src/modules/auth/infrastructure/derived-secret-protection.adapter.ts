import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { SecretProtectionPort } from '../application/ports/secret-protection.port';
import { EnvService } from '../../../common/config/env.service';

@Injectable()
export class DerivedSecretProtectionAdapter implements SecretProtectionPort {
  private readonly refreshKey: Buffer;
  private readonly csrfKey: Buffer;
  private readonly oauthKey: Buffer;
  private readonly pkceKey: Buffer;

  constructor(private readonly envService: EnvService) {
    const rootSecret = this.envService.secretProtectionKey;
    const version = this.envService.secretKeyVersion;

    this.refreshKey = Buffer.from(
      crypto.hkdfSync(
        'sha256',
        rootSecret,
        '',
        `rescom-refresh-hmac-v${version}`,
        32,
      ),
    );

    this.csrfKey = Buffer.from(
      crypto.hkdfSync(
        'sha256',
        rootSecret,
        '',
        `rescom-csrf-hmac-v${version}`,
        32,
      ),
    );

    this.oauthKey = Buffer.from(
      crypto.hkdfSync(
        'sha256',
        rootSecret,
        '',
        `rescom-oauth-intent-hmac-v${version}`,
        32,
      ),
    );

    this.pkceKey = Buffer.from(
      crypto.hkdfSync(
        'sha256',
        rootSecret,
        '',
        `rescom-pkce-encryption-v${version}`,
        32,
      ),
    );
  }

  hashRefreshSecret(secret: string): string {
    return crypto
      .createHmac('sha256', this.refreshKey)
      .update(secret)
      .digest('hex');
  }

  verifyRefreshSecret(secret: string, digest: string): boolean {
    const computed = this.hashRefreshSecret(secret);
    return this.timingSafeEquals(computed, digest);
  }

  hashCsrfToken(token: string): string {
    return crypto
      .createHmac('sha256', this.csrfKey)
      .update(token)
      .digest('hex');
  }

  verifyCsrfToken(token: string, digest: string): boolean {
    const computed = this.hashCsrfToken(token);
    return this.timingSafeEquals(computed, digest);
  }

  hashOAuthSecret(secret: string): string {
    return crypto
      .createHmac('sha256', this.oauthKey)
      .update(secret)
      .digest('hex');
  }

  verifyOAuthSecret(secret: string, digest: string): boolean {
    const computed = this.hashOAuthSecret(secret);
    return this.timingSafeEquals(computed, digest);
  }

  encryptPkceVerifier(verifier: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.pkceKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(verifier, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('base64url')}.${authTag.toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  decryptPkceVerifier(encryptedStr: string): string {
    const parts = encryptedStr.split('.');
    if (parts.length !== 3) {
      throw new Error('Malformed encrypted verifier string');
    }
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const data = Buffer.from(dataB64, 'base64url');

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.pkceKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

    return decrypted.toString('utf8');
  }

  private timingSafeEquals(aHex: string, bHex: string): boolean {
    if (!aHex || !bHex) return false;
    const bufA = Buffer.from(aHex, 'hex');
    const bufB = Buffer.from(bHex, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }
}
