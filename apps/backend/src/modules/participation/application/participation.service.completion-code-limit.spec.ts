import { ParticipationService } from './participation.service';
import {
  AttemptLockedException,
  CompletionCodeLimitReachedException,
  InvalidCompletionCodeException,
} from './exceptions/participation.exceptions';
import { InMemoryParticipationRepository } from '../infrastructure/in-memory-participation.repository';
import { InMemoryFormRepository } from '../../forms/infrastructure/in-memory-form.repository';
import { InMemoryDemographicProfileRepository } from '../../users/infrastructure/in-memory-demographic-profile.repository';
import { FormEntity } from '../../forms/domain/form.entity';
import { FormVersionEntity } from '../../forms/domain/form-version.entity';
import { SurveyAttemptEntity } from '../domain/survey-attempt.entity';
import { PassThroughUnitOfWork } from '../../../common/database/unit-of-work.port';
import { seedCompleteDemographicProfile } from '../../../../test/fixtures/demographic-profile.fixture';

/**
 * Code-review decision E5-D1 (2026-09-26, option B) — the account+FormVersion
 * completion-code limit, `completion-code-policy-v1` (provisional pending PRD
 * Open Question 14): 3 wrong codes lock an attempt; 6 wrong codes per account
 * and FormVersion, summed across attempts, refuse further attempts and
 * verifications on that version (409 COMPLETION_CODE_LIMIT_REACHED) until an
 * Admin resets the count.
 */
describe('ParticipationService completion-code limit (decision E5-D1)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const publisherId = '22222222-2222-4222-8222-222222222222';
  const adminId = '33333333-3333-4333-8333-333333333333';
  const formId = '55555555-5555-4555-8555-555555555555';
  const versionId = '66666666-6666-4666-8666-666666666666';
  const internalFormId = '77777777-7777-4777-8777-777777777777';

  let formRepo: InMemoryFormRepository;
  let partRepo: InMemoryParticipationRepository;
  let service: ParticipationService;
  let completionCode: {
    verifyCode: jest.Mock;
    canVerify: jest.Mock;
    generateSixDigitCode: jest.Mock;
  };

  function externalVersion(id: string, versionNumber = 1) {
    return new FormVersionEntity(
      id,
      formId,
      versionNumber,
      {
        title: 'External survey',
        blocks: [],
        metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 15 },
      } as any,
      null,
      true,
      'https://docs.google.com/forms/d/e/abc/viewform',
      'v1:digest',
      new Date(),
      new Date(),
    );
  }

  function backdate(attemptId: string, seconds: number) {
    const attempt = partRepo.attempts.get(attemptId)!;
    partRepo.attempts.set(
      attemptId,
      new SurveyAttemptEntity(
        attempt.id,
        attempt.surveyId,
        attempt.formVersionId,
        attempt.respondentId,
        attempt.status,
        attempt.isGuest,
        new Date(attempt.startedAt.getTime() - seconds * 1000),
        attempt.submittedAt,
        attempt.clientContext,
        attempt.createdAt,
        attempt.updatedAt,
        attempt.codeVerification,
      ),
    );
  }

  async function start(): Promise<string> {
    const attempt = await service.startAttempt(formId, userId, {}, '127.0.0.1');
    backdate(attempt.attemptId, 60); // past the 15 s barrier
    return attempt.attemptId;
  }

  function verify(attemptId: string, code = '000000') {
    return service.verifyExternalCompletionCode(formId, attemptId, userId, {
      completionCode: code,
    });
  }

  async function failTimes(attemptId: string, times: number) {
    const errors: unknown[] = [];
    for (let i = 0; i < times; i++) {
      errors.push(await verify(attemptId).catch((e: unknown) => e));
    }
    return errors;
  }

  beforeEach(async () => {
    formRepo = new InMemoryFormRepository();
    partRepo = new InMemoryParticipationRepository();
    const demoRepo = new InMemoryDemographicProfileRepository();
    await seedCompleteDemographicProfile(demoRepo, userId);
    completionCode = {
      verifyCode: jest.fn(
        (_versionId: string, code: string) => code === '123456',
      ),
      canVerify: jest.fn().mockReturnValue(true),
      generateSixDigitCode: jest.fn(),
    };
    await formRepo.create(
      new FormEntity(
        formId,
        publisherId,
        'EXTERNAL',
        'PUBLISHED',
        'External survey',
        null,
        10,
        50,
        new Date(),
        new Date(),
      ),
      externalVersion(versionId),
    );
    service = new ParticipationService(
      formRepo,
      demoRepo,
      partRepo,
      undefined,
      completionCode as any,
      undefined,
      new PassThroughUnitOfWork(),
    );
  });

  it('allows a second attempt after a locked one, then refuses a third start with 409 COMPLETION_CODE_LIMIT_REACHED', async () => {
    const first = await start();
    const firstErrors = await failTimes(first, 3);
    expect(firstErrors[0]).toBeInstanceOf(InvalidCompletionCodeException);
    expect(
      (firstErrors[0] as InvalidCompletionCodeException).remainingAttempts,
    ).toBe(2);
    expect(firstErrors[2]).toBeInstanceOf(AttemptLockedException);
    expect(partRepo.attempts.get(first)?.status).toBe('LOCKED');

    // The honest mistyper may retry once without Admin help.
    const second = await start();
    const secondErrors = await failTimes(second, 3);
    expect(
      (secondErrors[0] as InvalidCompletionCodeException).remainingAttempts,
    ).toBe(2);
    expect(secondErrors[2]).toBeInstanceOf(AttemptLockedException);

    const refused = await service
      .startAttempt(formId, userId, {}, '127.0.0.1')
      .catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(CompletionCodeLimitReachedException);
    expect(refused).toMatchObject({
      code: 'COMPLETION_CODE_LIMIT_REACHED',
      details: {
        formVersionId: versionId,
        failedVerifications: 6,
        limit: 6,
        policyVersion: 'completion-code-policy-v1',
      },
    });
    expect(
      [...partRepo.attempts.values()].filter((a) => a.status === 'IN_PROGRESS'),
    ).toHaveLength(0);
  });

  it('counts wrong codes of abandoned attempts too and locks as soon as the account reaches 6', async () => {
    const first = await start();
    await failTimes(first, 2);
    // The attempt expires with 2 wrong codes (abandoned on the next start).
    backdate(first, 31 * 60);

    const second = await start();
    expect(partRepo.attempts.get(first)?.status).toBe('ABANDONED');
    const secondErrors = await failTimes(second, 3);
    // 2 + 1 = 3 counted: min(3 - 1 per attempt, 6 - 3 per account) = 2.
    expect(
      (secondErrors[0] as InvalidCompletionCodeException).remainingAttempts,
    ).toBe(2);
    expect(secondErrors[2]).toBeInstanceOf(AttemptLockedException);

    // 5 counted: one try left on the version, even on a fresh attempt.
    const third = await start();
    const thirdErrors = await failTimes(third, 1);
    expect(thirdErrors[0]).toBeInstanceOf(AttemptLockedException);
    expect(partRepo.attempts.get(third)?.status).toBe('LOCKED');
    expect(partRepo.attempts.get(third)?.codeVerification.failedCount).toBe(1);

    await expect(
      service.startAttempt(formId, userId, {}, '127.0.0.1'),
    ).rejects.toBeInstanceOf(CompletionCodeLimitReachedException);
  });

  it('refuses a verification at the limit before the code is compared (no strike, no leak)', async () => {
    const attemptId = await start();
    // Strikes counted on older attempts of the same version (e.g. legacy
    // rows from before the limit existed).
    partRepo.attempts.set(
      'older',
      new SurveyAttemptEntity(
        'older',
        formId,
        versionId,
        userId,
        'LOCKED',
        false,
        new Date(Date.now() - 3_600_000),
        null,
        null,
        new Date(),
        new Date(),
        {
          failedCount: 6,
          lastFailedAt: new Date(),
          missingCodeReportedAt: null,
          missingCodeReason: null,
        },
      ),
    );

    await expect(verify(attemptId, '123456')).rejects.toBeInstanceOf(
      CompletionCodeLimitReachedException,
    );
    expect(completionCode.verifyCode).not.toHaveBeenCalled();
    expect(partRepo.attempts.get(attemptId)?.codeVerification.failedCount).toBe(
      0,
    );
    expect(partRepo.attempts.get(attemptId)?.status).toBe('IN_PROGRESS');
  });

  it('an Admin reset forgives the counted wrong codes, audited, and lets the account start again', async () => {
    await failTimes(await start(), 3);
    await failTimes(await start(), 3);

    const result = await service.resetCompletionCodeLimit(adminId, {
      respondentId: userId,
      formVersionId: versionId,
      reason: 'Honest mistyping confirmed by support',
    });
    expect(result).toEqual({
      respondentId: userId,
      formVersionId: versionId,
      failuresForgiven: 6,
      failedVerifications: 0,
      limit: 6,
      resetAt: expect.any(String),
      policyVersion: 'completion-code-policy-v1',
    });
    expect(partRepo.completionCodeLimitResets).toEqual([
      expect.objectContaining({
        respondentId: userId,
        formVersionId: versionId,
        resetById: adminId,
        reason: 'Honest mistyping confirmed by support',
        failuresForgiven: 6,
        policyVersion: 'completion-code-policy-v1',
      }),
    ]);
    // The locked attempts and their evidence stay untouched.
    expect(
      [...partRepo.attempts.values()].filter((a) => a.status === 'LOCKED'),
    ).toHaveLength(2);
    expect(
      partRepo.fraudLogs.filter((log) => log.type === 'SECURITY_VIOLATION'),
    ).toHaveLength(6);

    const again = await start();
    const errors = await failTimes(again, 1);
    expect(
      (errors[0] as InvalidCompletionCodeException).remainingAttempts,
    ).toBe(2);
    await expect(verify(again, '123456')).resolves.toMatchObject({
      status: 'COMPLETED',
    });

    // Nothing left to forgive: no second audit row.
    await expect(
      service.resetCompletionCodeLimit(adminId, {
        respondentId: userId,
        formVersionId: versionId,
        reason: 'Second reset attempt',
      }),
    ).resolves.toMatchObject({
      failuresForgiven: 1,
      resetAt: expect.any(String),
    });
    await expect(
      service.resetCompletionCodeLimit(adminId, {
        respondentId: userId,
        formVersionId: versionId,
        reason: 'Third reset attempt',
      }),
    ).resolves.toMatchObject({ failuresForgiven: 0, resetAt: null });
    expect(partRepo.completionCodeLimitResets).toHaveLength(2);
  });

  it('counts per FormVersion: a new version (new code) starts a fresh count', async () => {
    await failTimes(await start(), 3);
    await failTimes(await start(), 3);
    await expect(
      service.startAttempt(formId, userId, {}, '127.0.0.1'),
    ).rejects.toBeInstanceOf(CompletionCodeLimitReachedException);

    await formRepo.createVersion(
      formId,
      '88888888-8888-4888-8888-888888888888',
      new Date(),
    );
    const latest = await formRepo.findById(formId);
    await formRepo.update(
      latest!.form.copyWith({ status: 'PUBLISHED', updatedAt: new Date() }),
      latest!.currentVersion.copyWith({ isPublished: true }),
    );

    await expect(
      service.startAttempt(formId, userId, {}, '127.0.0.1'),
    ).resolves.toMatchObject({
      formVersionId: '88888888-8888-4888-8888-888888888888',
    });
  });

  it('never applies to Internal surveys', async () => {
    await formRepo.create(
      new FormEntity(
        internalFormId,
        publisherId,
        'INTERNAL',
        'PUBLISHED',
        'Internal survey',
        null,
        10,
        50,
        new Date(),
        new Date(),
      ),
      new FormVersionEntity(
        '99999999-9999-4999-8999-999999999999',
        internalFormId,
        1,
        {
          title: 'Internal survey',
          metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 4 },
          blocks: [{ id: 'q1', order: 0, title: 'Q', type: 'text' }],
        } as any,
        null,
        true,
        null,
        null,
        new Date(),
        new Date(),
      ),
    );
    const count = jest.spyOn(partRepo, 'countCompletionCodeFailures');
    const reserve = jest.spyOn(partRepo, 'reserveAttempt');

    await service.startAttempt(internalFormId, userId, {}, '127.0.0.1');

    expect(count).not.toHaveBeenCalled();
    expect(reserve.mock.calls[0][0].completionCodeFailureLimit).toBeUndefined();
  });
  describe('Bug 3.4: a completion-code rotation during an attempt', () => {
    const rotatedVersionId = '88888888-8888-4888-8888-888888888888';

    async function rotate() {
      const rotated = await formRepo.createVersion(
        formId,
        rotatedVersionId,
        new Date(),
        {
          completionCode: 'v1:rotated-digest',
          isPublished: true,
          publishedAt: new Date(),
          expectedStatus: 'PUBLISHED',
        },
      );
      expect(rotated!.currentVersion.versionNumber).toBe(2);
    }

    beforeEach(() => {
      // Each version has its own code: v1 "111111", the rotated v2 "222222".
      completionCode.verifyCode.mockImplementation(
        (id: string, code: string) =>
          id === rotatedVersionId ? code === '222222' : code === '111111',
      );
    });

    it('rejects the superseded code and keys the failure budget by the rotated version', async () => {
      const attemptId = await start();
      await rotate();
      const count = jest.spyOn(partRepo, 'countCompletionCodeFailures');
      const record = jest.spyOn(partRepo, 'recordFailedAttemptVerification');

      await expect(verify(attemptId, '111111')).rejects.toBeInstanceOf(
        InvalidCompletionCodeException,
      );

      expect(completionCode.verifyCode).toHaveBeenLastCalledWith(
        rotatedVersionId,
        '111111',
        'v1:rotated-digest',
      );
      expect(count).toHaveBeenCalledWith(userId, rotatedVersionId);
      expect(record).toHaveBeenCalledWith(attemptId, userId, rotatedVersionId);
    });

    it('accepts the new code and keeps the attempt pinned to its version', async () => {
      const attemptId = await start();
      await rotate();

      const result = await verify(attemptId, '222222');

      expect(result.status).toBe('COMPLETED');
      expect(result.formVersionId).toBe(versionId);
      expect(partRepo.attempts.get(attemptId)!.formVersionId).toBe(versionId);
    });

    it('verifies against the pinned version when nothing was rotated', async () => {
      const attemptId = await start();

      const result = await verify(attemptId, '111111');

      expect(result.status).toBe('COMPLETED');
      expect(completionCode.verifyCode).toHaveBeenLastCalledWith(
        versionId,
        '111111',
        'v1:digest',
      );
    });
  });
});
