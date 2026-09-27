import {
  EXTERNAL_SURVEY_URL_MAX_LENGTH,
  externalSurveyUrlSchema,
  isGoogleFormsUrl,
  isHttpsUrl,
} from "@rescom/schemas";

export type ExternalSurveyUrlValidation =
  | { valid: true; url: string; isGoogleForm: true; error: null }
  | { valid: false; url: null; isGoogleForm: false; error: string };

/**
 * Real-time validation for the "Create External Survey" link step, using the
 * same `externalSurveyUrlSchema` the backend enforces (HTTPS only, max 2000
 * characters, Google Forms only — decision E4-DN3, Phase 1 allowlist
 * `docs.google.com/forms/…`, `forms.gle/…`, `forms.google.com/…`). Every
 * valid link is therefore a Google Form; other hosts get an inline error.
 */
export function validateExternalSurveyUrl(raw: string): ExternalSurveyUrlValidation {
  const trimmed = raw.trim();
  if (!trimmed) {
    return invalid("Vui lòng nhập liên kết khảo sát.");
  }
  const result = externalSurveyUrlSchema.safeParse(trimmed);
  if (result.success) {
    return { valid: true, url: result.data, isGoogleForm: true, error: null };
  }
  if (trimmed.length > EXTERNAL_SURVEY_URL_MAX_LENGTH) {
    return invalid(
      `Liên kết không được vượt quá ${EXTERNAL_SURVEY_URL_MAX_LENGTH} ký tự.`,
    );
  }
  if (isParsableUrl(trimmed) && !isHttpsUrl(trimmed)) {
    return invalid("Liên kết phải dùng HTTPS (bắt đầu bằng https://).");
  }
  if (isParsableUrl(trimmed) && !isGoogleFormsUrl(trimmed)) {
    return invalid(
      "Giai đoạn 1 chỉ chấp nhận liên kết Google Forms (docs.google.com/forms/…, forms.gle/… hoặc forms.google.com/…).",
    );
  }
  return invalid("Liên kết không hợp lệ (ví dụ: https://forms.gle/...).");
}

function invalid(error: string): ExternalSurveyUrlValidation {
  return { valid: false, url: null, isGoogleForm: false, error };
}

function isParsableUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Bounds for the Step 1 "estimated completion time" input (minutes). */
export const EXTERNAL_EFFORT_MIN_MINUTES = 1;
export const EXTERNAL_EFFORT_MAX_MINUTES = 1440;

export type ExternalEffortValidation =
  | { valid: true; seconds: number; error: null }
  | { valid: false; seconds: null; error: string };

/**
 * Converts the publisher's estimate in whole minutes into
 * `expectedEffortSeconds` (backend bounds: 10..86400 seconds).
 */
export function effortMinutesToSeconds(minutes: number): ExternalEffortValidation {
  if (
    !Number.isInteger(minutes) ||
    minutes < EXTERNAL_EFFORT_MIN_MINUTES ||
    minutes > EXTERNAL_EFFORT_MAX_MINUTES
  ) {
    return {
      valid: false,
      seconds: null,
      error: `Thời gian hoàn thành dự kiến phải là số phút nguyên từ ${EXTERNAL_EFFORT_MIN_MINUTES} đến ${EXTERNAL_EFFORT_MAX_MINUTES}.`,
    };
  }
  return { valid: true, seconds: minutes * 60, error: null };
}
