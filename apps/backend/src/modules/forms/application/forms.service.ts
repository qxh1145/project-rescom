import { randomUUID } from 'crypto';
import {
  closeFormSchema,
  CloseFormInput,
  CreateExternalSurveyInput,
  createExternalSurveySchema,
  CreateFormDraftInput,
  createFormDraftSchema,
  determinePublishTargetStatus,
  DraftFormDefinition,
  ExternalSurveyResponseDto,
  formDefinitionSchema,
  FormDetailDto,
  FormStatusEnum,
  formStatusTransitionSchema,
  FormStatusTransitionInput,
  FormSummaryDto,
  FormVersionDto,
  FormVersionSummaryDto,
  ListFormsQuery,
  publishFormSchema,
  PublishFormInput,
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
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';
import {
  FormAlreadyClosedException,
  FormForbiddenException,
  FormHasPublishedVersionsException,
  FormNotFoundException,
  FormNotInDraftStatusException,
  FormNotPublishedException,
  FormConflictException,
  FormValidationException,
  InvalidFormDraftException,
  InvalidFormStatusTransitionException,
  TargetingValidationException,
} from './exceptions/form.exceptions';

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
    currentVersion: toFormVersionDto(data.currentVersion),
    createdAt: data.form.createdAt.toISOString(),
    updatedAt: data.form.updatedAt.toISOString(),
  };
}

export class FormsService {
  constructor(
    private readonly formRepository: FormRepositoryPort,
    private readonly completionCodePort?: CompletionCodePort,
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
      metadata: {
        expectedEffortSeconds: 60,
        minTimeBarrierSeconds: 15,
      },
    };

    let status: FormStatusEnum;
    let isPublished = false;
    let publishedAt: Date | null = null;

    if (dto.autoPublish) {
      status = determinePublishTargetStatus({
        type: 'EXTERNAL',
        rewardPerResponse: dto.rewardPerResponse,
      });
      isPublished = status === 'PUBLISHED';
      publishedAt = isPublished ? now : null;
    } else {
      status = 'DRAFT';
      isPublished = false;
      publishedAt = null;
    }

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
    );

    const version = new FormVersionEntity(
      versionId,
      formId,
      1,
      initialSchema,
      dto.targetingJson ?? null,
      isPublished,
      dto.externalUrl,
      verifier,
      publishedAt,
      now,
    );

    const created = await this.formRepository.create(form, version);
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

    // Validate entire form JSON strictly against formDefinitionSchema
    const schemaValidation = formDefinitionSchema.safeParse(
      existing.currentVersion.schemaJson,
    );
    if (!schemaValidation.success) {
      const errorMessages = schemaValidation.error.errors
        .map((e) => `${e.path.join('.') || 'root'}: ${e.message}`)
        .join('; ');
      throw new FormValidationException(
        `Form validation failed before publishing: ${errorMessages}`,
        schemaValidation.error.errors,
      );
    }

    // External survey validation: must have externalUrl
    const effectiveExternalUrl =
      dto.externalUrl ?? existing.currentVersion.externalUrl;
    if (existing.form.type === 'EXTERNAL' && !effectiveExternalUrl) {
      throw new FormValidationException(
        'External surveys require a valid externalUrl before publishing.',
      );
    }

    // Determine target status
    let targetStatus: FormStatusEnum;
    if (dto.targetStatus) {
      if (!existing.form.canTransitionTo(dto.targetStatus)) {
        throw new InvalidFormStatusTransitionException(
          id,
          existing.form.status,
          dto.targetStatus,
        );
      }
      targetStatus = dto.targetStatus;
    } else {
      targetStatus = determinePublishTargetStatus({
        type: existing.form.type,
        rewardPerResponse: existing.form.rewardPerResponse,
      });
    }

    const now = new Date();
    const isPublishedState = targetStatus === 'PUBLISHED';

    let completionCode = existing.currentVersion.completionCode;
    if (
      existing.form.type === 'EXTERNAL' &&
      !completionCode &&
      this.completionCodePort
    ) {
      const generatedCode = this.completionCodePort.generateSixDigitCode();
      completionCode = this.completionCodePort.computeVerifier(
        existing.currentVersion.id,
        generatedCode,
      );
    }

    const updatedVersion = existing.currentVersion.copyWith({
      isPublished: isPublishedState,
      publishedAt: isPublishedState ? now : null,
      externalUrl: effectiveExternalUrl,
      completionCode,
    });

    const updatedForm = existing.form.transitionTo(targetStatus, now);

    const saved = await this.formRepository.update(
      updatedForm,
      updatedVersion,
      {
        status: 'DRAFT',
        updatedAt: existing.form.updatedAt,
      },
    );
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

    if (!existing.form.canTransitionTo('CLOSED')) {
      throw new InvalidFormStatusTransitionException(
        id,
        existing.form.status,
        'CLOSED',
      );
    }

    const now = new Date();
    const updatedForm = existing.form.transitionTo('CLOSED', now);

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

    const now = new Date();
    const isNowPublished = dto.targetStatus === 'PUBLISHED';
    let updatedVersion = existing.currentVersion;

    if (isNowPublished && !existing.currentVersion.isPublished) {
      updatedVersion = existing.currentVersion.copyWith({
        isPublished: true,
        publishedAt: now,
      });
    }

    const updatedForm = existing.form.transitionTo(dto.targetStatus, now);

    const saved = await this.formRepository.update(
      updatedForm,
      isNowPublished ? updatedVersion : undefined,
      {
        status: existing.form.status,
        updatedAt: existing.form.updatedAt,
      },
    );
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

  async createNewVersion(
    id: string,
    requester: { userId: string; role: string },
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
    return toFormDetailDto(saved);
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
    const publishedAt = isPublished ? now : null;

    const result = await this.formRepository.createVersion(
      id,
      newVersionId,
      now,
      {
        completionCode: verifier,
        isPublished,
        publishedAt,
        targetStatus: existing.form.status,
      },
    );

    if (!result) {
      throw new FormNotFoundException(id);
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
}
