import { FormStatusEnum, FormTypeEnum } from '@rescom/schemas';
import { FormEntity } from '../../domain/form.entity';
import { FormVersionEntity } from '../../domain/form-version.entity';

export const FORM_REPOSITORY_PORT = Symbol('FORM_REPOSITORY_PORT');

export interface FormWithVersion {
  form: FormEntity;
  currentVersion: FormVersionEntity;
  versions?: FormVersionEntity[];
}

export interface FormSummaryItem {
  form: FormEntity;
  latestVersionNumber: number;
}

export interface ListFormsParams {
  publisherId: string;
  page: number;
  limit: number;
  status?: FormStatusEnum;
  type?: FormTypeEnum;
}

export interface FormUpdateExpectation {
  status?: FormStatusEnum;
  updatedAt?: Date;
}

export interface ModerationQueueParams {
  limit: number;
  offset: number;
}

export interface ModerationQueuePage {
  items: FormWithVersion[];
  total: number;
}

export interface CreateVersionOptions {
  completionCode?: string | null;
  isPublished?: boolean;
  publishedAt?: Date | null;
  /**
   * Keeps the form's status and only bumps `updatedAt`, provided the form is
   * still in this status when the version is created (optimistic precondition).
   * Completion-code rotation uses it so a concurrent close/moderation decision
   * is never overwritten (a lost precondition returns `null`).
   */
  expectedStatus?: FormStatusEnum;
}

/**
 * Epic 6 review P4: the completions whose rewards draw one form's Escrow
 * (same completion definition as the participation quota).
 */
export interface FormCompletionRefs {
  /** Completed participations, quota definition (guests included). */
  completedCount: number;
  /**
   * Non-guest Internal responses past submission. `rewardable` ones
   * (SUBMITTED/VALIDATED) are owed a reward until their payout journal
   * exists; the others only count when a payout journal already exists.
   */
  internalResponses: Array<{ id: string; rewardable: boolean }>;
  /** COMPLETED External attempts (no Response row), each owed a Pending credit. */
  externalAttemptIds: string[];
}

export interface FormRepositoryPort {
  create(
    form: FormEntity,
    initialVersion: FormVersionEntity,
  ): Promise<FormWithVersion>;

  findById(id: string): Promise<FormWithVersion | null>;

  findManyByPublisher(
    params: ListFormsParams,
  ): Promise<{ forms: FormSummaryItem[]; total: number }>;

  update(
    form: FormEntity,
    version?: FormVersionEntity,
    expectation?: FormUpdateExpectation,
  ): Promise<FormWithVersion | null>;

  delete(id: string): Promise<boolean>;

  /**
   * Atomically creates a new FormVersion row cloned from the form's newest
   * version (schema, targeting, external URL).
   * If options.expectedStatus is provided, the form must still be in that
   * status and keeps it; otherwise a PUBLISHED form transitions back to DRAFT.
   * Returns `null` when the status precondition is not met.
   * The existing published version record is never modified.
   */
  createVersion(
    formId: string,
    newVersionId: string,
    createdAt: Date,
    options?: CreateVersionOptions,
  ): Promise<FormWithVersion | null>;

  /**
   * Returns all versions for a form, ordered by versionNumber ascending.
   */
  findAllVersions(formId: string): Promise<FormVersionEntity[]>;

  /**
   * Returns all PUBLISHED forms with their newest published FormVersion as
   * `currentVersion` (and `versions` = [that version] only), ordered by
   * updatedAt descending. Forms without a published version are excluded.
   */
  findPublishedForms(): Promise<FormWithVersion[]>;

  /**
   * Epic 6 review P4: the form's completions (quota count, guests included)
   * and the Internal responses / External attempts whose rewards draw its
   * Escrow. Joins the ambient Unit of Work (read inside close/publish).
   */
  listRewardableCompletions(formId: string): Promise<FormCompletionRefs>;

  /**
   * Decision E5-D4: the form's unexpired IN_PROGRESS attempts (started on or
   * after `startedSince`) — the respondents a new version cuts off. Joins the
   * ambient Unit of Work.
   */
  countInProgressAttempts(formId: string, startedSince: Date): Promise<number>;

  /**
   * Story 8.1: forms waiting in `MODERATION_QUEUE`, oldest submission first
   * (FIFO by the queue-entry time `updatedAt`), each with all versions
   * (`currentVersion` = the pinned version awaiting review).
   */
  findModerationQueue(
    params: ModerationQueueParams,
  ): Promise<ModerationQueuePage>;
}
