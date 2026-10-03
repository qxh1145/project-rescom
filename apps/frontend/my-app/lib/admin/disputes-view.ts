import { PILOT_BUILD } from "../pilot-scope.ts";
import { formatDayMonth, formatShortDateTime, formatTime } from "../format/date-time.ts";
import { DISPUTE_REASON_LABELS } from "../forms/manage-messages.ts";
import {
  DECISION_NOTE_MAX,
  DECISION_NOTE_MIN,
  type DisputeCase,
  type DisputeCaseKind,
  type DisputeCaseOutcome,
  type FraudLogType,
} from "./disputes-service.ts";

/**
 * Pure view rules of "Khiếu nại & báo lỗi" (Figma 11c, 62:1609). Only the
 * `ATTEMPT_DISPUTE` card is drawn; the missing-code and locked-attempt copy
 * reuses its anatomy and is ASSUMED.
 */

const ALL_DISPUTE_TABS: ReadonlyArray<{ kind: DisputeCaseKind; label: string }> = [
  { kind: "ATTEMPT_DISPUTE", label: "Khiếu nại lượt làm" },
  { kind: "MISSING_CODE", label: "Báo thiếu mã" },
  { kind: "LOCKED_ATTEMPT", label: "Lượt bị khoá" },
];

/** Pilot build: only the real "Báo thiếu mã" tab (disputes and locked attempts are mock-only). */
export const DISPUTE_TABS = PILOT_BUILD ? ALL_DISPUTE_TABS.filter((tab) => tab.kind === "MISSING_CODE") : ALL_DISPUTE_TABS;

/** ASSUMED (design) empty states (not drawn). */
export const EMPTY_TAB_COPY: Record<DisputeCaseKind, string> = {
  ATTEMPT_DISPUTE: "Không có khiếu nại lượt làm nào đang chờ.",
  MISSING_CODE: "Không có báo cáo thiếu mã nào đang chờ.",
  LOCKED_ATTEMPT: "Không có lượt làm bị khoá nào cần xem lại.",
};

/** Open cases of one tab, most urgent first (disputes by review end, others oldest first). */
export function casesOfKind(cases: readonly DisputeCase[], kind: DisputeCaseKind): DisputeCase[] {
  const urgency = (item: DisputeCase) => item.reviewEndsAt ?? item.createdAt;
  return cases
    .filter((item) => item.kind === kind && item.status === "OPEN")
    .sort((a, b) => urgency(a).localeCompare(urgency(b)));
}

/** First shown tab with work, else the first shown tab. */
export function defaultTab(counts: Record<DisputeCaseKind, number> | undefined): DisputeCaseKind {
  return DISPUTE_TABS.find((tab) => (counts?.[tab.kind] ?? 0) > 0)?.kind ?? DISPUTE_TABS[0].kind;
}

const HOUR_MS = 3_600_000;

/** Whole hours left until `iso` (rounded up, 0 once passed). */
export function hoursLeft(iso: string | null, now: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / HOUR_MS));
}

/** "3 phút 05 giây" · "45 giây" · "1 giờ 02 phút". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours} giờ ${String(minutes).padStart(2, "0")} phút`;
  if (minutes > 0) return `${minutes} phút ${String(rest).padStart(2, "0")} giây`;
  return `${rest} giây`;
}

/** "8 phút" (publisher estimate, whole minutes). */
function formatEstimate(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} phút`;
}

/** "15:07:05" in Vietnam time (the zone offset is whole hours, so seconds are UTC seconds). */
export function formatClock(iso: string): string {
  const time = formatTime(iso);
  if (!time) return "";
  return `${time}:${String(new Date(iso).getUTCSeconds()).padStart(2, "0")}`;
}

function surveyTypeLabel(type: DisputeCase["survey"]["type"]): string {
  return type === "EXTERNAL" ? "Google Forms" : "Trong Rescom";
}

/** Red pill above the title. */
export function urgencyLabel(item: DisputeCase, now: number): string {
  switch (item.kind) {
    case "ATTEMPT_DISPUTE": {
      const hours = hoursLeft(item.reviewEndsAt, now);
      return hours > 0
        ? `Điểm còn chờ ${hours} giờ · xử lý trước khi tự chuyển`
        : "Đã quá 48 giờ · điểm vẫn giữ đến khi có quyết định";
    }
    case "MISSING_CODE":
      return `Báo lúc ${formatShortDateTime(item.createdAt)} · xử lý trong 24 giờ làm việc`;
    case "LOCKED_ATTEMPT":
      return `Khoá lúc ${formatShortDateTime(item.createdAt)} · ${item.attempt.wrongCodeCount} lần sai mã`;
  }
}

/** ASSUMED (design) queue chip when a tab holds several cases (Figma draws one): "#7F3A · còn 31 giờ". */
export function queueChipLabel(item: DisputeCase, now: number): string {
  if (item.kind === "ATTEMPT_DISPUTE") {
    const hours = hoursLeft(item.reviewEndsAt, now);
    return `${item.respondent.code} · ${hours > 0 ? `còn ${hours} giờ` : "quá 48 giờ"}`;
  }
  return `${item.respondent.code} · ${formatShortDateTime(item.createdAt)}`;
}

/** Confirmation shown after a decision (ASSUMED (design) copy). */
export function resolvedMessage(item: DisputeCase, outcome: DisputeCaseOutcome): string {
  const code = item.respondent.code;
  const points = `${item.amount} điểm`;
  switch (outcome) {
    case "REFUND_TO_PUBLISHER":
      return `Đã chấp nhận khiếu nại về ${code}: ${points} hoàn vào Khả dụng của người đăng “${item.survey.title}”. Hai bên đã được thông báo.`;
    case "RELEASE_TO_RESPONDENT":
      return `Đã bác bỏ khiếu nại: ${points} chuyển vào Khả dụng của ${code}. Hai bên đã được thông báo.`;
    case "CREDIT_RESPONDENT":
      return `Đã cộng ${points} cho ${code}.`;
    case "CODE_LIMIT_RESET":
      return `Đã mở lại giới hạn mã hoàn thành cho ${code}.`;
    case "DISMISSED":
      return `Đã đóng mục của ${code}, không thay đổi điểm.`;
  }
}

export function caseTitle(item: DisputeCase): string {
  const code = item.respondent.code;
  switch (item.kind) {
    case "ATTEMPT_DISPUTE":
      return `${item.reporter.name} khiếu nại lượt làm của người dùng ${code}`;
    case "MISSING_CODE":
      return `Người dùng ${code} báo thiếu mã hoàn thành`;
    case "LOCKED_ATTEMPT":
      return `Lượt làm của người dùng ${code} bị khoá`;
  }
}

/** "Khảo sát: Thói quen đọc sách của sinh viên · Google Forms · 10 điểm" */
export function caseSubtitle(item: DisputeCase): string {
  return `Khảo sát: ${item.survey.title} · ${surveyTypeLabel(item.survey.type)} · ${item.amount} điểm`;
}

/** Label of the description block, with the dispute reason chip when there is one. */
export function descriptionHeading(item: DisputeCase): string {
  if (item.kind === "ATTEMPT_DISPUTE") {
    return item.reason && item.reason !== "OTHER"
      ? `Mô tả của người đăng · ${DISPUTE_REASON_LABELS[item.reason]}`
      : "Mô tả của người đăng";
  }
  return "Mô tả của người trả lời";
}

export interface TimelineSegment {
  text: string;
  strong?: boolean;
}

export interface TimelineRow {
  at: string;
  /** "15:07:05" */
  time: string;
  segments: TimelineSegment[];
}

/** "Dòng thời gian lượt làm" rows, oldest first. */
export function timelineOf(item: DisputeCase): TimelineRow[] {
  const { attempt } = item;
  const declared = attempt.declaredEffortSeconds;
  const declaredSuffix = declared ? ` (khai ${formatEstimate(declared)})` : "";
  const since = (iso: string) => (Date.parse(iso) - Date.parse(attempt.startedAt)) / 1000;
  const rows: Array<Omit<TimelineRow, "time">> = [
    { at: attempt.startedAt, segments: [{ text: "Bắt đầu lượt làm, mở Google Form" }] },
  ];
  if (item.kind === "ATTEMPT_DISPUTE" && attempt.codeVerifiedAt) {
    rows.push(
      {
        at: attempt.codeVerifiedAt,
        segments: [
          { text: "Nhập đúng mã hoàn thành · " },
          { text: formatDuration(since(attempt.codeVerifiedAt)), strong: true },
          { text: declaredSuffix },
        ],
      },
      { at: attempt.codeVerifiedAt, segments: [{ text: `${item.amount} điểm vào mục Chờ 48 giờ` }] },
    );
  }
  if (item.kind === "MISSING_CODE") {
    if (attempt.wrongCodeCount > 0) {
      rows.push({ at: item.createdAt, segments: [{ text: `Đã nhập sai mã ${attempt.wrongCodeCount} lần` }] });
    }
    rows.push({
      at: item.createdAt,
      segments: [
        { text: "Báo thiếu mã hoàn thành · sau " },
        { text: formatDuration(since(item.createdAt)), strong: true },
        { text: declaredSuffix },
      ],
    });
  }
  if (item.kind === "LOCKED_ATTEMPT") {
    rows.push({
      at: item.createdAt,
      segments: [
        { text: "Nhập sai mã " },
        { text: `${attempt.wrongCodeCount} lần`, strong: true },
        { text: " · lượt làm bị khoá" },
      ],
    });
  }
  return rows.map((row) => ({ ...row, time: formatClock(row.at) }));
}

/** CURRENT attempt status shown on the case (backend `AttemptStatus`, ASSUMED copy). */
export const ATTEMPT_STATUS_LABELS: Record<DisputeCase["attempt"]["status"], string> = {
  IN_PROGRESS: "Đang làm",
  COMPLETED: "Đã hoàn thành",
  ABANDONED: "Đã huỷ hoặc hết hạn",
  LOCKED: "Bị khoá",
};

/** ASSUMED: the only FraudLog written by participation as SECURITY_VIOLATION is a wrong completion code. */
export const FRAUD_LOG_LABELS: Record<FraudLogType, string> = {
  TIME_BARRIER: "Nộp quá nhanh",
  RATE_LIMIT: "Vượt giới hạn tần suất",
  SECURITY_VIOLATION: "Sai mã hoàn thành",
  DEMO_MISMATCH: "Lệch thông tin nhân khẩu",
  RECAPTCHA_FAIL: "Không qua kiểm tra chống bot",
};

/** "Tham gia 20/09 · 14 lượt làm · 5 mục FraudLog trong 14 ngày" */
export function respondentSummary(respondent: DisputeCase["respondent"]): string {
  const parts = [
    respondent.joinedAt ? `Tham gia ${formatDayMonth(respondent.joinedAt)}` : null,
    `${respondent.attemptCount} lượt làm`,
    `${respondent.fraudLogCount} mục FraudLog trong 14 ngày`,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** "+2 mục khác" below the listed FraudLog entries; 0 = nothing hidden. */
export function hiddenFraudLogCount(respondent: DisputeCase["respondent"]): number {
  return Math.max(0, respondent.fraudLogCount - respondent.recentFraudLogs.length);
}

export interface CaseAction {
  outcome: DisputeCaseOutcome;
  label: string;
  primary: boolean;
  /** Confirm dialog. */
  confirmTitle: string;
  confirmBody: string;
  confirmLabel: string;
  /** Why the button is disabled (shown next to it); absent = enabled. */
  disabledReason?: string;
}

/** Decision buttons, secondary first (Figma: "Bác bỏ khiếu nại" left of the green button). */
export function actionsOf(item: DisputeCase): CaseAction[] {
  const points = `${item.amount} điểm`;
  const code = item.respondent.code;
  const survey = `“${item.survey.title}”`;
  switch (item.kind) {
    case "ATTEMPT_DISPUTE":
      return [
        {
          outcome: "RELEASE_TO_RESPONDENT",
          label: "Bác bỏ khiếu nại",
          primary: false,
          confirmTitle: "Bác bỏ khiếu nại?",
          confirmBody: `Lượt làm của ${code} được giữ là hợp lệ. ${points} đang giữ chuyển vào Khả dụng của người trả lời. Cả hai bên nhận email kèm lý do.`,
          confirmLabel: "Bác bỏ khiếu nại",
        },
        {
          outcome: "REFUND_TO_PUBLISHER",
          label: `Chấp nhận · hoàn ${points} cho người đăng`,
          primary: true,
          confirmTitle: "Chấp nhận khiếu nại?",
          confirmBody: `Lượt làm của ${code} bị đánh dấu không hợp lệ. ${points} hoàn vào Khả dụng của người đăng ${survey}. Tài khoản ${code} không bị khoá. Cả hai bên nhận email kèm lý do.`,
          confirmLabel: "Chấp nhận khiếu nại",
        },
      ];
    case "MISSING_CODE": {
      const actions: CaseAction[] = [
        {
          outcome: "DISMISSED",
          label: "Bác bỏ báo cáo",
          primary: false,
          confirmTitle: "Bác bỏ báo cáo thiếu mã?",
          confirmBody: `Không cộng điểm cho ${code}. Người trả lời nhận thông báo kèm lý do.`,
          confirmLabel: "Bác bỏ báo cáo",
        },
      ];
      if (item.attempt.wrongCodeCount > 0) actions.push(resetAction(code, survey));
      actions.push({
        outcome: "CREDIT_RESPONDENT",
        label: `Cộng ${points} cho người trả lời`,
        primary: true,
        confirmTitle: `Cộng ${points} thủ công?`,
        confirmBody: `Lượt làm của ${code} được xác nhận hoàn thành. ${points} lấy từ ký quỹ của ${survey} vào Khả dụng của người trả lời. Người đăng và người trả lời nhận thông báo kèm lý do.`,
        confirmLabel: `Cộng ${points}`,
        // The respondent entered the code after reporting: the attempt already earned its reward.
        ...(item.attempt.status === "COMPLETED"
          ? { disabledReason: "Lượt làm đã hoàn thành (người trả lời đã nhập đúng mã) nên không cộng điểm thêm." }
          : {}),
      });
      return actions;
    }
    case "LOCKED_ATTEMPT":
      return [
        {
          outcome: "DISMISSED",
          label: "Giữ khoá",
          primary: false,
          confirmTitle: "Giữ khoá lượt làm?",
          confirmBody: `Các lần sai mã của ${code} vẫn được tính. Người trả lời nhận thông báo kèm lý do.`,
          confirmLabel: "Giữ khoá",
        },
        { ...resetAction(code, survey), primary: true },
      ];
  }
}

function resetAction(code: string, survey: string): CaseAction {
  return {
    outcome: "CODE_LIMIT_RESET",
    label: "Mở lại giới hạn mã",
    primary: false,
    confirmTitle: "Mở lại giới hạn mã hoàn thành?",
    confirmBody: `Xoá số lần sai mã của ${code} trên phiên bản hiện tại của ${survey} để người này làm lại. Lượt làm đã khoá và nhật ký FraudLog giữ nguyên.`,
    confirmLabel: "Mở lại giới hạn",
  };
}

/** Figma 11c note under the respondent card (disputes); ASSUMED (design) for the other kinds. */
export function sideNoteOf(kind: DisputeCaseKind): string {
  return kind === "ATTEMPT_DISPUTE"
    ? "Chấp nhận khiếu nại chỉ trả điểm của lượt này. Khoá tài khoản là quyết định riêng, hệ thống không tự khoá."
    : "Mở lại giới hạn mã không xoá lượt làm đã khoá hay nhật ký FraudLog. Khoá tài khoản là quyết định riêng.";
}

/** Error of the decision note (sent to both parties), or null when valid. */
export function validateDecisionNote(note: string): string | null {
  const length = note.trim().length;
  if (length < DECISION_NOTE_MIN) {
    return `Nhập lý do ít nhất ${DECISION_NOTE_MIN} ký tự — lý do được gửi cho cả hai bên.`;
  }
  if (length > DECISION_NOTE_MAX) return `Lý do tối đa ${DECISION_NOTE_MAX} ký tự.`;
  return null;
}
