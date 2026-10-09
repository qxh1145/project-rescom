import {
  ModerationQueueStatsPort,
  QueuedFormSummary,
} from '../application/ports/moderation-queue-stats.port';
import {
  FormTitleLookupPort,
  FormTitleLookupResult,
} from '../application/ports/form-title-lookup.port';
import {
  PublishedFormAdminPort,
  PublishedFormSummary,
} from '../application/ports/published-form-admin.port';

export interface InMemoryAdminForm {
  id: string;
  title: string;
  type: 'INTERNAL' | 'EXTERNAL';
  status:
    'DRAFT' | 'ESCROW_LOCKED' | 'MODERATION_QUEUE' | 'PUBLISHED' | 'CLOSED';
  publisherId: string;
  updatedAt: Date;
  versionIds?: string[];
  isPinned?: boolean;
}

/** Test double of `PrismaFormAdminReads` over a seeded list of forms. */
export class InMemoryFormAdminReads
  implements
    ModerationQueueStatsPort,
    FormTitleLookupPort,
    PublishedFormAdminPort
{
  readonly forms: InMemoryAdminForm[] = [];
  calls = 0;

  seed(...forms: InMemoryAdminForm[]): void {
    this.forms.push(...forms);
  }

  clear(): void {
    this.forms.length = 0;
    this.calls = 0;
  }

  async countByStatus(): Promise<{ queued: number; published: number }> {
    this.calls += 1;
    return {
      queued: this.forms.filter((form) => form.status === 'MODERATION_QUEUE')
        .length,
      published: this.forms.filter((form) => form.status === 'PUBLISHED')
        .length,
    };
  }

  async oldestQueued(): Promise<QueuedFormSummary | null> {
    this.calls += 1;
    const oldest = this.forms
      .filter((form) => form.status === 'MODERATION_QUEUE')
      .sort(
        (a, b) =>
          a.updatedAt.getTime() - b.updatedAt.getTime() ||
          a.id.localeCompare(b.id),
      )[0];
    return oldest
      ? {
          formId: oldest.id,
          title: oldest.title,
          type: oldest.type,
          publisherId: oldest.publisherId,
          submittedAt: oldest.updatedAt,
        }
      : null;
  }

  async findTitles(params: {
    formIds: readonly string[];
    formVersionIds: readonly string[];
  }): Promise<FormTitleLookupResult> {
    this.calls += 1;
    const byFormId = new Map<string, string>();
    const byFormVersionId = new Map<
      string,
      { formId: string; title: string }
    >();
    for (const form of this.forms) {
      if (params.formIds.includes(form.id)) byFormId.set(form.id, form.title);
      for (const versionId of form.versionIds ?? []) {
        if (params.formVersionIds.includes(versionId)) {
          byFormVersionId.set(versionId, {
            formId: form.id,
            title: form.title,
          });
        }
      }
    }
    return { byFormId, byFormVersionId };
  }

  async listPublished(params: {
    limit: number;
    offset: number;
    search?: string;
  }): Promise<{ items: PublishedFormSummary[]; total: number }> {
    this.calls += 1;
    const term = params.search?.toLowerCase() ?? '';
    const all = this.forms
      .filter(
        (form) =>
          form.status === 'PUBLISHED' &&
          form.title.toLowerCase().includes(term),
      )
      .sort(
        (a, b) =>
          Number(!!b.isPinned) - Number(!!a.isPinned) ||
          b.updatedAt.getTime() - a.updatedAt.getTime(),
      );
    return {
      items: all
        .slice(params.offset, params.offset + params.limit)
        .map((form) => ({
          formId: form.id,
          title: form.title,
          publisherId: form.publisherId,
          updatedAt: form.updatedAt,
          isPinned: !!form.isPinned,
        })),
      total: all.length,
    };
  }

  async findStatus(formId: string) {
    return this.forms.find((form) => form.id === formId)?.status ?? null;
  }

  async setPinned(formId: string, pinned: boolean): Promise<void> {
    const form = this.forms.find((candidate) => candidate.id === formId);
    if (form) form.isPinned = pinned;
  }
}
