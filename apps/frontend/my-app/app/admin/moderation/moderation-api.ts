import {
  moderationQueueListSchema,
  moderationSurveyPreviewSchema,
  surveyModerationResultSchema,
  type ModerationQueueListDto,
  type ModerationSurveyPreviewDto,
  type SurveyModerationResultDto,
} from "@rescom/schemas";
import { formMutationFetch } from "../../forms/forms-api.ts";

/**
 * Typed live-API client for the Admin Moderation Dashboard (Story 8.1,
 * FR-20/FR-53). Authorization is enforced by the backend (session role +
 * live Admin capability); mutations carry the CSRF token.
 */

export type ModerationApiError = Error & {
  code?: string;
  status?: number;
  details?: unknown;
};

export interface ModerationQueueQuery {
  limit?: number;
  offset?: number;
}

export interface ModerationRequestOptions {
  signal?: AbortSignal;
}

export interface ApproveSurveyInput {
  formVersionId: string;
  note?: string;
}

export interface RejectSurveyInput {
  formVersionId: string;
  reason: string;
}

const BASE_PATH = "/api/admin/moderation/surveys";

function apiError(
  payload: unknown,
  status: number,
  fallback: string,
): ModerationApiError {
  const body = payload as {
    error?: { message?: string; code?: string; details?: unknown };
  } | null;
  const error = new Error(body?.error?.message || fallback) as ModerationApiError;
  error.code = body?.error?.code;
  error.status = status;
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
    throw apiError(payload, res.status, fallback);
  }
  const parsed = schema.safeParse(payload?.data);
  if (!parsed.success || parsed.data === undefined) {
    throw new Error("Phản hồi từ máy chủ không hợp lệ.");
  }
  return parsed.data;
}

function surveyPath(formId: string, action?: "approve" | "reject"): string {
  const base = `${BASE_PATH}/${encodeURIComponent(formId)}`;
  return action ? `${base}/${action}` : base;
}

/** `GET /api/admin/moderation/surveys` — queue, oldest submission first. */
export async function listModerationQueue(
  query: ModerationQueueQuery = {},
  options?: ModerationRequestOptions,
): Promise<ModerationQueueListDto> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  const qs = params.toString();
  const res = await fetch(`${BASE_PATH}${qs ? `?${qs}` : ""}`, {
    signal: options?.signal,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  return readData(res, moderationQueueListSchema, "Không thể tải hàng chờ kiểm duyệt.");
}

/** `GET /api/admin/moderation/surveys/:formId` — preview + decision. */
export async function getModerationSurvey(
  formId: string,
  options?: ModerationRequestOptions,
): Promise<ModerationSurveyPreviewDto> {
  const res = await fetch(surveyPath(formId), {
    signal: options?.signal,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  return readData(res, moderationSurveyPreviewSchema, "Không thể tải bản xem trước.");
}

async function decide(
  formId: string,
  action: "approve" | "reject",
  body: ApproveSurveyInput | RejectSurveyInput,
  correlationId?: string,
): Promise<SurveyModerationResultDto> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (correlationId) {
    headers["X-Correlation-Id"] = correlationId;
  }
  const res = await formMutationFetch(surveyPath(formId, action), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return readData(
    res,
    surveyModerationResultSchema,
    action === "approve" ? "Không thể phê duyệt khảo sát." : "Không thể từ chối khảo sát.",
  );
}

/** `POST …/:formId/approve` — idempotent for the same version. */
export function approveSurvey(
  formId: string,
  input: ApproveSurveyInput,
  options: { correlationId?: string } = {},
): Promise<SurveyModerationResultDto> {
  return decide(formId, "approve", input, options.correlationId);
}

/** `POST …/:formId/reject` — reason is shown to the Publisher; Escrow is refunded. */
export function rejectSurvey(
  formId: string,
  input: RejectSurveyInput,
  options: { correlationId?: string } = {},
): Promise<SurveyModerationResultDto> {
  return decide(formId, "reject", input, options.correlationId);
}
