import {
  starterPointsStatusSchema,
  starterPointsUnlockResultSchema,
  type StarterPointsStatusDto,
  type StarterPointsUnlockResultDto,
} from "@rescom/schemas";
import { formMutationFetch } from "../forms/forms-api.ts";

/**
 * Typed live-API client for the Marketplace activation step (Story 7.2). The
 * demo UI uses `mockRepository.getActivationStatus()`; this client is ready
 * for the later API swap (recommended surveys then come from
 * `GET /marketplace/feed`). Errors keep the backend `code` and `details`.
 */

export type ActivationApiError = Error & { code?: string; details?: unknown };

export interface ActivationRequestOptions {
  signal?: AbortSignal;
}

function apiError(payload: unknown, fallback: string): ActivationApiError {
  const body = payload as {
    error?: { message?: string; code?: string; details?: unknown };
  } | null;
  const error = new Error(body?.error?.message || fallback) as ActivationApiError;
  error.code = body?.error?.code;
  error.details = body?.error?.details;
  return error;
}

async function readData<T>(
  res: Response,
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
  fallback: string,
): Promise<T> {
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw apiError(payload, fallback);
  }
  const parsed = schema.safeParse(payload?.data);
  if (!parsed.success || parsed.data === undefined) {
    throw new Error("Received a malformed starter-points response from the server");
  }
  return parsed.data;
}

/** `GET /economy/starter-points/status` — read-only activation state (FR-7). */
export async function fetchStarterPointsStatus(
  options: ActivationRequestOptions = {},
): Promise<StarterPointsStatusDto> {
  const res = await fetch("/api/economy/starter-points/status", {
    signal: options.signal,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  return readData(res, starterPointsStatusSchema, "Failed to load the activation status");
}

/** `POST /economy/starter-points/unlock` — idempotent unlock/retry (FR-8). */
export async function claimStarterPointsUnlock(
  options: ActivationRequestOptions = {},
): Promise<StarterPointsUnlockResultDto> {
  const res = await formMutationFetch("/api/economy/starter-points/unlock", {
    method: "POST",
    headers: { Accept: "application/json" },
    signal: options.signal,
  });
  return readData(res, starterPointsUnlockResultSchema, "Failed to unlock the starter points");
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * Status for the activation card: when the step is complete but the unlock
 * has not been posted yet (e.g. an External survey's review window just
 * closed, or an earlier unlock failed) it claims the unlock once and re-reads.
 *
 * Code review P14: a failed claim never loses the valid status already read
 * (the unlock is retried by the next refresh or another trigger); an abort is
 * still propagated, and the claim honours the caller's abort signal.
 */
export async function refreshActivationStatus(
  options: ActivationRequestOptions = {},
): Promise<StarterPointsStatusDto> {
  const status = await fetchStarterPointsStatus(options);
  if (status.activationState !== "READY_TO_UNLOCK") {
    return status;
  }
  try {
    await claimStarterPointsUnlock(options);
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) throw error;
    return status;
  }
  return fetchStarterPointsStatus(options);
}
