import { AdminCompletionCodeLimitController } from './admin-completion-code-limit.controller';
import { ParticipationService } from '../application/participation.service';
import { ROLES_KEY } from '../../auth/presentation/decorators/roles.decorator';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { completionCodeLimitResetRequestSchema } from '@rescom/schemas';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';

describe('AdminCompletionCodeLimitController (decision E5-D1)', () => {
  const respondentId = '11111111-1111-4111-8111-111111111111';
  const formVersionId = '22222222-2222-4222-8222-222222222222';
  const admin = { id: '33333333-3333-4333-8333-333333333333', role: 'ADMIN' };
  const body = {
    respondentId,
    formVersionId,
    reason: 'Honest mistyping confirmed',
  };

  let service: jest.Mocked<
    Pick<ParticipationService, 'resetCompletionCodeLimit'>
  >;
  let controller: AdminCompletionCodeLimitController;

  beforeEach(() => {
    service = {
      resetCompletionCodeLimit: jest.fn().mockResolvedValue({
        respondentId,
        formVersionId,
        failuresForgiven: 6,
        failedVerifications: 0,
        limit: 6,
        resetAt: '2026-09-26T12:00:00.000Z',
        policyVersion: 'completion-code-policy-v1',
      }),
    };
    controller = new AdminCompletionCodeLimitController(
      service as unknown as ParticipationService,
    );
  });

  it('is Admin-only (RESPONDENT/PUBLISHER get 403 from RolesGuard)', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminCompletionCodeLimitController),
    ).toEqual(['ADMIN']);
  });

  it('resets the limit as the calling Admin and returns the audited result', async () => {
    const res = await controller.reset(
      admin as unknown as AuthenticatedUser,
      body,
    );

    expect(service.resetCompletionCodeLimit).toHaveBeenCalledWith(
      admin.id,
      body,
    );
    expect(res.data).toMatchObject({ failuresForgiven: 6, limit: 6 });
    expect(res.meta.message).toMatch(/reset/);
  });

  it('says so when nothing was counted', async () => {
    service.resetCompletionCodeLimit.mockResolvedValueOnce({
      respondentId,
      formVersionId,
      failuresForgiven: 0,
      failedVerifications: 0,
      limit: 6,
      resetAt: null,
      policyVersion: 'completion-code-policy-v1',
    });
    const res = await controller.reset(
      admin as unknown as AuthenticatedUser,
      body,
    );
    expect(res.meta.message).toMatch(/Nothing to reset/);
  });

  it('requires a reason and rejects any other field', () => {
    const pipe = new ZodValidationPipe(completionCodeLimitResetRequestSchema);
    expect(() =>
      pipe.transform({ respondentId, formVersionId }, { type: 'body' }),
    ).toThrow();
    expect(() =>
      pipe.transform({ ...body, failuresForgiven: 99 }, { type: 'body' }),
    ).toThrow();
    expect(pipe.transform(body, { type: 'body' })).toEqual(body);
  });
});
