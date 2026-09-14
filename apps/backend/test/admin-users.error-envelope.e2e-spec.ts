import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AdminUsersController } from '../src/modules/admin/presentation/admin-users.controller';
import {
  CannotDemoteLastAdminException,
  CannotLockLastAdminException,
} from '../src/modules/users/application/exceptions/user-admin.exceptions';
import { UserAdminService } from '../src/modules/users/application/user-admin.service';
import { CsrfGuard } from '../src/modules/auth/presentation/guards/csrf.guard';
import { RolesGuard } from '../src/modules/auth/presentation/guards/roles.guard';
import { SessionAuthGuard } from '../src/modules/auth/presentation/guards/session-auth.guard';

describe('Admin last-admin HTTP error envelopes', () => {
  let app: INestApplication;
  const service = {
    updateUserStatus: jest.fn(),
    updateUserRole: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminUsersController],
      providers: [{ provide: UserAdminService, useValue: service }],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = {
            id: '00000000-0000-0000-0000-000000000099',
            email: 'admin@example.com',
            role: 'ADMIN',
            status: 'ACTIVE',
          };
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('formats CANNOT_LOCK_LAST_ADMIN from the status endpoint', async () => {
    service.updateUserStatus.mockRejectedValueOnce(
      new CannotLockLastAdminException(),
    );

    const response = await request(app.getHttpServer())
      .patch('/admin/users/123e4567-e89b-12d3-a456-426614174000/status')
      .send({ status: 'LOCKED' })
      .expect(400);

    expect(response.body.error.code).toBe('CANNOT_LOCK_LAST_ADMIN');
  });

  it('formats CANNOT_DEMOTE_LAST_ADMIN from the role endpoint', async () => {
    service.updateUserRole.mockRejectedValueOnce(
      new CannotDemoteLastAdminException(),
    );

    const response = await request(app.getHttpServer())
      .patch('/admin/users/123e4567-e89b-12d3-a456-426614174000/role')
      .send({ role: 'RESPONDENT' })
      .expect(400);

    expect(response.body.error.code).toBe('CANNOT_DEMOTE_LAST_ADMIN');
  });
});
