import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '../types/authenticated-request.type';
import { Session } from '../../domain/session.entity';

export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Session | undefined => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.session;
  },
);
