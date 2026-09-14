import { InMemoryOAuthRepository } from './in-memory-oauth.repository';
import { InMemoryUserRepository } from '../../users/infrastructure/in-memory-user.repository';
import {
  GoogleLinkRequiredException,
  GoogleIdentityConflictException,
  FinalLoginMethodException,
  UserLockedException,
} from '../application/exceptions/auth.exceptions';

describe('OAuthPersistencePort (Task 4 Account Resolution)', () => {
  let userRepo: InMemoryUserRepository;
  let oauthRepo: InMemoryOAuthRepository;

  beforeEach(() => {
    userRepo = new InMemoryUserRepository();
    oauthRepo = new InMemoryOAuthRepository(userRepo);
  });

  it('should create exactly one user and authIdentity on first-time login (AC4)', async () => {
    const result = await oauthRepo.resolveGoogleUser({
      sub: 'google-sub-1',
      email: 'newgoogleuser@example.com',
    });

    expect(result.isNewUser).toBe(true);
    expect(result.user.id).toBeDefined();
    expect(result.user.email).toBe('newgoogleuser@example.com');
    expect(result.user.passwordHash).toBeNull();
    expect(result.user.role).toBe('RESPONDENT');
    expect(result.user.status).toBe('ACTIVE');

    // Second call with same sub must resolve the existing user (AC5)
    const secondCall = await oauthRepo.resolveGoogleUser({
      sub: 'google-sub-1',
      email: 'changedemail@example.com', // Even if email changed at Google
    });

    expect(secondCall.isNewUser).toBe(false);
    expect(secondCall.user.id).toBe(result.user.id);
  });

  it('should throw GoogleLinkRequiredException if Google email matches an existing password user (AC6)', async () => {
    // Existing user with password
    await userRepo.create({
      id: 'existing-password-user',
      email: 'existing@example.com',
      passwordHash: '$2a$12$hashedpassword',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });

    // Google login attempt with same email but no Google AuthIdentity yet
    await expect(
      oauthRepo.resolveGoogleUser({
        sub: 'some-new-google-sub',
        email: 'EXISTING@example.COM',
      }),
    ).rejects.toThrow(GoogleLinkRequiredException);
  });

  it('should reject locked user with UserLockedException (AC5)', async () => {
    const user = await userRepo.create({
      id: 'locked-user',
      email: 'locked@example.com',
      passwordHash: null,
      role: 'RESPONDENT',
      status: 'LOCKED',
    });

    await oauthRepo.linkGoogleIdentity({
      userId: user.id,
      sub: 'locked-sub-1',
    });

    await expect(
      oauthRepo.resolveGoogleUser({
        sub: 'locked-sub-1',
        email: 'locked@example.com',
      }),
    ).rejects.toThrow(UserLockedException);
  });

  it('should support linking and reject linking to a second Google account or conflicting account (AC7)', async () => {
    const user1 = await userRepo.create({
      id: 'user-1',
      email: 'u1@example.com',
      passwordHash: '$2a$12$pw1',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });

    const user2 = await userRepo.create({
      id: 'user-2',
      email: 'u2@example.com',
      passwordHash: '$2a$12$pw2',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });

    // Link user1 to google-sub-A
    await oauthRepo.linkGoogleIdentity({
      userId: user1.id,
      sub: 'google-sub-A',
    });

    // Linking user1 to a second Google account should fail
    await expect(
      oauthRepo.linkGoogleIdentity({
        userId: user1.id,
        sub: 'google-sub-B',
      }),
    ).rejects.toThrow(GoogleIdentityConflictException);

    // Linking user2 to already-linked google-sub-A should fail
    await expect(
      oauthRepo.linkGoogleIdentity({
        userId: user2.id,
        sub: 'google-sub-A',
      }),
    ).rejects.toThrow(GoogleIdentityConflictException);
  });

  it('should allow unlink only when user has another login method (password) (AC7)', async () => {
    const passwordUser = await userRepo.create({
      id: 'pw-user',
      email: 'pw@example.com',
      passwordHash: '$2a$12$somehash',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });

    await oauthRepo.linkGoogleIdentity({
      userId: passwordUser.id,
      sub: 'sub-to-unlink',
    });

    // Unlink succeeds because user has password
    await expect(
      oauthRepo.unlinkGoogleIdentity({ userId: passwordUser.id }),
    ).resolves.not.toThrow();

    // Now test a user who only has Google login (no password)
    const googleOnly = await userRepo.create({
      id: 'google-only-user',
      email: 'googleonly@example.com',
      passwordHash: null,
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });

    await oauthRepo.linkGoogleIdentity({
      userId: googleOnly.id,
      sub: 'google-only-sub',
    });

    // Unlinking the only login method must be rejected
    await expect(
      oauthRepo.unlinkGoogleIdentity({ userId: googleOnly.id }),
    ).rejects.toThrow(FinalLoginMethodException);
  });
});
