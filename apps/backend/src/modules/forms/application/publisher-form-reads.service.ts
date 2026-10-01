import {
  EXTERNAL_COMPLETION_REVIEW_HOURS,
  publisherProgressWindow,
  publisherFormVersionDetailSchema,
  PublisherFormVersionDetailDto,
  PublisherProgressDto,
  PublisherProgressRange,
  toCompletionsSeries,
} from '@rescom/schemas';
import {
  FormRepositoryPort,
  FormWithVersion,
} from './ports/form-repository.port';
import { FormsEscrowCoordinator } from './forms-escrow.coordinator';
import {
  FormNotFoundException,
  FormVersionNotFoundException,
} from './exceptions/form.exceptions';

const REVIEW_WINDOW_MS = EXTERNAL_COMPLETION_REVIEW_HOURS * 3_600_000;

/**
 * Story IR.4a (FR-39, AD-16 Research-owned reads): the Publisher's progress
 * of one survey and the read-only detail of one of its versions. Owner only:
 * anybody else — an Admin included (decision Q4, no audited admin read
 * exists) — gets 404 `FORM_NOT_FOUND`, so the form's existence never leaks.
 * Read-only: no write happens here.
 */
export class PublisherFormReadsService {
  constructor(
    private readonly formRepository: FormRepositoryPort,
    private readonly escrowCoordinator?: FormsEscrowCoordinator,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async ownedForm(
    id: string,
    requesterId: string,
  ): Promise<FormWithVersion> {
    const record = await this.formRepository.findById(id);
    if (!record || !record.form.isOwnedBy(requesterId)) {
      throw new FormNotFoundException(id);
    }
    return record;
  }

  /**
   * `GET /forms/:id/progress?range=`. `completed` and `escrowRemaining` come
   * from the same reads as `GET /forms/:id` (`completedCompletions`,
   * `escrowLocked`); a free, DRAFT or queued survey returns zeros.
   */
  async getProgress(
    id: string,
    requester: { userId: string },
    range: PublisherProgressRange,
  ): Promise<PublisherProgressDto> {
    const { form } = await this.ownedForm(id, requester.userId);
    const now = this.clock();
    const window = publisherProgressWindow(range, now);

    // The completions are read once and reused for the Escrow position.
    const completions = await this.formRepository.listRewardableCompletions(
      form.id,
    );
    const [escrow, counts, pendingAttempts] = await Promise.all([
      this.escrowCoordinator
        ? this.escrowCoordinator.getProgressEscrow(form, completions)
        : Promise.resolve({ held: 0, spent: 0 }),
      this.formRepository.countCompletionsInBuckets(form.id, window),
      form.type === 'EXTERNAL'
        ? this.formRepository.countExternalCompletionsSince(
            form.id,
            new Date(now.getTime() - REVIEW_WINDOW_MS),
          )
        : Promise.resolve(null),
    ]);

    return {
      formId: form.id,
      status: form.status,
      completed: completions.completedCount,
      expected: form.expectedCompletions,
      pointsSpent: escrow.spent,
      escrowRemaining: escrow.held,
      deadlineAt: form.deadlineAt ? form.deadlineAt.toISOString() : null,
      pendingAttempts,
      completionsSeries: toCompletionsSeries(range, window, counts),
    };
  }

  /**
   * `GET /forms/:id/versions/:versionId` (decision Q3): one version with its
   * stored definition, by explicit projection — never `completionCode` or
   * `targetingJson`.
   */
  async getVersionDetail(
    id: string,
    versionId: string,
    requester: { userId: string },
  ): Promise<PublisherFormVersionDetailDto> {
    const { form } = await this.ownedForm(id, requester.userId);
    const versions = await this.formRepository.findAllVersions(form.id);
    const version = versions.find((item) => item.id === versionId);
    if (!version) throw new FormVersionNotFoundException();
    const definition = version.schemaJson as unknown as Record<string, unknown>;
    // A draft may hold incomplete blocks: only blocks with a string id and
    // type are returned, so the response always parses with the contract.
    const blocks = (
      Array.isArray(definition?.blocks) ? definition.blocks : []
    ).filter(
      (block): block is { id: string; type: string } =>
        typeof block === 'object' &&
        block !== null &&
        typeof (block as { id?: unknown }).id === 'string' &&
        typeof (block as { type?: unknown }).type === 'string',
    );
    return publisherFormVersionDetailSchema.parse({
      id: version.id,
      formId: version.formId,
      versionNumber: version.versionNumber,
      isPublished: version.isPublished,
      publishedAt: version.publishedAt
        ? version.publishedAt.toISOString()
        : null,
      createdAt: version.createdAt.toISOString(),
      externalUrl: version.externalUrl ?? null,
      schemaJson: { ...definition, blocks },
    });
  }
}
