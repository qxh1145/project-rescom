import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Exactly `application/json`, optionally with parameters (`; charset=utf-8`).
 * A substring match would also accept e.g. `text/plain; x=application/json`,
 * which a cross-site form can send without a CORS preflight.
 */
export function isJsonMediaType(contentType: string | undefined): boolean {
  return (
    !!contentType &&
    contentType.split(';')[0].trim().toLowerCase() === 'application/json'
  );
}

@Injectable()
export class JsonOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!isJsonMediaType(req.headers['content-type'])) {
      throw new UnsupportedMediaTypeException({
        code: 'AUTH_UNSUPPORTED_MEDIA_TYPE',
        message: 'Auth endpoints accept JSON payloads only.',
      });
    }
    return true;
  }
}
