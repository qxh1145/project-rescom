import { Injectable } from '@nestjs/common';
import {
  CreateVersionOptions,
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
import type { FormCompletionRefs } from '../application/ports/form-repository.port';

type CompletionRefsSource = (
  formId: string,
) => FormCompletionRefs | Promise<FormCompletionRefs>;

type InProgressAttemptsSource = (
  formId: string,
  startedSince: Date,
) => number | Promise<number>;

@Injectable()
export class InMemoryFormRepository implements FormRepositoryPort {
  private readonly forms = new Map<string, FormEntity>();
  private readonly versions = new Map<string, FormVersionEntity>();
  private readonly completionRefs = new Map<string, FormCompletionRefs>();
  private completionSource?: CompletionRefsSource;
  private inProgressAttemptsSource?: InProgressAttemptsSource;

  clear(): void {
    this.forms.clear();
    this.versions.clear();
    this.completionRefs.clear();
    this.completionSource = undefined;
    this.inProgressAttemptsSource = undefined;
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
  ): Promise<FormWithVersion> {
    this.forms.set(form.id, form);
    this.versions.set(initialVersion.id, initialVersion);

    return {
      form,
      currentVersion: initialVersion,
      versions: [initialVersion],
    };
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
      };
    });

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
