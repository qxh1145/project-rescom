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
import { AuthenticatedRequest } from '../types/authenticated-request.type';
import { CsrfGuard } from './csrf.guard';

/**
 * AD-20 CSRF protection for `@Public()` mutations that guests may also call
 * (Epic 5 review P12): internal submissions and survey-attachment uploads.
 *
 * - With a validated session (set by `SessionAuthGuard` on public routes),
 *   the request must pass the full `CsrfGuard` synchronizer-token check.
 * - Without one (a guest), there is no token to check, so the request must
 *   at least carry an allowed `Origin`/`Referer`.
 */
@Injectable()
export class OptionalSessionCsrfGuard implements CanActivate {
  private readonly csrfGuard: CsrfGuard;

  constructor(
    private readonly envService: EnvService,
    @Inject(SECRET_PROTECTION_PORT)
    secretProtection: SecretProtectionPort,
  ) {
    this.csrfGuard = new CsrfGuard(envService, secretProtection);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.session) {
      return this.csrfGuard.canActivate(context);
    }
    validateRequestOrigin(request, this.envService, { requireOrigin: true });
    return true;
  }
}
