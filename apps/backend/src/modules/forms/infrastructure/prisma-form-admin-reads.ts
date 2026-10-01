import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  ModerationQueueStatsPort,
  QueuedFormSummary,
} from '../application/ports/moderation-queue-stats.port';
import {
  FormTitleLookupPort,
  FormTitleLookupResult,
} from '../application/ports/form-title-lookup.port';

/**
 * Bounded admin reads of `forms` (Story IR.4b part C, mock-off plan 4.1-4.3):
 * one grouped count, one `findFirst` without versions, and title lookups by
 * primary key for at most one page of ids.
 */
@Injectable()
export class PrismaFormAdminReads
  implements ModerationQueueStatsPort, FormTitleLookupPort
{
  constructor(private readonly prisma: PrismaService) {}

  async countByStatus(): Promise<{ queued: number; published: number }> {
    const rows = await this.prisma.form.groupBy({
      by: ['status'],
      where: { status: { in: ['MODERATION_QUEUE', 'PUBLISHED'] } },
      _count: { _all: true },
    });
    const countOf = (status: string) =>
      rows.find((row) => row.status === status)?._count._all ?? 0;
    return {
      queued: countOf('MODERATION_QUEUE'),
      published: countOf('PUBLISHED'),
    };
  }

  async oldestQueued(): Promise<QueuedFormSummary | null> {
    const row = await this.prisma.form.findFirst({
      // Like `findModerationQueue`, which skips a queued form without versions.
      where: { status: 'MODERATION_QUEUE', versions: { some: {} } },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        title: true,
        type: true,
        publisherId: true,
        updatedAt: true,
      },
    });
    return row
      ? {
          formId: row.id,
          title: row.title,
          type: row.type,
          publisherId: row.publisherId,
          submittedAt: row.updatedAt,
        }
      : null;
  }

  async findTitles(params: {
    formIds: readonly string[];
    formVersionIds: readonly string[];
  }): Promise<FormTitleLookupResult> {
    const formIds = [...new Set(params.formIds)];
    const versionIds = [...new Set(params.formVersionIds)];
    const [forms, versions] = await Promise.all([
      formIds.length > 0
        ? this.prisma.form.findMany({
            where: { id: { in: formIds } },
            select: { id: true, title: true },
            take: formIds.length,
          })
        : Promise.resolve([]),
      versionIds.length > 0
        ? this.prisma.formVersion.findMany({
            where: { id: { in: versionIds } },
            select: { id: true, form: { select: { id: true, title: true } } },
            take: versionIds.length,
          })
        : Promise.resolve([]),
    ]);
    return {
      byFormId: new Map(forms.map((form) => [form.id, form.title])),
      byFormVersionId: new Map(
        versions.map((version) => [
          version.id,
          { formId: version.form.id, title: version.form.title },
        ]),
      ),
    };
  }
}
