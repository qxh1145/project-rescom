import type { FormBlock } from "@rescom/schemas";
import type { AiChatMessage, AiConversation, AiDraft, AiDurationBucket, AiMessageOptions } from "../../lib/forms/builder-ai.ts";
import { randomUuid } from "../../lib/random-uuid.ts";

/**
 * Deterministic "Soạn bằng AI" assistant for MSW (ASSUMED routes, see
 * `lib/forms/builder-ai.ts`): canned Vietnamese replies whose drafts are
 * valid `form-blocks`. Pure (no storage) so it is unit-tested.
 */

const newId = () => randomUuid();
const nowIso = () => new Date().toISOString();

// --- Block helpers (valid `formBlockSchema` blocks) ---

export function choice(
  id: string,
  title: string,
  labels: string[],
  options: { multiple?: boolean; required?: boolean; attention?: string } = {},
): FormBlock {
  const block = {
    id,
    order: 0,
    type: options.multiple ? "multiple_choice" : "single_choice",
    title,
    required: options.required ?? true,
    allowOther: false,
    options: labels.map((label, i) => ({ id: `${id}-o${i + 1}`, label, value: `opt_${i + 1}` })),
  } as FormBlock;
  if (options.attention) {
    block.integrity = {
      attentionCheck: { isAttentionCheck: true, expectedValue: options.attention, failAction: "FLAG" },
      semanticCategory: "ATTENTION_CHECK",
    };
  }
  return block;
}

export const scale = (id: string, title: string, minLabel: string, maxLabel: string): FormBlock => ({
  id,
  order: 0,
  type: "linear_scale",
  title,
  required: true,
  min: 1,
  max: 5,
  step: 1,
  minLabel,
  maxLabel,
});

export const stars = (id: string, title: string): FormBlock => ({
  id,
  order: 0,
  type: "rating",
  title,
  required: true,
  maxRating: 5,
  ratingShape: "STAR",
});

export const paragraph = (id: string, title: string, required = false): FormBlock => ({
  id,
  order: 0,
  type: "textarea",
  title,
  required,
  placeholder: "Người trả lời nhập đoạn văn ở đây",
});

export const numberBlock = (id: string, title: string): FormBlock => ({
  id,
  order: 0,
  type: "number",
  title,
  required: false,
  min: 0,
  max: 80,
  integerOnly: true,
  placeholder: "0",
});

export const ordered = (blocks: FormBlock[]): FormBlock[] => blocks.map((block, order) => ({ ...block, order }) as FormBlock);

// --- Canned AI assistant (ASSUMED routes, deterministic) ---

interface CannedTopic {
  keywords: string[];
  build: () => { title: string; description: string; sections: { title: string; summary: string; blocks: FormBlock[] }[]; checks: { blockId: string; expectedValue: string }[] };
}

const TOPICS: CannedTopic[] = [
  {
    keywords: ["học nhóm", "hoc nhom", "tự học", "nhóm"],
    build: () => ({
      title: "Thói quen học nhóm của sinh viên",
      description: "Khảo sát cho môn Phương pháp nghiên cứu. Khoảng 5 phút, câu trả lời được ẩn danh.",
      sections: [
        {
          title: "Thói quen học nhóm",
          summary: "tần suất, địa điểm, mức hiệu quả",
          blocks: [
            choice("ai-freq", "Bạn thường học nhóm bao nhiêu buổi mỗi tuần?", ["Không học nhóm", "1 buổi", "2–3 buổi", "Từ 4 buổi trở lên"]),
            choice("ai-place", "Bạn hay học nhóm ở đâu?", ["Thư viện trường", "Quán cà phê", "Phòng tự học", "Online (Meet, Zoom)"], { multiple: true }),
            choice("ai-day", "Hãy chọn “Thứ Tư” để tiếp tục.", ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm"]),
            scale("ai-help", "Học nhóm giúp bạn hiểu bài hơn đến mức nào?", "Không giúp gì", "Giúp rất nhiều"),
          ],
        },
        {
          title: "Trải nghiệm & góp ý",
          summary: "chấm không gian tự học, góp ý mở",
          blocks: [
            stars("ai-space", "Bạn chấm không gian tự học của trường mấy sao?"),
            choice("ai-read", "Để biết bạn đang đọc kỹ, hãy chọn “Đồng ý một phần”.", ["Đồng ý", "Đồng ý một phần", "Không đồng ý"]),
            paragraph("ai-why", "Điều gì khiến buổi học nhóm của bạn kém hiệu quả?"),
          ],
        },
      ],
      checks: [
        { blockId: "ai-day", expectedValue: "opt_3" },
        { blockId: "ai-read", expectedValue: "opt_2" },
      ],
    }),
  },
  {
    keywords: ["căng tin", "cang tin", "canteen", "ăn uống"],
    build: () => ({
      title: "Mức độ hài lòng với căng tin trường",
      description: "Khảo sát ngắn khoảng 4 phút về căng tin, câu trả lời được ẩn danh.",
      sections: [
        {
          title: "Thói quen ăn uống",
          summary: "tần suất, bữa hay ăn, chi tiêu",
          blocks: [
            choice("ai-often", "Bạn ăn ở căng tin trường bao nhiêu lần mỗi tuần?", ["Chưa bao giờ", "1–2 lần", "3–5 lần", "Gần như mỗi ngày"]),
            choice("ai-meal", "Bạn thường ăn bữa nào ở căng tin?", ["Sáng", "Trưa", "Chiều", "Tối"], { multiple: true }),
            numberBlock("ai-spend", "Mỗi bữa bạn chi khoảng bao nhiêu nghìn đồng?"),
          ],
        },
        {
          title: "Đánh giá",
          summary: "chất lượng món ăn, góp ý",
          blocks: [
            stars("ai-food", "Bạn chấm chất lượng món ăn mấy sao?"),
            choice("ai-read", "Để biết bạn đang đọc kỹ, hãy chọn “Bình thường”.", ["Rất tệ", "Bình thường", "Rất tốt"]),
            paragraph("ai-idea", "Bạn muốn căng tin cải thiện điều gì nhất?"),
          ],
        },
      ],
      checks: [{ blockId: "ai-read", expectedValue: "opt_2" }],
    }),
  },
];

function genericTopic(prompt: string): ReturnType<CannedTopic["build"]> {
  const topic = prompt.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  const title = topic.length > 60 ? `${topic.slice(0, 57).trimEnd()}…` : topic;
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    description: "Khảo sát ngắn, câu trả lời được ẩn danh.",
    sections: [
      {
        title: "Thông tin chung",
        summary: "mức độ quen thuộc, tần suất",
        blocks: [
          choice("ai-know", "Bạn quen thuộc với chủ đề này ở mức nào?", ["Chưa từng nghe", "Có biết qua", "Khá quen", "Rất quen"]),
          choice("ai-often", "Bạn gặp vấn đề này thường xuyên không?", ["Hiếm khi", "Thỉnh thoảng", "Thường xuyên"]),
        ],
      },
      {
        title: "Ý kiến của bạn",
        summary: "mức hài lòng, góp ý mở",
        blocks: [
          scale("ai-satisfied", "Bạn hài lòng đến mức nào?", "Không hài lòng", "Rất hài lòng"),
          choice("ai-read", "Để biết bạn đang đọc kỹ, hãy chọn “Có”.", ["Không", "Có"]),
          paragraph("ai-idea", "Bạn có góp ý gì thêm không?"),
        ],
      },
    ],
    checks: [{ blockId: "ai-read", expectedValue: "opt_2" }],
  };
}

function toDraft(built: ReturnType<CannedTopic["build"]>, suggestChecks: boolean): AiDraft {
  const blocks = ordered(built.sections.flatMap((section) => section.blocks));
  return {
    title: built.title,
    description: built.description,
    blocks,
    sections: built.sections.map((section, i) => ({
      id: `ai-sec-${i + 1}`,
      title: section.title,
      blockIds: section.blocks.map((block) => block.id),
    })),
    attentionSuggestions: suggestChecks ? built.checks : [],
  };
}

const DURATION_MINUTES: Record<AiDurationBucket, string> = {
  UNDER_5: "khoảng 5 phút",
  FROM_5_TO_10: "khoảng 8 phút",
  FROM_10_TO_15: "khoảng 12 phút",
  OVER_15: "khoảng 15 phút",
};

const QUICK_REPLIES = ["Rút gọn còn 5 câu", "Thêm câu về thời gian tự học", "Giọng văn thân mật hơn"];

function message(role: AiChatMessage["role"], text: string, extra: Partial<AiChatMessage> = {}): AiChatMessage {
  return { id: newId(), role, text, createdAt: nowIso(), bullets: [], hasDraft: false, quickReplies: [], ...extra };
}

function sectionTitleOf(draft: AiDraft, blockId: string): string | undefined {
  return draft.sections.find((section) => section.blockIds.includes(blockId))?.title;
}

function draftReply(draft: AiDraft, options: AiMessageOptions, lead: string, sectionSummaries?: string[]): AiChatMessage {
  const numbers = draft.attentionSuggestions.map((s) => draft.blocks.findIndex((b) => b.id === s.blockId) + 1);
  const replies = [...QUICK_REPLIES];
  if (numbers.length === 2) replies.unshift(`Giữ câu ${numbers[1]}, bỏ câu ${numbers[0]}`);
  const followUp =
    numbers.length === 0
      ? "Bạn xem lại từng câu bên phải, sửa trực tiếp trong Form Builder nếu cần."
      : numbers.length === 1
        ? `Mình gợi ý **1 câu kiểm tra chú ý** (câu ${numbers[0]}). Câu này chưa có hiệu lực cho đến khi bạn xác nhận trong Form Builder.`
        : `Mình gợi ý **${numbers.length} câu kiểm tra chú ý** (câu ${numbers.join(" và ")}). Form ngắn thường chỉ cần 1 câu, bạn muốn giữ câu nào? Cả hai chưa có hiệu lực cho đến khi bạn xác nhận.`;
  return message(
    "ASSISTANT",
    `${lead} **${draft.blocks.length} câu, chia ${draft.sections.length} phần**, ${DURATION_MINUTES[options.duration]}:`,
    {
      bullets: sectionSummaries ?? draft.sections.map((section) => `**${section.title}:** ${section.blockIds.length} câu`),
      hasDraft: true,
      followUp,
      quickReplies: replies,
    },
  );
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase();
}

function reindexDraft(draft: AiDraft, keep: (block: FormBlock) => boolean): AiDraft {
  const blocks = ordered(draft.blocks.filter(keep));
  const ids = new Set(blocks.map((block) => block.id));
  return {
    ...draft,
    blocks,
    sections: draft.sections
      .map((section) => ({ ...section, blockIds: section.blockIds.filter((id) => ids.has(id)) }))
      .filter((section) => section.blockIds.length > 0),
    attentionSuggestions: draft.attentionSuggestions.filter((s) => ids.has(s.blockId)),
  };
}

/** One assistant turn: new draft for the first prompt, deterministic edits afterwards. */
export function cannedAssistantTurn(
  conversation: Omit<AiConversation, "formId"> | null,
  text: string,
  options: AiMessageOptions,
): Omit<AiConversation, "formId"> {
  const userMessage = message("USER", text);
  const history = conversation?.messages ?? [];
  const current = conversation?.draft ?? null;
  const folded = fold(text);

  const firstPrompt = history.find((m) => m.role === "USER")?.text ?? text;
  const topic = TOPICS.find((candidate) => candidate.keywords.some((k) => fold(firstPrompt).includes(fold(k))));
  const fresh = () => toDraft(topic ? topic.build() : genericTopic(firstPrompt), options.suggestAttentionChecks);

  let draft: AiDraft;
  let reply: AiChatMessage;
  if (!current || folded.startsWith("tao lai")) {
    draft = fresh();
    const built = topic ? topic.build() : genericTopic(firstPrompt);
    reply = draftReply(draft, options, current ? "Mình đã soạn lại bản nháp" : "Mình đã soạn bản nháp", built.sections.map((s) => `**${s.title}:** ${s.summary}`));
  } else if (/giu cau (\d+).*bo cau (\d+)/.test(folded)) {
    const [, keep, drop] = folded.match(/giu cau (\d+).*bo cau (\d+)/) as RegExpMatchArray;
    const dropped = current.blocks[Number(drop) - 1];
    draft = dropped ? reindexDraft(current, (block) => block.id !== dropped.id) : current;
    reply = draftReply(draft, options, `Mình đã bỏ câu ${drop} và giữ câu ${keep} làm câu kiểm tra chú ý. Bản nháp còn`);
  } else if (/rut gon.*?(\d+)/.test(folded)) {
    const target = Math.max(1, Number((folded.match(/rut gon.*?(\d+)/) as RegExpMatchArray)[1]));
    const suggested = new Set(current.attentionSuggestions.map((s) => s.blockId));
    // Drop suggested checks first beyond the first one, then trailing questions.
    let blocks = current.blocks;
    const extraChecks = [...suggested].slice(1);
    for (const id of extraChecks) if (blocks.length > target) blocks = blocks.filter((block) => block.id !== id);
    const keepIds = new Set(blocks.slice(0, target).map((block) => block.id));
    draft = reindexDraft(current, (block) => keepIds.has(block.id));
    reply = draftReply(draft, options, "Mình đã rút gọn bản nháp còn");
  } else if (folded.startsWith("them cau")) {
    const topicText = text.replace(/^thêm câu( hỏi)?( về)?/i, "").trim() || "thói quen của bạn";
    const block = fold(topicText).includes("thoi gian")
      ? numberBlock(`ai-extra-${history.length}`, `Mỗi tuần bạn dành khoảng bao nhiêu giờ cho ${topicText.replace(/^thời gian\s*/i, "") || "việc này"}?`)
      : choice(`ai-extra-${history.length}`, `Bạn đánh giá thế nào về ${topicText}?`, ["Chưa tốt", "Bình thường", "Tốt"]);
    const firstSection = current.sections[0];
    draft = {
      ...current,
      blocks: ordered([
        ...current.blocks.slice(0, firstSection ? firstSection.blockIds.length : current.blocks.length),
        block,
        ...current.blocks.slice(firstSection ? firstSection.blockIds.length : current.blocks.length),
      ]),
      sections: current.sections.map((section, i) => (i === 0 ? { ...section, blockIds: [...section.blockIds, block.id] } : section)),
    };
    reply = draftReply(draft, options, `Mình đã thêm câu “${block.title}” vào ${sectionTitleOf(draft, block.id) ?? "bản nháp"}. Bản nháp giờ có`);
  } else if (folded.includes("than mat")) {
    draft = {
      ...current,
      description: "Chào bạn! Mình đang làm khảo sát nhỏ, mất khoảng 5 phút thôi, câu trả lời được ẩn danh nha.",
      blocks: current.blocks.map((block) => ({ ...block, title: block.title.replace(/^Bạn /, "Cậu ") }) as FormBlock),
    };
    reply = draftReply(draft, options, "Mình đã đổi giọng văn thân mật hơn. Bản nháp vẫn có");
  } else {
    draft = current;
    reply = message(
      "ASSISTANT",
      "Mình chưa rõ bạn muốn đổi gì. Bạn có thể yêu cầu **rút gọn**, **thêm câu về một chủ đề** hoặc **đổi giọng văn**.",
      { quickReplies: QUICK_REPLIES },
    );
  }

  return { messages: [...history, userMessage, reply], draft, options, updatedAt: nowIso() };
}

const SUGGESTED_BLOCKS: ((n: number) => FormBlock)[] = [
  (n) => choice(`ai-sg-${n}`, "Bạn biết đến khảo sát này qua đâu?", ["Bạn bè", "Nhóm lớp", "Mạng xã hội", "Khác"]),
  (n) => scale(`ai-sg-${n}`, "Bạn có sẵn sàng giới thiệu cho bạn bè không?", "Không bao giờ", "Chắc chắn có"),
  (n) => paragraph(`ai-sg-${n}`, "Bạn muốn chia sẻ thêm điều gì?"),
];

/** ASSUMED `POST /forms/:id/ai/suggest-block` (13f "Để AI gợi ý câu hỏi"). */
export function cannedSuggestedBlock(existingCount: number): FormBlock {
  return SUGGESTED_BLOCKS[existingCount % SUGGESTED_BLOCKS.length](existingCount + 1);
}
