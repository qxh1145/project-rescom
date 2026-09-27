import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminModerationController } from './admin-moderation.controller';
import { SurveyModerationService } from '../application/survey-moderation.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ROLES_KEY } from '../../auth/presentation/decorators/roles.decorator';

describe('Story 8.1: AdminModerationController', () => {
  let controller: AdminModerationController;
  let service: jest.Mocked<
    Pick<
      SurveyModerationService,
      'listQueue' | 'getSurvey' | 'approve' | 'reject'
    >
  >;

  const admin = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'admin@rescom.test',
    role: 'ADMIN' as const,
    status: 'ACTIVE' as const,
  };
  const formId = '11111111-1111-4111-8111-111111111111';
  const formVersionId = '22222222-2222-4222-8222-222222222222';
  const correlationId = '33333333-3333-4333-8333-333333333333';

  const result = (replayed: boolean) =>
    ({
      decision: { id: 'd' },
      form: { id: formId },
      replayed,
    }) as never;

  beforeEach(async () => {
    service = {
      listQueue: jest.fn(),
      getSurvey: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminModerationController],
      providers: [{ provide: SurveyModerationService, useValue: service }],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AdminModerationController);
  });

  it('protects every route with session + ADMIN role, and mutations with CSRF + JSON-only', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminModerationController),
    ).toEqual([SessionAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, AdminModerationController)).toEqual([
      'ADMIN',
    ]);
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        AdminModerationController.prototype.listQueue,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        AdminModerationController.prototype.approve,
      ),
    ).toEqual([CsrfGuard, JsonOnlyGuard]);
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        AdminModerationController.prototype.reject,
      ),
    ).toEqual([CsrfGuard, JsonOnlyGuard]);
  });

  it('lists the queue in a success envelope', async () => {
    const page = { items: [], total: 0, limit: 20, offset: 0, hasMore: false };
    service.listQueue.mockResolvedValue(page);

    const response = await controller.listQueue({ limit: 20, offset: 0 });

    expect(service.listQueue).toHaveBeenCalledWith({ limit: 20, offset: 0 });
    expect(response).toEqual({ data: page, error: null, meta: {} });
  });

  it('returns a survey preview', async () => {
    service.getSurvey.mockResolvedValue({ formId } as never);
    const response = await controller.getSurvey(formId);
    expect(service.getSurvey).toHaveBeenCalledWith(formId);
    expect(response.data).toEqual({ formId });
  });

  it('approves with the acting admin and correlation id', async () => {
    service.approve.mockResolvedValue(result(false));

    const response = await controller.approve(
      admin,
      formId,
      { formVersionId },
      correlationId,
    );

    expect(service.approve).toHaveBeenCalledWith({
      formId,
      adminId: admin.id,
      input: { formVersionId },
      correlationId,
    });
    expect(response.meta.message).toBe('Survey approved and published');
  });

  it('reports an approval replay', async () => {
    service.approve.mockResolvedValue(result(true));
    const response = await controller.approve(admin, formId, { formVersionId });
    expect(response.meta.message).toBe('Survey was already approved');
  });

  it('rejects with the reason', async () => {
    service.reject.mockResolvedValue(result(false));
    const body = { formVersionId, reason: 'Spam survey' };

    const response = await controller.reject(admin, formId, body);

    expect(service.reject).toHaveBeenCalledWith({
      formId,
      adminId: admin.id,
      input: body,
      correlationId: undefined,
    });
    expect(response.meta.message).toBe('Survey rejected and escrow refunded');

    service.reject.mockResolvedValue(result(true));
    const replay = await controller.reject(admin, formId, body);
    expect(replay.meta.message).toBe('Survey was already rejected');
  });
});
