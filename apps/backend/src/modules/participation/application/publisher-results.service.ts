import { createHash } from 'crypto';
import {
  aggregateFormAnalytics,
  decodePublisherResponsesCursor,
  encodePublisherResponsesCursor,
  PUBLISHER_ANALYTICS_MAX_RESPONSES,
  PublisherAnalyticsDto,
  PublisherResponseAnswerValue,
  PublisherResponseQuestion,
  PublisherResponseRow,
  PublisherResponsesPage,
  projectPublisherAnswers,
  toPublisherQuestions,
} from '@rescom/schemas';
import {
  FormRepositoryPort,
  FormWithVersion,
} from '../../forms/application/ports/form-repository.port';
import { FormVersionEntity } from '../../forms/domain/form-version.entity';
import {
  FormNotFoundException,
  FormVersionNotFoundException,
  InvalidResultsCursorException,
  PublisherAnalyticsLimitExceededException,
} from '../../forms/application/exceptions/form.exceptions';
import {
  PublisherResponseReadPort,
  ResponseFeedPosition,
} from './ports/publisher-response-read.port';

/** Keyset batch size of the analytics scan (AC4, NFR-30). */
export const PUBLISHER_ANALYTICS_BATCH_SIZE = 500;

/**
 * Per-response pseudonym (decision Q2): the first 6 hex characters of a
 * namespaced SHA-256 of the Response id, upper-cased. Derived from the
 * Response alone, so it cannot be linked across forms or to a respondent.
 */
export function responseDisplayCode(responseId: string): string {
  return createHash('sha256')
    .update(`rescom-response-code:v1:${responseId}`)
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();
}

/**
 * Explicit answer projection (AD-18): the shared `projectPublisherAnswers`,
 * also used by MSW (only the pinned version's question keys; file answers
 * become file names).
 */
export const projectAnswers = projectPublisherAnswers;

function durationSeconds(submittedAt: Date, startedAt: Date | null) {
  if (!startedAt) return null;
  return Math.max(
    0,
    Math.round((submittedAt.getTime() - startedAt.getTime()) / 1000),
  );
}

/**
 * Story IR.4a (FR-40, AD-16 Participation-owned): the Responses of one pinned
 * version of a Publisher's survey, and their per-question summary. Owner only
 * — anybody else, an Admin included (decision Q4), gets 404
 * `FORM_NOT_FOUND`. Google Forms surveys get an explicit `NOT_APPLICABLE`
 * result: their answers stay in Google. Read-only.
 */
export class PublisherResultsService {
  constructor(
    private readonly formRepository: FormRepositoryPort,
    private readonly responses: PublisherResponseReadPort,
    private readonly analyticsMaxResponses = PUBLISHER_ANALYTICS_MAX_RESPONSES,
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

  private notApplicable(record: FormWithVersion) {
    return {
      availability: 'NOT_APPLICABLE' as const,
      reason: 'EXTERNAL_FORM' as const,
      form: {
        id: record.form.id,
        title: record.form.title,
        type: 'EXTERNAL' as const,
        externalUrl: record.currentVersion.externalUrl ?? null,
      },
    };
  }

  /**
   * AC3.2: `versionNumber` when given (404 `FORM_VERSION_NOT_FOUND` if
   * unknown); otherwise the newest version with a listed Response, else the
   * newest published version, else the newest version.
   */
  private async selectVersion(
    record: FormWithVersion,
    versionNumber?: number,
  ): Promise<FormVersionEntity> {
    const formId = record.form.id;
    // `findById` already loaded every version: no second read per page.
    const versions =
      record.versions ?? (await this.formRepository.findAllVersions(formId));
    if (versionNumber !== undefined) {
      const version = versions.find(
        (item) => item.versionNumber === versionNumber,
      );
      if (!version) throw new FormVersionNotFoundException();
      return version;
    }
    const newestFirst = [...versions].sort(
      (a, b) => b.versionNumber - a.versionNumber,
    );
    const withResponses = new Set(
      await this.responses.versionIdsWithListedResponses(formId),
    );
    const version =
      newestFirst.find((item) => withResponses.has(item.id)) ??
      newestFirst.find((item) => item.isPublished) ??
      newestFirst[0];
    if (!version) throw new FormVersionNotFoundException();
    return version;
  }

  private availableForm(record: FormWithVersion, version: FormVersionEntity) {
    return {
      id: record.form.id,
      title: record.form.title,
      type: 'INTERNAL' as const,
      versionId: version.id,
      versionNumber: version.versionNumber,
    };
  }

  private questionsOf(version: FormVersionEntity): PublisherResponseQuestion[] {
    const blocks = (version.schemaJson as { blocks?: unknown } | null)?.blocks;
    return toPublisherQuestions(Array.isArray(blocks) ? blocks : []);
  }

  /** `GET /forms/:id/responses`: one keyset page of one version (AC3). */
  async getResponsesPage(
    formId: string,
    requester: { userId: string },
    query: { versionNumber?: number; cursor?: string; limit: number },
  ): Promise<PublisherResponsesPage> {
    const record = await this.ownedForm(formId, requester.userId);
    if (record.form.type === 'EXTERNAL') return this.notApplicable(record);

    const version = await this.selectVersion(record, query.versionNumber);
    let after: ResponseFeedPosition | undefined;
    if (query.cursor !== undefined) {
      const cursor = decodePublisherResponsesCursor(query.cursor);
      if (!cursor || cursor.versionId !== version.id) {
        throw new InvalidResultsCursorException();
      }
      after = { submittedAt: new Date(cursor.submittedAt), id: cursor.id };
    }

    const questions = this.questionsOf(version);
    const [totalCount, rows] = await Promise.all([
      this.responses.countListed(version.id),
      this.responses.listPage({
        formVersionId: version.id,
        after,
        limit: query.limit + 1,
      }),
    ]);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    const responses: PublisherResponseRow[] = page.map((row) => ({
      id: row.id,
      code: responseDisplayCode(row.id),
      formVersionId: row.formVersionId,
      submittedAt: row.submittedAt.toISOString(),
      durationSeconds: durationSeconds(row.submittedAt, row.attemptStartedAt),
      integrity: { applicability: 'NOT_ASSESSED' },
      answers: projectAnswers(row.answers, questions),
    }));

    return {
      availability: 'AVAILABLE',
      form: this.availableForm(record, version),
      questions,
      responses,
      totalCount,
      nextCursor:
        rows.length > query.limit && last
          ? encodePublisherResponsesCursor({
              versionId: version.id,
              submittedAt: last.submittedAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  /**
   * `GET /forms/:id/analytics` (decision Q1, AC4): an index-backed count
   * first (422 above the cap), then keyset batches of `id, submitted_at,
   * answers_json` of that one version, aggregated by the shared aggregator.
   */
  async getAnalytics(
    formId: string,
    requester: { userId: string },
    query: { versionNumber?: number },
  ): Promise<PublisherAnalyticsDto> {
    const record = await this.ownedForm(formId, requester.userId);
    if (record.form.type === 'EXTERNAL') return this.notApplicable(record);

    const version = await this.selectVersion(record, query.versionNumber);
    const total = await this.responses.countListed(version.id);
    if (total > this.analyticsMaxResponses) {
      throw new PublisherAnalyticsLimitExceededException(
        total,
        this.analyticsMaxResponses,
      );
    }

    const questions = this.questionsOf(version);
    const rows: Array<{
      id: string;
      submittedAt: string;
      answers: Record<string, PublisherResponseAnswerValue>;
    }> = [];
    let after: ResponseFeedPosition | undefined;
    // Scan exactly the counted rows (newest first): a row submitted between
    // the count and the scan is left out, so `totalResponses` always equals
    // the count and never exceeds the cap.
    while (rows.length < total) {
      const limit = Math.min(
        PUBLISHER_ANALYTICS_BATCH_SIZE,
        total - rows.length,
      );
      const batch = await this.responses.listAnswerBatch({
        formVersionId: version.id,
        after,
        limit,
      });
      for (const row of batch) {
        rows.push({
          id: row.id,
          submittedAt: row.submittedAt.toISOString(),
          answers: projectAnswers(row.answers, questions),
        });
      }
      if (batch.length < limit) break;
      const last = batch[batch.length - 1];
      after = { submittedAt: last.submittedAt, id: last.id };
    }

    return {
      availability: 'AVAILABLE',
      form: this.availableForm(record, version),
      ...aggregateFormAnalytics(questions, rows),
    };
  }
}
