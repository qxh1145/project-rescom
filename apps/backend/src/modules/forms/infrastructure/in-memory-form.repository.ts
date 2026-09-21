import { Injectable } from '@nestjs/common';
import {
  CreateVersionOptions,
  FormRepositoryPort,
  FormSummaryItem,
  FormUpdateExpectation,
  FormWithVersion,
  ListFormsParams,
} from '../application/ports/form-repository.port';
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';

@Injectable()
export class InMemoryFormRepository implements FormRepositoryPort {
  private readonly forms = new Map<string, FormEntity>();
  private readonly versions = new Map<string, FormVersionEntity>();

  clear(): void {
    this.forms.clear();
    this.versions.clear();
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
    if (!options?.targetStatus && existingForm.status !== 'PUBLISHED')
      return null;

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

    const targetStatus = options?.targetStatus ?? 'DRAFT';
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

      const publishedVersion =
        versions.find((v) => v.isPublished) ?? versions[0];
      if (publishedVersion) {
        result.push({
          form,
          currentVersion: publishedVersion,
          versions,
        });
      }
    }

    return result;
  }
}
