import { AuthService } from './auth.service';
import { UserRepositoryPort } from '../../users/application/ports/user.repository.port';
import { PasswordHasherPort } from './ports/password-hasher.port';
import { TokenServicePort } from './ports/token-service.port';
import { User } from '../../users/domain/user.entity';
import {
  EmailAlreadyRegisteredException,
  InvalidCredentialsException,
} from './exceptions/auth.exceptions';

describe('AuthService', () => {
  let authService: AuthService;
  let mockUserRepo: jest.Mocked<UserRepositoryPort>;
  let mockPasswordHasher: jest.Mocked<PasswordHasherPort>;
  let mockTokenService: jest.Mocked<TokenServicePort>;

  const sampleUser = new User({
    id: '123e4567-e89b-12d3-a456-426614174000',
    email: 'test@example.com',
    passwordHash: '$2a$12$hashedpassword',
    role: 'RESPONDENT',
    status: 'ACTIVE',
  });

  beforeEach(() => {
    mockUserRepo = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      countByRoleAndStatus: jest.fn(),
    };

    mockPasswordHasher = {
      hash: jest.fn().mockResolvedValue('$2a$12$hashedpassword'),
      compare: jest.fn(),
      compareDummy: jest.fn().mockResolvedValue(false),
    };

    mockTokenService = {
      signToken: jest.fn().mockResolvedValue('signed.jwt.token'),
      verifyToken: jest.fn(),
    };

    authService = new AuthService(
      mockUserRepo,
      mockPasswordHasher,
      mockTokenService,
      () => sampleUser.id,
    );
  });

  describe('register', () => {
    it('should register a new user successfully and return sanitized user + token', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockUserRepo.create.mockResolvedValue(sampleUser);

      const result = await authService.register({
        email: '  Test@Example.COM  ',
        password: 'ValidPassword123!',
      });

      expect(mockUserRepo.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(mockPasswordHasher.hash).toHaveBeenCalledWith('ValidPassword123!');
      expect(mockUserRepo.create).toHaveBeenCalledWith({
        id: sampleUser.id,
        email: 'test@example.com',
        passwordHash: '$2a$12$hashedpassword',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });
      expect(mockTokenService.signToken).toHaveBeenCalledWith(
        expect.objectContaining({ sub: sampleUser.id }),
      );

      expect(result.user).toEqual({
        id: sampleUser.id,
        email: sampleUser.email,
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });
      expect((result.user as any).passwordHash).toBeUndefined();
      expect(result.token).toBe('signed.jwt.token');
    });

    it('should not persist a user when token signing fails', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockTokenService.signToken.mockRejectedValue(
        new Error('Token signer unavailable'),
      );

      await expect(
        authService.register({
          email: 'test@example.com',
          password: 'ValidPassword123!',
        }),
      ).rejects.toThrow('Token signer unavailable');

      expect(mockTokenService.signToken).toHaveBeenCalledWith(
        expect.objectContaining({ sub: sampleUser.id }),
      );
      expect(mockUserRepo.create).not.toHaveBeenCalled();
    });

    it('should throw EmailAlreadyRegisteredException if email already exists in pre-check', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(sampleUser);

      await expect(
        authService.register({
          email: 'test@example.com',
          password: 'ValidPassword123!',
        }),
      ).rejects.toThrow(EmailAlreadyRegisteredException);

      expect(mockUserRepo.create).not.toHaveBeenCalled();
    });

    it('should propagate EmailAlreadyRegisteredException when repository indicates duplicate email', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockUserRepo.create.mockRejectedValue(
        new EmailAlreadyRegisteredException(),
      );

      await expect(
        authService.register({
          email: 'test@example.com',
          password: 'ValidPassword123!',
        }),
      ).rejects.toThrow(EmailAlreadyRegisteredException);
    });
  });

  describe('login', () => {
    it('should successfully log in an active user with correct password', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(sampleUser);
      mockPasswordHasher.compare.mockResolvedValue(true);

      const result = await authService.login({
        email: 'TEST@EXAMPLE.COM',
        password: 'CorrectPassword123!',
      });

      expect(mockUserRepo.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(mockPasswordHasher.compare).toHaveBeenCalledWith(
        'CorrectPassword123!',
        sampleUser.passwordHash,
      );
      expect(result.user).toEqual({
        id: sampleUser.id,
        email: sampleUser.email,
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });
      expect((result.user as any).passwordHash).toBeUndefined();
      expect(result.token).toBe('signed.jwt.token');
    });

    it('should throw InvalidCredentialsException for unknown email and perform dummy comparison', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockPasswordHasher.compare.mockResolvedValue(false);

      await expect(
        authService.login({
          email: 'unknown@example.com',
          password: 'Password123!',
        }),
      ).rejects.toThrow(InvalidCredentialsException);

      expect(mockPasswordHasher.compareDummy).toHaveBeenCalledWith(
        'Password123!',
      );
    });

    it('should throw InvalidCredentialsException for incorrect password', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(sampleUser);
      mockPasswordHasher.compare.mockResolvedValue(false);

      await expect(
        authService.login({
          email: 'test@example.com',
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(InvalidCredentialsException);
    });

    it('should throw InvalidCredentialsException for user without passwordHash', async () => {
      const googleOnlyUser = new User({
        id: '123e4567-e89b-12d3-a456-426614174001',
        email: 'google@example.com',
        passwordHash: null,
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });
      mockUserRepo.findByEmail.mockResolvedValue(googleOnlyUser);
      mockPasswordHasher.compareDummy.mockResolvedValue(false);

      await expect(
        authService.login({
          email: 'google@example.com',
          password: 'Password123!',
        }),
      ).rejects.toThrow(InvalidCredentialsException);

      expect(mockPasswordHasher.compareDummy).toHaveBeenCalledWith(
        'Password123!',
      );
    });

    it('should throw InvalidCredentialsException for LOCKED user and perform password comparison to prevent timing oracle', async () => {
      const lockedUser = new User({
        id: '123e4567-e89b-12d3-a456-426614174002',
        email: 'locked@example.com',
        passwordHash: '$2a$12$hashedpassword',
        role: 'RESPONDENT',
        status: 'LOCKED',
      });
      mockUserRepo.findByEmail.mockResolvedValue(lockedUser);
      mockPasswordHasher.compare.mockResolvedValue(false);

      await expect(
        authService.login({
          email: 'locked@example.com',
          password: 'Password123!',
        }),
      ).rejects.toThrow(InvalidCredentialsException);

      expect(mockPasswordHasher.compare).toHaveBeenCalledWith(
        'Password123!',
        '$2a$12$hashedpassword',
      );
    });

    it('should throw InvalidCredentialsException and perform dummy compare when passwordHash is empty string', async () => {
      const emptyHashUser = new User({
        id: '123e4567-e89b-12d3-a456-426614174003',
        email: 'emptyhash@example.com',
        passwordHash: '',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });
      mockUserRepo.findByEmail.mockResolvedValue(emptyHashUser);
      mockPasswordHasher.compareDummy.mockResolvedValue(false);

      await expect(
        authService.login({
          email: 'emptyhash@example.com',
          password: 'Password123!',
        }),
      ).rejects.toThrow(InvalidCredentialsException);

      expect(mockPasswordHasher.compareDummy).toHaveBeenCalledWith(
        'Password123!',
      );
    });

    it('should rethrow unexpected database errors during registration without masking as duplicate', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockPasswordHasher.hash.mockResolvedValue('$2a$12$hashedpassword');
      mockTokenService.signToken.mockResolvedValue('signed.jwt.token');
      mockUserRepo.create.mockRejectedValue(new Error('Connection lost'));

      await expect(
        authService.register({
          email: 'test@example.com',
          password: 'ValidPassword123!',
        }),
      ).rejects.toThrow('Connection lost');
    });

    it('should delegate session creation to SessionService when provided', async () => {
      const mockSessionService: any = {
        createSession: jest.fn().mockResolvedValue({
          accessToken: 'session.access.token',
          refreshToken: 'cred-id.refresh-secret',
          csrfToken: 'raw-csrf-token',
        }),
      };

      const authWithSession = new AuthService(
        mockUserRepo,
        mockPasswordHasher,
        mockTokenService,
        () => sampleUser.id,
        mockSessionService,
      );

      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockUserRepo.create.mockResolvedValue(sampleUser);

      const result = await authWithSession.register({
        email: 'test@example.com',
        password: 'ValidPassword123!',
      });

      expect(mockSessionService.createSession).toHaveBeenCalledWith(
        sampleUser.id,
      );
      expect(result.accessToken).toBe('session.access.token');
      expect(result.refreshToken).toBe('cred-id.refresh-secret');
      expect(result.csrfToken).toBe('raw-csrf-token');
    });
  });
});
