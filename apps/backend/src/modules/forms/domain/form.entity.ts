import {
  FormCloseKind,
  FormStatusEnum,
  FormTopic,
  FormTypeEnum,
  isFormImmutable,
  isOwnerReopenableClose,
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
    /**
     * How many times the survey entered CLOSED (Epic 6 review P3). It is the
     * close identity of the Escrow keys `close-refund:{formId}:c{closeCount}`
     * and `reopen-escrow:{formId}:c{closeCount}`, so every close/reopen cycle
     * posts its own journal.
     */
    public readonly closeCount: number = 0,
    /**
     * Publisher's estimated completion time in whole minutes (decision
     * E6-D2): picks the FR-14 pricing band enforced at publish. Optional on
     * drafts.
     */
    public readonly estimatedDurationMinutes: number | null = null,
    /**
     * Who closed the survey most recently (decision E8-D1): written by the
     * same conditional update as the CLOSED transition. `null` when it was
     * never closed, or closed before the close kind was recorded.
     */
    public readonly closeKind: FormCloseKind | null = null,
    /**
     * Story IR.2b Q1: collection deadline. New starts stop at it; the
     * `deadline-close` job closes the survey (close kind DEADLINE) once the
     * in-flight attempts' window passed. `null` = no deadline.
     */
    public readonly deadlineAt: Date | null = null,
    /** Plan 2.2: the survey topic (`FORM_TOPICS`); `null` = none chosen. */
    public readonly topic: FormTopic | null = null,
  ) {}

  /** Story IR.2b: true once `now` reached the deadline (no new starts). */
  isPastDeadline(now: Date): boolean {
    return (
      this.deadlineAt !== null && this.deadlineAt.getTime() <= now.getTime()
    );
  }

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

  /**
   * Decision E8-D1: only a survey its owner closed can be reopened; Admin
   * takedowns and moderation rejections are final.
   */
  isReopenableByOwner(): boolean {
    return this.isClosed() && isOwnerReopenableClose(this.closeKind);
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
    return this.copyWith({
      status: nextStatus,
      updatedAt,
      // Persisted by the same conditional update that performs the
      // transition, so concurrent closes cannot share a close number.
      closeCount:
        nextStatus === 'CLOSED' ? this.closeCount + 1 : this.closeCount,
    });
  }

  /**
   * The CLOSED transition that records who closed the survey (decision
   * E8-D1). Every production close path goes through here; `closeKind` is
   * persisted by the same conditional update as the transition and
   * `closeCount`.
   */
  close(closeKind: FormCloseKind, closedAt = new Date()): FormEntity {
    return this.transitionTo('CLOSED', closedAt).copyWith({
      updatedAt: closedAt,
      closeKind,
    });
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
    closeCount?: number;
    /** `undefined` keeps the current value; `null` clears it. */
    estimatedDurationMinutes?: number | null;
    /** `undefined` keeps the current value; `null` clears it. */
    closeKind?: FormCloseKind | null;
    /** `undefined` keeps the current value; `null` clears it. */
    deadlineAt?: Date | null;
    /** `undefined` keeps the current value; `null` clears it. */
    topic?: FormTopic | null;
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
      updates.closeCount ?? this.closeCount,
      updates.estimatedDurationMinutes !== undefined
        ? updates.estimatedDurationMinutes
        : this.estimatedDurationMinutes,
      updates.closeKind !== undefined ? updates.closeKind : this.closeKind,
      updates.deadlineAt !== undefined ? updates.deadlineAt : this.deadlineAt,
      updates.topic !== undefined ? updates.topic : this.topic,
    );
  }
}
