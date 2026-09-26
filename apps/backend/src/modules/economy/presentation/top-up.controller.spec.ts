import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { TopUpController } from './top-up.controller';
import { AdminTopUpController } from './admin-top-up.controller';
import { TopUpService } from '../application/top-up.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ROLES_KEY } from '../../auth/presentation/decorators/roles.decorator';

describe('Story 6.6: top-up controllers', () => {
  let userController: TopUpController;
  let adminController: AdminTopUpController;
  let service: jest.Mocked<
    Pick<
      TopUpService,
      | 'createRequest'
      | 'listMyRequests'
      | 'listForReview'
      | 'approveTopUp'
      | 'rejectTopUp'
    >
  >;

  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'student@fpt.edu.vn',
    role: 'RESPONDENT' as const,
    status: 'ACTIVE' as const,
  };
  const admin = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'admin@rescom.test',
    role: 'ADMIN' as const,
    status: 'ACTIVE' as const,
  };
  const topUpId = '33333333-3333-4333-8333-333333333333';

  beforeEach(async () => {
    service = {
      createRequest: jest.fn(),
      listMyRequests: jest.fn(),
      listForReview: jest.fn(),
      approveTopUp: jest.fn(),
      rejectTopUp: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TopUpController, AdminTopUpController],
      providers: [{ provide: TopUpService, useValue: service }],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();

    userController = module.get(TopUpController);
    adminController = module.get(AdminTopUpController);
  });

  describe('TopUpController (user)', () => {
    it('creates a request for the caller and wraps it in the success envelope', async () => {
      const dto = { id: topUpId, status: 'PENDING' } as never;
      service.createRequest.mockResolvedValue(dto);

      const response = await userController.create(user, { amount: 100 });

      expect(service.createRequest).toHaveBeenCalledWith(user.id, {
        amount: 100,
      });
      expect(response).toEqual({ data: dto, error: null, meta: {} });
    });

    it("lists only the caller's requests", async () => {
      const list = {
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
        hasMore: false,
      };
      service.listMyRequests.mockResolvedValue(list);

      const response = await userController.list(user, {
        limit: 20,
        offset: 0,
      });

      expect(service.listMyRequests).toHaveBeenCalledWith(user.id, {
        limit: 20,
        offset: 0,
      });
      expect(response.data).toEqual(list);
    });

    it('protects the mutation with session, CSRF and JSON-only guards', () => {
      const classGuards = Reflect.getMetadata(GUARDS_METADATA, TopUpController);
      const createGuards = Reflect.getMetadata(
        GUARDS_METADATA,
        TopUpController.prototype.create,
      );
      expect(classGuards).toEqual([SessionAuthGuard]);
      expect(createGuards).toEqual([CsrfGuard, JsonOnlyGuard]);
    });
  });

  describe('AdminTopUpController', () => {
    it('lists the review queue', async () => {
      const list = {
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
        hasMore: false,
      };
      service.listForReview.mockResolvedValue(list);

      const response = await adminController.list({ limit: 20, offset: 0 });

      expect(service.listForReview).toHaveBeenCalledWith({
        limit: 20,
        offset: 0,
      });
      expect(response.data).toEqual(list);
    });

    it('approves as the acting admin and forwards the correlation id', async () => {
      const result = { replayed: false } as never;
      service.approveTopUp.mockResolvedValue(result);

      const response = await adminController.approve(
        admin,
        topUpId,
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      );

      expect(service.approveTopUp).toHaveBeenCalledWith({
        topUpId,
        adminId: admin.id,
        correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      });
      expect(response.data).toBe(result);
    });

    it('rejects with the validated reason', async () => {
      const result = { replayed: false } as never;
      service.rejectTopUp.mockResolvedValue(result);

      await adminController.reject(
        admin,
        topUpId,
        { reason: 'Không tìm thấy giao dịch' },
        undefined,
      );

      expect(service.rejectTopUp).toHaveBeenCalledWith({
        topUpId,
        adminId: admin.id,
        reason: 'Không tìm thấy giao dịch',
        correlationId: undefined,
      });
    });

    it('requires ADMIN plus CSRF on mutations (JSON-only when a body is sent)', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, AdminTopUpController),
      ).toEqual([SessionAuthGuard, RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, AdminTopUpController)).toEqual([
        'ADMIN',
      ]);
      expect(
        Reflect.getMetadata(
          GUARDS_METADATA,
          AdminTopUpController.prototype.approve,
        ),
      ).toEqual([CsrfGuard]);
      expect(
        Reflect.getMetadata(
          GUARDS_METADATA,
          AdminTopUpController.prototype.reject,
        ),
      ).toEqual([CsrfGuard, JsonOnlyGuard]);
    });
  });
});
