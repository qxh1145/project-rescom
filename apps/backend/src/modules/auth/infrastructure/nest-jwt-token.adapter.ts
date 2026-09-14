import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  TokenServicePort,
  AccessTokenClaims,
} from '../application/ports/token-service.port';
import { EnvService } from '../../../common/config/env.service';
import {
  InvalidTokenException,
  SessionExpiredException,
} from '../application/exceptions/auth.exceptions';

@Injectable()
export class NestJwtTokenAdapter implements TokenServicePort {
  constructor(
    private readonly jwtService: JwtService,
    private readonly envService: EnvService,
  ) {}

  async signToken(payload: AccessTokenClaims): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: payload.sub,
        sessionId: payload.sessionId,
        sessionVersion: payload.sessionVersion,
      },
      {
        secret: this.envService.jwtSecret,
        expiresIn: this.envService.jwtAccessTtlSeconds,
        algorithm: 'HS256',
      },
    );
  }

  async verifyToken(token: string): Promise<AccessTokenClaims> {
    try {
      const decoded = await this.jwtService.verifyAsync<AccessTokenClaims>(
        token,
        {
          secret: this.envService.jwtSecret,
          algorithms: ['HS256'],
        },
      );
      return decoded;
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'name' in err &&
        (err as { name: string }).name === 'TokenExpiredError'
      ) {
        throw new SessionExpiredException();
      }
      throw new InvalidTokenException(
        err instanceof Error ? err.message : 'Invalid token',
      );
    }
  }
}
