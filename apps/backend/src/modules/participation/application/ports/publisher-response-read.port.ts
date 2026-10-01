export const PUBLISHER_RESPONSE_READ_PORT = Symbol(
  'PUBLISHER_RESPONSE_READ_PORT',
);

/** Keyset position of the responses feed (`submitted_at DESC, id DESC`). */
export interface ResponseFeedPosition {
  submittedAt: Date;
  id: string;
}

/**
 * One listed Response, explicit columns only (AD-18): never the respondent,
 * the IP, the guest flag, the client context or any integrity data.
 */
export interface PublisherResponseReadRow {
  id: string;
  formVersionId: string;
  submittedAt: Date;
  /** Raw `answers_json`; the service projects it. */
  answers: unknown;
  /** Start of the Response's attempt; null without one (guest response). */
  attemptStartedAt: Date | null;
}

/** The analytics batch read: only `id, submitted_at, answers_json`. */
export interface PublisherAnswerRow {
  id: string;
  submittedAt: Date;
  answers: unknown;
}

/**
 * Story IR.4a (AD-16): Participation-owned reads of the Responses listed to a
 * Publisher — SUBMITTED/VALIDATED Responses of ONE FormVersion (IN_PROGRESS,
 * DISPUTED and REJECTED are never listed), newest first. Read-only, every
 * read bounded by one version and a page limit.
 */
export interface PublisherResponseReadPort {
  /** Listed Responses of the version (all pages). */
  countListed(formVersionId: string): Promise<number>;

  /** Up to `limit` listed rows after `after` (exclusive), newest first. */
  listPage(params: {
    formVersionId: string;
    after?: ResponseFeedPosition;
    limit: number;
  }): Promise<PublisherResponseReadRow[]>;

  /** Version ids of the form that have at least one listed Response. */
  versionIdsWithListedResponses(formId: string): Promise<string[]>;

  /** Analytics keyset batch: like `listPage` without the attempt join. */
  listAnswerBatch(params: {
    formVersionId: string;
    after?: ResponseFeedPosition;
    limit: number;
  }): Promise<PublisherAnswerRow[]>;
}
