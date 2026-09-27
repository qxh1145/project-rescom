import { AI_DURATION_LABELS, type AiDraft, type AiMessageOptions } from "./builder-ai.ts";
import { blockTypeInfo } from "./builder-catalog.ts";

/**
 * "Trợ lý đang suy nghĩ" thought line (canvas 13b₁ / 13b₂).
 *
 * `POST /forms/:id/ai/messages` (ASSUMED API CONTRACT) answers in one piece —
 * it does not stream the model's steps. So while the request is in flight the
 * client paces a fixed plan of steps (`activeStepAt`), holding the last one
 * until the answer lands, and only then fills each step's details from the
 * draft that actually came back (`completeThinking`). Nothing shown as a
 * finished step's detail is invented: it is read from the input or the draft.
 * When the backend streams real steps, feed them into `ThoughtLine` instead.
 */

export type ThoughtStepId = "read" | "length" | "sections" | "types" | "checks" | "review" | "update";
export type ThoughtStatus = "running" | "done" | "stopped";

export interface ThoughtStep {
  id: ThoughtStepId;
  /** Past-tense / neutral title ("Chia khảo sát thành phần"). */
  title: string;
  /** Title while the step is active ("Đang chia phần"). */
  activeTitle: string;
  detail?: string;
  chips?: string[];
}

/** How long each planned step stays active before the next one starts. */
export const THOUGHT_STEP_MS = 1800;
/** After this, the thought line says the assistant is slower than usual. */
export const THOUGHT_SLOW_AFTER_MS = 30_000;

const SHORT_DURATIONS: ReadonlySet<AiMessageOptions["duration"]> = new Set(["UNDER_5", "FROM_5_TO_10"]);

/** First `max` characters of `text`, on one line, with an ellipsis when cut. */
export function excerpt(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The steps shown while the request runs. A first prompt builds a whole
 * survey (6 steps, or 5 without attention checks); a follow-up edits it (3).
 */
export function planThinking(message: string, options: AiMessageOptions, followUp: boolean): ThoughtStep[] {
  const quote = `“${excerpt(message)}”`;
  if (followUp) {
    return [
      { id: "read", title: "Đọc yêu cầu chỉnh sửa", activeTitle: "Đang đọc yêu cầu chỉnh sửa", detail: quote },
      { id: "update", title: "Cập nhật bản nháp", activeTitle: "Đang cập nhật bản nháp" },
      { id: "review", title: "Rà soát câu chữ", activeTitle: "Đang rà soát câu chữ" },
    ];
  }
  const durationLabel = AI_DURATION_LABELS[options.duration];
  const lengthDetail = SHORT_DURATIONS.has(options.duration)
    ? `Nhắm “${durationLabel}”, nên giữ bản nháp gọn và ưu tiên câu chọn nhanh.`
    : `Nhắm “${durationLabel}”, nên có thể hỏi sâu hơn và xen vài câu tự luận.`;
  const steps: ThoughtStep[] = [
    { id: "read", title: "Đọc yêu cầu của bạn", activeTitle: "Đang đọc yêu cầu của bạn", detail: quote },
    { id: "length", title: "Ước lượng độ dài", activeTitle: "Đang ước lượng độ dài", detail: lengthDetail },
    { id: "sections", title: "Chia khảo sát thành phần", activeTitle: "Đang chia phần" },
    { id: "types", title: "Chọn dạng câu cho từng ý", activeTitle: "Đang chọn dạng câu cho từng ý" },
  ];
  if (options.suggestAttentionChecks) {
    steps.push({ id: "checks", title: "Đặt câu kiểm tra chú ý", activeTitle: "Đang đặt câu kiểm tra chú ý" });
  }
  steps.push({ id: "review", title: "Rà soát câu chữ", activeTitle: "Đang rà soát câu chữ" });
  return steps;
}

/** "Một lựa chọn × 3" chips, in the order types first appear in the draft. */
export function blockTypeChips(draft: AiDraft): string[] {
  const counts = new Map<string, number>();
  for (const block of draft.blocks) {
    let label: string;
    try {
      label = blockTypeInfo(block.type).label;
    } catch {
      continue;
    }
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => (count > 1 ? `${label} × ${count}` : label));
}

/** "câu 3 và câu 6" / "câu 2, câu 4 và câu 7". */
function joinQuestionNumbers(numbers: number[]): string {
  const parts = numbers.map((n) => `câu ${n}`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} và ${parts.at(-1)}`;
}

/**
 * The plan with each step's detail taken from the answer. `previous` is the
 * draft before a follow-up, to say what changed. Without a draft (the reply
 * only talked), the steps finish with the details they already had.
 */
export function completeThinking(plan: readonly ThoughtStep[], draft: AiDraft | null, previous: AiDraft | null = null): ThoughtStep[] {
  if (!draft) return plan.map((step) => ({ ...step }));
  const count = draft.blocks.length;
  return plan.map((step): ThoughtStep => {
    switch (step.id) {
      case "read":
        return previous ? { ...step } : { ...step, detail: `Đặt tên khảo sát: “${excerpt(draft.title, 80)}”.` };
      case "length":
        return { ...step, detail: `${count} câu. ${step.detail ?? ""}`.trim() };
      case "sections": {
        const titles = draft.sections.map((section) => section.title);
        return {
          ...step,
          detail:
            titles.length > 1
              ? `${titles.length} phần: ${titles.join(" · ")}.`
              : "Để chung một phần vì khảo sát ngắn.",
        };
      }
      case "types":
        return { ...step, detail: undefined, chips: blockTypeChips(draft) };
      case "checks": {
        const positions = draft.attentionSuggestions
          .map((suggestion) => draft.blocks.findIndex((block) => block.id === suggestion.blockId) + 1)
          .filter((n) => n > 0)
          .sort((a, b) => a - b);
        return {
          ...step,
          detail:
            positions.length > 0
              ? `Gợi ý ${joinQuestionNumbers(positions)} làm câu kiểm tra. Chỉ có hiệu lực khi bạn xác nhận.`
              : "Chưa có câu phù hợp để làm câu kiểm tra.",
        };
      }
      case "update": {
        const before = previous?.blocks.length ?? 0;
        const diff = count - before;
        const change = diff > 0 ? ` (thêm ${diff})` : diff < 0 ? ` (bớt ${-diff})` : "";
        return { ...step, detail: `Bản nháp giờ có ${count} câu${change}.` };
      }
      case "review":
        return { ...step, detail: "Bản nháp sẵn sàng để bạn đọc lại." };
      default:
        return { ...step };
    }
  });
}

/** Index of the active step `elapsedMs` into a run; the last step waits for the answer. */
export function activeStepAt(elapsedMs: number, count: number, stepMs: number = THOUGHT_STEP_MS): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(elapsedMs / stepMs)), count - 1);
}

/** Header label: "Đang suy nghĩ", "Đã suy nghĩ", "Đã dừng". */
export function thoughtStatusLabel(status: ThoughtStatus): string {
  if (status === "running") return "Đang suy nghĩ";
  if (status === "stopped") return "Đã dừng";
  return "Đã suy nghĩ";
}

/** "· 7 giây" while running, "trong 13 giây" when done, "sau 6 giây" when stopped. */
export function thoughtSecondsLabel(status: ThoughtStatus, seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (status === "running") return `· ${s} giây`;
  if (status === "stopped") return `sau ${s} giây`;
  return `trong ${s} giây`;
}

/** A finished run kept with the answer it produced. */
export interface SavedThought {
  messageId: string;
  status: Exclude<ThoughtStatus, "running">;
  seconds: number;
  steps: ThoughtStep[];
}

const STORAGE_PREFIX = "rescom:ai-thought:";

/**
 * The first prompt of a new survey navigates to `/forms/:id/builder/ai`, which
 * remounts the chat: the finished thought is carried over in `sessionStorage`
 * (tab-scoped, optional — failures are ignored).
 */
export function saveThought(formId: string, thought: SavedThought): void {
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + formId, JSON.stringify(thought));
  } catch {
    // Storage blocked: the collapsed summary is only a nicety.
  }
}

export function loadThought(formId: string): SavedThought | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + formId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedThought;
    if (typeof parsed?.messageId !== "string" || !Array.isArray(parsed.steps)) return null;
    return parsed;
  } catch {
    return null;
  }
}
