import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from './current-user.decorator';
import { CurrentSession } from './current-session.decorator';

describe('Auth Parameter Decorators (Task 4)', () => {
  function getParamDecoratorFactory(
    decorator: (...args: any[]) => ParameterDecorator,
  ) {
    class Test {
      test(@decorator() _param: any) {}
    }
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Test, 'test');
    return args[Object.keys(args)[0]].factory;
  }

  it('CurrentUser decorator should extract req.user from execution context', () => {
    const factory = getParamDecoratorFactory(CurrentUser);
    const mockUser = {
      id: 'u-1',
      email: 'u1@example.com',
      role: 'RESPONDENT' as const,
      status: 'ACTIVE' as const,
    };
    const mockContext: any = {
      switchToHttp: () => ({
        getRequest: () => ({ user: mockUser }),
      }),
    };

    const result = factory(null, mockContext);
    expect(result).toBe(mockUser);
  });

  it('CurrentSession decorator should extract req.session from execution context', () => {
    const factory = getParamDecoratorFactory(CurrentSession);
    const mockSession = { id: 's-1', userId: 'u-1' };
    const mockContext: any = {
      switchToHttp: () => ({
        getRequest: () => ({ session: mockSession }),
      }),
    };

    const result = factory(null, mockContext);
    expect(result).toBe(mockSession);
  });
});
