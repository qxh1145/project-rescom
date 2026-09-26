import { randomUUID } from 'crypto';
import {
  calculateEscrowCost,
  checkPublishRewardBand,
  closeFormSchema,
  CloseFormInput,
  CreateExternalSurveyInput,
  createExternalSurveySchema,
  CreateFormVersionResultDto,
  FormInProgressAttemptsDto,
  RESERVATION_EXPIRY_MINUTES,
  RESERVATION_EXPIRY_MS,
  CreateFormDraftInput,
  createFormDraftSchema,
  determinePublishTargetStatus,
  DraftFormDefinition,
  ExternalSurveyResponseDto,
  FormDetailDto,
  FormStatusEnum,
  formStatusTransitionSchema,
  FormStatusTransitionInput,
  MAX_EXPECTED_COMPLETIONS,
  FormSummaryDto,
  FormVersionDto,
  FormVersionSummaryDto,
  getRewardPricingRange,
  ListFormsQuery,
  PricingQuoteDto,
  publishFormSchema,
  PublishFormInput,
  reopenSurveySchema,
  ReopenSurveyInput,
  RotateCompletionCodeInput,
  rotateCompletionCodeSchema,
  surveyTargetingSchema,
  updateFormDraftSchema,
} from '@rescom/schemas';
import {
  FormRepositoryPort,
  FormWithVersion,
} from './ports/form-repository.port';
import { CompletionCodePort } from './ports/completion-code.port';
import {
  PassThroughUnitOfWork,
  UnitOfWorkPort,
} from '../../../common/database/unit-of-work.port';
import {
  closeIdentity,
  FormsEscrowCoordinator,
} from './forms-escrow.coordinator';
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';
import {
  FormAlreadyClosedException,
  FormForbiddenException,
  FormHasPublishedVersionsException,
  FormModerationRequiredException,
  FormNotFoundException,
  FormNotReopenableException,
  FormNotInDraftStatusException,
  FormNotPublishedException,
  FormConflictException,
  FormValidationException,
  InvalidFormDraftException,
  InvalidFormStatusTransitionException,
  ModerationEscrowNotFundedException,
  TargetingValidationException,
} from './exceptions/form.exceptions';
import {
  assertFormPublishable,
  assertRewardWithinPricingBand,
  assertSurveyFitsReservationWindow,
} from './form-publishability';

export function toFormVersionDto(version: FormVersionEntity): FormVersionDto {
  return {
    id: version.id,
    formId: version.formId,
    versionNumber: version.versionNumber,
    schemaJson: version.schemaJson,
    targetingJson: version.targetingJson,
    isPublished: version.isPublished,
    externalUrl: version.externalUrl,
    completionCode: null,
    hasCompletionCode: Boolean(version.completionCode),
    publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
    createdAt: version.createdAt.toISOString(),
  };
}

export function toFormDetailDto(data: FormWithVersion): FormDetailDto {
  return {
    id: data.form.id,
    publisherId: data.form.publisherId,
    type: data.form.type,
    status: data.form.status,
    title: data.form.title,
    description: data.form.description,
    rewardPerResponse: data.form.rewardPerResponse,
    expectedCompletions: data.form.expectedCompletions,
    estimatedDurationMinutes: data.form.estimatedDurationMinutes,
    closeKind: data.form.closeKind,
    currentVersion: toFormVersionDto(data.currentVersion),
    createdAt: data.form.createdAt.toISOString(),
    updatedAt: data.form.updatedAt.toISOString(),
  };
}

export class FormsService {
  constructor(
    private readonly formRepository: FormRepositoryPort,
    private readonly completionCodePort?: CompletionCodePort,
    private readonly escrowCoordinator?: FormsEscrowCoordinator,
    /**
     * AD-16 shared Unit of Work: publish (Escrow reserve + queue entry), close
     * (transition + refund) and reopen (Escrow lock + transition) commit or
     * roll back together.
     */
    private readonly unitOfWork: UnitOfWorkPort = new PassThroughUnitOfWork(),
  ) {}

  private getCompletionCodePort(): CompletionCodePort {
    if (!this.completionCodePort) {
      throw new Error(
        'CompletionCodePort is required for completion code operations',
      );
    }
    return this.completionCodePort;
  }

  async createDraft(
    publisherId: string,
    rawDto: CreateFormDraftInput,
  ): Promise<FormDetailDto> {
    const dto = createFormDraftSchema.parse(rawDto);
    const formId = randomUUID();
    const versionId = randomUUID();
    const now = new Date();

    const initialSchema: DraftFormDefinition = dto.schema ?? {
      schemaVersion: 1,
      title: dto.title ?? 'Untitled Survey',
      description: dto.description ?? undefined,
      blocks: [],
      settings: {
        shuffleBlocks: false,
        progressBar: true,
        requireAuth: false,
        allowPublicAccess: true,
        submitButtonText: 'Submit',
      },
      metadata: {
        expectedEffortSeconds: 60,
        minTimeBarrierSeconds: 15,
      },
    };

    const form = new FormEntity(
      formId,
      publisherId,
      dto.type ?? 'INTERNAL',
      'DRAFT',
      dto.title ?? 'Untitled Survey',
      dto.description ?? null,
      dto.rewardPerResponse ?? 10,
      dto.expectedCompletions ?? 50,
      now,
      now,
      undefined,
      0,
      dto.estimatedDurationMinutes ?? null,
    );

    const version = new FormVersionEntity(
      versionId,
      formId,
      1,
      initialSchema,
      dto.targetingJson ?? null,
      false,
      dto.externalUrl ?? null,
      null,
      null,
      now,
    );

    const created = await this.formRepository.create(form, version);
    return toFormDetailDto(created);
  }

  async createExternalSurvey(
    publisherId: string,
    rawDto: CreateExternalSurveyInput,
  ): Promise<ExternalSurveyResponseDto> {
    const dto = createExternalSurveySchema.parse(rawDto);
    const formId = randomUUID();
    const versionId = randomUUID();
    const now = new Date();

    const plaintextCode = this.getCompletionCodePort().generateSixDigitCode();
    const verifier = this.getCompletionCodePort().computeVerifier(
      versionId,
      plaintextCode,
    );

    const initialSchema: DraftFormDefinition = {
      schemaVersion: 1,
      title: dto.title ?? 'External Survey',
      description: dto.description ?? undefined,
      blocks: [],
      settings: {
        shuffleBlocks: false,
        progressBar: false,
        requireAuth: false,
        allowPublicAccess: true,
        submitButtonText: 'Submit',
      },
      // PRD FR-12: the publisher's estimated completion time drives the
      // Marketplace duration sort/filter. The External time-barrier policy is
      // unchanged (PO item deferred by Story 8.2); it is capped so the
      // metadata invariant (barrier <= effort) holds.
      metadata: {
        expectedEffortSeconds: dto.expectedEffortSeconds,
        minTimeBarrierSeconds: Math.min(15, dto.expectedEffortSeconds),
      },
    };

    // Story 8.1: auto-publish submits the survey to the moderation queue; the
    // version only becomes published when an Admin approves it.
    const status: FormStatusEnum = dto.autoPublish
      ? determinePublishTargetStatus({
          type: 'EXTERNAL',
          rewardPerResponse: dto.rewardPerResponse,
        })
      : 'DRAFT';

    const form = new FormEntity(
      formId,
      publisherId,
      'EXTERNAL',
      status,
      dto.title ?? 'External Survey',
      dto.description ?? null,
      dto.rewardPerResponse,
      dto.expectedCompletions,
      now,
      now,
      undefined,
      0,
      dto.estimatedDurationMinutes ?? null,
    );

    // Decision E6-D2: auto-publish is a publication, so the FR-14 pricing
    // band applies (a draft is never checked); so does the 30-minute attempt
    // reservation window (decision E5-D2).
    if (dto.autoPublish) {
      assertSurveyFitsReservationWindow(form, { schemaJson: initialSchema });
      assertRewardWithinPricingBand(form);
    }

    const version = new FormVersionEntity(
      versionId,
      formId,
      1,
      initialSchema,
      dto.targetingJson ?? null,
      false,
      dto.externalUrl,
      verifier,
      null,
      now,
    );

    // AD-16 Publish+Escrow: an auto-published survey reserves its Escrow in the
    // same Unit of Work that creates it, so an unfunded survey never reaches the
    // moderation queue (insufficient balance → nothing is created).
    const created = dto.autoPublish
      ? await this.unitOfWork.run(`publish:${versionId}`, async () => {
          await this.escrowCoordinator?.coordinatePublish(
            form,
            version,
            publisherId,
          );
          return this.formRepository.create(form, version);
        })
      : await this.formRepository.create(form, version);
    const detail = toFormDetailDto(created);
    return {
      ...detail,
      plaintextCompletionCode: plaintextCode,
      hasCompletionCode: true,
      externalUrl: created.currentVersion.externalUrl,
      currentVersionNumber: created.currentVersion.versionNumber,
    };
  }

  async getFormById(
    id: string,
    requester: { userId: string; role: string },
  ): Promise<FormDetailDto> {
    const record = await this.formRepository.findById(id);
    if (!record) {
      throw new FormNotFoundException(id);
    }

    if (
      !record.form.isOwnedBy(requester.userId) &&
      requester.role !== 'ADMIN'
    ) {
      throw new FormForbiddenException();
    }

    return toFormDetailDto(record);
  }

  async listForms(
    publisherId: string,
    query: ListFormsQuery,
  ): Promise<{
    forms: FormSummaryDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { forms, total } = await this.formRepository.findManyByPublisher({
      publisherId,
      page,
      limit,
      status: query.status,
      type: query.type,
    });

    const items: FormSummaryDto[] = forms.map((item) => ({
      id: item.form.id,
      publisherId: item.form.publisherId,
      type: item.form.type,
      status: item.form.status,
      title: item.form.title,
      description: item.form.description,
      rewardPerResponse: item.form.rewardPerResponse,
      expectedCompletions: item.form.expectedCompletions,
      estimatedDurationMinutes: item.form.estimatedDurationMinutes,
      latestVersionNumber: item.latestVersionNumber,
      createdAt: item.form.createdAt.toISOString(),
      updatedAt: item.form.updatedAt.toISOString(),
    }));

    return {
      forms: items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async updateDraft(
    id: string,
    requester: { userId: string; role: string },
    rawDto: unknown,
  ): Promise<FormDetailDto> {
    const existing = await this.formRepository.findById(id);
    if (!existing) {
      throw new FormNotFoundException(id);
    }

    if (
      !existing.form.isOwnedBy(requester.userId) &&
      requester.role !== 'ADMIN'
    ) {
      throw new FormForbiddenException();
    }

    if (!existing.form.canBeEdited()) {
      throw new FormNotInDraftStatusException(existing.form.status);
    }

    // Validate targeting only after resource authorization and lifecycle checks.
    // This preserves the required 403/409 precedence for foreign or immutable
    // forms while retaining the Story 4.1-specific 422 contract for editable drafts.
    const rawTargeting =
      typeof rawDto === 'object' && rawDto !== null && 'targetingJson' in rawDto
        ? rawDto.targetingJson
        : undefined;
    if (rawTargeting != null) {
      const targetingResult = surveyTargetingSchema.safeParse(rawTargeting);
      if (!targetingResult.success) {
        const details = targetingResult.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw new TargetingValidationException(
          details,
          targetingResult.error.issues,
        );
      }
    }

    const draftResult = updateFormDraftSchema.safeParse(rawDto);
    if (!draftResult.success) {
      throw new InvalidFormDraftException(
        draftResult.error.issues[0]?.message || 'Invalid form draft update',
      );
    }
    const dto = draftResult.data;

    // ── Optimistic concurrency check ───────────────────────────────────────
    // The client must supply the `updatedAt` value it last received so we can
    // detect whether a concurrent autosave already committed a newer write.
    // The token must match exactly; accepting future client clocks would defeat
    // optimistic locking.
    const clientTs = new Date(dto.clientUpdatedAt).getTime();
    const serverTs = existing.form.updatedAt.getTime();
    if (serverTs !== clientTs) {
      throw new FormConflictException(
        id,
        dto.clientUpdatedAt,
        existing.form.updatedAt.toISOString(),
      );
    }
    // ───────────────────────────────────────────────────────────────────────

    const updatedForm = existing.form.copyWith({
      title: dto.title,
      description: dto.description,
      type: dto.type,
      rewardPerResponse: dto.rewardPerResponse,
      expectedCompletions: dto.expectedCompletions,
      // Drafts stay editable: the FR-14 band is only checked at publish.
      estimatedDurationMinutes: dto.estimatedDurationMinutes,
      updatedAt: new Date(
        Math.max(Date.now(), existing.form.updatedAt.getTime() + 1),
      ),
    });

    const updatedVersion = existing.currentVersion.copyWith({
      schemaJson: dto.schema,
      targetingJson: dto.targetingJson,
      externalUrl: dto.externalUrl,
    });

    // repository.update() MUST execute both the Form and FormVersion writes
    // atomically inside a single DB transaction (see PrismaFormRepository).
    const saved = await this.formRepository.update(
      updatedForm,
      updatedVersion,
      {
        status: 'DRAFT',
        updatedAt: new Date(dto.clientUpdatedAt),
      },
    );
    if (!saved) {
      const latest = await this.formRepository.findById(id);
      throw new FormConflictException(
        id,
        dto.clientUpdatedAt,
        latest?.form.updatedAt.toISOString() ??
          existing.form.updatedAt.toISOString(),
      );
    }
    return toFormDetailDto(saved);
  }

  async deleteDraft(
    id: string,
    requester: { userId: string; role: string },
  ): Promise<void> {
    const existing = await this.formRepository.findById(id);
    if (!existing) {
      throw new FormNotFoundException(id);
    }

    if (
      !existing.form.isOwnedBy(requester.userId) &&
      requester.role !== 'ADMIN'
    ) {
      throw new FormForbiddenException();
    }

    if (!existing.form.canBeDeleted()) {
      throw new FormNotInDraftStatusException(existing.form.status);
    }

    if (existing.versions?.some((version) => version.isPublished)) {
      throw new FormHasPublishedVersionsException(id);
    }

    const deleted = await this.formRepository.delete(id);
    if (!deleted) {
      const latest = await this.formRepository.findById(id);
      if (latest?.versions?.some((version) => version.isPublished)) {
        throw new FormHasPublishedVersionsException(id);
      }
      if (latest && !latest.form.canBeDeleted()) {
        throw new FormNotInDraftStatusException(latest.form.status);
      }
      throw new FormNotFoundException(id);
    }
  }

  async publishForm(
    id: string,
    requester: { userId: string; role: string },
    rawDto?: PublishFormInput,
  ): Promise<FormDetailDto> {
    const dto = rawDto ? publishFormSchema.parse(rawDto) : {};
    const existing = await this.formRepository.findById(id);
    if (!existing) {
      throw new FormNotFoundException(id);
    }

    if (
      !existing.form.isOwnedBy(requester.userId) &&
      requester.role !== 'ADMIN'
    ) {
      throw new FormForbiddenException();
    }

    if (!existing.form.isDraft()) {
      throw new FormNotInDraftStatusException(existing.form.status);
    }

    // Decision E6-D2: the publish request may set the estimated duration,
    // which is stored with the transition; the FR-14 band is enforced here
    // (publish time only — drafts stay editable).
    const formToPublish =
      dto.estimatedDurationMinutes !== undefined
        ? existing.form.copyWith({
            estimatedDurationMinutes: dto.estimatedDurationMinutes,
            updatedAt: existing.form.updatedAt,
          })
        : existing.form;

    // External surveys may supply the URL with the publish request. The
    // estimated duration being published is checked against the attempt
    // reservation window too (decision E5-D2).
    const effectiveExternalUrl =
      dto.externalUrl ?? existing.currentVersion.externalUrl;
    assertFormPublishable(
      formToPublish,
      existing.currentVersion,
      effectiveExternalUrl,
    );
    assertRewardWithinPricingBand(formToPublish);

    // Story 8.1: every publication enters the Admin moderation queue. An
    // explicit target is accepted only when the lifecycle table allows it
    // (DRAFT -> MODERATION_QUEUE), so nobody can publish around moderation.
    const targetStatus: FormStatusEnum =
      dto.targetStatus ??
      determinePublishTargetStatus({
        type: existing.form.type,
        rewardPerResponse: existing.form.rewardPerResponse,
      });
    if (!existing.form.canTransitionTo(targetStatus)) {
      throw new InvalidFormStatusTransitionException(
        id,
        existing.form.status,
        targetStatus,
      );
    }

    const now = new Date();

    // The queued version stays unpublished (not startable, not in the
    // Marketplace) until an Admin approves it; approval sets publishedAt.
    const updatedVersion = existing.currentVersion.copyWith({
      isPublished: false,
      publishedAt: null,
      externalUrl: effectiveExternalUrl,
    });

    const updatedForm = formToPublish.transitionTo(targetStatus, now);

    // AD-16 Publish+Escrow: the Escrow journal and the queue entry commit or
    // roll back together (a lost optimistic update rolls the journal back).
    const saved = await this.unitOfWork.run(
      `publish:${updatedVersion.id}`,
      async () => {
        await this.escrowCoordinator?.coordinatePublish(
          existing.form,
          updatedVersion,
          existing.form.publisherId,
        );

        const result = await this.formRepository.update(
          updatedForm,
          updatedVersion,
          {
            status: 'DRAFT',
            updatedAt: existing.form.updatedAt,
          },
        );
        if (!result) {
          const latest = await this.formRepository.findById(id);
          throw new FormConflictException(
            id,
            existing.form.updatedAt.toISOString(),
            latest?.form.updatedAt.toISOString() ??
              existing.form.updatedAt.toISOString(),
          );
        }
        return result;
      },
    );
    return toFormDetailDto(saved);
  }

  async closeForm(
    id: string,
    requester: { userId: string; role: string },
    rawDto?: CloseFormInput,
  ): Promise<FormDetailDto> {
    if (rawDto) closeFormSchema.parse(rawDto);
    const existing = await this.formRepository.findById(id);
    if (!existing) {
      throw new FormNotFoundException(id);
    }

    if (
      !existing.form.isOwnedBy(requester.userId) &&
      requester.role !== 'ADMIN'
    ) {
      throw new FormForbiddenException();
    }

    if (existing.form.isClosed()) {
      throw new FormAlreadyClosedException(id);
    }

    // Epic 8 review P1: only the owner may withdraw a queued survey. Anybody
    // else (an Admin) takes it out of the queue through the moderation reject
    // command, which records the decision and its reason, writes the audit
    // event and notifies the Publisher.
    if (
      existing.form.status === 'MODERATION_QUEUE' &&
      !existing.form.isOwnedBy(requester.userId)
    ) {
      throw new FormModerationRequiredException(id);
    }

    if (!existing.form.canTransitionTo('CLOSED')) {
      throw new InvalidFormStatusTransitionException(
        id,
        existing.form.status,
        'CLOSED',
      );
    }

    const now = new Date();
    // The transition increments `closeCount`, the close identity of the
    // refund key (Epic 6 review P3), and records who closed the survey
    // (decision E8-D1): the owner's close — including an Admin closing their
    // own survey — can be reopened later; an Admin takedown of someone else's
    // survey is final.
    const updatedForm = existing.form.close(
      existing.form.isOwnedBy(requester.userId) ? 'OWNER' : 'ADMIN',
      now,
    );

    // AD-16 CloseForm: the close transition and the Escrow refund commit or
    // roll back together. The conditional transition runs first, so a lost
    // race never refunds.
    const saved = await this.unitOfWork.run(
      `close-refund:${id}:${closeIdentity(updatedForm.closeCount)}`,
      async () => {
        const result = await this.formRepository.update(
          updatedForm,
          undefined,
          {
            status: existing.form.status,
            updatedAt: existing.form.updatedAt,
          },
        );
        if (!result) {
          const latest = await this.formRepository.findById(id);
          throw new FormConflictException(
            id,
            existing.form.updatedAt.toISOString(),
            latest?.form.updatedAt.toISOString() ??
              existing.form.updatedAt.toISOString(),
          );
        }

        await this.escrowCoordinator?.coordinateClose(
          updatedForm,
          existing.form.publisherId,
        );
        return result;
      },
    );

    return toFormDetailDto(saved);
  }

  async transitionStatus(
    id: string,
    requester: { userId: string; role: string },
    rawDto: FormStatusTransitionInput,
  ): Promise<FormDetailDto> {
    const dto = formStatusTransitionSchema.parse(rawDto);
    if (requester.role !== 'ADMIN') {
      throw new FormForbiddenException(
        'Only administrators may use the generic form status transition endpoint.',
      );
    }

    const existing = await this.formRepository.findById(id);
    if (!existing) {
      throw new FormNotFoundException(id);
    }

    // Story 8.1: a queued survey leaves the queue only through the Admin
    // moderation workflow (decision record, refund, audit, notification).
    if (existing.form.status === 'MODERATION_QUEUE') {
      throw new FormModerationRequiredException(id);
    }

    if (existing.form.status === 'DRAFT') {
      return this.publishForm(id, requester, {
        targetStatus: dto.targetStatus,
      });
    }

    if (!existing.form.canTransitionTo(dto.targetStatus)) {
      throw new InvalidFormStatusTransitionException(
        id,
        existing.form.status,
        dto.targetStatus,
      );
    }

    // Closing always goes through the refunding close path.
    if (dto.targetStatus === 'CLOSED') {
      return this.closeForm(id, requester);
    }

    // Remaining generic move: legacy ESCROW_LOCKED -> MODERATION_QUEUE. Pre-8.1
    // rows were never validated and `autoPublish` created them without an
    // Escrow reservation, so only a publishable, fully funded row may enter
    // the queue (Epic 8 review P2). The Admin never reserves on the
    // Publisher's behalf (Epic 6 review P13): an unfunded row is closed
    // instead (the close refunds only what it holds).
    assertFormPublishable(existing.form, existing.currentVersion);
    if (this.escrowCoordinator) {
      const funding = await this.escrowCoordinator.getFundingPosition(
        existing.form,
        existing.form.publisherId,
      );
      if (funding.shortfall > 0) {
        throw new ModerationEscrowNotFundedException(id, funding.shortfall);
      }
    }
    const now = new Date();
    const updatedForm = existing.form.transitionTo(dto.targetStatus, now);

    const saved = await this.formRepository.update(updatedForm, undefined, {
      status: existing.form.status,
      updatedAt: existing.form.updatedAt,
    });
    if (!saved) {
      const latest = await this.formRepository.findById(id);
      throw new FormConflictException(
        id,
        existing.form.updatedAt.toISOString(),
        latest?.form.updatedAt.toISOString() ??
          existing.form.updatedAt.toISOString(),
      );
    }
    return toFormDetailDto(saved);
  }

  /**
   * Decision E5-D4 (strict, option A): "Create New Version" moves a live
   * survey to DRAFT at once and every respondent still taking the published
   * version is cut off (their submission / code verification is refused), so
   * the builder asks for this count first and warns the Publisher.
   * Owner or Admin only.
   */
  async getInProgressAttempts(
    id: string,
    requester: { userId: string; role: string },
  ): Promise<FormInProgressAttemptsDto> {
    const existing = await this.formRepository.findById(id);
    if (!existing) {
      throw new FormNotFoundException(id);
    }
    if (
      !existing.form.isOwnedBy(requester.userId) &&
      requester.role !== 'ADMIN'
    ) {
      throw new FormForbiddenException();
    }
    const inProgressAttempts =
      await this.formRepository.countInProgressAttempts(
        id,
        new Date(Date.now() - RESERVATION_EXPIRY_MS),
      );
    return {
      formId: id,
      status: existing.form.status,
      inProgressAttempts,
      reservationWindowMinutes: RESERVATION_EXPIRY_MINUTES,
    };
  }

  /**
   * Creates an editable DRAFT copy of a live survey (FR-18). Decision E5-D4
   * (strict): the survey leaves PUBLISHED immediately; the result reports how
   * many in-progress attempts on the previous version were cut off (counted
   * after the transition, when no attempt can start any more).
   */
  async createNewVersion(
    id: string,
    requester: { userId: string; role: string },
  ): Promise<CreateFormVersionResultDto> {
    const existing = await this.formRepository.findById(id);
    if (!existing) {
      throw new FormNotFoundException(id);
    }

    if (
      !existing.form.isOwnedBy(requester.userId) &&
      requester.role !== 'ADMIN'
    ) {
      throw new FormForbiddenException();
    }

    if (!existing.form.canCreateNewVersion()) {
      throw new FormNotPublishedException(id, existing.form.status);
    }

    const now = new Date();
    const newVersionId = randomUUID();

    const saved = await this.formRepository.createVersion(
      id,
      newVersionId,
      now,
    );
    if (!saved) {
      const latest = await this.formRepository.findById(id);
      throw new FormNotPublishedException(id, latest?.form.status ?? 'UNKNOWN');
    }
    const interruptedAttempts =
      await this.formRepository.countInProgressAttempts(
        id,
        new Date(now.getTime() - RESERVATION_EXPIRY_MS),
      );
    return { ...toFormDetailDto(saved), interruptedAttempts };
  }

  async listVersions(
    id: string,
    requester: { userId: string; role: string },
  ): Promise<FormVersionSummaryDto[]> {
    const existing = await this.formRepository.findById(id);
    if (!existing) {
      throw new FormNotFoundException(id);
    }

    if (
      !existing.form.isOwnedBy(requester.userId) &&
      requester.role !== 'ADMIN'
    ) {
      throw new FormForbiddenException();
    }

    const versions = await this.formRepository.findAllVersions(id);
    return versions.map((v) => ({
      id: v.id,
      formId: v.formId,
      versionNumber: v.versionNumber,
      isPublished: v.isPublished,
      publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
      createdAt: v.createdAt.toISOString(),
    }));
  }

  async rotateCompletionCode(
    id: string,
    requester: { userId: string; role: string },
    rawDto?: RotateCompletionCodeInput,
  ): Promise<ExternalSurveyResponseDto> {
    if (rawDto) rotateCompletionCodeSchema.parse(rawDto);

    const existing = await this.formRepository.findById(id);
    if (!existing) {
      throw new FormNotFoundException(id);
    }

    if (
      !existing.form.isOwnedBy(requester.userId) &&
      requester.role !== 'ADMIN'
    ) {
      throw new FormForbiddenException();
    }

    if (existing.form.type !== 'EXTERNAL') {
      throw new FormValidationException(
        'Completion code rotation is only applicable to external surveys.',
      );
    }

    if (existing.form.isClosed()) {
      throw new FormAlreadyClosedException(id);
    }

    const newVersionId = randomUUID();
    const plaintextCode = this.getCompletionCodePort().generateSixDigitCode();
    const verifier = this.getCompletionCodePort().computeVerifier(
      newVersionId,
      plaintextCode,
    );

    const now = new Date();
    const isPublished = existing.currentVersion.isPublished;
    // Rotation only changes the code, not the content: keep the original
    // publication time so rotating cannot re-promote the survey in "newest".
    const publishedAt = isPublished
      ? (existing.currentVersion.publishedAt ?? now)
      : null;

    const result = await this.formRepository.createVersion(
      id,
      newVersionId,
      now,
      {
        completionCode: verifier,
        isPublished,
        publishedAt,
        // Keep the status, and only if nobody changed it meanwhile (a
        // concurrent close + Escrow refund must never be reverted).
        expectedStatus: existing.form.status,
      },
    );

    if (!result) {
      const latest = await this.formRepository.findById(id);
      if (!latest) {
        throw new FormNotFoundException(id);
      }
      if (latest.form.isClosed()) {
        throw new FormAlreadyClosedException(id);
      }
      throw new FormConflictException(
        id,
        existing.form.updatedAt.toISOString(),
        latest.form.updatedAt.toISOString(),
      );
    }

    const detail = toFormDetailDto(result);
    return {
      ...detail,
      plaintextCompletionCode: plaintextCode,
      hasCompletionCode: true,
      externalUrl: result.currentVersion.externalUrl,
      currentVersionNumber: result.currentVersion.versionNumber,
    };
  }

  /**
   * Reopens a closed survey with additional sample quota, locking additional points in Escrow (FR-33).
   */
  async reopenForm(
    id: string,
    requester: { userId: string; role: string },
    rawDto: ReopenSurveyInput,
  ): Promise<FormDetailDto> {
    const dto = reopenSurveySchema.parse(rawDto);
    const existing = await this.formRepository.findById(id);
    if (!existing) {
      throw new FormNotFoundException(id);
    }

    // FR-33: reopening spends the owner's Available points on new Escrow, so
    // only the Publisher may do it — never an Admin on their behalf
    // (Epic 6 review P13).
    if (!existing.form.isOwnedBy(requester.userId)) {
      throw new FormForbiddenException(
        'Only the survey owner can reopen it with additional quota.',
      );
    }

    if (!existing.form.isClosed()) {
      throw new FormConflictException(
        id,
        existing.form.updatedAt.toISOString(),
        'Only CLOSED surveys can be reopened with additional quota.',
      );
    }

    // Decision E8-D1 (option B): Admin takedowns and moderation rejections
    // are final — only a survey its owner closed can be reopened.
    if (!existing.form.isReopenableByOwner()) {
      throw new FormNotReopenableException(id, {
        reason: 'CLOSED_BY_ADMIN_OR_MODERATION',
        closeKind: existing.form.closeKind,
      });
    }

    // Story 8.1: reopening puts the current version back on the Marketplace,
    // so it must have been approved by moderation (a rejected or withdrawn
    // submission is never published).
    if (!existing.currentVersion.isPublished) {
      throw new FormNotReopenableException(id, {
        reason: 'VERSION_NOT_APPROVED',
        closeKind: existing.form.closeKind,
      });
    }

    const now = new Date();
    const updatedExpectedCompletions =
      existing.form.expectedCompletions + dto.additionalCompletions;
    // Same cap as survey creation; also keeps the quota inside INT4 and the
    // Escrow amount inside the ledger range (Epic 6 review P12).
    if (updatedExpectedCompletions > MAX_EXPECTED_COMPLETIONS) {
      throw new FormValidationException(
        `Expected completions cannot exceed ${MAX_EXPECTED_COMPLETIONS.toLocaleString('en-US')} after reopening (currently ${existing.form.expectedCompletions}).`,
      );
    }

    const updatedForm = existing.form.copyWith({
      status: 'PUBLISHED',
      expectedCompletions: updatedExpectedCompletions,
      updatedAt: now,
      versions: existing.versions,
    });

    // AD-16: the additional Escrow lock and the reopen transition commit or
    // roll back together. One reopen per close: the key carries the close
    // identity of the close being reopened (Epic 6 review P3).
    const saved = await this.unitOfWork.run(
      `reopen-escrow:${id}:${closeIdentity(existing.form.closeCount)}`,
      async () => {
        await this.escrowCoordinator?.coordinateReopen(
          existing.form,
          existing.form.publisherId,
          dto.additionalCompletions,
        );

        const result = await this.formRepository.update(
          updatedForm,
          undefined,
          {
            status: 'CLOSED',
            updatedAt: existing.form.updatedAt,
          },
        );
        if (!result) {
          const latest = await this.formRepository.findById(id);
          throw new FormConflictException(
            id,
            existing.form.updatedAt.toISOString(),
            latest?.form.updatedAt.toISOString() ??
              existing.form.updatedAt.toISOString(),
          );
        }
        return result;
      },
    );

    return toFormDetailDto(saved);
  }

  /**
   * Returns escrow and pricing calculation quote for a form before publishing
   * (FR-14, FR-19): the Escrow cost plus the FR-14 band of the form's
   * estimated duration and what the publish-time band check would answer
   * (decision E6-D2).
   */
  async getPricingQuote(
    id: string,
    requester: { userId: string; role: string },
  ): Promise<PricingQuoteDto> {
    const existing = await this.formRepository.findById(id);
    if (!existing) {
      throw new FormNotFoundException(id);
    }

    if (
      !existing.form.isOwnedBy(requester.userId) &&
      requester.role !== 'ADMIN'
    ) {
      throw new FormForbiddenException();
    }

    const form = existing.form;
    return {
      ...calculateEscrowCost({
        type: form.type,
        expectedCompletions: form.expectedCompletions,
        rewardPerResponse: form.rewardPerResponse,
      }),
      estimatedDurationMinutes: form.estimatedDurationMinutes,
      pricingBand:
        form.estimatedDurationMinutes != null
          ? getRewardPricingRange(form.estimatedDurationMinutes)
          : null,
      bandCheck: checkPublishRewardBand(form).status,
    };
  }
}
