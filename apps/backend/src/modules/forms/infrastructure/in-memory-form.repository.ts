import { Injectable } from '@nestjs/common';
import {
  CompletionBucketWindow,
  CreateVersionOptions,
  FormCreationKey,
  FormEscrowInputs,
  FormPublishedSummary,
  FormRejection,
  FormRepositoryPort,
  FormSummaryItem,
  FormUpdateExpectation,
  FormWithCreationKey,
  FormWithVersion,
  ListFormsParams,
  ModerationQueuePage,
  ModerationQueueParams,
} from '../application/ports/form-repository.port';
import { FormCreationKeyTakenException } from '../application/exceptions/form.exceptions';
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';
import type { FormCompletionRefs } from '../application/ports/form-repository.port';

type CompletionRefsSource = (
  formId: string,
) => FormCompletionRefs | Promise<FormCompletionRefs>;

type InProgressAttemptsSource = (
  formId: string,
  startedSince: Date,
) => number | Promise<number>;

/** IR.4a: one completed participation of a form (see `setCompletionTimes`). */
export interface CompletionTime {
  submittedAt: Date;
  external: boolean;
}

type CompletionTimesSource = (
  formId: string,
) => CompletionTime[] | Promise<CompletionTime[]>;

@Injectable()
export class InMemoryFormRepository implements FormRepositoryPort {
  private readonly forms = new Map<string, FormEntity>();
  private readonly versions = new Map<string, FormVersionEntity>();
  private readonly completionRefs = new Map<string, FormCompletionRefs>();
  /** Phase 5 C6: `${publisherId}:${key}` → form id + request fingerprint. */
  private readonly creationKeys = new Map<
    string,
    { formId: string; requestHash: string }
  >();
  private completionSource?: CompletionRefsSource;
  private inProgressAttemptsSource?: InProgressAttemptsSource;
  private readonly completionTimes = new Map<string, CompletionTime[]>();
  private completionTimesSource?: CompletionTimesSource;
  private readonly rejections = new Map<string, FormRejection>();

  clear(): void {
    this.forms.clear();
    this.versions.clear();
    this.completionRefs.clear();
    this.creationKeys.clear();
    this.completionSource = undefined;
    this.inProgressAttemptsSource = undefined;
    this.completionTimes.clear();
    this.completionTimesSource = undefined;
    this.rejections.clear();
  }

  /**
   * Test helper (decision E5-D4): read in-progress attempts from another
   * in-memory store (e.g. `InMemoryParticipationRepository
   * .countInProgressAttemptsFor`); without one the count is 0.
   */
  useInProgressAttemptsSource(source: InProgressAttemptsSource): void {
    this.inProgressAttemptsSource = source;
  }

  async countInProgressAttempts(
    formId: string,
    startedSince: Date,
  ): Promise<number> {
    return this.inProgressAttemptsSource
      ? this.inProgressAttemptsSource(formId, startedSince)
      : 0;
  }

  async create(
    form: FormEntity,
    initialVersion: FormVersionEntity,
    creationKey?: FormCreationKey,
  ): Promise<FormWithVersion> {
    if (creationKey) {
      const slot = `${form.publisherId}:${creationKey.key}`;
      const taken = this.creationKeys.get(slot);
      if (taken && this.forms.has(taken.formId)) {
        throw new FormCreationKeyTakenException(creationKey.key);
      }
      this.creationKeys.set(slot, {
        formId: form.id,
        requestHash: creationKey.requestHash,
      });
    }
    this.forms.set(form.id, form);
    this.versions.set(initialVersion.id, initialVersion);

    return {
      form,
      currentVersion: initialVersion,
      versions: [initialVersion],
    };
  }

  async findByCreationKey(
    publisherId: string,
    key: string,
  ): Promise<FormWithCreationKey | null> {
    const entry = this.creationKeys.get(`${publisherId}:${key}`);
    if (!entry) return null;
    const record = await this.findById(entry.formId);
    return record
      ? { ...record, creationRequestHash: entry.requestHash }
      : null;
  }

  /**
   * Test helper (review F12): the stored form row, read synchronously so
   * another in-memory store (the guest quota check) sees what the services
   * wrote with no `await` between its check and its insert.
   */
  peekForm(id: string): FormEntity | undefined {
    return this.forms.get(id);
  }

  async findById(id: string): Promise<FormWithVersion | null> {
    const form = this.forms.get(id);
    if (!form) return null;

    const formVersions = Array.from(this.versions.values())
      .filter((v) => v.formId === id)
      .sort((a, b) => b.versionNumber - a.versionNumber);

    if (formVersions.length === 0) return null;

    return {
      form,
      currentVersion: formVersions[0],
      versions: formVersions,
    };
  }

  async findPublishedSummaryById(
    id: string,
  ): Promise<FormPublishedSummary | null> {
    const form = this.forms.get(id);
    if (!form) return null;
    const newest = Array.from(this.versions.values())
      .filter((v) => v.formId === id && v.isPublished)
      .sort((a, b) => b.versionNumber - a.versionNumber)[0];
    return {
      form,
      newestPublished: newest
        ? {
            id: newest.id,
            versionNumber: newest.versionNumber,
            metadata: newest.schemaJson?.metadata ?? null,
          }
        : null,
    };
  }

  async findManyByPublisher(
    params: ListFormsParams,
  ): Promise<{ forms: FormSummaryItem[]; total: number }> {
    let list = Array.from(this.forms.values()).filter(
      (f) => f.publisherId === params.publisherId,
    );

    if (params.status) {
      list = list.filter((f) => f.status === params.status);
    }

    if (params.type) {
      list = list.filter((f) => f.type === params.type);
    }

    // Sort descending by updatedAt
    list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    const total = list.length;
    const start = (params.page - 1) * params.limit;
    const paginated = list.slice(start, start + params.limit);

    const items: FormSummaryItem[] = paginated.map((form) => {
      const formVersions = Array.from(this.versions.values())
        .filter((v) => v.formId === form.id)
        .sort((a, b) => b.versionNumber - a.versionNumber);

      const latestVersionNumber =
        formVersions.length > 0 ? formVersions[0].versionNumber : 1;

      return {
        form,
        latestVersionNumber,
        completedCompletions: 0,
      };
    });

    for (const item of items) {
      item.completedCompletions = (
        await this.listRewardableCompletions(item.form.id)
      ).completedCount;
    }

    return {
      forms: items,
      total,
    };
  }

  async update(
    form: FormEntity,
    version?: FormVersionEntity,
    expectation?: FormUpdateExpectation,
  ): Promise<FormWithVersion | null> {
    const current = this.forms.get(form.id);
    if (!current) return null;
    if (
      (expectation?.status && current.status !== expectation.status) ||
      (expectation?.updatedAt &&
        current.updatedAt.getTime() !== expectation.updatedAt.getTime())
    ) {
      return null;
    }

    this.forms.set(form.id, form);
    if (version) {
      this.versions.set(version.id, version);
    }

    const formVersions = Array.from(this.versions.values())
      .filter((v) => v.formId === form.id)
      .sort((a, b) => b.versionNumber - a.versionNumber);

    return {
      form,
      currentVersion: version ?? formVersions[0],
      versions: formVersions,
    };
  }

  async delete(id: string): Promise<boolean> {
    const form = this.forms.get(id);
    const formVersions = Array.from(this.versions.values()).filter(
      (version) => version.formId === id,
    );
    if (
      !form ||
      form.status !== 'DRAFT' ||
      formVersions.some((version) => version.isPublished)
    ) {
      return false;
    }
    this.forms.delete(id);
    for (const [vId, v] of this.versions.entries()) {
      if (v.formId === id) {
        this.versions.delete(vId);
      }
    }
    return true;
  }

  async createVersion(
    formId: string,
    newVersionId: string,
    createdAt: Date,
    options?: CreateVersionOptions,
  ): Promise<FormWithVersion | null> {
    const existingForm = this.forms.get(formId);
    if (!existingForm) return null;
    if (options?.expectedStatus) {
      if (existingForm.status !== options.expectedStatus) return null;
    } else if (existingForm.status !== 'PUBLISHED') {
      return null;
    }

    const existingVersions = Array.from(this.versions.values()).filter(
      (version) => version.formId === formId,
    );
    const baseVersion = existingVersions
      .slice()
      .sort((a, b) => b.versionNumber - a.versionNumber)[0];
    if (!baseVersion) return null;

    const nextVersionNumber =
      Math.max(...existingVersions.map((version) => version.versionNumber)) + 1;
    const isPublished = options?.isPublished ?? false;
    const publishedAt =
      options?.publishedAt ?? (isPublished ? createdAt : null);
    const completionCode =
      options?.completionCode !== undefined ? options.completionCode : null;

    const newVersion = new FormVersionEntity(
      newVersionId,
      formId,
      nextVersionNumber,
      baseVersion.schemaJson,
      baseVersion.targetingJson,
      isPublished,
      baseVersion.externalUrl,
      completionCode,
      publishedAt,
      createdAt,
    );

    this.versions.set(newVersion.id, newVersion);

    const targetStatus = options?.expectedStatus ?? 'DRAFT';
    const updatedForm = existingForm.copyWith({
      status: targetStatus,
      updatedAt: createdAt,
    });
    this.forms.set(formId, updatedForm);

    const formVersions = Array.from(this.versions.values())
      .filter((v) => v.formId === formId)
      .sort((a, b) => b.versionNumber - a.versionNumber);

    return {
      form: updatedForm,
      currentVersion: formVersions[0],
      versions: formVersions,
    };
  }

  async findAllVersions(formId: string): Promise<FormVersionEntity[]> {
    return Array.from(this.versions.values())
      .filter((v) => v.formId === formId)
      .sort((a, b) => a.versionNumber - b.versionNumber);
  }

  async findPublishedForms(): Promise<FormWithVersion[]> {
    const publishedForms = Array.from(this.forms.values())
      .filter((f) => f.status === 'PUBLISHED')
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    const result: FormWithVersion[] = [];

    for (const form of publishedForms) {
      const versions = Array.from(this.versions.values())
        .filter((v) => v.formId === form.id)
        .sort((a, b) => b.versionNumber - a.versionNumber);

      // Never fall back to an unpublished (draft/queued) version.
      const publishedVersion = versions.find((v) => v.isPublished);
      if (!publishedVersion) continue;
      result.push({
        form,
        currentVersion: publishedVersion,
        versions: [publishedVersion],
      });
    }

    return result;
  }

  /** Story IR.2b Task 9.3 parity: oldest deadline first. */
  async findQuotaState(formId: string) {
    const form = this.forms.get(formId);
    if (!form) return null;
    const refs = await this.listRewardableCompletions(formId);
    return {
      status: form.status,
      expectedCompletions: form.quotaLimit,
      completedCount: refs.completedCount,
    };
  }

  async findFormsPastDeadline(cutoff: Date, limit: number): Promise<string[]> {
    return Array.from(this.forms.values())
      .filter(
        (form) =>
          (form.status === 'PUBLISHED' || form.status === 'MODERATION_QUEUE') &&
          form.deadlineAt !== null &&
          form.deadlineAt.getTime() <= cutoff.getTime(),
      )
      .sort(
        (a, b) =>
          (a.deadlineAt?.getTime() ?? 0) - (b.deadlineAt?.getTime() ?? 0) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, Math.max(0, limit))
      .map((form) => form.id);
  }

  /**
   * Test helper: the quota count only (no settleable completions, so no
   * reward is owed for them).
   */
  setCompletedResponsesCount(formId: string, count: number): void {
    this.setRewardableCompletions(formId, { completedCount: count });
  }

  /** Test helper: the completions `listRewardableCompletions` reports. */
  setRewardableCompletions(
    formId: string,
    refs: Partial<FormCompletionRefs>,
  ): void {
    const current = this.completionRefs.get(formId) ?? emptyCompletionRefs();
    this.completionRefs.set(formId, { ...current, ...refs });
  }

  /**
   * Test helper: read completions from another in-memory store (for example
   * `InMemoryParticipationRepository.completionRefsFor`), so e2e flows that
   * really submit/verify see them.
   */
  useCompletionSource(source: CompletionRefsSource): void {
    this.completionSource = source;
  }

  async listRewardableCompletions(formId: string): Promise<FormCompletionRefs> {
    if (this.completionSource) {
      return this.completionSource(formId);
    }
    const refs = this.completionRefs.get(formId) ?? emptyCompletionRefs();
    return {
      completedCount: refs.completedCount,
      internalResponses: [...refs.internalResponses],
      externalAttemptIds: [...refs.externalAttemptIds],
    };
  }

  async listEscrowInputsByFormIds(
    formIds: string[],
  ): Promise<Map<string, FormEscrowInputs>> {
    const result = new Map<string, FormEscrowInputs>();
    for (const formId of formIds) {
      result.set(formId, {
        versionIds: (await this.findAllVersions(formId)).map(
          (version) => version.id,
        ),
        completions: await this.listRewardableCompletions(formId),
      });
    }
    return result;
  }

  /**
   * Test helper (IR.4a): the completion instants of a form (`external` = a
   * COMPLETED External attempt without a Response) behind the progress
   * buckets and the review-window count.
   */
  setCompletionTimes(formId: string, completions: CompletionTime[]): void {
    this.completionTimes.set(formId, [...completions]);
  }

  /** Test helper (IR.4a): read completion instants from another in-memory store. */
  useCompletionTimesSource(source: CompletionTimesSource): void {
    this.completionTimesSource = source;
  }

  private async completionTimesOf(formId: string): Promise<CompletionTime[]> {
    return this.completionTimesSource
      ? this.completionTimesSource(formId)
      : (this.completionTimes.get(formId) ?? []);
  }

  async countCompletionsInBuckets(
    formId: string,
    buckets: readonly CompletionBucketWindow[],
  ): Promise<number[]> {
    const completions = await this.completionTimesOf(formId);
    return buckets.map(
      (bucket) =>
        completions.filter(
          (completion) =>
            completion.submittedAt >= bucket.startsAt &&
            completion.submittedAt < bucket.endsAt,
        ).length,
    );
  }

  async countExternalCompletionsSince(
    formId: string,
    since: Date,
  ): Promise<number> {
    const completions = await this.completionTimesOf(formId);
    return completions.filter(
      (completion) => completion.external && completion.submittedAt >= since,
    ).length;
  }

  /** Test helper: the latest REJECTED moderation decision of a form. */
  setRejection(formId: string, rejection: FormRejection | null): void {
    if (rejection) this.rejections.set(formId, rejection);
    else this.rejections.delete(formId);
  }

  async findLatestRejection(formId: string): Promise<FormRejection | null> {
    return this.rejections.get(formId) ?? null;
  }

  async findModerationQueue(
    params: ModerationQueueParams,
  ): Promise<ModerationQueuePage> {
    const queued = Array.from(this.forms.values())
      .filter((form) => form.status === 'MODERATION_QUEUE')
      .sort(
        (a, b) =>
          a.updatedAt.getTime() - b.updatedAt.getTime() ||
          a.id.localeCompare(b.id),
      );
    const page = queued.slice(params.offset, params.offset + params.limit);
    const items: FormWithVersion[] = [];
    for (const form of page) {
      const record = await this.findById(form.id);
      if (record) items.push(record);
    }
    return { items, total: queued.length };
  }
}

function emptyCompletionRefs(): FormCompletionRefs {
  return { completedCount: 0, internalResponses: [], externalAttemptIds: [] };
}
