import {
  checkSurveyFitsReservationWindow,
  MAX_PUBLISHABLE_DURATION_MINUTES,
  MAX_PUBLISHABLE_TIME_BARRIER_SECONDS,
  RESERVATION_EXPIRY_MINUTES,
  SURVEY_DURATION_EXCEEDS_RESERVATION_CODE,
  type FormTypeEnum,
  type ReservationWindowViolation,
} from "@rescom/schemas";

/**
 * Publisher-facing copy for the 30-minute attempt reservation (code-review
 * decisions E5-D2 and E5-D4, 2026-09-26). The rules live in
 * `@rescom/schemas` and on the server; these helpers only word them.
 */

function describeViolation(violation: ReservationWindowViolation): string {
  switch (violation.rule) {
    case "TIME_BARRIER":
      return violation.questionCount !== null
        ? `thời gian làm bài tối thiểu là ${violation.requiredSeconds} giây (${violation.questionCount} câu hỏi × 2 giây hoặc mức tối thiểu ${violation.publisherMinimumSeconds} giây bạn đặt), vượt quá ${violation.maxSeconds} giây cho phép`
        : `thời gian làm bài tối thiểu là ${violation.requiredSeconds} giây, vượt quá ${violation.maxSeconds} giây cho phép`;
    case "EXPECTED_EFFORT":
      return `thời lượng ước tính là ${violation.expectedEffortSeconds} giây, vượt quá ${violation.maxSeconds} giây cho phép`;
    case "ESTIMATED_DURATION":
      return `thời gian hoàn thành dự kiến là ${violation.estimatedDurationMinutes} phút, vượt quá ${violation.maxMinutes} phút cho phép`;
  }
}

function reservationWindowMessage(
  violations: ReadonlyArray<ReservationWindowViolation>,
): string {
  return `Không thể xuất bản: ${violations.map(describeViolation).join("; ")}. Mỗi lượt làm bài chỉ được giữ chỗ ${RESERVATION_EXPIRY_MINUTES} phút, nên thời gian tối thiểu phải để lại ít nhất 5 phút để nộp bài (tối đa ${Math.floor(MAX_PUBLISHABLE_TIME_BARRIER_SECONDS / 60)} phút) và thời lượng không quá ${MAX_PUBLISHABLE_DURATION_MINUTES} phút. Giai đoạn 1 chưa hỗ trợ khảo sát dài hơn ${RESERVATION_EXPIRY_MINUTES} phút.`;
}

export interface ReservationWindowHint {
  /** True when the backend would refuse the publication (422). */
  blocksPublish: boolean;
  message: string | null;
}

/**
 * Decision E5-D2: the builder's pre-publish check — the same rule the backend
 * enforces at publish (drafts stay editable).
 */
export function describeReservationWindow(input: {
  type: FormTypeEnum;
  definition: unknown;
  estimatedDurationMinutes: number | null | undefined;
}): ReservationWindowHint {
  const check = checkSurveyFitsReservationWindow({
    type: input.type,
    definition: input.definition,
    estimatedDurationMinutes: input.estimatedDurationMinutes ?? null,
  });
  return check.fits
    ? { blocksPublish: false, message: null }
    : { blocksPublish: true, message: reservationWindowMessage(check.violations) };
}

/**
 * Vietnamese message for the backend's 422
 * `SURVEY_DURATION_EXCEEDS_RESERVATION` (details = the violations), or null
 * for any other error.
 */
export function reservationWindowPublishErrorMessage(
  code: string | undefined,
  details: unknown,
): string | null {
  if (code !== SURVEY_DURATION_EXCEEDS_RESERVATION_CODE) return null;
  const violations = Array.isArray(details)
    ? (details as ReservationWindowViolation[]).filter(
        (violation) =>
          violation &&
          (violation.rule === "TIME_BARRIER" ||
            violation.rule === "EXPECTED_EFFORT" ||
            violation.rule === "ESTIMATED_DURATION"),
      )
    : [];
  return violations.length > 0
    ? reservationWindowMessage(violations)
    : `Không thể xuất bản: khảo sát dài hơn thời gian giữ chỗ ${RESERVATION_EXPIRY_MINUTES} phút của mỗi lượt làm bài. Giai đoạn 1 chưa hỗ trợ khảo sát dài hơn ${RESERVATION_EXPIRY_MINUTES} phút.`;
}

export interface NewVersionWarning {
  tone: "info" | "warning";
  message: string;
}

/**
 * Decision E5-D4 (strict): "Create New Version" closes the live survey at
 * once, so respondents still taking it cannot submit their answers or their
 * completion code. `inProgressAttempts` is null while loading or unknown.
 */
export function describeNewVersionImpact(
  inProgressAttempts: number | null,
): NewVersionWarning {
  const cutOff =
    "Tạo phiên bản mới sẽ đóng khảo sát đang chạy ngay lập tức: người đang làm dở sẽ không thể nộp câu trả lời hoặc mã hoàn thành của họ.";
  if (inProgressAttempts === null) {
    return { tone: "warning", message: cutOff };
  }
  if (inProgressAttempts === 0) {
    return {
      tone: "info",
      message: `Hiện không có ai đang làm khảo sát này. ${cutOff}`,
    };
  }
  return {
    tone: "warning",
    message: `Có ${inProgressAttempts} người đang làm khảo sát này (lượt làm bài giữ chỗ tối đa ${RESERVATION_EXPIRY_MINUTES} phút). ${cutOff} Hãy cân nhắc chờ họ hoàn thành trước.`,
  };
}

/** Success notice after the version was created (decision E5-D4). */
export function interruptedAttemptsNotice(
  versionNumber: number,
  interruptedAttempts: number | undefined,
): string {
  const created = `Đã tạo bản nháp phiên bản ${versionNumber}. Khảo sát đã chuyển sang trạng thái nháp để chỉnh sửa.`;
  return interruptedAttempts && interruptedAttempts > 0
    ? `${created} ${interruptedAttempts} lượt làm bài đang dở trên phiên bản trước đã bị dừng.`
    : created;
}
