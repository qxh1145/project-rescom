/**
 * Decision C6 (a): the `Idempotency-Key` rule the mock `POST /forms/external`
 * follows (backend in progress): per user and key, the first successful
 * response is stored; the same request body replays it, another body is a
 * conflict. Pure so it is unit-tested (`tests/forms-create.test.mjs`).
 */
export interface IdempotencyRecord<T> {
  fingerprint: string;
  response: T;
}

export type IdempotencyDecision<T> = { kind: "new" } | { kind: "replay"; response: T } | { kind: "conflict" };

export function idempotencyRecordKey(userId: string, key: string | null): string | null {
  return key ? `${userId}:${key}` : null;
}

export function decideIdempotentRequest<T>(
  previous: IdempotencyRecord<T> | undefined,
  fingerprint: string,
): IdempotencyDecision<T> {
  if (!previous) return { kind: "new" };
  return previous.fingerprint === fingerprint ? { kind: "replay", response: previous.response } : { kind: "conflict" };
}
