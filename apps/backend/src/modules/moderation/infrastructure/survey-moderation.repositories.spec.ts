import { PrismaService } from '../../../common/database/prisma.service';
import { PrismaUnitOfWork } from '../../../common/database/prisma-unit-of-work';
import { SurveyModerationDecisionEntity } from '../domain/survey-moderation-decision.entity';
import { SurveyModerationAuditOutboxEvent } from '../application/ports/survey-moderation-repository.port';
import { ModerationAlreadyDecidedException } from '../application/exceptions/moderation.exceptions';
import { PrismaSurveyModerationRepository } from './prisma-survey-moderation.repository';
import { InMemorySurveyModerationRepository } from './in-memory-survey-moderation.repository';
import { UserPublisherDirectory } from './user-publisher-directory';
import { UserRepositoryPort } from '../../users/application/ports/user.repository.port';

describe('Story 8.1: survey moderation persistence', () => {
  const formId = '11111111-1111-4111-8111-111111111111';
  const formVersionId = '22222222-2222-4222-8222-222222222222';
  const adminId = '33333333-3333-4333-8333-333333333333';
  const correlationId = '44444444-4444-4444-8444-444444444444';
  const decidedAt = new Date('2026-09-26T15:00:00.000Z');

  const decision = SurveyModerationDecisionEntity.reject({
    id: '55555555-5555-4555-8555-555555555555',
    formId,
    formVersionId,
    versionNumber: 1,
    adminId,
    reason: 'Spam survey',
    refundAmount: 400,
    refundJournalId: '66666666-6666-4666-8666-666666666666',
    correlationId,
    decidedAt,
  });

  const auditEvent: SurveyModerationAuditOutboxEvent = {
    id: '77777777-7777-4777-8777-777777777777',
    idempotencyKey: `admin-audit:moderation:${formVersionId}`,
    eventType: 'AdminSurveyRejected',
    producer: 'moderation-service',
    aggregateType: 'Form',
    aggregateId: formId,
    aggregateVersion: 1,
    correlationId,
    payload: {
      schemaVersion: 1,
      auditCategory: 'MODERATION_ADMIN_ACTION',
      action: 'SURVEY_REJECTED',
      decisionId: decision.id,
      formId,
      formVersionId,
      versionNumber: 1,
      publisherId: '88888888-8888-4888-8888-888888888888',
      adminId,
      reason: 'Spam survey',
      refundAmount: 400,
      refundJournalId: decision.refundJournalId,
      ledgerIdempotencyKey: `close-refund:${formId}:c1`,
      correlationId,
      occurredAt: decidedAt.toISOString(),
    },
  };

  const row = {
    id: decision.id,
    formId,
    formVersionId,
    versionNumber: 1,
    outcome: 'REJECTED' as const,
    adminId,
    reason: 'Spam survey',
    refundAmount: 400,
    refundJournalId: decision.refundJournalId,
    correlationId,
    decidedAt,
    createdAt: decidedAt,
  };

  describe('SurveyModerationDecisionEntity', () => {
    it('enforces approval/rejection invariants', () => {
      expect(() =>
        SurveyModerationDecisionEntity.reject({
          ...row,
          reason: '',
          refundJournalId: null,
        }),
      ).toThrow('A rejection requires a reason');
      expect(
        () =>
          new SurveyModerationDecisionEntity({ ...row, outcome: 'APPROVED' }),
      ).toThrow('An approval never refunds Escrow');
      expect(
        () => new SurveyModerationDecisionEntity({ ...row, refundAmount: -1 }),
      ).toThrow('refundAmount must be a non-negative integer');
      const approved = SurveyModerationDecisionEntity.approve({
        ...row,
        note: '',
      });
      expect(approved.reason).toBeNull();
      expect(approved.refundAmount).toBe(0);
      expect(approved.toDto().decidedAt).toBe(decidedAt.toISOString());
    });
  });

  describe('PrismaSurveyModerationRepository', () => {
    let tx: {
      surveyModerationDecision: { create: jest.Mock; findUnique: jest.Mock };
      outboxEvent: { create: jest.Mock };
    };
    let prisma: {
      $transaction: jest.Mock;
      surveyModerationDecision: { findUnique: jest.Mock };
    };
    let repo: PrismaSurveyModerationRepository;

    beforeEach(() => {
      tx = {
        surveyModerationDecision: {
          create: jest.fn().mockResolvedValue(row),
          findUnique: jest.fn().mockResolvedValue(row),
        },
        outboxEvent: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma = {
        $transaction: jest.fn((work: (client: typeof tx) => unknown) =>
          work(tx),
        ),
        surveyModerationDecision: { findUnique: jest.fn() },
      };
      repo = new PrismaSurveyModerationRepository(
        prisma as unknown as PrismaService,
      );
    });

    it('finds a decision by FormVersion', async () => {
      prisma.surveyModerationDecision.findUnique.mockResolvedValueOnce(row);
      const found = await repo.findByFormVersionId(formVersionId);
      expect(prisma.surveyModerationDecision.findUnique).toHaveBeenCalledWith({
        where: { formVersionId },
      });
      expect(found?.toDto()).toEqual(decision.toDto());

      prisma.surveyModerationDecision.findUnique.mockResolvedValueOnce(null);
      expect(await repo.findByFormVersionId(formVersionId)).toBeNull();
    });

    it('reads the decision through the ambient Unit of Work transaction (review P5)', async () => {
      const unitOfWork = new PrismaUnitOfWork(prisma as never);

      const found = await unitOfWork.run(`moderation:${formVersionId}`, () =>
        repo.findByFormVersionId(formVersionId),
      );

      expect(tx.surveyModerationDecision.findUnique).toHaveBeenCalledWith({
        where: { formVersionId },
      });
      expect(prisma.surveyModerationDecision.findUnique).not.toHaveBeenCalled();
      expect(found?.id).toBe(decision.id);
    });

    it('writes the decision and its Outbox audit event in one transaction', async () => {
      const saved = await repo.saveDecision(decision, auditEvent);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.surveyModerationDecision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: decision.id,
          formVersionId,
          outcome: 'REJECTED',
          refundAmount: 400,
          correlationId,
        }),
      });
      expect(tx.outboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          idempotencyKey: `admin-audit:moderation:${formVersionId}`,
          eventType: 'AdminSurveyRejected',
          producer: 'moderation-service',
          aggregateType: 'Form',
          aggregateId: formId,
          aggregateVersion: 1,
          schemaVersion: 1,
          status: 'PENDING',
          payload: auditEvent.payload,
        }),
      });
      expect(saved.id).toBe(decision.id);
    });

    it('maps a duplicate decision (unique formVersionId) to a conflict', async () => {
      tx.surveyModerationDecision.create.mockRejectedValue({ code: 'P2002' });
      await expect(repo.saveDecision(decision, auditEvent)).rejects.toThrow(
        ModerationAlreadyDecidedException,
      );
    });

    it('propagates other failures (the Unit of Work rolls back)', async () => {
      const failure = new Error('outbox insert failed');
      tx.outboxEvent.create.mockRejectedValue(failure);
      await expect(repo.saveDecision(decision, auditEvent)).rejects.toBe(
        failure,
      );
    });
  });

  describe('InMemorySurveyModerationRepository', () => {
    it('stores one decision per FormVersion with its audit event', async () => {
      const repo = new InMemorySurveyModerationRepository();
      await repo.saveDecision(decision, auditEvent);

      expect(await repo.findByFormVersionId(formVersionId)).toBe(decision);
      expect(repo.outboxEvents).toEqual([auditEvent]);
      await expect(repo.saveDecision(decision, auditEvent)).rejects.toThrow(
        ModerationAlreadyDecidedException,
      );
    });
  });

  describe('UserPublisherDirectory', () => {
    it('resolves emails of known users once per id', async () => {
      const findById = jest.fn(async (id: string) =>
        id === adminId ? ({ id, email: 'a@fpt.edu.vn' } as never) : null,
      );
      const directory = new UserPublisherDirectory({
        findById,
      } as unknown as UserRepositoryPort);

      const emails = await directory.findEmails([adminId, adminId, formId]);

      expect(findById).toHaveBeenCalledTimes(2);
      expect([...emails.entries()]).toEqual([[adminId, 'a@fpt.edu.vn']]);
    });
  });
});
