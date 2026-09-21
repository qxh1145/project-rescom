import {
  FormStatusEnum,
  FormTypeEnum,
  isFormImmutable,
  isValidStatusTransition,
} from '@rescom/schemas';
import { FormVersionEntity } from './form-version.entity';
import { InvalidFormStatusTransitionException } from '../application/exceptions/form.exceptions';

export class FormEntity {
  constructor(
    public readonly id: string,
    public readonly publisherId: string,
    public readonly type: FormTypeEnum,
    public readonly status: FormStatusEnum,
    public readonly title: string,
    public readonly description: string | null,
    public readonly rewardPerResponse: number,
    public readonly expectedCompletions: number,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly versions?: FormVersionEntity[],
  ) {}

  isDraft(): boolean {
    return this.status === 'DRAFT';
  }

  canBeEdited(): boolean {
    return this.isDraft();
  }

  canBeDeleted(): boolean {
    return this.isDraft();
  }

  isImmutable(): boolean {
    return isFormImmutable(this.status);
  }

  isPublished(): boolean {
    return this.status === 'PUBLISHED';
  }

  canCreateNewVersion(): boolean {
    return this.status === 'PUBLISHED';
  }

  isClosed(): boolean {
    return this.status === 'CLOSED';
  }

  canTransitionTo(nextStatus: FormStatusEnum): boolean {
    return isValidStatusTransition(this.status, nextStatus);
  }

  transitionTo(nextStatus: FormStatusEnum, updatedAt = new Date()): FormEntity {
    if (!this.canTransitionTo(nextStatus)) {
      throw new InvalidFormStatusTransitionException(
        this.id,
        this.status,
        nextStatus,
      );
    }
    return this.copyWith({ status: nextStatus, updatedAt });
  }

  isOwnedBy(userId: string): boolean {
    return this.publisherId === userId;
  }

  copyWith(updates: {
    title?: string;
    description?: string | null;
    type?: FormTypeEnum;
    status?: FormStatusEnum;
    rewardPerResponse?: number;
    expectedCompletions?: number;
    updatedAt?: Date;
    versions?: FormVersionEntity[];
  }): FormEntity {
    return new FormEntity(
      this.id,
      this.publisherId,
      updates.type ?? this.type,
      updates.status ?? this.status,
      updates.title ?? this.title,
      updates.description !== undefined
        ? updates.description
        : this.description,
      updates.rewardPerResponse ?? this.rewardPerResponse,
      updates.expectedCompletions ?? this.expectedCompletions,
      this.createdAt,
      updates.updatedAt ?? new Date(),
      updates.versions ?? this.versions,
    );
  }
}
