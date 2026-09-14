import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import {
  ForbiddenResourceException,
  UnauthorizedSessionException,
  UserLockedException,
} from '../../application/exceptions/auth.exceptions';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function createMockExecutionContext(
    user?: any,
    requiredRoles?: string[],
  ): ExecutionContext {
    const req: any = { user };
    const context: any = {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };

    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(requiredRoles as any);

    return context as ExecutionContext;
  }

  it('should allow access when no roles are required', () => {
    const context = createMockExecutionContext(undefined, undefined);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when roles array is empty', () => {
    const context = createMockExecutionContext(undefined, []);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw UnauthorizedSessionException when user is not present on request', () => {
    const context = createMockExecutionContext(undefined, ['ADMIN']);
    expect(() => guard.canActivate(context)).toThrow(
      UnauthorizedSessionException,
    );
  });

  it('should throw UserLockedException when user status is LOCKED', () => {
    const user = {
      id: 'u-1',
      role: 'ADMIN',
      status: 'LOCKED',
    };
    const context = createMockExecutionContext(user, ['ADMIN']);
    expect(() => guard.canActivate(context)).toThrow(UserLockedException);
  });

  it('should throw ForbiddenResourceException when user role does not match required roles', () => {
    const user = {
      id: 'u-2',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    };
    const context = createMockExecutionContext(user, ['ADMIN']);
    expect(() => guard.canActivate(context)).toThrow(
      ForbiddenResourceException,
    );
  });

  it('should allow access when user role is in required roles', () => {
    const user = {
      id: 'u-3',
      role: 'ADMIN',
      status: 'ACTIVE',
    };
    const context = createMockExecutionContext(user, ['ADMIN']);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when user role matches one of multiple permitted roles', () => {
    const user = {
      id: 'u-4',
      role: 'PUBLISHER',
      status: 'ACTIVE',
    };
    const context = createMockExecutionContext(user, ['ADMIN', 'PUBLISHER']);
    expect(guard.canActivate(context)).toBe(true);
  });
});
