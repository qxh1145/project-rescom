import { UnsupportedMediaTypeException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { JsonOnlyGuard, isJsonMediaType } from './json-only.guard';

describe('JsonOnlyGuard', () => {
  it.each([
    ['application/json', true],
    ['Application/JSON; charset=utf-8', true],
    [' application/json ;charset=UTF-8', true],
    ['text/plain; x=application/json', false],
    ['application/jsonp', false],
    ['application/json-patch+json', false],
    ['application/x-www-form-urlencoded', false],
    ['', false],
    [undefined, false],
  ])('%j → %s', (contentType, expected) => {
    expect(isJsonMediaType(contentType)).toBe(expected);
  });

  it('rejects a non-JSON body with 415 AUTH_UNSUPPORTED_MEDIA_TYPE', () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'content-type': 'text/plain;application/json' },
        }),
      }),
    } as unknown as ExecutionContext;
    expect(() => new JsonOnlyGuard().canActivate(context)).toThrow(
      UnsupportedMediaTypeException,
    );
  });
});
