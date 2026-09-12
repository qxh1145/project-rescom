import { randomUUID } from 'crypto';
import { RegisterDto, LoginDto, SanitizedUser } from '@rescom/schemas';
import { UserRepositoryPort } from '../../users/application/ports/user.repository.port';
import { PasswordHasherPort } from './ports/password-hasher.port';
import { TokenServicePort } from './ports/token-service.port';
import { SessionService } from './session.service';
import {
  EmailAlreadyRegisteredException,
  InvalidCredentialsException,
} from './exceptions/auth.exceptions';

export interface AuthResult {
  user: SanitizedUser;
  token: string;
  accessToken: string;
  refreshToken?: string;
  csrfToken?: string;
}

export class AuthService {
  constructor(
    private readonly userRepository: UserRepositoryPort,
    private readonly passwordHasher: PasswordHasherPort,
    private readonly tokenService: TokenServicePort,
    private readonly generateId: () => string = randomUUID,
    private readonly sessionService?: SessionService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    // Application pre-check for quick feedback
    const existing = await this.userRepository.findByEmail(normalizedEmail);
    if (existing) {
      throw new EmailAlreadyRegisteredException();
    }

    const passwordHash = await this.passwordHasher.hash(dto.password);
    const id = this.generateId();

    if (!this.sessionService) {
      // Legacy Story 1.1 fallback if SessionService is not wired
      const token = await this.tokenService.signToken({
        sub: id,
        sessionId: id,
        sessionVersion: 1,
      });

      const user = await this.userRepository.create({
        id,
        email: normalizedEmail,
        passwordHash,
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          status: user.status,
        },
        token,
        accessToken: token,
      };
    }

    const user = await this.userRepository.create({
      id,
      email: normalizedEmail,
      passwordHash,
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });

    const sessionTokens = await this.sessionService.createSession(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
      },
      token: sessionTokens.accessToken,
      accessToken: sessionTokens.accessToken,
      refreshToken: sessionTokens.refreshToken,
      csrfToken: sessionTokens.csrfToken,
    };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    const user = await this.userRepository.findByEmail(normalizedEmail);

    if (!user) {
      await this.passwordHasher.compareDummy(dto.password);
      throw new InvalidCredentialsException();
    }

    if (user.isLocked()) {
      if (user.hasPassword() && user.passwordHash) {
        await this.passwordHasher.compare(dto.password, user.passwordHash);
      } else {
        await this.passwordHasher.compareDummy(dto.password);
      }
      throw new InvalidCredentialsException();
    }

    if (!user.hasPassword() || !user.passwordHash) {
      await this.passwordHasher.compareDummy(dto.password);
      throw new InvalidCredentialsException();
    }

    const isMatch = await this.passwordHasher.compare(
      dto.password,
      user.passwordHash,
    );
    if (!isMatch) {
      throw new InvalidCredentialsException();
    }

    if (!this.sessionService) {
      const token = await this.tokenService.signToken({
        sub: user.id,
        sessionId: user.id,
        sessionVersion: 1,
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          status: user.status,
        },
        token,
        accessToken: token,
      };
    }

    const sessionTokens = await this.sessionService.createSession(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
      },
      token: sessionTokens.accessToken,
      accessToken: sessionTokens.accessToken,
      refreshToken: sessionTokens.refreshToken,
      csrfToken: sessionTokens.csrfToken,
    };
  }

  async logout(params: {
    accessToken?: string;
    refreshToken?: string;
    csrfToken?: string;
  }): Promise<void> {
    if (this.sessionService) {
      await this.sessionService.logout(params);
    }
  }
}
