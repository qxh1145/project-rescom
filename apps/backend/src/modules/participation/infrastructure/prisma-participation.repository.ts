import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  SurveyAttemptEntity,
  AttemptCloseReason,
  AttemptStatus,
  MAX_COMPLETION_CODE_FAILURES,
  MAX_COMPLETION_CODE_FAILURES_PER_ACCOUNT_VERSION,
} from '../domain/survey-attempt.entity';
import { ResponseEntity, ResponseStatus } from '../domain/response.entity';
import { IntegrityEventEntity } from '../domain/integrity-event.entity';
import {
  CancelAttemptParams,
  CancelAttemptResult,
  CreateAttemptWithResponseParams,
  ParticipationRepositoryPort,
  QuotaStatus,
  ReserveAttemptParams,
  ReserveAttemptResult,
  SubmitInternalResponseTransactionParams,
  SubmitInternalResponseTransactionResult,
  CompleteExternalAttemptTransactionParams,
  CompleteExternalAttemptResult,
  CompletionLimitCheck,
  FraudLogType,
  InternalRewardRequest,
  MissingCodeReportEvidence,
  ResetCompletionCodeFailuresParams,
} from '../application/ports/participation-repository.port';
import {
  currentClient,
  runInTransaction,
} from '../../../common/database/prisma-unit-of-work';
import {
  COMPLETED_RESPONSE_STATUSES,
  countCompletionsByFormIds,
} from '../../../common/database/completion-counts';
import { UncleanAttachmentException } from '../application/exceptions/participation.exceptions';
import { COMPLETION_CODE_POLICY_VERSION } from '@rescom/schemas';

type ParticipationClient = Prisma.TransactionClient;

/** Epic 5 review P1: partial unique indexes (migration-only, see schema). */
const ONE_ACTIVE_PER_ACCOUNT_INDEX = 'survey_attempts_one_active_per_account';
const ONE_COMPLETION_PER_ACCOUNT_INDEX =
  'survey_attempts_one_completion_per_account';

/** P2002 details (Prisma reports the constraint name, columns or fields). */
function uniqueViolationTargets(error: unknown): string[] | null {
  if (
    !error ||
    typeof error !== 'object' ||
    (error as { code?: unknown }).code !== 'P2002'
  ) {
    return null;
  }
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  const targets = Array.isArray(target) ? target.map(String) : [String(target)];
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? [...targets, message] : targets;
}

/**
 * P2002 on one of the account-level attempt indexes (`indexName`, or the
 * `(respondent_id, survey_id)` columns — both partial indexes share them, so
 * the caller's write tells them apart).
 */
function isAttemptAccountViolation(error: unknown, indexName: string): boolean {
  const targets = uniqueViolationTargets(error);
  if (!targets) return false;
  return targets.some(
    (value) =>
      value.includes(indexName) ||
      value.includes('respondent_id') ||
      value.includes('respondentId'),
  );
}

/** P2002 on the Outbox idempotency key (a concurrent writer won). */
function isOutboxKeyViolation(error: unknown): boolean {
  const targets = uniqueViolationTargets(error);
  if (!targets) return false;
  return targets.some(
    (value) =>
      value.includes('idempotency_key') || value.includes('idempotencyKey'),
  );
}

/**
 * Epic 5 review (post-review follow-up): replaces each file answer's
 * client-supplied `fileName`/`fileSize`/`mimeType` with the verified
 * `stored_objects` values, so the stored answers cannot be spoofed.
 */
function withStoredFileMetadata(
  answers: Record<string, unknown>,
  attachments: Array<{ objectId: string; questionId: string }>,
  stored: Array<{
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  }>,
): Record<string, unknown> {
  const byId = new Map(stored.map((object) => [object.id, object]));
  const questionIds = new Set(attachments.map((a) => a.questionId));
  const result: Record<string, unknown> = { ...answers };
  for (const questionId of questionIds) {
    const files = answers[questionId];
    if (!Array.isArray(files)) continue;
    result[questionId] = files.map((file) => {
      const objectId = (file as { objectId?: unknown })?.objectId;
      const object =
        typeof objectId === 'string' ? byId.get(objectId) : undefined;
      return object
        ? {
            objectId: object.id,
            fileName: object.fileName,
            fileSize: object.fileSize,
            mimeType: object.mimeType,
            status: 'CLEAN',
          }
        : file;
    });
  }
  return result;
}

/** Rolls a submit transaction back and maps it to an outcome. */
class SubmitRollback extends Error {
  constructor(
    readonly outcome:
      'ALREADY_SUBMITTED' | 'NOT_SUBMITTABLE' | 'ALREADY_COMPLETED_LOGICAL',
  ) {
    super(outcome);
  }
}

/**
 * Epic 6 review P6: reads the form's status under its row lock inside a
 * completion transaction. Closing takes the row lock with its conditional
 * UPDATE, so an in-flight completion and a close serialize: a completion
 * that commits first is seen by the close refund, one that waits sees
 * CLOSED. Plan 2.3: the lock is `FOR NO KEY UPDATE` (was `FOR SHARE`), so
 * completions of one survey serialize too — the one that meets the sample
 * target counts every earlier completion and closes the survey (QUOTA) in
 * its own transaction without upgrading a shared lock (no deadlock).
 */
async function isFormOpenForCompletion(
  tx: { $queryRaw: (...args: any[]) => Promise<unknown> },
  formId: string,
): Promise<boolean> {
  const rows = (await tx.$queryRaw`
    SELECT status FROM forms WHERE id = ${formId}::uuid FOR NO KEY UPDATE
  `) as Array<{ status: string }>;
  return rows[0]?.status === 'PUBLISHED';
}

/**
 * Epic 8 review P3 (FR-46): the user's completion lock, a transaction-scoped
 * advisory lock. It is taken FIRST in every completion transaction, before
 * the `forms` row lock and the attempt row `FOR UPDATE`, so parallel
 * completions of one user serialize on it without lock-order inversions.
 * Re-entrant: taking it again in the same transaction returns immediately.
 */
async function lockCompletionsOf(
  tx: { $queryRaw: (...args: any[]) => Promise<unknown> },
  userId: string,
): Promise<void> {
  // `pg_advisory_xact_lock` returns void: select a constant from it instead.
  await tx.$queryRaw`
    SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`participation-completions:${userId}`}, 0))
  `;
}

/**
 * Epic 8 review P3: the user's completion times in the rolling window
 * (`submittedAt > now - window`), oldest first, read under the completion
 * lock — returned only when their count reached the limit, else null.
 */
async function completionTimesOverLimitWith(
  client: ParticipationClient,
  check: CompletionLimitCheck,
): Promise<Date[] | null> {
  const since = new Date(check.now.getTime() - check.windowSeconds * 1000);
  const rows = await client.surveyAttempt.findMany({
    where: {
      respondentId: check.userId,
      status: 'COMPLETED',
      submittedAt: { gt: since },
    },
    select: { submittedAt: true },
    orderBy: { submittedAt: 'asc' },
    // Bounded read, like `findCompletionTimesSince`.
    take: 1000,
  });
  const times = rows
    .map((row) => row.submittedAt)
    .filter((value): value is Date => value instanceof Date);
  return times.length >= check.limit ? times : null;
}

/**
 * Decision E8-D6: the user's completions in the rolling window and their open
 * attempts (unexpired IN_PROGRESS on any form), oldest first, read under the
 * completion lock at attempt start — returned only when together they reached
 * the limit, else null.
 */
async function startCapacityOverLimitWith(
  client: ParticipationClient,
  check: CompletionLimitCheck,
  cutoffDate: Date,
): Promise<{ completionTimes: Date[]; openAttemptStartTimes: Date[] } | null> {
  const since = new Date(check.now.getTime() - check.windowSeconds * 1000);
  const [completed, open] = await Promise.all([
    client.surveyAttempt.findMany({
      where: {
        respondentId: check.userId,
        status: 'COMPLETED',
        submittedAt: { gt: since },
      },
      select: { submittedAt: true },
      orderBy: { submittedAt: 'asc' },
      take: 1000,
    }),
    client.surveyAttempt.findMany({
      where: {
        respondentId: check.userId,
        status: 'IN_PROGRESS',
        startedAt: { gte: cutoffDate },
      },
      select: { startedAt: true },
      orderBy: { startedAt: 'asc' },
      take: 1000,
    }),
  ]);
  const completionTimes = completed
    .map((row) => row.submittedAt)
    .filter((value): value is Date => value instanceof Date);
  const openAttemptStartTimes = open.map((row) => row.startedAt);
  return completionTimes.length + openAttemptStartTimes.length >= check.limit
    ? { completionTimes, openAttemptStartTimes }
    : null;
}

/**
 * Decision E5-D1: the account's counted wrong completion codes on one
 * FormVersion = SUM(failed_code_verifications) over its attempts minus the
 * wrong codes an Admin forgave (append-only resets), never below 0.
 */
async function countCompletionCodeFailuresWith(
  client: ParticipationClient,
  respondentId: string,
  formVersionId: string,
): Promise<number> {
  const [attempts, resets] = await Promise.all([
    client.surveyAttempt.aggregate({
      where: { respondentId, formVersionId },
      _sum: { failedCodeVerifications: true },
    }),
    client.completionCodeLimitReset.aggregate({
      where: { respondentId, formVersionId },
      _sum: { failuresForgiven: true },
    }),
  ]);
  const failed = attempts._sum.failedCodeVerifications ?? 0;
  const forgiven = resets._sum.failuresForgiven ?? 0;
  return Math.max(0, failed - forgiven);
}

const POLICY_MODES = ['SHADOW', 'ADVISORY', 'ENFORCED'] as const;

function toAttemptEntity(raw: any): SurveyAttemptEntity {
  return new SurveyAttemptEntity(
    raw.id,
    raw.surveyId,
    raw.formVersionId,
    raw.respondentId,
    raw.status as AttemptStatus,
    raw.isGuest,
    raw.startedAt,
    raw.submittedAt,
    (raw.clientContext as Record<string, unknown> | null) ?? null,
    raw.createdAt,
    raw.updatedAt,
    {
      // Epic 5 review P2: server-owned columns only, never clientContext.
      failedCount:
        typeof raw.failedCodeVerifications === 'number'
          ? raw.failedCodeVerifications
          : 0,
      lastFailedAt: raw.lastFailedVerificationAt ?? null,
      missingCodeReportedAt: raw.missingCodeReportedAt ?? null,
      missingCodeReason: raw.missingCodeReason ?? null,
    },
    (raw.closedReason as AttemptCloseReason | null) ?? null,
    raw.closedAt ?? null,
  );
}

/**
 * FR-25/AD-19: a SUBMITTED/VALIDATED Response or a COMPLETED attempt of the
 * account on the logical Form (optionally other than `excludeAttemptId`).
 */
async function hasCompletedLogicalFormWith(
  client: ParticipationClient,
  respondentId: string,
  formId: string,
  excludeAttemptId?: string,
): Promise<boolean> {
  const completedResponse = await client.response.findFirst({
    where: {
      respondentId,
      formId,
      status: { in: [...COMPLETED_RESPONSE_STATUSES] },
      // NULL-safe: `NOT attempt_id = $1` would skip attempt-less responses.
      ...(excludeAttemptId
        ? {
            OR: [{ attemptId: null }, { attemptId: { not: excludeAttemptId } }],
          }
        : {}),
    },
    select: { id: true },
  });
  if (completedResponse) return true;

  const completedAttempt = await client.surveyAttempt.findFirst({
    where: {
      respondentId,
      surveyId: formId,
      status: 'COMPLETED',
      ...(excludeAttemptId ? { NOT: { id: excludeAttemptId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(completedAttempt);
}

async function findConflictingActiveAttemptWith(
  client: ParticipationClient,
  respondentId: string,
  formId: string,
  cutoffDate: Date,
) {
  return client.surveyAttempt.findFirst({
    where: {
      respondentId,
      surveyId: formId,
      status: 'IN_PROGRESS',
      startedAt: { gte: cutoffDate },
    },
  });
}

/**
 * Lazy expiry (Epic 5 DF7): the respondent's expired IN_PROGRESS attempts on
 * the form become ABANDONED with closed reason EXPIRED (Story IR.2a).
 */
async function abandonExpiredAttemptsWith(
  client: ParticipationClient,
  respondentId: string,
  formId: string,
  cutoffDate: Date,
  closedAt: Date = new Date(),
): Promise<number> {
  const result = await client.surveyAttempt.updateMany({
    where: {
      respondentId,
      surveyId: formId,
      status: 'IN_PROGRESS',
      startedAt: { lt: cutoffDate },
    },
    data: { status: 'ABANDONED', closedReason: 'EXPIRED', closedAt },
  });
  // The Response of an abandoned attempt follows it (attempt-authoritative).
  await client.response.updateMany({
    where: {
      status: 'IN_PROGRESS',
      attempt: {
        respondentId,
        surveyId: formId,
        status: 'ABANDONED',
        closedReason: 'EXPIRED',
        closedAt,
      },
    },
    data: { status: 'ABANDONED' },
  });
  return result.count;
}

/**
 * Quota usage: completed participations (the shared definition of
 * `countCompletionsByFormIds`, Epic 4 P3) + unexpired IN_PROGRESS attempts.
 */
async function getQuotaStatusWith(
  client: ParticipationClient,
  formId: string,
  cutoffDate: Date,
): Promise<QuotaStatus> {
  const [completed, activeReservationCount] = await Promise.all([
    countCompletionsByFormIds(client, [formId]),
    client.surveyAttempt.count({
      where: {
        surveyId: formId,
        status: 'IN_PROGRESS',
        startedAt: { gte: cutoffDate },
      },
    }),
  ]);
  return {
    completedCount: completed.get(formId) ?? 0,
    activeReservationCount,
  };
}

async function createAttemptRows(
  client: ParticipationClient,
  params: CreateAttemptWithResponseParams,
): Promise<{ attempt: SurveyAttemptEntity; response: ResponseEntity | null }> {
  const createdAttempt = await client.surveyAttempt.create({
    data: {
      id: params.attemptId,
      surveyId: params.formId,
      formVersionId: params.formVersionId,
      respondentId: params.respondentId,
      status: 'IN_PROGRESS',
      isGuest: params.isGuest,
      startedAt: params.startedAt,
      clientContext: params.clientContext
        ? (params.clientContext as Prisma.InputJsonValue)
        : undefined,
    },
  });

  let createdResponse: any = null;
  if (params.formType === 'INTERNAL') {
    createdResponse = await client.response.create({
      data: {
        formId: params.formId,
        formVersionId: params.formVersionId,
        attemptId: createdAttempt.id,
        respondentId: params.respondentId,
        status: 'IN_PROGRESS',
        ipAddress: params.ipAddress,
        isGuest: params.isGuest,
      },
    });
  }

  return {
    attempt: toAttemptEntity(createdAttempt),
    response: createdResponse ? toResponseEntity(createdResponse) : null,
  };
}

function toResponseEntity(raw: any): ResponseEntity {
  return new ResponseEntity(
    raw.id,
    raw.formId,
    raw.formVersionId,
    raw.attemptId,
    raw.respondentId,
    raw.status as ResponseStatus,
    (raw.answersJson as Record<string, unknown> | null) ?? null,
    raw.ipAddress,
    raw.isGuest,
    raw.submittedAt,
    raw.createdAt,
    raw.updatedAt,
  );
}

@Injectable()
export class PrismaParticipationRepository implements ParticipationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async hasCompletedLogicalForm(
    respondentId: string,
    formId: string,
  ): Promise<boolean> {
    return hasCompletedLogicalFormWith(
      currentClient(this.prisma),
      respondentId,
      formId,
    );
  }

  async findConflictingActiveAttempt(
    respondentId: string,
    formId: string,
    cutoffDate: Date,
  ): Promise<SurveyAttemptEntity | null> {
    const attempt = await findConflictingActiveAttemptWith(
      currentClient(this.prisma),
      respondentId,
      formId,
      cutoffDate,
    );
    return attempt ? toAttemptEntity(attempt) : null;
  }

  async abandonExpiredAttempts(
    respondentId: string,
    formId: string,
    cutoffDate: Date,
  ): Promise<number> {
    // Attempt and Response updates commit together (joins an ambient UoW).
    return runInTransaction(this.prisma, (tx) =>
      abandonExpiredAttemptsWith(tx, respondentId, formId, cutoffDate),
    );
  }

  async abandonExpiredAttemptsBatch(
    cutoff: Date,
    limit: number,
    now: Date,
  ): Promise<{ abandonedIds: string[] }> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      WITH due AS (
        SELECT id FROM survey_attempts
        WHERE status = 'IN_PROGRESS' AND started_at < ${cutoff}
        ORDER BY started_at, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED),
      closed AS (
        UPDATE survey_attempts sa
           SET status = 'ABANDONED',
               closed_reason = 'EXPIRED',
               closed_at = ${now},
               updated_at = ${now}
          FROM due
         WHERE sa.id = due.id AND sa.status = 'IN_PROGRESS'
        RETURNING sa.id),
      responses_closed AS (
        UPDATE responses r
           SET status = 'ABANDONED', updated_at = ${now}
          FROM closed
         WHERE r.attempt_id = closed.id AND r.status = 'IN_PROGRESS'
        RETURNING r.id)
      SELECT closed.id::text AS id FROM closed
    `;
    return { abandonedIds: rows.map((row) => row.id) };
  }

  async getQuotaStatus(formId: string, cutoffDate: Date): Promise<QuotaStatus> {
    return getQuotaStatusWith(currentClient(this.prisma), formId, cutoffDate);
  }

  /**
   * Epic 5 review P1: the form row lock (`FOR NO KEY UPDATE`) serializes
   * every start of the form — and the close's conditional UPDATE and the
   * completions' row lock (Epic 6 review P6) — so the re-checks below and
   * the insert are atomic. `NO KEY` does not block FK inserts on the form
   * (guest responses, attempts of other forms). The partial unique indexes
   * catch anything that bypasses this path.
   */
  async reserveAttempt(
    params: ReserveAttemptParams,
  ): Promise<ReserveAttemptResult> {
    try {
      return await runInTransaction(this.prisma, async (tx) => {
        // Decision E8-D6: the user's completion lock first (the lock order of
        // every completion transaction), so the reservation count below and
        // the insert cannot be raced by the user's other starts/completions.
        if (params.completionReservation) {
          await lockCompletionsOf(tx, params.completionReservation.userId);
        }
        const forms = (await tx.$queryRaw`
          SELECT status, close_kind, deadline_at FROM forms WHERE id = ${params.formId}::uuid FOR NO KEY UPDATE
        `) as Array<{
          status: string;
          close_kind: string | null;
          deadline_at: Date | null;
        }>;
        const form = forms[0];
        // Plan 2.3: a survey closed because its sample target was met is
        // "full" for the respondent, not "unavailable".
        if (form?.status === 'CLOSED' && form.close_kind === 'QUOTA') {
          return { outcome: 'QUOTA_FULL' as const };
        }
        if (form?.status !== 'PUBLISHED') {
          return { outcome: 'NOT_OPEN' as const };
        }
        // Story IR.2b Task 9.2: no new start at or after the deadline.
        if (
          form.deadline_at &&
          form.deadline_at.getTime() <= params.startedAt.getTime()
        ) {
          return { outcome: 'NOT_OPEN' as const };
        }
        const version = await tx.formVersion.findUnique({
          where: { id: params.formVersionId },
          select: { formId: true, isPublished: true },
        });
        if (
          !version ||
          version.formId !== params.formId ||
          !version.isPublished
        ) {
          return { outcome: 'NOT_OPEN' as const };
        }

        if (params.respondentId) {
          if (
            await hasCompletedLogicalFormWith(
              tx,
              params.respondentId,
              params.formId,
            )
          ) {
            return { outcome: 'ALREADY_COMPLETED' as const };
          }
          await abandonExpiredAttemptsWith(
            tx,
            params.respondentId,
            params.formId,
            params.cutoffDate,
            params.startedAt,
          );
          const active = await findConflictingActiveAttemptWith(
            tx,
            params.respondentId,
            params.formId,
            params.cutoffDate,
          );
          if (active) {
            return {
              outcome: 'CONFLICTING_ACTIVE' as const,
              attempt: toAttemptEntity(active),
            };
          }

          // Decision E5-D1: every completion-code try on this version used.
          // The form row lock serializes this with verifications.
          if (params.completionCodeFailureLimit !== undefined) {
            const failedVerifications = await countCompletionCodeFailuresWith(
              tx,
              params.respondentId,
              params.formVersionId,
            );
            if (failedVerifications >= params.completionCodeFailureLimit) {
              return {
                outcome: 'COMPLETION_CODE_LIMIT_REACHED' as const,
                failedVerifications,
              };
            }
          }

          // Decision E8-D6: completions in the window + open attempts.
          if (params.completionReservation) {
            const overLimit = await startCapacityOverLimitWith(
              tx,
              params.completionReservation,
              params.cutoffDate,
            );
            if (overLimit) {
              return { outcome: 'RATE_LIMITED' as const, ...overLimit };
            }
          }
        }

        const quota = await getQuotaStatusWith(
          tx,
          params.formId,
          params.cutoffDate,
        );
        if (
          quota.completedCount + quota.activeReservationCount >=
          params.expectedCompletions
        ) {
          return { outcome: 'QUOTA_FULL' as const };
        }

        const created = await createAttemptRows(tx, params);
        return { outcome: 'CREATED' as const, ...created };
      });
    } catch (error) {
      // An IN_PROGRESS insert can only hit the one-active index.
      if (isAttemptAccountViolation(error, ONE_ACTIVE_PER_ACCOUNT_INDEX)) {
        return { outcome: 'CONFLICTING_ACTIVE', attempt: null };
      }
      throw error;
    }
  }

  async findAttemptById(
    attemptId: string,
  ): Promise<SurveyAttemptEntity | null> {
    const raw = await currentClient(this.prisma).surveyAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!raw) return null;
    return toAttemptEntity(raw);
  }

  async findResponseById(responseId: string): Promise<ResponseEntity | null> {
    const raw = await currentClient(this.prisma).response.findUnique({
      where: { id: responseId },
    });
    if (!raw) return null;
    return toResponseEntity(raw);
  }

  async findResponseByAttemptId(
    attemptId: string,
  ): Promise<ResponseEntity | null> {
    const raw = await currentClient(this.prisma).response.findFirst({
      where: { attemptId },
    });
    if (!raw) return null;
    return toResponseEntity(raw);
  }

  async findActivePolicyDeployment(): Promise<{
    id: string;
    name: string;
    version: number;
    status: 'SHADOW' | 'ADVISORY' | 'ENFORCED';
  } | null> {
    const active = await currentClient(this.prisma).scoringPolicy.findFirst({
      where: { status: { in: ['ENFORCED', 'ADVISORY', 'SHADOW'] } },
      orderBy: { version: 'desc' },
    });
    if (!active) return null;
    return {
      id: active.id,
      name: active.name,
      version: active.version,
      status: active.status as 'SHADOW' | 'ADVISORY' | 'ENFORCED',
    };
  }

  /**
   * Epic 5 review P7 (+ P1 step 4, P4, P21): the whole submission is
   * state-predicated under the attempt row lock. Lock order is the user's
   * completion lock (Epic 8 review P3, only with `completionLimit`), then the
   * form row (`FOR NO KEY UPDATE`, Epic 6 review P6 + plan 2.3), then the
   * attempt row — the same as External verification; attempt start takes
   * only the form row — so they never deadlock. `afterCompletion` (plan 2.3,
   * the QUOTA close) runs last, still under these locks.
   */
  async submitInternalResponseTransaction(
    params: SubmitInternalResponseTransactionParams,
  ): Promise<SubmitInternalResponseTransactionResult> {
    try {
      return await runInTransaction(this.prisma, async (tx) => {
        // Epic 8 review P3: serialize this user's completions first.
        if (params.completionLimit) {
          await lockCompletionsOf(tx, params.completionLimit.userId);
        }

        // 0. A survey closed since the pre-check takes no new completion.
        if (!(await isFormOpenForCompletion(tx, params.formId))) {
          return { outcome: 'FORM_NOT_OPEN' as const };
        }

        // 1. Serialize concurrent submits of the same attempt.
        await tx.$queryRaw`
          SELECT id FROM survey_attempts WHERE id = ${params.attemptId}::uuid FOR UPDATE
        `;
        const [attempt, response] = await Promise.all([
          tx.surveyAttempt.findUnique({ where: { id: params.attemptId } }),
          tx.response.findUnique({ where: { id: params.responseId } }),
        ]);
        if (!attempt || !response || response.attemptId !== attempt.id) {
          return { outcome: 'NOT_SUBMITTABLE' as const };
        }
        if (
          response.status !== 'IN_PROGRESS' ||
          attempt.status === 'COMPLETED'
        ) {
          return response.status === 'ABANDONED'
            ? { outcome: 'NOT_SUBMITTABLE' as const }
            : { outcome: 'ALREADY_SUBMITTED' as const };
        }
        if (attempt.status !== 'IN_PROGRESS') {
          return { outcome: 'NOT_SUBMITTABLE' as const };
        }

        // 2. One completion per account and logical Form (FR-25).
        if (
          params.respondentId &&
          !params.isGuest &&
          (await hasCompletedLogicalFormWith(
            tx,
            params.respondentId,
            params.formId,
            params.attemptId,
          ))
        ) {
          return { outcome: 'ALREADY_COMPLETED_LOGICAL' as const };
        }

        // 2b. Epic 8 review P3 (FR-46): the authoritative completion limit,
        // counted under the user's lock after the attempt-state checks (a
        // duplicate submit stays ALREADY_SUBMITTED) and before any write.
        if (params.completionLimit) {
          const completionTimes = await completionTimesOverLimitWith(
            tx,
            params.completionLimit,
          );
          if (completionTimes) {
            return { outcome: 'RATE_LIMITED' as const, completionTimes };
          }
        }

        // 3. Attach exactly the answered files (Epic 5 review P4, AD-22):
        // CLEAN, owned by this attempt and uploaded for that question. The
        // stored answers then carry the server-verified file metadata, never
        // the client-supplied name/size/type.
        let answers = params.answers;
        const attachments = params.attachments ?? [];
        if (attachments.length > 0) {
          const ids = attachments.map((attachment) => attachment.objectId);
          await tx.$queryRaw`
            SELECT id FROM stored_objects
            WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
            FOR UPDATE
          `;
          const attached = await tx.storedObject.updateMany({
            where: {
              ownerContext: 'participation',
              ownerRecordId: params.attemptId,
              status: 'CLEAN',
              OR: attachments.map((attachment) => ({
                id: attachment.objectId,
                questionId: attachment.questionId,
              })),
            },
            data: {
              status: 'ATTACHED',
              attachedAt: params.submittedAt,
              expiresAt: null,
            },
          });
          if (attached.count !== attachments.length) {
            // Rolls the whole submission back: the Response stays
            // IN_PROGRESS, so the respondent can fix the file and resubmit.
            // The files this update did not attach are named for the runner.
            const rows = await tx.storedObject.findMany({
              where: { id: { in: ids } },
              select: {
                id: true,
                ownerRecordId: true,
                questionId: true,
                status: true,
                attachedAt: true,
              },
            });
            const byId = new Map(rows.map((row) => [row.id, row]));
            throw new UncleanAttachmentException(
              attachments
                .filter((attachment) => {
                  const row = byId.get(attachment.objectId);
                  return !(
                    row &&
                    row.ownerRecordId === params.attemptId &&
                    row.questionId === attachment.questionId &&
                    row.status === 'ATTACHED' &&
                    row.attachedAt?.getTime() === params.submittedAt.getTime()
                  );
                })
                .map(({ questionId, objectId }) => ({ questionId, objectId })),
            );
          }
          const stored = await tx.storedObject.findMany({
            where: { id: { in: ids } },
            select: {
              id: true,
              fileName: true,
              fileSize: true,
              mimeType: true,
            },
          });
          answers = withStoredFileMetadata(params.answers, attachments, stored);
        }

        // 4. State-predicated transitions: Response VALIDATED, Attempt COMPLETED.
        const responseUpdate = await tx.response.updateMany({
          where: { id: params.responseId, status: 'IN_PROGRESS' },
          data: {
            status: 'VALIDATED',
            answersJson: answers as Prisma.InputJsonValue,
            submittedAt: params.submittedAt,
          },
        });
        if (responseUpdate.count !== 1) {
          throw new SubmitRollback('ALREADY_SUBMITTED');
        }
        const attemptUpdate = await tx.surveyAttempt.updateMany({
          where: { id: params.attemptId, status: 'IN_PROGRESS' },
          data: { status: 'COMPLETED', submittedAt: params.submittedAt },
        });
        if (attemptUpdate.count !== 1) {
          throw new SubmitRollback('NOT_SUBMITTABLE');
        }

        // 5. Atomic AD-10 Outbox events.
        const outboxEventIds: string[] = [];

        if (params.respondentId && !params.isGuest) {
          const rewardEventId = randomUUID();
          outboxEventIds.push(rewardEventId);
          await tx.outboxEvent.create({
            data: {
              id: rewardEventId,
              idempotencyKey: `internal-reward:${params.responseId}`,
              eventType: 'InternalRewardRequested',
              schemaVersion: 1,
              producer: 'participation-service',
              aggregateType: 'Response',
              aggregateId: params.responseId,
              aggregateVersion: 1,
              // Epic 5 review P21: a single-event stream per response (like
              // `integrity:{responseId}`), so AD-10 contiguity holds.
              orderingStream: `internal-reward:${params.responseId}`,
              streamSequence: 1,
              status: 'PENDING',
              // Story IR.2b Task 5.2: the synchronous post-commit settlement
              // stays (instant rewards); the dispatcher is the durable
              // recovery path and waits a minute to avoid contending with it.
              availableAt: new Date(params.submittedAt.getTime() + 60_000),
              payload: {
                responseId: params.responseId,
                attemptId: params.attemptId,
                formId: params.formId,
                formVersionId: params.formVersionId,
                publisherId: params.publisherId,
                respondentId: params.respondentId,
                rewardAmount: params.rewardAmount,
                policyMode: params.policyMode,
                policyDeploymentId: params.policyDeploymentId,
                submittedAt: params.submittedAt.toISOString(),
              },
            },
          });
        }

        const assessmentEventId = randomUUID();
        outboxEventIds.push(assessmentEventId);
        await tx.outboxEvent.create({
          data: {
            id: assessmentEventId,
            idempotencyKey: `integrity-assessment:${params.responseId}:${params.policyDeploymentId}`,
            eventType: 'IntegrityAssessmentRequested',
            schemaVersion: 1,
            producer: 'participation-service',
            aggregateType: 'Response',
            aggregateId: params.responseId,
            aggregateVersion: 1,
            orderingStream: `integrity:${params.responseId}`,
            streamSequence: 1,
            status: 'PENDING',
            payload: {
              responseId: params.responseId,
              attemptId: params.attemptId,
              formId: params.formId,
              formVersionId: params.formVersionId,
              respondentId: params.respondentId,
              policyMode: params.policyMode,
              policyDeploymentId: params.policyDeploymentId,
              answers: answers as Prisma.InputJsonValue,
              submittedAt: params.submittedAt.toISOString(),
              ...(params.securityEvidence
                ? {
                    securityEvidence:
                      params.securityEvidence as unknown as Prisma.InputJsonValue,
                  }
                : {}),
            },
          },
        });

        // Plan 2.3: the QUOTA close + Escrow refund, in this transaction.
        if (params.afterCompletion) {
          await params.afterCompletion();
        }

        const [updatedResponse, updatedAttempt] = await Promise.all([
          tx.response.findUniqueOrThrow({ where: { id: params.responseId } }),
          tx.surveyAttempt.findUniqueOrThrow({
            where: { id: params.attemptId },
          }),
        ]);
        return {
          outcome: 'SUBMITTED' as const,
          response: toResponseEntity(updatedResponse),
          attempt: toAttemptEntity(updatedAttempt),
          outboxEventIds,
        };
      });
    } catch (error) {
      if (error instanceof SubmitRollback) {
        return { outcome: error.outcome };
      }
      if (isOutboxKeyViolation(error)) {
        return { outcome: 'ALREADY_SUBMITTED' };
      }
      // A COMPLETED update can only hit the one-completion index.
      if (isAttemptAccountViolation(error, ONE_COMPLETION_PER_ACCOUNT_INDEX)) {
        return { outcome: 'ALREADY_COMPLETED_LOGICAL' };
      }
      throw error;
    }
  }

  async saveIntegrityEvents(events: IntegrityEventEntity[]): Promise<number> {
    if (events.length === 0) return 0;

    const result = await currentClient(this.prisma).integrityEvent.createMany({
      data: events.map((event) => ({
        clientEventId: event.clientEventId,
        eventType: event.eventType as any,
        attemptId: event.attemptId,
        formVersionId: event.formVersionId,
        respondentId: event.respondentId,
        questionId: event.questionId ?? undefined,
        sequence: event.sequence ?? undefined,
        occurredAt: event.occurredAt,
        metadata: event.metadata ? (event.metadata as any) : undefined,
        consentId: event.consentId ?? undefined,
      })),
      skipDuplicates: true,
    });

    return result.count;
  }

  async lockAttemptForVerification(
    attemptId: string,
    formId: string,
    completionLockUserId?: string,
  ): Promise<SurveyAttemptEntity | null> {
    return runInTransaction(this.prisma, async (tx) => {
      // Same lock order as submit: the user's completion lock (Epic 8 review
      // P3), then the form row, then the attempt row.
      if (completionLockUserId) {
        await lockCompletionsOf(tx, completionLockUserId);
      }
      // Plan 2.3: the completion lock mode (see `isFormOpenForCompletion`).
      await tx.$queryRaw`
        SELECT id FROM forms WHERE id = ${formId}::uuid FOR NO KEY UPDATE
      `;
      await tx.$queryRaw`
        SELECT id FROM survey_attempts WHERE id = ${attemptId}::uuid FOR UPDATE
      `;
      const raw = await tx.surveyAttempt.findUnique({
        where: { id: attemptId },
      });
      return raw ? toAttemptEntity(raw) : null;
    });
  }

  async recordFailedAttemptVerification(
    attemptId: string,
    respondentId: string,
    formVersionId: string,
  ): Promise<{
    failureCount: number;
    isLocked: boolean;
    accountFailureCount: number;
    attemptInProgress: boolean;
  }> {
    return runInTransaction(this.prisma, async (tx) => {
      // Row lock prevents concurrent failures from losing increments (3-strike rule).
      await tx.$queryRaw`
        SELECT id FROM survey_attempts WHERE id = ${attemptId}::uuid FOR UPDATE
      `;
      const attempt = await tx.surveyAttempt.findUnique({
        where: { id: attemptId },
        select: {
          status: true,
          failedCodeVerifications: true,
          formVersionId: true,
        },
      });
      // Epic 5 review P2: the server-owned counter only (never clientContext).
      const currentFailures = attempt?.failedCodeVerifications ?? 0;
      // BE-7 (decision D4): a code verified against a rotated version re-pins
      // the attempt to it before the sum is read, so this strike and the
      // attempt's earlier ones count toward that version's budget.
      if (
        attempt?.status === 'IN_PROGRESS' &&
        attempt.formVersionId !== formVersionId
      ) {
        await tx.surveyAttempt.update({
          where: { id: attemptId },
          data: { formVersionId },
        });
      }
      // Decision E5-D1: the account's counted wrong codes on this version
      // before this one (one IN_PROGRESS attempt per account and form, so
      // the attempt row lock serializes every writer of this sum).
      const accountFailuresBefore = await countCompletionCodeFailuresWith(
        tx,
        respondentId,
        formVersionId,
      );
      if (!attempt || attempt.status !== 'IN_PROGRESS') {
        return {
          failureCount: currentFailures,
          isLocked: attempt?.status === 'LOCKED',
          accountFailureCount: accountFailuresBefore,
          attemptInProgress: false,
        };
      }
      const failureCount = currentFailures + 1;
      const accountFailureCount = accountFailuresBefore + 1;
      const isLocked =
        failureCount >= MAX_COMPLETION_CODE_FAILURES ||
        accountFailureCount >= MAX_COMPLETION_CODE_FAILURES_PER_ACCOUNT_VERSION;

      await tx.surveyAttempt.update({
        where: { id: attemptId },
        data: {
          status: isLocked ? 'LOCKED' : undefined,
          failedCodeVerifications: failureCount,
          lastFailedVerificationAt: new Date(),
        },
      });

      // Record security violation in FraudLog (never logging candidate code)
      await tx.fraudLog.create({
        data: {
          userId: respondentId,
          type: 'SECURITY_VIOLATION',
          details: {
            attemptId,
            formVersionId,
            action: 'COMPLETION_CODE_VERIFICATION_FAILED',
            failureCount,
            accountFailureCount,
            isLocked,
            policyVersion: COMPLETION_CODE_POLICY_VERSION,
          },
        },
      });

      return {
        failureCount,
        isLocked,
        accountFailureCount,
        attemptInProgress: true,
      };
    });
  }

  async countCompletionCodeFailures(
    respondentId: string,
    formVersionId: string,
  ): Promise<number> {
    return countCompletionCodeFailuresWith(
      currentClient(this.prisma),
      respondentId,
      formVersionId,
    );
  }

  /**
   * Decision E5-D1: the attempt rows of the account on the version are locked
   * (`FOR UPDATE`, the lock a verification takes last), so a reset and an
   * in-flight wrong code serialize; the reset row forgives exactly what was
   * counted.
   */
  async resetCompletionCodeFailures(
    params: ResetCompletionCodeFailuresParams,
  ): Promise<{ failuresForgiven: number; resetAt: Date | null }> {
    return runInTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM survey_attempts
        WHERE respondent_id = ${params.respondentId}::uuid
          AND form_version_id = ${params.formVersionId}::uuid
        FOR UPDATE
      `;
      const counted = await countCompletionCodeFailuresWith(
        tx,
        params.respondentId,
        params.formVersionId,
      );
      if (counted <= 0) {
        return { failuresForgiven: 0, resetAt: null };
      }
      const reset = await tx.completionCodeLimitReset.create({
        data: {
          respondentId: params.respondentId,
          formVersionId: params.formVersionId,
          failuresForgiven: counted,
          resetById: params.resetById,
          reason: params.reason,
          policyVersion: params.policyVersion,
        },
      });
      return { failuresForgiven: counted, resetAt: reset.createdAt };
    });
  }

  async findOpenAttemptStartTimes(
    respondentId: string,
    cutoffDate: Date,
  ): Promise<Date[]> {
    const rows = await currentClient(this.prisma).surveyAttempt.findMany({
      where: {
        respondentId,
        status: 'IN_PROGRESS',
        startedAt: { gte: cutoffDate },
      },
      select: { startedAt: true },
      orderBy: { startedAt: 'asc' },
      take: 1000,
    });
    return rows.map((row) => row.startedAt);
  }

  async recordFraudLog(
    userId: string,
    type: FraudLogType,
    details?: Record<string, unknown>,
    dedupeKey?: string,
  ): Promise<boolean> {
    // Append-only (FR-47): INSERT ... ON CONFLICT (dedupe_key) DO NOTHING, so a
    // repeated rejection never updates or duplicates the existing evidence.
    // Bug 3.6: deliberately the root client, never the ambient Unit of Work
    // transaction: the evidence is written for a request that is being
    // rejected, and must survive that request's rollback (see
    // `ParticipationRateLimiter.rejectCompletions`).
    const result = await this.prisma.fraudLog.createMany({
      data: [
        {
          userId,
          type,
          details: details ? (details as any) : undefined,
          dedupeKey: dedupeKey ?? null,
        },
      ],
      skipDuplicates: true,
    });
    return result.count > 0;
  }

  async findCompletionTimesSince(
    respondentId: string,
    since: Date,
  ): Promise<Date[]> {
    const rows = await currentClient(this.prisma).surveyAttempt.findMany({
      where: {
        respondentId,
        status: 'COMPLETED',
        submittedAt: { gte: since },
      },
      select: { submittedAt: true },
      orderBy: { submittedAt: 'asc' },
      // Bounded read: enforcement keeps a user near the configured limit, so
      // this cap only guards against pathological histories.
      take: 1000,
    });
    return rows
      .map((row) => row.submittedAt)
      .filter((value): value is Date => value instanceof Date);
  }

  async completeExternalAttemptTransaction(
    params: CompleteExternalAttemptTransactionParams,
  ): Promise<CompleteExternalAttemptResult> {
    let current: SurveyAttemptEntity | null = null;
    try {
      return await runInTransaction(this.prisma, async (tx) => {
        // Lock order user completion lock (Epic 8 review P3) → form →
        // attempt, like submit (no-op re-locks after
        // `lockAttemptForVerification`); the form row is read again below as
        // the Epic 6 P6 open-check.
        if (params.completionLimit) {
          await lockCompletionsOf(tx, params.completionLimit.userId);
        }
        await tx.$queryRaw`
          SELECT id FROM forms WHERE id = ${params.formId}::uuid FOR NO KEY UPDATE
        `;
        // Serialize concurrent verifications of the same attempt.
        await tx.$queryRaw`
          SELECT id FROM survey_attempts WHERE id = ${params.attemptId}::uuid FOR UPDATE
        `;
        current = toAttemptEntity(
          await tx.surveyAttempt.findUniqueOrThrow({
            where: { id: params.attemptId },
          }),
        );

        if (current.status === 'COMPLETED') {
          return { outcome: 'ALREADY_COMPLETED' as const, attempt: current };
        }
        if (current.status !== 'IN_PROGRESS') {
          return { outcome: 'NOT_CLAIMABLE' as const, attempt: current };
        }

        if (!(await isFormOpenForCompletion(tx, params.formId))) {
          return { outcome: 'FORM_NOT_OPEN' as const, attempt: current };
        }

        // Epic 5 review P1 step 4: one completion per account and Form.
        if (
          current.respondentId &&
          (await hasCompletedLogicalFormWith(
            tx,
            current.respondentId,
            current.surveyId,
            current.id,
          ))
        ) {
          return {
            outcome: 'ALREADY_COMPLETED_LOGICAL' as const,
            attempt: current,
          };
        }

        // Epic 8 review P3 (FR-46): the authoritative completion limit under
        // the user's lock, after the state checks and before the claim.
        if (params.completionLimit) {
          const completionTimes = await completionTimesOverLimitWith(
            tx,
            params.completionLimit,
          );
          if (completionTimes) {
            return {
              outcome: 'RATE_LIMITED' as const,
              attempt: current,
              completionTimes,
            };
          }
        }

        // BE-7 (decision D4): the claim re-pins the attempt to the version
        // whose code was verified (a newer one after a code rotation).
        const updated = await tx.surveyAttempt.update({
          where: { id: params.attemptId },
          data: {
            status: 'COMPLETED',
            submittedAt: params.submittedAt,
            formVersionId: params.formVersionId,
          },
        });
        return {
          outcome: 'COMPLETED' as const,
          attempt: toAttemptEntity(updated),
        };
      });
    } catch (error) {
      // Only the one-completion index can reject a COMPLETED update. Inside a
      // Unit of Work the transaction is aborted: the caller must throw.
      if (
        current &&
        isAttemptAccountViolation(error, ONE_COMPLETION_PER_ACCOUNT_INDEX)
      ) {
        return { outcome: 'ALREADY_COMPLETED_LOGICAL', attempt: current };
      }
      throw error;
    }
  }

  async findInternalRewardRequest(
    responseId: string,
  ): Promise<InternalRewardRequest | null> {
    const event = await currentClient(this.prisma).outboxEvent.findUnique({
      where: { idempotencyKey: `internal-reward:${responseId}` },
      select: { payload: true },
    });
    return toInternalRewardRequest(event?.payload);
  }

  /**
   * Epic 5 review P2/P20: the report marker is a server-owned column written
   * with a compare-and-set, so exactly one report (and one Outbox row) exists
   * per attempt; the payload carries the timing evidence for the Admin.
   */
  async reportMissingCompletionCode(
    attemptId: string,
    respondentId: string,
    reason: string,
    evidence: MissingCodeReportEvidence,
  ): Promise<{ reportedAt: Date }> {
    return runInTransaction(this.prisma, async (tx) => {
      const reportedAt = new Date();
      const marked = await tx.surveyAttempt.updateMany({
        where: { id: attemptId, missingCodeReportedAt: null },
        data: { missingCodeReportedAt: reportedAt, missingCodeReason: reason },
      });
      const attempt = await tx.surveyAttempt.findUnique({
        where: { id: attemptId },
        select: {
          surveyId: true,
          formVersionId: true,
          missingCodeReportedAt: true,
        },
      });
      if (marked.count === 0) {
        return { reportedAt: attempt?.missingCodeReportedAt ?? reportedAt };
      }

      // Admin investigation request, not a fraud signal: FraudLog stays reserved
      // for confirmed abuse, so the report is queued via the Outbox (AD-16).
      await tx.outboxEvent.create({
        data: {
          id: randomUUID(),
          idempotencyKey: `missing-code-report:${attemptId}`,
          eventType: 'ExternalCompletionCodeMissingReported',
          schemaVersion: 1,
          producer: 'participation-service',
          aggregateType: 'SurveyAttempt',
          aggregateId: attemptId,
          aggregateVersion: 1,
          status: 'PENDING',
          payload: {
            attemptId,
            surveyId: attempt?.surveyId ?? null,
            formVersionId: attempt?.formVersionId ?? null,
            respondentId,
            reason,
            reportedAt: reportedAt.toISOString(),
            startedAt: evidence.startedAt.toISOString(),
            elapsedSeconds: evidence.elapsedSeconds,
            requiredBarrierSeconds: evidence.requiredBarrierSeconds,
            reservationExpired: evidence.reservationExpired,
          },
        },
      });

      return { reportedAt };
    });
  }

  /**
   * Story IR.2a (API-03): the form row (`FOR SHARE`) and then the attempt row
   * (`FOR UPDATE`) — the global lock order of start, submit and verify — so a
   * cancel never deadlocks with them. No user completion lock: a cancel only
   * removes a reservation, so the E8-D6 count can only go down. The Internal
   * Response moves to ABANDONED in the same transaction.
   */
  async cancelAttempt(
    params: CancelAttemptParams,
  ): Promise<CancelAttemptResult> {
    return runInTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM forms WHERE id = ${params.formId}::uuid FOR SHARE
      `;
      await tx.$queryRaw`
        SELECT id FROM survey_attempts WHERE id = ${params.attemptId}::uuid FOR UPDATE
      `;
      const raw = await tx.surveyAttempt.findUnique({
        where: { id: params.attemptId },
      });
      if (
        !raw ||
        raw.surveyId !== params.formId ||
        raw.isGuest ||
        raw.respondentId !== params.respondentId
      ) {
        return { outcome: 'NOT_FOUND' as const };
      }

      const current = toAttemptEntity(raw);
      const state = current.cancellation(params.cutoffDate);
      switch (state.kind) {
        case 'ALREADY_CANCELLED':
          return { outcome: 'ALREADY_CANCELLED' as const, attempt: current };
        case 'NOT_IN_PROGRESS':
          return {
            outcome: 'NOT_IN_PROGRESS' as const,
            attempt: current,
            derivedCloseReason: state.closedReason,
          };
        case 'CANCELLABLE':
          break;
      }

      // State-predicated: only an IN_PROGRESS row moves, so a stored
      // closedAt is never rewritten.
      const cancelled = await tx.surveyAttempt.updateMany({
        where: { id: params.attemptId, status: 'IN_PROGRESS' },
        data: {
          status: 'ABANDONED',
          closedReason: 'CANCELLED',
          closedAt: params.now,
        },
      });
      if (cancelled.count !== 1) {
        throw new Error(
          `Survey attempt ${params.attemptId} changed while its row lock was held.`,
        );
      }
      await tx.response.updateMany({
        where: { attemptId: params.attemptId, status: 'IN_PROGRESS' },
        data: { status: 'ABANDONED' },
      });
      const updated = await tx.surveyAttempt.findUniqueOrThrow({
        where: { id: params.attemptId },
      });
      return {
        outcome: 'CANCELLED' as const,
        attempt: toAttemptEntity(updated),
      };
    });
  }
}

/** Validates the stored Outbox payload; malformed payloads are ignored. */
export function toInternalRewardRequest(
  payload: unknown,
): InternalRewardRequest | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const value = payload as Record<string, unknown>;
  const policyMode = POLICY_MODES.find((mode) => mode === value.policyMode);
  if (
    typeof value.publisherId !== 'string' ||
    typeof value.respondentId !== 'string' ||
    typeof value.rewardAmount !== 'number' ||
    !Number.isInteger(value.rewardAmount) ||
    value.rewardAmount < 0
  ) {
    return null;
  }
  return {
    publisherId: value.publisherId,
    respondentId: value.respondentId,
    rewardAmount: value.rewardAmount,
    policyMode: policyMode ?? 'SHADOW',
  };
}
