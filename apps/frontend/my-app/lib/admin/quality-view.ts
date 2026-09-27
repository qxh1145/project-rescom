import { formatShortDateTime } from "../format/date-time.ts";
import { formatDurationLong } from "../forms/results-view.ts";
import { QUALITY_NOTE_MAX_LENGTH } from "./quality-service.ts";
import type { QualityConfidence, QualityDecision, QualityReason, QualityReview } from "./quality-service.ts";

/** Pure view rules of the admin "Xem xét chất lượng" (Figma 17b, 63:3276). */

/** Header meta: "3 câu trả lời cần xem · hạn xem xét 28/09 15:02" (earliest deadline, when set). */
export function qualityQueueMeta(items: readonly Pick<QualityReview, "reviewDeadline">[]): string {
  if (items.length === 0) return "Không còn câu trả lời cần xem";
  const deadlines = items.flatMap((item) => (item.reviewDeadline ? [item.reviewDeadline] : [])).sort();
  const count = `${items.length} câu trả lời cần xem`;
  return deadlines.length > 0 ? `${count} · hạn xem xét ${formatShortDateTime(deadlines[0])}` : count;
}

/** Vietnamese explanation of one signal ("Làm xong trong 1 phút 40 giây, khảo sát dự kiến 5 phút"). */
export function reasonText(reason: QualityReason): string {
  const { params } = reason;
  switch (reason.code) {
    case "FAST_COMPLETION":
      if (params.durationSeconds !== undefined && params.expectedSeconds !== undefined) {
        return `Làm xong trong ${formatDurationLong(params.durationSeconds)}, khảo sát dự kiến ${formatDurationLong(params.expectedSeconds)}`;
      }
      return "Làm xong nhanh hơn nhiều so với thời gian dự kiến";
    case "ATTENTION_CHECK_FAILED":
      return params.questionNumber !== undefined
        ? `Trả lời sai câu kiểm tra chú ý (câu ${params.questionNumber})`
        : "Trả lời sai câu kiểm tra chú ý";
    case "STRAIGHT_LINING":
      return params.scaleCount !== undefined
        ? `Chọn cùng một mức cho cả ${params.scaleCount} câu thang đo`
        : "Chọn cùng một mức cho mọi câu thang đo";
    case "ANSWER_INCONSISTENCY":
      return params.firstQuestion !== undefined && params.secondQuestion !== undefined
        ? `Hai câu trả lời mâu thuẫn nhau (câu ${params.firstQuestion} và câu ${params.secondQuestion})`
        : "Có câu trả lời mâu thuẫn nhau";
    case "ENFORCED_POLICY":
      return "Khảo sát áp dụng chính sách giữ điểm để xét chất lượng";
    default:
      return "Tín hiệu chất lượng cần Admin xem";
  }
}

const CONFIDENCE_LABELS: Record<QualityConfidence, string> = {
  LOW: "Thấp",
  MEDIUM: "Trung bình",
  HIGH: "Cao",
};

export function confidenceLabel(confidence: QualityConfidence): string {
  return CONFIDENCE_LABELS[confidence];
}

/** "80%" */
export function coverageText(coverage: number): string {
  return `${Math.round(coverage * 100)}%`;
}

const RELIABILITY_LABELS: Record<QualityReview["respondent"]["reliabilityLevel"], string> = {
  FORMING: "Đang hình thành độ tin cậy",
  GOOD: "Độ tin cậy tốt",
  REVIEW: "Độ tin cậy cần xem thêm",
};

/** "Đang hình thành độ tin cậy · 3 câu trả lời trước đều Đạt" */
export function respondentContextText(respondent: QualityReview["respondent"]): string {
  const level = RELIABILITY_LABELS[respondent.reliabilityLevel];
  const { priorAssessed, priorPassed } = respondent;
  if (priorAssessed === 0) return `${level} · chưa có câu trả lời trước`;
  if (priorPassed === priorAssessed) return `${level} · ${priorAssessed} câu trả lời trước đều Đạt`;
  return `${level} · ${priorPassed}/${priorAssessed} câu trả lời trước Đạt`;
}

/** "Chất lượng v1: chưa đủ dữ liệu" */
export function surveyQualityText(survey: QualityReview["surveyQuality"]): string {
  return `Chất lượng v${survey.version}: ${survey.status === "READY" ? "đủ dữ liệu" : "chưa đủ dữ liệu"}`;
}

export interface DecisionOption {
  value: QualityDecision;
  label: string;
  description: string;
}

/** "Quyết định" cards (63:3386–63:3398). */
export function decisionOptionsFor(heldPoints: number): DecisionOption[] {
  return [
    { value: "ACCEPT", label: "Chấp nhận", description: `Giải phóng ${heldPoints} điểm vào Khả dụng` },
    {
      value: "INSUFFICIENT_EVIDENCE",
      label: "Chưa đủ căn cứ",
      description: `Giải phóng ${heldPoints} điểm, ghi nhận để hiệu chỉnh`,
    },
    { value: "REJECT", label: "Từ chối", description: "Cần ghi lý do · đảo giao dịch giữ điểm" },
  ];
}

export interface DecisionFormErrors {
  decision?: string;
  note?: string;
}

/** Client-side check before "Lưu quyết định" (the server re-checks the reason). */
export function validateDecision(decision: QualityDecision | null, note: string): DecisionFormErrors {
  const errors: DecisionFormErrors = {};
  if (!decision) errors.decision = "Chọn một quyết định.";
  if (decision === "REJECT" && note.trim().length === 0) errors.note = "Nhập lý do từ chối để người trả lời hiểu.";
  if (note.trim().length > QUALITY_NOTE_MAX_LENGTH) errors.note = `Ghi chú tối đa ${QUALITY_NOTE_MAX_LENGTH} ký tự.`;
  return errors;
}

/** Item to open after `decidedId` leaves the queue: the next one, else the previous one. */
export function nextReviewId(items: readonly Pick<QualityReview, "responseId">[], decidedId: string): string | null {
  const index = items.findIndex((item) => item.responseId === decidedId);
  const rest = items.filter((item) => item.responseId !== decidedId);
  if (rest.length === 0) return null;
  if (index < 0) return rest[0].responseId;
  return (rest[index] ?? rest[rest.length - 1]).responseId;
}

/** Confirmation after saving (announced in a status line). */
export function decisionSavedText(reference: string, decision: QualityDecision, points: number): string {
  return decision === "REJECT"
    ? `Đã từ chối câu trả lời #${reference} và đảo ${points} điểm đang giữ.`
    : `Đã lưu quyết định cho #${reference}: ${points} điểm vào Khả dụng của người trả lời.`;
}
