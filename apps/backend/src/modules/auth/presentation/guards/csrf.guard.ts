import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { EnvService } from '../../../../common/config/env.service';
import { validateRequestOrigin } from '../../../../common/http/origin-check.helper';
import {
  SECRET_PROTECTION_PORT,
  SecretProtectionPort,
} from '../../application/ports/secret-protection.port';
import { InvalidCsrfTokenException } from '../../application/exceptions/auth.exceptions';
import { AuthenticatedRequest } from '../types/authenticated-request.type';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly envService: EnvService,
    @Inject(SECRET_PROTECTION_PORT)
    private readonly secretProtection: SecretProtectionPort,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    validateRequestOrigin(request, this.envService, { requireOrigin: true });

    const csrfToken = request.headers['x-csrf-token'];
    if (
      !request.session ||
      typeof csrfToken !== 'string' ||
      !this.secretProtection.verifyCsrfToken(
        csrfToken,
        request.session.csrfDigest,
      )
    ) {
      throw new InvalidCsrfTokenException();
    }

    return true;
  }
}
