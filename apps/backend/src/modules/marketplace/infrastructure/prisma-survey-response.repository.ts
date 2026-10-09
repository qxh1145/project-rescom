import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  countCompletionsByFormIds,
  findCompletedFormIdsForRespondent,
} from '../../../common/database/completion-counts';
import { runInTransaction } from '../../../common/database/prisma-unit-of-work';
import {
  SurveyResponseRepositoryPort,
  RecordResponseParams,
  CreateGuestResponseWithinQuotaParams,
  CreateGuestResponseWithinQuotaResult,
} from '../application/ports/survey-response.repository.port';

@Injectable()
export class PrismaSurveyResponseRepository implements SurveyResponseRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findCompletedFormIdsByRespondent(
    respondentId: string,
  ): Promise<Set<string>> {
    return findCompletedFormIdsForRespondent(this.prisma, respondentId);
  }

  async getCompletedCountsByFormIds(
    formIds: string[],
  ): Promise<Map<string, number>> {
    return countCompletionsByFormIds(this.prisma, formIds);
  }

  async recordResponse(params: RecordResponseParams): Promise<void> {
    await this.prisma.response.create({
      data: {
        formId: params.formId,
        formVersionId:
          params.formVersionId || '00000000-0000-4000-8000-000000000000',
        respondentId: params.respondentId ?? null,
        status: params.status as any,
        ipAddress: '127.0.0.1',
        submittedAt: new Date(),
      },
    });
  }

  /**
   * Bug 3.3: the form row lock (`FOR NO KEY UPDATE`, as in participation's
   * `reserveAttempt`) serializes this with every paid start, completion and
   * close of the form, so the quota count and the insert are atomic.
   */
  async createGuestResponseWithinQuota(
    params: CreateGuestResponseWithinQuotaParams,
  ): Promise<CreateGuestResponseWithinQuotaResult> {
    return runInTransaction(this.prisma, async (tx) => {
      const forms = (await tx.$queryRaw`
        SELECT status, type, expected_completions, is_official, deadline_at, close_kind FROM forms WHERE id = ${params.formId}::uuid FOR NO KEY UPDATE
      `) as Array<{
        status: string;
        type: string;
        expected_completions: number;
        is_official: boolean;
        deadline_at: Date | null;
        close_kind: string | null;
      }>;
      const form = forms[0];
      // Review LOW-8: closed by the QUOTA close while this guest was answering.
      if (form?.status === 'CLOSED' && form.close_kind === 'QUOTA') {
        return { outcome: 'QUOTA_FULL' as const };
      }
      if (!form || form.status !== 'PUBLISHED' || form.type !== 'INTERNAL') {
        return { outcome: 'NOT_OPEN' as const };
      }
      // Story IR.2b Task 9.2: no guest submission after the deadline.
      if (form.deadline_at && form.deadline_at.getTime() <= Date.now()) {
        return { outcome: 'NOT_OPEN' as const };
      }

      const [completed, activeReservationCount] = await Promise.all([
        countCompletionsByFormIds(tx, [params.formId]),
        tx.surveyAttempt.count({
          where: {
            surveyId: params.formId,
            status: 'IN_PROGRESS',
            startedAt: { gte: params.cutoffDate },
          },
        }),
      ]);
      const used = (completed.get(params.formId) ?? 0) + activeReservationCount;
      if (!form.is_official && used >= Number(form.expected_completions)) {
        return { outcome: 'QUOTA_FULL' as const };
      }

      const created = await tx.response.create({
        data: {
          formId: params.formId,
          formVersionId: params.formVersionId,
          respondentId: null,
          status: 'SUBMITTED',
          isGuest: true,
          answersJson: params.answers as Prisma.InputJsonValue,
          ipAddress: params.ipAddress,
          submittedAt: new Date(),
        },
      });

      // Plan 2.3: the QUOTA close, in this transaction.
      if (params.afterCreate) {
        await params.afterCreate();
      }

      return {
        outcome: 'CREATED' as const,
        response: {
          id: created.id,
          formId: created.formId,
          formVersionId: created.formVersionId,
          status: 'SUBMITTED' as const,
          isGuest: true as const,
          rewardEarned: 0 as const,
          integrityStatus: 'ASSESSED' as const,
          respondentReliability: 'NOT_AVAILABLE' as const,
          submittedAt: created.submittedAt || new Date(),
        },
      };
    });
  }
}
