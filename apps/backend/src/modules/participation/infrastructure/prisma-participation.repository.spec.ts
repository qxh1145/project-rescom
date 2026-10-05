import {
  PrismaParticipationRepository,
  toInternalRewardRequest,
} from './prisma-participation.repository';
import {
  PrismaUnitOfWork,
  runInTransaction,
} from '../../../common/database/prisma-unit-of-work';
import { UncleanAttachmentException } from '../application/exceptions/participation.exceptions';
import { IntegrityEventEntity } from '../domain/integrity-event.entity';

/**
 * Epic 6 review P5/P6: completion transactions read the form status under a
 * shared row lock, and the pinned Internal reward request is read back from
 * the Outbox. PostgreSQL locking itself stays in the Postgres-gated suite.
 */
describe('PrismaParticipationRepository (Epic 6 review P5/P6)', () => {
  const attemptRow = {
    id: '11111111-1111-4111-8111-111111111111',
    surveyId: '22222222-2222-4222-8222-222222222222',
    formVersionId: '33333333-3333-4333-8333-333333333333',
    respondentId: '44444444-4444-4444-8444-444444444444',
    status: 'IN_PROGRESS',
    isGuest: false,
    startedAt: new Date(),
    submittedAt: null,
    clientContext: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function setup(formStatus: string | null) {
    const queries: string[] = [];
    const tx = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        queries.push(sql);
        if (sql.includes('FROM forms')) {
          return formStatus ? [{ status: formStatus }] : [];
        }
        return [{ id: attemptRow.id }];
      }),
      surveyAttempt: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(attemptRow),
        // Epic 5 review P1: the one-completion-per-account re-check.
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest
          .fn()
          .mockResolvedValue({ ...attemptRow, status: 'COMPLETED' }),
      },
      response: { update: jest.fn(), findFirst: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (work: (client: unknown) => unknown) =>
        work(tx),
      ),
      outboxEvent: { findUnique: jest.fn() },
    };
    return {
      tx,
      prisma,
      queries,
      repository: new PrismaParticipationRepository(prisma as any),
      unitOfWork: new PrismaUnitOfWork(prisma as any),
    };
  }

  const params = {
    attemptId: attemptRow.id,
    respondentId: attemptRow.respondentId,
    formId: attemptRow.surveyId,
    formVersionId: attemptRow.formVersionId,
    submittedAt: new Date(),
  };

  it('claims an External attempt only while the form is PUBLISHED, under FOR NO KEY UPDATE', async () => {
    const { tx, queries, repository, unitOfWork } = setup('PUBLISHED');

    const result = await unitOfWork.run('external-completion:a', () =>
      repository.completeExternalAttemptTransaction(params),
    );

    expect(result.outcome).toBe('COMPLETED');
    expect(
      queries.some((sql) => /FROM forms[\s\S]*FOR NO KEY UPDATE/.test(sql)),
    ).toBe(true);
    expect(tx.surveyAttempt.update).toHaveBeenCalled();
  });

  it('BE-7: the claim re-pins the attempt to the verified (rotated) version', async () => {
    const { tx, repository, unitOfWork } = setup('PUBLISHED');
    const rotatedVersionId = '99999999-9999-4999-8999-999999999999';

    await unitOfWork.run('external-completion:a', () =>
      repository.completeExternalAttemptTransaction({
        ...params,
        formVersionId: rotatedVersionId,
      }),
    );

    expect(tx.surveyAttempt.update).toHaveBeenCalledWith({
      where: { id: attemptRow.id },
      data: expect.objectContaining({
        status: 'COMPLETED',
        formVersionId: rotatedVersionId,
      }),
    });
  });

  it('returns FORM_NOT_OPEN without writing when the form closed meanwhile', async () => {
    const { tx, repository, unitOfWork } = setup('CLOSED');

    const result = await unitOfWork.run('external-completion:a', () =>
      repository.completeExternalAttemptTransaction(params),
    );

    expect(result.outcome).toBe('FORM_NOT_OPEN');
    expect(tx.surveyAttempt.update).not.toHaveBeenCalled();
  });

  it('refuses an Internal submission without writing when the form is no longer open', async () => {
    const { tx, repository } = setup('CLOSED');

    await expect(
      repository.submitInternalResponseTransaction({
        responseId: '55555555-5555-4555-8555-555555555555',
        attemptId: attemptRow.id,
        formId: attemptRow.surveyId,
        formVersionId: attemptRow.formVersionId,
        respondentId: attemptRow.respondentId,
        isGuest: false,
        answers: {},
        submittedAt: new Date(),
        policyMode: 'SHADOW',
        policyDeploymentId: 'policy-default-v1',
        rewardAmount: 10,
        publisherId: '66666666-6666-4666-8666-666666666666',
      }),
    ).resolves.toEqual({ outcome: 'FORM_NOT_OPEN' });
    expect(tx.response.update).not.toHaveBeenCalled();
  });

  it('reads the pinned reward request from the Outbox', async () => {
    const { prisma, repository } = setup('PUBLISHED');
    prisma.outboxEvent.findUnique.mockResolvedValue({
      payload: {
        publisherId: 'p',
        respondentId: 'r',
        rewardAmount: 40,
        policyMode: 'ADVISORY',
      },
    });

    await expect(
      repository.findInternalRewardRequest('resp-1'),
    ).resolves.toEqual({
      publisherId: 'p',
      respondentId: 'r',
      rewardAmount: 40,
      policyMode: 'ADVISORY',
    });
    expect(prisma.outboxEvent.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: 'internal-reward:resp-1' },
      select: { payload: true },
    });
  });

  it('ignores missing or malformed reward requests', () => {
    expect(toInternalRewardRequest(undefined)).toBeNull();
    expect(
      toInternalRewardRequest({ publisherId: 'p', respondentId: 'r' }),
    ).toBeNull();
    expect(
      toInternalRewardRequest({
        publisherId: 'p',
        respondentId: 'r',
        rewardAmount: 1.5,
      }),
    ).toBeNull();
    expect(
      toInternalRewardRequest({
        publisherId: 'p',
        respondentId: 'r',
        rewardAmount: 5,
        policyMode: 'UNKNOWN',
      }),
    ).toEqual({
      publisherId: 'p',
      respondentId: 'r',
      rewardAmount: 5,
      policyMode: 'SHADOW',
    });
  });
});

/**
 * Epic 5 review P1/P2/P4/P7/P21: the SQL-level shape of the new transactions
 * (lock order, state predicates, unique-violation mapping, server-owned
 * counters). PostgreSQL itself stays in the Postgres-gated suite (DF5).
 */
describe('PrismaParticipationRepository (Epic 5 review)', () => {
  const ids = {
    attempt: '11111111-1111-4111-8111-111111111111',
    form: '22222222-2222-4222-8222-222222222222',
    version: '33333333-3333-4333-8333-333333333333',
    respondent: '44444444-4444-4444-8444-444444444444',
    response: '55555555-5555-4555-8555-555555555555',
    publisher: '66666666-6666-4666-8666-666666666666',
    object: '77777777-7777-4777-8777-777777777777',
  };

  function attemptRow(overrides: Record<string, unknown> = {}) {
    return {
      id: ids.attempt,
      surveyId: ids.form,
      formVersionId: ids.version,
      respondentId: ids.respondent,
      status: 'IN_PROGRESS',
      isGuest: false,
      startedAt: new Date(),
      submittedAt: null,
      clientContext: null,
      failedCodeVerifications: 0,
      lastFailedVerificationAt: null,
      missingCodeReportedAt: null,
      missingCodeReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  function responseRow(overrides: Record<string, unknown> = {}) {
    return {
      id: ids.response,
      formId: ids.form,
      formVersionId: ids.version,
      attemptId: ids.attempt,
      respondentId: ids.respondent,
      status: 'IN_PROGRESS',
      answersJson: null,
      ipAddress: '127.0.0.1',
      isGuest: false,
      submittedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  function createHarness(options: { formStatus?: string } = {}) {
    const log: string[] = [];
    const tx: any = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        log.push(`sql:${sql.replace(/\s+/g, ' ').trim()}`);
        if (sql.includes('FROM forms')) {
          return [{ status: options.formStatus ?? 'PUBLISHED' }];
        }
        return [];
      }),
      formVersion: {
        findUnique: jest.fn(async () => {
          log.push('formVersion.findUnique');
          return { formId: ids.form, isPublished: true };
        }),
      },
      surveyAttempt: {
        findFirst: jest.fn(async () => {
          log.push('surveyAttempt.findFirst');
          return null;
        }),
        findUnique: jest.fn(async () => attemptRow()),
        findUniqueOrThrow: jest.fn(async () =>
          attemptRow({ status: 'COMPLETED' }),
        ),
        updateMany: jest.fn(async () => {
          log.push('surveyAttempt.updateMany');
          return { count: 1 };
        }),
        update: jest.fn(async ({ data }: any) => attemptRow(data)),
        // Epic 8 review P3: the in-transaction completion count.
        findMany: jest.fn(async () => {
          log.push('surveyAttempt.findMany');
          return [];
        }),
        count: jest.fn(async () => 0),
        groupBy: jest.fn(async () => []),
        create: jest.fn(async ({ data }: any) => {
          log.push('surveyAttempt.create');
          return attemptRow(data);
        }),
        // Decision E5-D1: the summed server-owned strike counter.
        aggregate: jest.fn(async () => {
          log.push('surveyAttempt.aggregate');
          return { _sum: { failedCodeVerifications: 0 } };
        }),
      },
      completionCodeLimitReset: {
        aggregate: jest.fn(async () => ({ _sum: { failuresForgiven: null } })),
        create: jest.fn(async ({ data }: any) => {
          log.push('completionCodeLimitReset.create');
          return { ...data, createdAt: new Date('2026-09-26T12:00:00.000Z') };
        }),
      },
      response: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => responseRow()),
        findUniqueOrThrow: jest.fn(async () =>
          responseRow({ status: 'VALIDATED' }),
        ),
        updateMany: jest.fn(async () => ({ count: 1 })),
        groupBy: jest.fn(async () => []),
        create: jest.fn(async ({ data }: any) => responseRow(data)),
      },
      storedObject: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        findMany: jest.fn(async () => [
          {
            id: ids.object,
            fileName: 'verified.pdf',
            fileSize: 2048,
            mimeType: 'application/pdf',
          },
        ]),
      },
      outboxEvent: { create: jest.fn(async () => ({})) },
      fraudLog: { create: jest.fn(async () => ({})) },
    };
    const prisma: any = {
      ...tx,
      $transaction: jest.fn(async (work: (client: unknown) => unknown) =>
        work(tx),
      ),
    };
    return {
      tx,
      log,
      repository: new PrismaParticipationRepository(prisma),
    };
  }

  const reserveParams = {
    attemptId: ids.attempt,
    formId: ids.form,
    formVersionId: ids.version,
    respondentId: ids.respondent,
    isGuest: false,
    formType: 'INTERNAL' as const,
    ipAddress: '127.0.0.1',
    startedAt: new Date(),
    expectedCompletions: 10,
    cutoffDate: new Date(Date.now() - 30 * 60 * 1000),
  };

  const submitParams = {
    responseId: ids.response,
    attemptId: ids.attempt,
    formId: ids.form,
    formVersionId: ids.version,
    respondentId: ids.respondent,
    isGuest: false,
    answers: { q1: 'a' },
    submittedAt: new Date(),
    policyMode: 'SHADOW' as const,
    policyDeploymentId: 'policy-default-v1',
    rewardAmount: 10,
    publisherId: ids.publisher,
  };

  describe('reserveAttempt (P1)', () => {
    it('takes the form row lock before any check, then inserts', async () => {
      const { log, repository } = createHarness();

      const result = await repository.reserveAttempt(reserveParams);

      expect(result.outcome).toBe('CREATED');
      expect(log[0]).toMatch(
        /FROM forms WHERE id = \? ?::uuid FOR NO KEY UPDATE/,
      );
      expect(log.indexOf('surveyAttempt.create')).toBeGreaterThan(
        log.indexOf('surveyAttempt.findFirst'),
      );
    });

    it('returns NOT_OPEN without writing when the form is not PUBLISHED', async () => {
      const { tx, repository } = createHarness({ formStatus: 'CLOSED' });
      await expect(repository.reserveAttempt(reserveParams)).resolves.toEqual({
        outcome: 'NOT_OPEN',
      });
      expect(tx.surveyAttempt.create).not.toHaveBeenCalled();
    });

    it('returns QUOTA_FULL when completed + active reservations reach the quota', async () => {
      const { tx, repository } = createHarness();
      tx.surveyAttempt.count.mockResolvedValue(10);
      await expect(repository.reserveAttempt(reserveParams)).resolves.toEqual({
        outcome: 'QUOTA_FULL',
      });
      expect(tx.surveyAttempt.create).not.toHaveBeenCalled();
    });

    it('maps a unique violation of the one-active index to CONFLICTING_ACTIVE', async () => {
      const { tx, repository } = createHarness();
      tx.surveyAttempt.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: 'survey_attempts_one_active_per_account' },
        }),
      );
      await expect(repository.reserveAttempt(reserveParams)).resolves.toEqual({
        outcome: 'CONFLICTING_ACTIVE',
        attempt: null,
      });
    });
  });

  describe('Story IR.2a: closed reason and cancel', () => {
    const cancelParams = {
      attemptId: ids.attempt,
      respondentId: ids.respondent,
      formId: ids.form,
      cutoffDate: new Date(Date.now() - 30 * 60 * 1000),
      now: new Date('2026-10-01T08:00:00.000Z'),
    };

    it('the lazy expiry inside a start writes closed reason EXPIRED', async () => {
      const { tx, repository } = createHarness();

      await repository.reserveAttempt(reserveParams);

      expect(tx.surveyAttempt.updateMany).toHaveBeenCalledWith({
        where: {
          respondentId: ids.respondent,
          surveyId: ids.form,
          status: 'IN_PROGRESS',
          startedAt: { lt: reserveParams.cutoffDate },
        },
        data: {
          status: 'ABANDONED',
          closedReason: 'EXPIRED',
          closedAt: reserveParams.startedAt,
        },
      });
    });

    it('cancel locks the form row before the attempt row, then moves only an IN_PROGRESS row', async () => {
      const { tx, log, repository } = createHarness();
      tx.surveyAttempt.findUniqueOrThrow.mockResolvedValue(
        attemptRow({
          status: 'ABANDONED',
          closedReason: 'CANCELLED',
          closedAt: cancelParams.now,
        }),
      );

      const result = await repository.cancelAttempt(cancelParams);

      const sql = log.filter((entry) => entry.startsWith('sql:'));
      expect(sql[0]).toMatch(/FROM forms WHERE id = \? ?::uuid FOR SHARE/);
      expect(sql[1]).toMatch(
        /FROM survey_attempts WHERE id = \? ?::uuid FOR UPDATE/,
      );
      // No user completion lock: a cancel only removes a reservation.
      expect(sql.some((entry) => entry.includes('pg_advisory_xact_lock'))).toBe(
        false,
      );
      expect(tx.surveyAttempt.updateMany).toHaveBeenCalledWith({
        where: { id: ids.attempt, status: 'IN_PROGRESS' },
        data: {
          status: 'ABANDONED',
          closedReason: 'CANCELLED',
          closedAt: cancelParams.now,
        },
      });
      expect(result.outcome).toBe('CANCELLED');
      expect(result.outcome !== 'NOT_FOUND' && result.attempt.closedAt).toEqual(
        cancelParams.now,
      );
    });

    it('cancel replays a cancelled attempt with its original closedAt, without writing', async () => {
      const { tx, repository } = createHarness();
      const original = new Date('2026-10-01T07:55:00.000Z');
      tx.surveyAttempt.findUnique.mockResolvedValue(
        attemptRow({
          status: 'ABANDONED',
          closedReason: 'CANCELLED',
          closedAt: original,
        }),
      );

      const result = await repository.cancelAttempt(cancelParams);

      expect(result).toMatchObject({
        outcome: 'ALREADY_CANCELLED',
        attempt: { closedReason: 'CANCELLED', closedAt: original },
      });
      expect(tx.surveyAttempt.updateMany).not.toHaveBeenCalled();
    });

    it('cancel refuses an expired reservation (derived EXPIRED) and a completed attempt', async () => {
      const { tx, repository } = createHarness();
      tx.surveyAttempt.findUnique.mockResolvedValueOnce(
        attemptRow({ startedAt: new Date(Date.now() - 31 * 60 * 1000) }),
      );
      await expect(
        repository.cancelAttempt(cancelParams),
      ).resolves.toMatchObject({
        outcome: 'NOT_IN_PROGRESS',
        derivedCloseReason: 'EXPIRED',
      });

      tx.surveyAttempt.findUnique.mockResolvedValueOnce(
        attemptRow({ status: 'COMPLETED' }),
      );
      await expect(
        repository.cancelAttempt(cancelParams),
      ).resolves.toMatchObject({
        outcome: 'NOT_IN_PROGRESS',
        derivedCloseReason: null,
      });
      expect(tx.surveyAttempt.updateMany).not.toHaveBeenCalled();
    });

    it("cancel answers NOT_FOUND for a guest or another user's attempt", async () => {
      const { tx, repository } = createHarness();
      tx.surveyAttempt.findUnique.mockResolvedValueOnce(
        attemptRow({ respondentId: ids.publisher }),
      );
      await expect(repository.cancelAttempt(cancelParams)).resolves.toEqual({
        outcome: 'NOT_FOUND',
      });
      tx.surveyAttempt.findUnique.mockResolvedValueOnce(
        attemptRow({ respondentId: null, isGuest: true }),
      );
      await expect(repository.cancelAttempt(cancelParams)).resolves.toEqual({
        outcome: 'NOT_FOUND',
      });
      expect(tx.surveyAttempt.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('submitInternalResponseTransaction (P7/P4/P21)', () => {
    it('locks the form then the attempt, and transitions with state predicates', async () => {
      const { tx, log, repository } = createHarness();

      const result =
        await repository.submitInternalResponseTransaction(submitParams);

      expect(result.outcome).toBe('SUBMITTED');
      const sql = log.filter((entry) => entry.startsWith('sql:'));
      expect(sql[0]).toMatch(/FROM forms .*FOR NO KEY UPDATE/);
      expect(sql[1]).toMatch(/FROM survey_attempts .*FOR UPDATE/);
      expect(tx.response.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ids.response, status: 'IN_PROGRESS' },
        }),
      );
      expect(tx.surveyAttempt.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ids.attempt, status: 'IN_PROGRESS' },
        }),
      );
      expect(tx.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'InternalRewardRequested',
            orderingStream: `internal-reward:${ids.response}`,
            streamSequence: 1,
          }),
        }),
      );
    });

    it('returns ALREADY_SUBMITTED without writing for an already-submitted response', async () => {
      const { tx, repository } = createHarness();
      tx.response.findUnique.mockResolvedValue(
        responseRow({ status: 'VALIDATED' }),
      );
      await expect(
        repository.submitInternalResponseTransaction(submitParams),
      ).resolves.toEqual({ outcome: 'ALREADY_SUBMITTED' });
      expect(tx.response.updateMany).not.toHaveBeenCalled();
      expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    });

    it('returns NOT_SUBMITTABLE without writing for an abandoned attempt', async () => {
      const { tx, repository } = createHarness();
      tx.surveyAttempt.findUnique.mockResolvedValue(
        attemptRow({ status: 'ABANDONED' }),
      );
      await expect(
        repository.submitInternalResponseTransaction(submitParams),
      ).resolves.toEqual({ outcome: 'NOT_SUBMITTABLE' });
      expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    });

    it('maps a concurrent Outbox key violation to ALREADY_SUBMITTED (never a 500)', async () => {
      const { tx, repository } = createHarness();
      tx.outboxEvent.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: ['idempotency_key'] },
        }),
      );
      await expect(
        repository.submitInternalResponseTransaction(submitParams),
      ).resolves.toEqual({ outcome: 'ALREADY_SUBMITTED' });
    });

    it('maps a one-completion index violation to ALREADY_COMPLETED_LOGICAL', async () => {
      const { tx, repository } = createHarness();
      tx.surveyAttempt.updateMany.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: 'survey_attempts_one_completion_per_account' },
        }),
      );
      await expect(
        repository.submitInternalResponseTransaction(submitParams),
      ).resolves.toEqual({ outcome: 'ALREADY_COMPLETED_LOGICAL' });
    });

    it('attaches only owned CLEAN objects of the answered question, or rolls back', async () => {
      const { tx, repository } = createHarness();
      const attachments = [{ objectId: ids.object, questionId: 'q-file' }];

      await repository.submitInternalResponseTransaction({
        ...submitParams,
        answers: {
          'q-file': [
            {
              objectId: ids.object,
              fileName: 'spoofed.exe',
              fileSize: 1,
              mimeType: 'text/plain',
              status: 'CLEAN',
            },
          ],
        },
        attachments,
      });
      // The stored answer carries the verified metadata, not the client's.
      expect(tx.response.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            answersJson: {
              'q-file': [
                {
                  objectId: ids.object,
                  fileName: 'verified.pdf',
                  fileSize: 2048,
                  mimeType: 'application/pdf',
                  status: 'CLEAN',
                },
              ],
            },
          }),
        }),
      );
      expect(tx.storedObject.updateMany).toHaveBeenCalledWith({
        where: {
          ownerContext: 'participation',
          ownerRecordId: ids.attempt,
          status: 'CLEAN',
          OR: [{ id: ids.object, questionId: 'q-file' }],
        },
        data: expect.objectContaining({ status: 'ATTACHED', expiresAt: null }),
      });

      tx.storedObject.updateMany.mockResolvedValue({ count: 0 });
      const rejected = repository.submitInternalResponseTransaction({
        ...submitParams,
        attachments,
      });
      await expect(rejected).rejects.toBeInstanceOf(UncleanAttachmentException);
      // Phase 7: the files that could not be attached are named for the runner.
      await expect(rejected).rejects.toMatchObject({
        details: { files: [{ questionId: 'q-file', objectId: ids.object }] },
      });
    });
  });

  describe('server-owned completion-code state (P2)', () => {
    it('counts strikes in the column and never reads client_context', async () => {
      const { tx, repository } = createHarness();
      tx.surveyAttempt.findUnique.mockResolvedValue({
        status: 'IN_PROGRESS',
        failedCodeVerifications: 2,
        formVersionId: ids.version,
      });

      const result = await repository.recordFailedAttemptVerification(
        ids.attempt,
        ids.respondent,
        ids.version,
      );

      expect(result).toEqual({
        failureCount: 3,
        isLocked: true,
        accountFailureCount: 1,
        attemptInProgress: true,
      });
      expect(tx.surveyAttempt.findUnique).toHaveBeenCalledWith({
        where: { id: ids.attempt },
        select: {
          status: true,
          failedCodeVerifications: true,
          formVersionId: true,
        },
      });
      // Already on the verified version: no re-pin write (BE-7).
      expect(tx.surveyAttempt.update).toHaveBeenCalledTimes(1);
      expect(tx.surveyAttempt.update).toHaveBeenCalledWith({
        where: { id: ids.attempt },
        data: expect.objectContaining({
          status: 'LOCKED',
          failedCodeVerifications: 3,
        }),
      });
      const updateData = tx.surveyAttempt.update.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('clientContext');
    });

    describe('decision E5-D1: account+FormVersion limit (completion-code-policy-v1)', () => {
      it('locks the attempt when the summed wrong codes reach 6, even below 3 per attempt', async () => {
        const { tx, repository } = createHarness();
        tx.surveyAttempt.findUnique.mockResolvedValue({
          status: 'IN_PROGRESS',
          failedCodeVerifications: 1,
          formVersionId: ids.version,
        });
        // 3 (locked first attempt) + 2 (earlier attempt) + 0 forgiven = 5.
        tx.surveyAttempt.aggregate.mockResolvedValue({
          _sum: { failedCodeVerifications: 5 },
        });

        const result = await repository.recordFailedAttemptVerification(
          ids.attempt,
          ids.respondent,
          ids.version,
        );

        expect(result).toEqual({
          failureCount: 2,
          isLocked: true,
          accountFailureCount: 6,
          attemptInProgress: true,
        });
        expect(tx.surveyAttempt.aggregate).toHaveBeenCalledWith({
          where: { respondentId: ids.respondent, formVersionId: ids.version },
          _sum: { failedCodeVerifications: true },
        });
        expect(tx.surveyAttempt.update).toHaveBeenCalledWith({
          where: { id: ids.attempt },
          data: expect.objectContaining({
            status: 'LOCKED',
            failedCodeVerifications: 2,
          }),
        });
        expect(tx.fraudLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            type: 'SECURITY_VIOLATION',
            details: expect.objectContaining({
              accountFailureCount: 6,
              policyVersion: 'completion-code-policy-v1',
            }),
          }),
        });
      });

      it('BE-7: re-pins a pre-rotation attempt to the verified version before summing, under the row lock', async () => {
        const { tx, log, repository } = createHarness();
        const oldVersion = '88888888-8888-4888-8888-888888888888';
        tx.surveyAttempt.findUnique.mockResolvedValue({
          status: 'IN_PROGRESS',
          failedCodeVerifications: 2,
          formVersionId: oldVersion,
        });
        tx.surveyAttempt.update.mockImplementation(async ({ data }: any) => {
          log.push(`surveyAttempt.update:${Object.keys(data).join(',')}`);
          return attemptRow(data);
        });
        // After the move the sum includes the attempt's 2 earlier strikes.
        tx.surveyAttempt.aggregate.mockImplementation(async () => {
          log.push('surveyAttempt.aggregate');
          return { _sum: { failedCodeVerifications: 2 } };
        });

        const result = await repository.recordFailedAttemptVerification(
          ids.attempt,
          ids.respondent,
          ids.version,
        );

        expect(result).toEqual({
          failureCount: 3,
          isLocked: true,
          accountFailureCount: 3,
          attemptInProgress: true,
        });
        expect(tx.surveyAttempt.update).toHaveBeenNthCalledWith(1, {
          where: { id: ids.attempt },
          data: { formVersionId: ids.version },
        });
        expect(
          log.filter((entry) => /FOR UPDATE|surveyAttempt\./.test(entry)),
        ).toEqual([
          expect.stringMatching(/FROM survey_attempts .* FOR UPDATE/),
          'surveyAttempt.update:formVersionId',
          'surveyAttempt.aggregate',
          'surveyAttempt.update:status,failedCodeVerifications,lastFailedVerificationAt',
        ]);
      });

      it('BE-7: never re-pins an attempt that is no longer IN_PROGRESS', async () => {
        const { tx, repository } = createHarness();
        tx.surveyAttempt.findUnique.mockResolvedValue({
          status: 'LOCKED',
          failedCodeVerifications: 3,
          formVersionId: '88888888-8888-4888-8888-888888888888',
        });

        const result = await repository.recordFailedAttemptVerification(
          ids.attempt,
          ids.respondent,
          ids.version,
        );

        expect(result).toMatchObject({
          failureCount: 3,
          isLocked: true,
          attemptInProgress: false,
        });
        expect(tx.surveyAttempt.update).not.toHaveBeenCalled();
      });

      it('counts summed strikes minus what an Admin forgave, never below 0', async () => {
        const { tx, repository } = createHarness();
        tx.surveyAttempt.aggregate.mockResolvedValue({
          _sum: { failedCodeVerifications: 8 },
        });
        tx.completionCodeLimitReset.aggregate.mockResolvedValue({
          _sum: { failuresForgiven: 6 },
        });
        await expect(
          repository.countCompletionCodeFailures(ids.respondent, ids.version),
        ).resolves.toBe(2);

        tx.completionCodeLimitReset.aggregate.mockResolvedValue({
          _sum: { failuresForgiven: 9 },
        });
        await expect(
          repository.countCompletionCodeFailures(ids.respondent, ids.version),
        ).resolves.toBe(0);
      });

      it('an Admin reset locks the attempts, then records exactly the counted strikes', async () => {
        const { tx, log, repository } = createHarness();
        tx.surveyAttempt.aggregate.mockResolvedValue({
          _sum: { failedCodeVerifications: 6 },
        });

        const result = await repository.resetCompletionCodeFailures({
          respondentId: ids.respondent,
          formVersionId: ids.version,
          resetById: ids.publisher,
          reason: 'Honest mistyping confirmed',
          policyVersion: 'completion-code-policy-v1',
        });

        expect(result).toEqual({
          failuresForgiven: 6,
          resetAt: new Date('2026-09-26T12:00:00.000Z'),
        });
        expect(log[0]).toMatch(
          /FROM survey_attempts WHERE respondent_id = \? ?::uuid AND form_version_id = \? ?::uuid FOR UPDATE/,
        );
        expect(tx.completionCodeLimitReset.create).toHaveBeenCalledWith({
          data: {
            respondentId: ids.respondent,
            formVersionId: ids.version,
            failuresForgiven: 6,
            resetById: ids.publisher,
            reason: 'Honest mistyping confirmed',
            policyVersion: 'completion-code-policy-v1',
          },
        });
        // The attempts and their strike counters are never rewritten.
        expect(tx.surveyAttempt.update).not.toHaveBeenCalled();
        expect(tx.surveyAttempt.updateMany).not.toHaveBeenCalled();
      });

      it('an Admin reset writes nothing when no strike is counted', async () => {
        const { tx, repository } = createHarness();
        await expect(
          repository.resetCompletionCodeFailures({
            respondentId: ids.respondent,
            formVersionId: ids.version,
            resetById: ids.publisher,
            reason: 'Nothing to forgive here',
            policyVersion: 'completion-code-policy-v1',
          }),
        ).resolves.toEqual({ failuresForgiven: 0, resetAt: null });
        expect(tx.completionCodeLimitReset.create).not.toHaveBeenCalled();
      });

      it('refuses an External start at the limit inside the reservation, without writing', async () => {
        const { tx, repository } = createHarness();
        tx.surveyAttempt.aggregate.mockResolvedValue({
          _sum: { failedCodeVerifications: 6 },
        });

        await expect(
          repository.reserveAttempt({
            ...reserveParams,
            formType: 'EXTERNAL',
            completionCodeFailureLimit: 6,
          }),
        ).resolves.toEqual({
          outcome: 'COMPLETION_CODE_LIMIT_REACHED',
          failedVerifications: 6,
        });
        expect(tx.surveyAttempt.create).not.toHaveBeenCalled();
      });
    });

    it('writes the missing-code marker with a compare-and-set and one Outbox row only once', async () => {
      const { tx, repository } = createHarness();
      const reportedAt = new Date('2026-09-26T10:00:00.000Z');
      tx.surveyAttempt.findUnique.mockResolvedValue({
        surveyId: ids.form,
        formVersionId: ids.version,
        missingCodeReportedAt: reportedAt,
      });
      tx.surveyAttempt.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        repository.reportMissingCompletionCode(
          ids.attempt,
          ids.respondent,
          'No code shown',
          {
            startedAt: new Date(),
            elapsedSeconds: 60,
            requiredBarrierSeconds: 15,
            reservationExpired: false,
          },
        ),
      ).resolves.toEqual({ reportedAt });
      expect(tx.surveyAttempt.updateMany).toHaveBeenCalledWith({
        where: { id: ids.attempt, missingCodeReportedAt: null },
        data: expect.objectContaining({ missingCodeReason: 'No code shown' }),
      });
      expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('completion limit under the user lock (Epic 8 review P3)', () => {
    const now = new Date('2026-09-26T12:00:00.000Z');
    const completionLimit = {
      userId: ids.respondent,
      limit: 2,
      windowSeconds: 3600,
      now,
    };
    const inWindow = [
      new Date('2026-09-26T11:10:00.000Z'),
      new Date('2026-09-26T11:50:00.000Z'),
    ];
    const ADVISORY_LOCK = /pg_advisory_xact_lock\(hashtextextended\(\?, 0\)\)/;

    function sqlOf(log: string[]) {
      return log.filter((entry) => entry.startsWith('sql:'));
    }

    function atLimit(harness: { tx: any; log: string[] }) {
      harness.tx.surveyAttempt.findMany.mockImplementation(async () => {
        harness.log.push('surveyAttempt.findMany');
        return inWindow.map((submittedAt) => ({ submittedAt }));
      });
    }

    it('Internal: takes the user lock before the form and attempt locks, and counts before any write', async () => {
      const { tx, log, repository } = createHarness();

      const result = await repository.submitInternalResponseTransaction({
        ...submitParams,
        completionLimit,
      });

      expect(result.outcome).toBe('SUBMITTED');
      const sql = sqlOf(log);
      expect(sql[0]).toMatch(ADVISORY_LOCK);
      expect(sql[1]).toMatch(/FROM forms .*FOR NO KEY UPDATE/);
      expect(sql[2]).toMatch(/FROM survey_attempts .*FOR UPDATE/);
      expect(tx.$queryRaw.mock.calls[0][1]).toBe(
        `participation-completions:${ids.respondent}`,
      );
      const countAt = log.indexOf('surveyAttempt.findMany');
      expect(countAt).toBeGreaterThan(log.indexOf(sql[2]));
      expect(countAt).toBeLessThan(log.indexOf('surveyAttempt.updateMany'));
      expect(tx.surveyAttempt.findMany).toHaveBeenCalledWith({
        where: {
          respondentId: ids.respondent,
          status: 'COMPLETED',
          submittedAt: { gt: new Date('2026-09-26T11:00:00.000Z') },
        },
        select: { submittedAt: true },
        orderBy: { submittedAt: 'asc' },
        take: 1000,
      });
    });

    it('Internal: returns RATE_LIMITED at the limit and writes nothing', async () => {
      const harness = createHarness();
      const { tx, repository } = harness;
      atLimit(harness);

      await expect(
        repository.submitInternalResponseTransaction({
          ...submitParams,
          attachments: [{ objectId: ids.object, questionId: 'q-file' }],
          completionLimit,
        }),
      ).resolves.toEqual({
        outcome: 'RATE_LIMITED',
        completionTimes: inWindow,
      });
      expect(tx.storedObject.updateMany).not.toHaveBeenCalled();
      expect(tx.response.updateMany).not.toHaveBeenCalled();
      expect(tx.surveyAttempt.updateMany).not.toHaveBeenCalled();
      expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    });

    it('Internal: a duplicate submit of a completed attempt stays ALREADY_SUBMITTED at the limit', async () => {
      const harness = createHarness();
      const { tx, repository } = harness;
      atLimit(harness);
      tx.response.findUnique.mockResolvedValue(
        responseRow({ status: 'VALIDATED' }),
      );

      await expect(
        repository.submitInternalResponseTransaction({
          ...submitParams,
          completionLimit,
        }),
      ).resolves.toEqual({ outcome: 'ALREADY_SUBMITTED' });
      expect(tx.surveyAttempt.findMany).not.toHaveBeenCalled();
    });

    it('Internal: without a limit takes no user lock and does not count', async () => {
      const { tx, log, repository } = createHarness();

      await repository.submitInternalResponseTransaction(submitParams);

      expect(sqlOf(log).some((sql) => ADVISORY_LOCK.test(sql))).toBe(false);
      expect(tx.surveyAttempt.findMany).not.toHaveBeenCalled();
    });

    it('External: same lock order; RATE_LIMITED at the limit without claiming', async () => {
      const harness = createHarness();
      const { tx, log, repository } = harness;
      atLimit(harness);
      tx.surveyAttempt.findUniqueOrThrow.mockResolvedValue(attemptRow());

      const result = await repository.completeExternalAttemptTransaction({
        attemptId: ids.attempt,
        respondentId: ids.respondent,
        formId: ids.form,
        formVersionId: ids.version,
        submittedAt: now,
        completionLimit,
      });

      expect(result).toMatchObject({
        outcome: 'RATE_LIMITED',
        completionTimes: inWindow,
      });
      const sql = sqlOf(log);
      expect(sql[0]).toMatch(ADVISORY_LOCK);
      expect(sql[1]).toMatch(/FROM forms .*FOR NO KEY UPDATE/);
      expect(sql[2]).toMatch(/FROM survey_attempts .*FOR UPDATE/);
      expect(log.indexOf('surveyAttempt.findMany')).toBeGreaterThan(
        log.indexOf(sql[2]),
      );
      expect(tx.surveyAttempt.update).not.toHaveBeenCalled();
    });

    it('External: an already claimed attempt replays at the limit instead of RATE_LIMITED', async () => {
      const harness = createHarness();
      const { tx, repository } = harness;
      atLimit(harness);

      const result = await repository.completeExternalAttemptTransaction({
        attemptId: ids.attempt,
        respondentId: ids.respondent,
        formId: ids.form,
        formVersionId: ids.version,
        submittedAt: now,
        completionLimit,
      });

      expect(result.outcome).toBe('ALREADY_COMPLETED');
      expect(tx.surveyAttempt.findMany).not.toHaveBeenCalled();
      expect(tx.surveyAttempt.update).not.toHaveBeenCalled();
    });

    describe('decision E8-D6: capacity reserved at attempt start', () => {
      const cutoffDate = new Date('2026-09-26T11:30:00.000Z');

      it('takes the user lock before the form lock and counts completions + open attempts before inserting', async () => {
        const { tx, log, repository } = createHarness();

        const result = await repository.reserveAttempt({
          ...reserveParams,
          cutoffDate,
          completionReservation: completionLimit,
        });

        expect(result.outcome).toBe('CREATED');
        const sql = sqlOf(log);
        expect(sql[0]).toMatch(ADVISORY_LOCK);
        expect(sql[1]).toMatch(/FROM forms .*FOR NO KEY UPDATE/);
        expect(tx.$queryRaw.mock.calls[0][1]).toBe(
          `participation-completions:${ids.respondent}`,
        );
        expect(tx.surveyAttempt.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              respondentId: ids.respondent,
              status: 'IN_PROGRESS',
              startedAt: { gte: cutoffDate },
            },
          }),
        );
        expect(log.indexOf('surveyAttempt.create')).toBeGreaterThan(
          log.lastIndexOf('surveyAttempt.findMany'),
        );
      });

      it('returns RATE_LIMITED without writing when completions + open attempts reach the limit', async () => {
        const { tx, repository } = createHarness();
        const openStart = new Date('2026-09-26T11:55:00.000Z');
        tx.surveyAttempt.findMany.mockImplementation(async (args: any) =>
          args.where.status === 'COMPLETED'
            ? [{ submittedAt: inWindow[0] }]
            : [{ startedAt: openStart }],
        );

        await expect(
          repository.reserveAttempt({
            ...reserveParams,
            cutoffDate,
            completionReservation: completionLimit,
          }),
        ).resolves.toEqual({
          outcome: 'RATE_LIMITED',
          completionTimes: [inWindow[0]],
          openAttemptStartTimes: [openStart],
        });
        expect(tx.surveyAttempt.create).not.toHaveBeenCalled();
      });

      it('takes no user lock and does not count without a reservation', async () => {
        const { tx, log, repository } = createHarness();
        await repository.reserveAttempt(reserveParams);
        expect(sqlOf(log)[0]).toMatch(/FROM forms .*FOR NO KEY UPDATE/);
        expect(tx.surveyAttempt.findMany).not.toHaveBeenCalled();
      });
    });

    it('lockAttemptForVerification takes the user lock first only when asked', async () => {
      const withLock = createHarness();
      await withLock.repository.lockAttemptForVerification(
        ids.attempt,
        ids.form,
        ids.respondent,
      );
      const sql = sqlOf(withLock.log);
      expect(sql[0]).toMatch(ADVISORY_LOCK);
      expect(sql[1]).toMatch(/FROM forms .*FOR NO KEY UPDATE/);
      expect(sql[2]).toMatch(/FROM survey_attempts .*FOR UPDATE/);

      const withoutLock = createHarness();
      await withoutLock.repository.lockAttemptForVerification(
        ids.attempt,
        ids.form,
      );
      expect(sqlOf(withoutLock.log)[0]).toMatch(
        /FROM forms .*FOR NO KEY UPDATE/,
      );
    });
  });
});

/**
 * Bug 3.6: reads and writes made inside a Unit of Work join its transaction
 * (they see its writes and never wait for a second pooled connection), except
 * the fraud evidence, which must survive the rejected request's rollback.
 */
describe('PrismaParticipationRepository ambient transaction client (Bug 3.6)', () => {
  function clientMocks() {
    return {
      scoringPolicy: { findFirst: jest.fn().mockResolvedValue(null) },
      integrityEvent: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      surveyAttempt: { findMany: jest.fn().mockResolvedValue([]) },
      outboxEvent: { findUnique: jest.fn().mockResolvedValue(null) },
      fraudLog: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
  }

  function setup() {
    const tx = clientMocks();
    const prisma: any = {
      ...clientMocks(),
      $transaction: jest.fn(async (work: (client: unknown) => unknown) =>
        work(tx),
      ),
    };
    return {
      tx,
      prisma,
      repository: new PrismaParticipationRepository(prisma),
      inTransaction: <T>(work: () => Promise<T>) =>
        runInTransaction(prisma, () => work()),
    };
  }

  const userId = '44444444-4444-4444-8444-444444444444';
  const cases: Array<
    [
      string,
      (repository: PrismaParticipationRepository) => Promise<unknown>,
      (client: ReturnType<typeof clientMocks>) => jest.Mock,
    ]
  > = [
    [
      'findActivePolicyDeployment',
      (repository) => repository.findActivePolicyDeployment(),
      (client) => client.scoringPolicy.findFirst,
    ],
    [
      'saveIntegrityEvents',
      (repository) =>
        repository.saveIntegrityEvents([
          new IntegrityEventEntity(
            'evt-1',
            'FOCUS_LOST',
            '11111111-1111-4111-8111-111111111111',
            '33333333-3333-4333-8333-333333333333',
            userId,
            new Date(),
          ),
        ]),
      (client) => client.integrityEvent.createMany,
    ],
    [
      'findOpenAttemptStartTimes',
      (repository) => repository.findOpenAttemptStartTimes(userId, new Date()),
      (client) => client.surveyAttempt.findMany,
    ],
    [
      'findCompletionTimesSince',
      (repository) => repository.findCompletionTimesSince(userId, new Date()),
      (client) => client.surveyAttempt.findMany,
    ],
    [
      'findInternalRewardRequest',
      (repository) =>
        repository.findInternalRewardRequest(
          '55555555-5555-4555-8555-555555555555',
        ),
      (client) => client.outboxEvent.findUnique,
    ],
  ];

  it.each(cases)(
    '%s uses the ambient transaction client inside a Unit of Work',
    async (_name, call, method) => {
      const { tx, prisma, repository, inTransaction } = setup();

      await inTransaction(() => call(repository));

      expect(method(tx)).toHaveBeenCalledTimes(1);
      expect(method(prisma)).not.toHaveBeenCalled();
    },
  );

  it.each(cases)(
    '%s uses the root client outside a Unit of Work',
    async (_name, call, method) => {
      const { tx, prisma, repository } = setup();

      await call(repository);

      expect(method(prisma)).toHaveBeenCalledTimes(1);
      expect(method(tx)).not.toHaveBeenCalled();
    },
  );

  it('recordFraudLog stays on the root client even inside a Unit of Work (evidence survives a rollback)', async () => {
    const { tx, prisma, repository, inTransaction } = setup();

    await inTransaction(() =>
      repository.recordFraudLog(userId, 'RATE_LIMIT', {
        attemptId: 'a-1',
      }),
    );

    expect(prisma.fraudLog.createMany).toHaveBeenCalledTimes(1);
    expect(tx.fraudLog.createMany).not.toHaveBeenCalled();
  });
});
