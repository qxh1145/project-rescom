import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class JsonOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const contentType = req.headers['content-type'];
    if (
      !contentType ||
      !contentType.toLowerCase().includes('application/json')
    ) {
      throw new UnsupportedMediaTypeException({
        code: 'AUTH_UNSUPPORTED_MEDIA_TYPE',
        message: 'Auth endpoints accept JSON payloads only.',
      });
    }
    return true;
  }
}
