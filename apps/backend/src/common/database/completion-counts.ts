import { Prisma } from '@prisma/client';

/** Response statuses that count as a completed participation. */
export const COMPLETED_RESPONSE_STATUSES = ['SUBMITTED', 'VALIDATED'] as const;

/** Works with the root client and with an interactive-transaction client. */
export type CompletionCountClient = Pick<
  Prisma.TransactionClient,
  'response' | 'surveyAttempt'
>;

/**
 * Completed participations per form: Responses in SUBMITTED/VALIDATED plus
 * COMPLETED attempts that have no Response (verified External completions,
 * which create no Response row). Same definition as participation's quota
 * check (`PrismaParticipationRepository.getQuotaStatus`).
 *
 * Shared on purpose: the Marketplace feed uses it for quota auto-hide (FR-38)
 * and the close-refund fix (Epic 6 review DF1) should reuse it so External
 * completions are never refunded twice. Every requested form id is present in
 * the result (0 when nothing completed).
 */
export async function countCompletionsByFormIds(
  client: CompletionCountClient,
  formIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (formIds.length === 0) return result;
  for (const id of formIds) result.set(id, 0);

  const [responseGroups, externalGroups] = await Promise.all([
    client.response.groupBy({
      by: ['formId'],
      where: {
        formId: { in: formIds },
        status: { in: [...COMPLETED_RESPONSE_STATUSES] },
      },
      _count: { _all: true },
    }),
    client.surveyAttempt.groupBy({
      by: ['surveyId'],
      where: {
        surveyId: { in: formIds },
        status: 'COMPLETED',
        response: null,
      },
      _count: { _all: true },
    }),
  ]);

  for (const group of responseGroups) {
    result.set(
      group.formId,
      (result.get(group.formId) ?? 0) + group._count._all,
    );
  }
  for (const group of externalGroups) {
    result.set(
      group.surveyId,
      (result.get(group.surveyId) ?? 0) + group._count._all,
    );
  }
  return result;
}

/**
 * Internal response statuses past submission: a payout journal
 * (`internal-reward:` / `integrity-hold:`) may exist for them. Only
 * SUBMITTED/VALIDATED ones still earn a reward.
 */
const SETTLEABLE_RESPONSE_STATUSES = [
  ...COMPLETED_RESPONSE_STATUSES,
  'DISPUTED',
  'REJECTED',
] as const;

/** Epic 6 review P4: the completions whose rewards draw one form's Escrow. */
export interface FormCompletionRefs {
  /** Completed participations, quota definition (guests included). */
  completedCount: number;
  /**
   * Non-guest Internal responses past submission. `rewardable` responses
   * (SUBMITTED/VALIDATED) are owed a reward until their payout journal
   * exists; the others only count when a payout journal already exists.
   */
  internalResponses: Array<{ id: string; rewardable: boolean }>;
  /** COMPLETED External attempts (no Response row), each owed a Pending credit. */
  externalAttemptIds: string[];
}

/**
 * The completions of one form whose rewards draw its Escrow, with the same
 * completion definition as `countCompletionsByFormIds` (Epic 4 P3), so the
 * close refund (Epic 6 review P4) and the quota never disagree. Guest
 * responses count as completed but are never paid.
 */
export async function listCompletionRefsForForm(
  client: CompletionCountClient,
  formId: string,
): Promise<FormCompletionRefs> {
  const [counts, responses, attempts] = await Promise.all([
    countCompletionsByFormIds(client, [formId]),
    client.response.findMany({
      where: {
        formId,
        isGuest: false,
        respondentId: { not: null },
        status: { in: [...SETTLEABLE_RESPONSE_STATUSES] },
      },
      select: { id: true, status: true },
    }),
    client.surveyAttempt.findMany({
      where: { surveyId: formId, status: 'COMPLETED', response: null },
      select: { id: true },
    }),
  ]);

  const completedStatuses: readonly string[] = COMPLETED_RESPONSE_STATUSES;
  return {
    completedCount: counts.get(formId) ?? 0,
    internalResponses: responses.map((response) => ({
      id: response.id,
      rewardable: completedStatuses.includes(response.status),
    })),
    externalAttemptIds: attempts.map((attempt) => attempt.id),
  };
}

/**
 * Forms the respondent has completed: a SUBMITTED/VALIDATED Response OR a
 * COMPLETED attempt (External completions; Internal ones whose Response was
 * later DISPUTED/REJECTED). Same definition as participation's
 * one-completion-per-form rule (`hasCompletedLogicalForm`), so the feed never
 * lists a survey that participation would refuse as already completed.
 */
export async function findCompletedFormIdsForRespondent(
  client: CompletionCountClient,
  respondentId: string,
): Promise<Set<string>> {
  const [responses, attempts] = await Promise.all([
    client.response.findMany({
      where: {
        respondentId,
        status: { in: [...COMPLETED_RESPONSE_STATUSES] },
      },
      select: { formId: true },
    }),
    client.surveyAttempt.findMany({
      where: { respondentId, status: 'COMPLETED' },
      select: { surveyId: true },
    }),
  ]);

  const formIds = new Set<string>();
  for (const response of responses) formIds.add(response.formId);
  for (const attempt of attempts) formIds.add(attempt.surveyId);
  return formIds;
}
