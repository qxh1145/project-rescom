import { AdminMissingCodeResolutionController } from './admin-missing-code-resolution.controller';
import { ParticipationService } from '../application/participation.service';
import { ROLES_KEY } from '../../auth/presentation/decorators/roles.decorator';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';

describe('AdminMissingCodeResolutionController (Story 14.1 AC 1)', () => {
  const attemptId = '11111111-1111-4111-8111-111111111111';
  const admin = { id: '22222222-2222-4222-8222-222222222222', role: 'ADMIN' };
  const body = {
    outcome: 'CREDIT_RESPONDENT' as const,
    note: 'Valid resolution note for manual credit',
  };

  let service: jest.Mocked<
    Pick<ParticipationService, 'resolveMissingCodeReport'>
  >;
  let controller: AdminMissingCodeResolutionController;

  beforeEach(() => {
    service = {
      resolveMissingCodeReport: jest.fn().mockResolvedValue({
        attemptId,
        outcome: 'CREDIT_RESPONDENT',
        attemptStatus: 'COMPLETED',
        rewardPoints: 50,
        replayed: false,
      }),
    };
    controller = new AdminMissingCodeResolutionController(
      service as unknown as ParticipationService,
    );
  });

  it('is Admin-only (RolesGuard metadata requires ADMIN)', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminMissingCodeResolutionController),
    ).toEqual(['ADMIN']);
  });

  it('calls resolveMissingCodeReport and wraps in standard success envelope', async () => {
    const res = await controller.resolve(
      admin as unknown as AuthenticatedUser,
      attemptId,
      body,
      'corr-123',
    );

    expect(service.resolveMissingCodeReport).toHaveBeenCalledWith(
      admin.id,
      attemptId,
      body,
      { correlationId: 'corr-123' },
    );
    expect(res.data).toEqual({
      attemptId,
      outcome: 'CREDIT_RESPONDENT',
      attemptStatus: 'COMPLETED',
      rewardPoints: 50,
      replayed: false,
    });
    expect(res.meta.message).toContain('Respondent credited');
  });

  it('returns replayed message when report was already resolved', async () => {
    service.resolveMissingCodeReport.mockResolvedValueOnce({
      attemptId,
      outcome: 'CREDIT_RESPONDENT',
      attemptStatus: 'COMPLETED',
      rewardPoints: 50,
      replayed: true,
    });

    const res = await controller.resolve(
      admin as unknown as AuthenticatedUser,
      attemptId,
      body,
    );

    expect(res.meta.message).toMatch(/already resolved/i);
  });

  it('returns dismissed message when outcome is DISMISSED', async () => {
    service.resolveMissingCodeReport.mockResolvedValueOnce({
      attemptId,
      outcome: 'DISMISSED',
      attemptStatus: 'IN_PROGRESS',
      rewardPoints: null,
      replayed: false,
    });

    const res = await controller.resolve(
      admin as unknown as AuthenticatedUser,
      attemptId,
      { outcome: 'DISMISSED', note: 'Respondent did not finish external survey' },
    );

    expect(res.meta.message).toMatch(/dismissed/i);
  });
});
