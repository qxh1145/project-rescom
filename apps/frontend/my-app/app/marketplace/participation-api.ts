import {
  StartSurveyAttemptInput,
  SurveyAttemptResponseDto,
  VerifyExternalCompletionCodeInput,
  VerifyExternalCompletionCodeResponseDto,
  ReportMissingCompletionCodeInput,
  ReportMissingCompletionCodeResponseDto,
} from "@rescom/schemas";
import { formMutationFetch } from "../forms/forms-api";

export async function startSurveyAttempt(
  formId: string,
  input: StartSurveyAttemptInput = {},
): Promise<SurveyAttemptResponseDto> {
  const res = await formMutationFetch(`/api/forms/${formId}/attempts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorMsg =
      payload?.error?.message ||
      payload?.message ||
      "Failed to start survey attempt";
    const error = new Error(errorMsg) as Error & { code?: string; details?: unknown };
    error.code = payload?.error?.code;
    error.details = payload?.error?.details;
    throw error;
  }

  const attempt = payload.data as SurveyAttemptResponseDto;
  if (typeof window !== "undefined" && attempt.storageCapability) {
    window.sessionStorage.setItem(
      `rescom_storage_capability_${attempt.attemptId}`,
      attempt.storageCapability,
    );
  }
  return attempt;
}

export async function verifyExternalCompletionCode(
  formId: string,
  attemptId: string,
  input: VerifyExternalCompletionCodeInput,
): Promise<VerifyExternalCompletionCodeResponseDto> {
  const res = await formMutationFetch(
    `/api/forms/${formId}/attempts/${attemptId}/verify-code`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorMsg =
      payload?.error?.message ||
      payload?.message ||
      "Failed to verify completion code";
    const error = new Error(errorMsg) as Error & { code?: string; details?: unknown };
    error.code = payload?.error?.code;
    error.details = payload?.error?.details;
    throw error;
  }

  return payload.data as VerifyExternalCompletionCodeResponseDto;
}

export async function reportMissingCompletionCode(
  formId: string,
  attemptId: string,
  input: ReportMissingCompletionCodeInput,
): Promise<ReportMissingCompletionCodeResponseDto> {
  const res = await formMutationFetch(
    `/api/forms/${formId}/attempts/${attemptId}/report-missing-code`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorMsg =
      payload?.error?.message ||
      payload?.message ||
      "Failed to submit missing code report";
    const error = new Error(errorMsg) as Error & { code?: string };
    error.code = payload?.error?.code;
    throw error;
  }

  return payload.data as ReportMissingCompletionCodeResponseDto;
}
