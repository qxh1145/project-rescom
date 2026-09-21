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

export interface CreateVersionOptions {
  completionCode?: string | null;
  isPublished?: boolean;
  publishedAt?: Date | null;
  targetStatus?: FormStatusEnum;
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
   * Atomically creates a new FormVersion row.
   * If options.targetStatus is provided, transitions Form.status to it;
   * otherwise defaults to transitioning Form.status back to DRAFT.
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
   * Returns all published forms with their current published FormVersion,
   * ordered by updatedAt descending.
   */
  findPublishedForms(): Promise<FormWithVersion[]>;
}
