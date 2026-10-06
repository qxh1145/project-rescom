import type { FormBlockType } from "@rescom/schemas";
import type { FormQuality } from "./results-service.ts";
import { formatDurationLong } from "./results-view.ts";

/**
 * Pure presentation of "Đánh giá chất lượng khảo sát" (Figma 17, 63:4702):
 * stat tiles, the drop-off summary and the improvement suggestions. The
 * server sends numbers and codes (ASSUMED contract); the copy lives here.
 */

export interface StatTile {
  label: string;
  value: string;
  caption: string;
}

/** 13 (%) — rounded share of starters who gave up; null with no starter. */
export function abandonmentRate(started: number, abandoned: number): number | null {
  return started > 0 ? Math.round((abandoned / started) * 100) : null;
}

/** "4,5" */
export function formatDecimal(value: number, digits = 1): string {
  return value.toLocaleString("vi-VN", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

const minutesOf = (seconds: number) => Math.max(1, Math.round(seconds / 60));

export function qualityTiles(quality: FormQuality): StatTile[] {
  const rate = abandonmentRate(quality.started, quality.abandoned);
  return [
    {
      label: "Tỷ lệ bỏ dở",
      value: rate === null ? "Chưa có" : `${rate}%`,
      caption: quality.started ? `${quality.abandoned} trong ${quality.started} người bắt đầu` : "Chưa ai bắt đầu",
    },
    {
      label: "Thời gian thực tế (trung vị)",
      value: quality.medianDurationSeconds === null ? "Chưa có" : formatDurationLong(quality.medianDurationSeconds),
      caption: `Bạn khai ${minutesOf(quality.declaredEffortSeconds)} phút`,
    },
    {
      label: "Lỗi kỹ thuật",
      value: String(quality.technicalErrors),
      caption: quality.technicalErrors ? `${quality.technicalErrors} lỗi đã được ghi nhận` : "Không ghi nhận lỗi nào",
    },
    {
      label: "Phản hồi người trả lời",
      value: quality.feedback.average === null ? "Chưa có" : `${formatDecimal(quality.feedback.average)} / 5`,
      caption: quality.feedback.count ? `${quality.feedback.count} đánh giá` : "Chưa có đánh giá",
    },
  ];
}

/** Short name of a question type, as in "(trả lời ngắn)". */
export function questionTypeName(type: FormBlockType): string {
  switch (type) {
    case "text":
      return "trả lời ngắn";
    case "textarea":
      return "trả lời dài";
    case "single_choice":
      return "một lựa chọn";
    case "multiple_choice":
      return "nhiều lựa chọn";
    case "linear_scale":
      return "thang điểm";
    case "rating":
      return "chấm sao";
    case "number":
      return "nhập số";
    case "date":
      return "chọn ngày";
    case "file_upload":
      return "tải tệp";
  }
}

export interface DropOffBar {
  questionNumber: number;
  label: string;
  count: number;
}

export function dropOffBars(quality: Pick<FormQuality, "dropOff">): DropOffBar[] {
  return [...quality.dropOff]
    .sort((a, b) => a.questionNumber - b.questionNumber)
    .map((item) => ({ questionNumber: item.questionNumber, label: `C${item.questionNumber}`, count: item.count }));
}

/** The question most people stopped at (first one on a tie); null when nobody stopped. */
export function peakDropOff(quality: Pick<FormQuality, "dropOff">) {
  let peak: FormQuality["dropOff"][number] | null = null;
  for (const item of [...quality.dropOff].sort((a, b) => a.questionNumber - b.questionNumber)) {
    if (item.count > 0 && (!peak || item.count > peak.count)) peak = item;
  }
  return peak;
}

/** "3 người bỏ dở · nhiều nhất ở câu 8 (trả lời ngắn)" */
export function dropOffSummary(quality: Pick<FormQuality, "dropOff" | "abandoned">): string {
  if (quality.abandoned === 0) return "Chưa ai bỏ dở giữa chừng";
  const peak = peakDropOff(quality);
  const head = `${quality.abandoned} người bỏ dở`;
  return peak ? `${head} · nhiều nhất ở câu ${peak.questionNumber} (${questionTypeName(peak.questionType)})` : head;
}

/** "Độ chắc chắn: trung bình" */
export function confidenceLabel(confidence: FormQuality["confidence"]): string | null {
  if (!confidence) return null;
  const word = confidence === "HIGH" ? "cao" : confidence === "MEDIUM" ? "trung bình" : "thấp";
  return `Độ chắc chắn: ${word}`;
}

export type SuggestionIcon = "text-lines" | "refresh" | "hourglass" | "shield-check" | "info";

export interface SuggestionView {
  icon: SuggestionIcon;
  title: string;
  body: string;
  fixedInVersion: number | null;
}

type Suggestion = FormQuality["suggestions"][number];

const num = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

export function suggestionView(suggestion: Suggestion): SuggestionView {
  const p = suggestion.params;
  const q = num(p.questionNumber);
  const fixedInVersion = suggestion.fixedInVersion;
  switch (suggestion.code) {
    case "DROP_OFF_QUESTION": {
      const type = typeof p.questionType === "string" ? (p.questionType as FormBlockType) : null;
      const what = type ? `câu ${questionTypeName(type)}${p.required ? " bắt buộc" : ""}` : "câu này";
      return {
        icon: "text-lines",
        title: `Câu ${q} khiến người trả lời dừng lại`,
        body: `${num(p.count)} người thoát ở ${what}.${p.required ? " Cân nhắc để câu này không bắt buộc." : " Thử viết câu hỏi ngắn và rõ hơn."}`,
        fixedInVersion,
      };
    }
    case "ANSWER_CHANGES":
      return {
        icon: "refresh",
        title: `Câu ${q} có nhiều lần đổi đáp án`,
        body: "Nhiều lựa chọn giống nhau có thể gây phân vân. Thử gộp hoặc viết rõ hơn.",
        fixedInVersion,
      };
    case "EFFORT_OVERESTIMATED":
      return {
        icon: "hourglass",
        title: "Thời gian khai dài hơn thực tế",
        body: `Phần lớn làm xong trong khoảng ${num(p.medianMinutes)} phút. Có thể khai ${num(p.medianMinutes)} phút cho lần mở lại.`,
        fixedInVersion,
      };
    case "EFFORT_UNDERESTIMATED":
      return {
        icon: "hourglass",
        title: "Thời gian khai ngắn hơn thực tế",
        body: `Phần lớn cần khoảng ${num(p.medianMinutes)} phút. Khai đúng thời gian giúp người trả lời không bỏ dở.`,
        fixedInVersion,
      };
    case "RESPONSE_QUALITY":
      return {
        icon: "shield-check",
        title: "Chất lượng câu trả lời",
        body: `${num(p.passed)} Đạt · ${num(p.needsReview)} Cần xem lại. ${
          p.normal === false ? "Tỷ lệ cần xem lại cao hơn thường lệ, nên kiểm tra kỹ." : `Tỷ lệ này bình thường với form ${num(p.questionCount)} câu.`
        }`,
        fixedInVersion,
      };
    default:
      return { icon: "info", title: "Gợi ý", body: "Xem lại form để người trả lời làm dễ hơn.", fixedInVersion };
  }
}

export const QUALITY_DISCLAIMER =
  "Đánh giá khảo sát chỉ giúp bạn cải thiện form. Nó không làm giảm độ tin cậy của người trả lời, và người trả lời không bị đánh giá thấp vì khảo sát khó. Phiên bản mới bắt đầu một lịch sử đánh giá riêng.";
