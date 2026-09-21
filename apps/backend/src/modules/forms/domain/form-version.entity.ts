import { DraftFormDefinition, SurveyTargetingCriteria } from '@rescom/schemas';

export class FormVersionEntity {
  constructor(
    public readonly id: string,
    public readonly formId: string,
    public readonly versionNumber: number,
    public readonly schemaJson: DraftFormDefinition,
    public readonly targetingJson: SurveyTargetingCriteria | null,
    public readonly isPublished: boolean,
    public readonly externalUrl: string | null,
    public readonly completionCode: string | null,
    public readonly publishedAt: Date | null,
    public readonly createdAt: Date,
  ) {}

  copyWith(updates: {
    schemaJson?: DraftFormDefinition;
    targetingJson?: SurveyTargetingCriteria | null;
    isPublished?: boolean;
    externalUrl?: string | null;
    completionCode?: string | null;
    publishedAt?: Date | null;
  }): FormVersionEntity {
    return new FormVersionEntity(
      this.id,
      this.formId,
      this.versionNumber,
      updates.schemaJson ?? this.schemaJson,
      updates.targetingJson !== undefined
        ? updates.targetingJson
        : this.targetingJson,
      updates.isPublished ?? this.isPublished,
      updates.externalUrl !== undefined
        ? updates.externalUrl
        : this.externalUrl,
      updates.completionCode !== undefined
        ? updates.completionCode
        : this.completionCode,
      updates.publishedAt !== undefined
        ? updates.publishedAt
        : this.publishedAt,
      this.createdAt,
    );
  }
}
