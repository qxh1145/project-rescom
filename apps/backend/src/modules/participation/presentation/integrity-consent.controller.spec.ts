import { HttpStatus } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  HTTP_CODE_METADATA,
} from '@nestjs/common/constants';
import { IntegrityConsentController } from './integrity-consent.controller';
import { IntegrityConsentService } from '../application/integrity-consent.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { IS_PUBLIC_KEY } from '../../../common/security/public.decorator';

describe('IntegrityConsentController', () => {
  const user = { id: '11111111-1111-4111-8111-111111111111' } as any;
  const consent = {
    currentVersion: 1,
    acceptedVersion: 1,
    acceptedAt: '2026-10-01T08:00:00.000Z',
  };
  const proto = IntegrityConsentController.prototype;
  let service: jest.Mocked<
    Pick<IntegrityConsentService, 'getConsent' | 'acceptConsent'>
  >;
  let controller: IntegrityConsentController;

  beforeEach(() => {
    service = {
      getConsent: jest.fn().mockResolvedValue(consent),
      acceptConsent: jest.fn().mockResolvedValue(consent),
    };
    controller = new IntegrityConsentController(
      service as unknown as IntegrityConsentService,
    );
  });

  it('requires a session for both routes (none is public)', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, IntegrityConsentController),
    ).toEqual([SessionAuthGuard]);
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, proto.getConsent),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, proto.acceptConsent),
    ).toBeUndefined();
  });

  it('reads the caller consent, uncached', async () => {
    expect(Reflect.getMetadata(HEADERS_METADATA, proto.getConsent)).toEqual([
      { name: 'Cache-Control', value: 'no-store' },
    ]);
    await expect(controller.getConsent(user)).resolves.toEqual({
      data: consent,
      error: null,
      meta: {},
    });
    expect(service.getConsent).toHaveBeenCalledWith(user.id);
  });

  it('accepts with CSRF + JSON-only and answers 200', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.acceptConsent)).toEqual([
      CsrfGuard,
      JsonOnlyGuard,
    ]);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.acceptConsent)).toBe(
      HttpStatus.OK,
    );
    await expect(
      controller.acceptConsent(user, { noticeVersion: 1 }),
    ).resolves.toEqual({ data: consent, error: null, meta: {} });
    expect(service.acceptConsent).toHaveBeenCalledWith(user.id, {
      noticeVersion: 1,
    });
  });
});
