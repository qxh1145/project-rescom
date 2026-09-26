import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  currentClient,
  runInTransaction,
} from '../../../common/database/prisma-unit-of-work';
import { listCompletionRefsForForm } from '../../../common/database/completion-counts';
import {
  CreateVersionOptions,
  FormCompletionRefs,
  FormRepositoryPort,
  FormSummaryItem,
  FormUpdateExpectation,
  FormWithVersion,
  ListFormsParams,
  ModerationQueuePage,
  ModerationQueueParams,
} from '../application/ports/form-repository.port';
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';
import {
  DraftFormDefinition,
  FormCloseKind,
  FormStatusEnum,
  FormTypeEnum,
  SurveyTargetingCriteria,
} from '@rescom/schemas';

function toFormEntity(raw: any, versions?: FormVersionEntity[]): FormEntity {
  return new FormEntity(
    raw.id,
    raw.publisherId,
    raw.type as FormTypeEnum,
    raw.status as FormStatusEnum,
    raw.title,
    raw.description,
    raw.rewardPerResponse,
    raw.expectedCompletions,
    raw.createdAt,
    raw.updatedAt,
    versions,
    raw.closeCount ?? 0,
    raw.estimatedDurationMinutes ?? null,
    (raw.closeKind as FormCloseKind | null | undefined) ?? null,
  );
}

function toFormVersionEntity(raw: any): FormVersionEntity {
  return new FormVersionEntity(
    raw.id,
    raw.formId,
    raw.versionNumber,
    raw.schemaJson as DraftFormDefinition,
    (raw.targetingJson as SurveyTargetingCriteria | null) ?? null,
    raw.isPublished,
    raw.externalUrl,
    raw.completionCode,
    raw.publishedAt,
    raw.createdAt,
  );
}

@Injectable()
export class PrismaFormRepository implements FormRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    form: FormEntity,
    initialVersion: FormVersionEntity,
  ): Promise<FormWithVersion> {
    // Run Form + FormVersion creation atomically so a partial write
    // (e.g. form row inserted but version row fails) never leaves the DB in an
    // inconsistent state. Joins the caller's Unit of Work when one is open
    // (AD-16: auto-publish reserves Escrow in the same transaction).
    const raw = await runInTransaction(this.prisma, async (tx) => {
      return tx.form.create({
        data: {
          id: form.id,
          publisherId: form.publisherId,
          type: form.type,
          status: form.status,
          title: form.title,
          description: form.description,
          rewardPerResponse: form.rewardPerResponse,
          expectedCompletions: form.expectedCompletions,
          closeCount: form.closeCount,
          closeKind: form.closeKind,
          estimatedDurationMinutes: form.estimatedDurationMinutes,
          updatedAt: form.updatedAt,
          versions: {
            create: {
              id: initialVersion.id,
              versionNumber: initialVersion.versionNumber,
              schemaJson:
                initialVersion.schemaJson as unknown as Prisma.InputJsonValue,
              targetingJson: initialVersion.targetingJson
                ? (initialVersion.targetingJson as unknown as Prisma.InputJsonValue)
                : Prisma.DbNull,
              isPublished: initialVersion.isPublished,
              externalUrl: initialVersion.externalUrl,
              completionCode: initialVersion.completionCode,
              publishedAt: initialVersion.publishedAt,
            },
          },
        },
        include: {
          versions: {
            orderBy: { versionNumber: 'desc' },
          },
        },
      });
    });

    const versionEntities = raw.versions.map(toFormVersionEntity);
    const formEntity = toFormEntity(raw, versionEntities);

    return {
      form: formEntity,
      currentVersion: versionEntities[0],
      versions: versionEntities,
    };
  }

  async findById(id: string): Promise<FormWithVersion | null> {
    // Joins the ambient Unit of Work (Epic 6 review P7): the close/publish/
    // reopen coordinators read the form inside their transaction.
    const raw = await currentClient(this.prisma).form.findUnique({
      where: { id },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
        },
      },
    });

    if (!raw || raw.versions.length === 0) {
      return null;
    }

    const versionEntities = raw.versions.map(toFormVersionEntity);
    const formEntity = toFormEntity(raw, versionEntities);

    return {
      form: formEntity,
      currentVersion: versionEntities[0],
      versions: versionEntities,
    };
  }

  async findManyByPublisher(
    params: ListFormsParams,
  ): Promise<{ forms: FormSummaryItem[]; total: number }> {
    const page = Math.max(1, params.page);
    const limit = Math.max(1, params.limit);
    const skip = (page - 1) * limit;

    const where: Prisma.FormWhereInput = {
      publisherId: params.publisherId,
    };

    if (params.status) {
      where.status = params.status;
    }

    if (params.type) {
      where.type = params.type;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.form.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        include: {
          versions: {
            select: { versionNumber: true },
            orderBy: { versionNumber: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.form.count({ where }),
    ]);

    const forms: FormSummaryItem[] = items.map((raw) => ({
      form: toFormEntity(raw),
      latestVersionNumber:
        raw.versions.length > 0 ? raw.versions[0].versionNumber : 1,
    }));

    return {
      forms,
      total,
    };
  }

  async update(
    form: FormEntity,
    version?: FormVersionEntity,
    expectation?: FormUpdateExpectation,
  ): Promise<FormWithVersion | null> {
    // Joins the caller's Unit of Work when one is open (AD-16: publish/close/
    // moderation commit the Form transition together with the Escrow journal).
    const result = await runInTransaction(this.prisma, async (tx) => {
      const updateResult = await tx.form.updateMany({
        where: {
          id: form.id,
          ...(expectation?.status ? { status: expectation.status } : {}),
          ...(expectation?.updatedAt
            ? { updatedAt: expectation.updatedAt }
            : {}),
        },
        data: {
          title: form.title,
          description: form.description,
          type: form.type,
          status: form.status,
          rewardPerResponse: form.rewardPerResponse,
          expectedCompletions: form.expectedCompletions,
          closeCount: form.closeCount,
          closeKind: form.closeKind,
          estimatedDurationMinutes: form.estimatedDurationMinutes,
          updatedAt: form.updatedAt,
        },
      });
      if (updateResult.count !== 1) return null;

      if (version) {
        await tx.formVersion.update({
          where: { id: version.id },
          data: {
            schemaJson: version.schemaJson as unknown as Prisma.InputJsonValue,
            targetingJson: version.targetingJson
              ? (version.targetingJson as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
            externalUrl: version.externalUrl,
            completionCode: version.completionCode,
            isPublished: version.isPublished,
            publishedAt: version.publishedAt,
          },
        });
      }

      const updatedFormRaw = await tx.form.findUnique({
        where: { id: form.id },
        include: { versions: { orderBy: { versionNumber: 'desc' } } },
      });
      if (!updatedFormRaw) return null;

      return {
        formRaw: updatedFormRaw,
        versionsRaw: updatedFormRaw.versions,
      };
    });
    if (!result) return null;

    const versionEntities = result.versionsRaw.map(toFormVersionEntity);
    const formEntity = toFormEntity(result.formRaw, versionEntities);

    return {
      form: formEntity,
      currentVersion: version
        ? (versionEntities.find((v) => v.id === version.id) ??
          versionEntities[0])
        : versionEntities[0],
      versions: versionEntities,
    };
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.prisma.form.deleteMany({
      where: {
        id,
        status: 'DRAFT',
        versions: { none: { isPublished: true } },
      },
    });
    return result.count === 1;
  }

  async createVersion(
    formId: string,
    newVersionId: string,
    createdAt: Date,
    options?: CreateVersionOptions,
  ): Promise<FormWithVersion | null> {
    const result = await runInTransaction(this.prisma, async (tx) => {
      if (!options?.expectedStatus) {
        const transition = await tx.form.updateMany({
          where: { id: formId, status: 'PUBLISHED' },
          data: { status: 'DRAFT' },
        });
        if (transition.count !== 1) return null;
      } else {
        // Rotation keeps the status; the status predicate stops a concurrent
        // close (and its Escrow refund) from being reverted to PUBLISHED.
        const updateResult = await tx.form.updateMany({
          where: { id: formId, status: options.expectedStatus },
          data: { updatedAt: createdAt },
        });
        if (updateResult.count !== 1) return null;
      }

      const existingVersions = await tx.formVersion.findMany({
        where: { formId },
        orderBy: { versionNumber: 'desc' },
      });
      // Clone the newest version: for a PUBLISHED form it is the published
      // one; for a DRAFT/queued re-publication it carries the pending edits.
      const baseVersion = existingVersions[0];
      if (!baseVersion) return null;

      const nextVersionNumber = existingVersions[0].versionNumber + 1;
      const isPublished = options?.isPublished ?? false;
      const publishedAt =
        options?.publishedAt ?? (isPublished ? createdAt : null);
      const completionCode =
        options?.completionCode !== undefined ? options.completionCode : null;

      await tx.formVersion.create({
        data: {
          id: newVersionId,
          formId,
          versionNumber: nextVersionNumber,
          schemaJson: baseVersion.schemaJson as Prisma.InputJsonValue,
          targetingJson: baseVersion.targetingJson
            ? (baseVersion.targetingJson as Prisma.InputJsonValue)
            : Prisma.DbNull,
          isPublished,
          externalUrl: baseVersion.externalUrl,
          completionCode,
          publishedAt,
          createdAt,
        },
      });

      const updatedFormRaw = await tx.form.findUnique({
        where: { id: formId },
      });
      if (!updatedFormRaw) return null;

      // Fetch all versions ordered by versionNumber descending
      const allVersionsRaw = await tx.formVersion.findMany({
        where: { formId },
        orderBy: { versionNumber: 'desc' },
      });

      return { formRaw: updatedFormRaw, versionsRaw: allVersionsRaw };
    });
    if (!result) return null;

    const versionEntities = result.versionsRaw.map(toFormVersionEntity);
    const formEntity = toFormEntity(result.formRaw, versionEntities);

    // currentVersion is the highest versionNumber (first after desc sort)
    return {
      form: formEntity,
      currentVersion: versionEntities[0],
      versions: versionEntities,
    };
  }

  async findAllVersions(formId: string): Promise<FormVersionEntity[]> {
    const rawVersions = await currentClient(this.prisma).formVersion.findMany({
      where: { formId },
      orderBy: { versionNumber: 'asc' },
    });
    return rawVersions.map(toFormVersionEntity);
  }

  async findPublishedForms(): Promise<FormWithVersion[]> {
    // Only the newest *published* version is loaded per form (not the whole
    // history with every schemaJson); a PUBLISHED form without a published
    // version is skipped rather than exposing unmoderated draft content.
    const rawForms = await this.prisma.form.findMany({
      where: {
        status: 'PUBLISHED',
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        versions: {
          where: { isPublished: true },
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
      },
    });

    const result: FormWithVersion[] = [];

    for (const raw of rawForms) {
      const publishedRaw = raw.versions[0];
      if (!publishedRaw) continue;
      const publishedVersion = toFormVersionEntity(publishedRaw);
      result.push({
        form: toFormEntity(raw, [publishedVersion]),
        currentVersion: publishedVersion,
        versions: [publishedVersion],
      });
    }

    return result;
  }

  async listRewardableCompletions(formId: string): Promise<FormCompletionRefs> {
    return listCompletionRefsForForm(currentClient(this.prisma), formId);
  }

  async countInProgressAttempts(
    formId: string,
    startedSince: Date,
  ): Promise<number> {
    return currentClient(this.prisma).surveyAttempt.count({
      where: {
        surveyId: formId,
        status: 'IN_PROGRESS',
        startedAt: { gte: startedSince },
      },
    });
  }

  async findModerationQueue(
    params: ModerationQueueParams,
  ): Promise<ModerationQueuePage> {
    const where: Prisma.FormWhereInput = { status: 'MODERATION_QUEUE' };
    const [rows, total] = await Promise.all([
      this.prisma.form.findMany({
        where,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        skip: params.offset,
        take: params.limit,
        include: { versions: { orderBy: { versionNumber: 'desc' } } },
      }),
      this.prisma.form.count({ where }),
    ]);

    const items: FormWithVersion[] = [];
    for (const raw of rows) {
      if (raw.versions.length === 0) continue;
      const versionEntities = raw.versions.map(toFormVersionEntity);
      items.push({
        form: toFormEntity(raw, versionEntities),
        currentVersion: versionEntities[0],
        versions: versionEntities,
      });
    }
    return { items, total };
  }
}
