import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  SurveyResponseRepositoryPort,
  RecordResponseParams,
  CreateGuestSubmissionParams,
  GuestSubmissionEntity,
} from '../application/ports/survey-response.repository.port';

@Injectable()
export class PrismaSurveyResponseRepository implements SurveyResponseRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findCompletedFormIdsByRespondent(
    respondentId: string,
  ): Promise<Set<string>> {
    const responses = await this.prisma.response.findMany({
      where: {
        respondentId,
        status: {
          in: ['SUBMITTED', 'VALIDATED'],
        },
      },
      select: {
        formId: true,
      },
    });

    const formIds = new Set<string>();
    for (const r of responses) {
      formIds.add(r.formId);
    }
    return formIds;
  }

  async getCompletedCountsByFormIds(
    formIds: string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (formIds.length === 0) {
      return result;
    }

    for (const id of formIds) {
      result.set(id, 0);
    }

    const aggregations = await this.prisma.response.groupBy({
      by: ['formId'],
      where: {
        formId: {
          in: formIds,
        },
        status: {
          in: ['SUBMITTED', 'VALIDATED'],
        },
      },
      _count: {
        _all: true,
      },
    });

    for (const agg of aggregations) {
      result.set(agg.formId, agg._count._all);
    }

    return result;
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

  async createGuestSubmission(
    params: CreateGuestSubmissionParams,
  ): Promise<GuestSubmissionEntity> {
    const created = await this.prisma.response.create({
      data: {
        formId: params.formId,
        formVersionId: params.formVersionId,
        respondentId: null,
        status: 'SUBMITTED',
        isGuest: true,
        answersJson: params.answers as any,
        ipAddress: params.ipAddress,
        submittedAt: new Date(),
      },
    });

    return {
      id: created.id,
      formId: created.formId,
      formVersionId: created.formVersionId,
      status: 'SUBMITTED',
      isGuest: true,
      rewardEarned: 0,
      integrityStatus: 'ASSESSED',
      respondentReliability: 'NOT_AVAILABLE',
      submittedAt: created.submittedAt || new Date(),
    };
  }
}
