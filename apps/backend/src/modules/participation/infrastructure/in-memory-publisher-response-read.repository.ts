import { ResponseEntity } from '../domain/response.entity';
import {
  PublisherAnswerRow,
  PublisherResponseReadPort,
  PublisherResponseReadRow,
  ResponseFeedPosition,
} from '../application/ports/publisher-response-read.port';
import { InMemoryParticipationRepository } from './in-memory-participation.repository';

/** Newest first: `submittedAt DESC, id DESC` (the Prisma feed order). */
function newestFirst(a: ResponseEntity, b: ResponseEntity): number {
  const byTime =
    (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0);
  if (byTime !== 0) return byTime;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function isAfter(response: ResponseEntity, after?: ResponseFeedPosition) {
  if (!after || !response.submittedAt) return true;
  const time = response.submittedAt.getTime();
  const at = after.submittedAt.getTime();
  return time < at || (time === at && response.id < after.id);
}

/**
 * In-memory twin of `PrismaPublisherResponseReadRepository` for unit tests and
 * e2e overrides: reads the Responses and attempts of an
 * `InMemoryParticipationRepository`, with the same filter and order.
 */
export class InMemoryPublisherResponseReadRepository implements PublisherResponseReadPort {
  constructor(
    private readonly participation: InMemoryParticipationRepository,
  ) {}

  private listed(formVersionId: string): ResponseEntity[] {
    return Array.from(this.participation.responses.values())
      .filter(
        (response) =>
          response.formVersionId === formVersionId &&
          response.isCompleted() &&
          response.submittedAt !== null,
      )
      .sort(newestFirst);
  }

  async countListed(formVersionId: string): Promise<number> {
    return this.listed(formVersionId).length;
  }

  async listPage(params: {
    formVersionId: string;
    after?: ResponseFeedPosition;
    limit: number;
  }): Promise<PublisherResponseReadRow[]> {
    return this.listed(params.formVersionId)
      .filter((response) => isAfter(response, params.after))
      .slice(0, params.limit)
      .map((response) => ({
        id: response.id,
        formVersionId: response.formVersionId,
        submittedAt: response.submittedAt as Date,
        answers: response.answersJson,
        attemptStartedAt: response.attemptId
          ? (this.participation.attempts.get(response.attemptId)?.startedAt ??
            null)
          : null,
      }));
  }

  async versionIdsWithListedResponses(formId: string): Promise<string[]> {
    const ids = new Set<string>();
    for (const response of this.participation.responses.values()) {
      if (
        response.formId === formId &&
        response.isCompleted() &&
        response.submittedAt !== null
      ) {
        ids.add(response.formVersionId);
      }
    }
    return [...ids];
  }

  async listAnswerBatch(params: {
    formVersionId: string;
    after?: ResponseFeedPosition;
    limit: number;
  }): Promise<PublisherAnswerRow[]> {
    const page = await this.listPage(params);
    return page.map((row) => ({
      id: row.id,
      submittedAt: row.submittedAt,
      answers: row.answers,
    }));
  }
}
