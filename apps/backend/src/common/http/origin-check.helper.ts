import { Request } from 'express';
import { EnvService } from '../config/env.service';
import { ForbiddenOriginException } from '../../modules/auth/application/exceptions/auth.exceptions';

export function validateRequestOrigin(
  req: Request,
  envService: EnvService,
  options?: { requireOrigin?: boolean },
): void {
  const origin = req.headers['origin'];
  const referer = req.headers['referer'];
  const fetchSite = req.headers['sec-fetch-site'];

  if (fetchSite === 'cross-site') {
    if (!origin && !referer) {
      throw new ForbiddenOriginException();
    }
  }

  let requestOrigin: string | undefined;
  if (typeof origin === 'string' && origin.length > 0) {
    requestOrigin = origin;
  } else if (typeof referer === 'string' && referer.length > 0) {
    try {
      requestOrigin = new URL(referer).origin;
    } catch {
      throw new ForbiddenOriginException();
    }
  }

  if (!requestOrigin) {
    if (options?.requireOrigin) {
      throw new ForbiddenOriginException();
    }
    return;
  }

  if (!envService.frontendOrigins.includes(requestOrigin)) {
    throw new ForbiddenOriginException();
  }
}
