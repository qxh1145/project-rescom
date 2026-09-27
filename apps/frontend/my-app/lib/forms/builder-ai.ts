import { formBlockSchema, generateBlockId, type BlockIntegrityMetadata, type FormBlock } from "@rescom/schemas";
import { z } from "zod";
import {
  normalizeDoc,
  setAttentionCheck,
  supportsAttentionCheck,
  type BuilderDoc,
  type BuilderSection,
} from "./builder-blocks.ts";

/**
 * "Soạn bằng AI" (Figma 13b / 13b' / 13c / 13g / 13h).
 *
 * ASSUMED API CONTRACT — the backend only has `POST /forms/ai/prepare-prompt`
 * (VERIFIED, `ai-forms.controller.ts`), which builds an AI-gateway payload and
 * returns no questions. The chat, the draft and the one-question suggestion
 * are frontend-designed:
 *
 * - `GET  /forms/:id/ai/conversation` → `AiConversation` (404 `AI_CONVERSATION_NOT_FOUND` = none yet)
 * - `POST /forms/:id/ai/messages` `{ message, options }` → `AiConversation`
 * - `POST /forms/:id/ai/suggest-block` `{ sectionTitle? }` → `{ block, attentionSuggestion }`
 *
 * The draft carries **valid `form-blocks`** (`formBlockSchema`) but never an
 * active attention check: suggested checks travel separately in
 * `attentionSuggestions` and only become `integrity.attentionCheck` when the
 * publisher confirms them in the builder (13c "Xác nhận").
 */

export const AI_DURATION_BUCKETS = ["UNDER_5", "FROM_5_TO_10", "FROM_10_TO_15", "OVER_15"] as const;
export type AiDurationBucket = (typeof AI_DURATION_BUCKETS)[number];

export const AI_DURATION_LABELS: Record<AiDurationBucket, string> = {
  UNDER_5: "Dưới 5 phút",
  FROM_5_TO_10: "5–10 phút",
  FROM_10_TO_15: "10–15 phút",
  OVER_15: "Trên 15 phút",
};

export const aiMessageOptionsSchema = z.object({
  duration: z.enum(AI_DURATION_BUCKETS),
  suggestAttentionChecks: z.boolean(),
});
export type AiMessageOptions = z.infer<typeof aiMessageOptionsSchema>;

export const aiMessageInputSchema = z.object({
  message: z.string().trim().min(1, "Hãy nhập yêu cầu.").max(4000, "Yêu cầu tối đa 4.000 ký tự."),
  options: aiMessageOptionsSchema,
});
export type AiMessageInput = z.infer<typeof aiMessageInputSchema>;

export const aiAttentionSuggestionSchema = z.object({
  blockId: z.string().min(1).max(100),
  expectedValue: z.union([z.string().min(1), z.number().finite(), z.array(z.string().min(1)).min(1)]),
});
export type AiAttentionSuggestion = z.infer<typeof aiAttentionSuggestionSchema>;

export const aiDraftSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  blocks: z.array(formBlockSchema).max(200),
  sections: z.array(z.object({ id: z.string().min(1), title: z.string().min(1).max(200), blockIds: z.array(z.string()) })),
  attentionSuggestions: z.array(aiAttentionSuggestionSchema).default([]),
});
export type AiDraft = z.infer<typeof aiDraftSchema>;

export const aiChatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["USER", "ASSISTANT"]),
  /** Plain text; `**…**` marks bold runs (rendered without HTML). */
  text: z.string(),
  createdAt: z.string(),
  /** Bullet lines under the text ("**Thói quen học nhóm:** tần suất…"). */
  bullets: z.array(z.string()).default([]),
  /** Whether this answer produced / changed the draft (shows the draft card). */
  hasDraft: z.boolean().default(false),
  /** Follow-up paragraph after the draft card. */
  followUp: z.string().optional(),
  quickReplies: z.array(z.string()).default([]),
});
export type AiChatMessage = z.infer<typeof aiChatMessageSchema>;

export const aiConversationSchema = z.object({
  formId: z.string().uuid(),
  messages: z.array(aiChatMessageSchema),
  draft: aiDraftSchema.nullable(),
  options: aiMessageOptionsSchema,
  updatedAt: z.string(),
});
export type AiConversation = z.infer<typeof aiConversationSchema>;

export const aiSuggestedBlockSchema = z.object({
  block: formBlockSchema,
  attentionSuggestion: aiAttentionSuggestionSchema.nullable().default(null),
});
export type AiSuggestedBlock = z.infer<typeof aiSuggestedBlockSchema>;

/** Splits `**bold**` markup into runs for rendering. */
/**
 * The draft an AI chat path names (`/forms/:id/builder/ai`); null for a new
 * chat (`/forms/new/builder/ai`) or any other path.
 */
export function formIdFromAiPath(pathname: string): string | null {
  const match = /^\/forms\/([^/]+)\/builder\/ai\/?$/.exec(pathname);
  if (!match || match[1] === "new") return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** Words of the first prompt that name an AI chat (and the draft it creates). */
export const CHAT_TITLE_MAX_WORDS = 10;
/** Form titles are capped at 200 characters (`form-draft.schema`). */
const CHAT_TITLE_MAX_CHARS = 200;

/**
 * Chat title from a prompt: its first `CHAT_TITLE_MAX_WORDS` words, without
 * trailing punctuation. Empty when the prompt has no words.
 */
export function chatTitleFromPrompt(prompt: string): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean).slice(0, CHAT_TITLE_MAX_WORDS);
  return words
    .join(" ")
    .slice(0, CHAT_TITLE_MAX_CHARS)
    .replace(/[\s,.;:!?…–—-]+$/u, "")
    .trim();
}

export function boldRuns(text: string): { text: string; bold: boolean }[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**") ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false },
    );
}

/** Whether `expected` is an answer the block can accept (mirrors `validateAttentionChecks`). */
export function isValidExpectedValue(block: FormBlock, expected: AiAttentionSuggestion["expectedValue"]): boolean {
  switch (block.type) {
    case "single_choice":
      return typeof expected === "string" && block.options.some((option) => option.value === expected);
    case "multiple_choice": {
      const list = Array.isArray(expected) ? expected : [expected];
      return list.length > 0 && list.every((value) => typeof value === "string" && block.options.some((o) => o.value === value));
    }
    case "rating":
      return typeof expected === "number" && Number.isInteger(expected) && expected >= 1 && expected <= block.maxRating;
    case "linear_scale":
      return (
        typeof expected === "number" &&
        expected >= block.min &&
        expected <= block.max &&
        (expected - block.min) % (block.step ?? 1) === 0
      );
    default:
      return false;
  }
}

function withoutAttentionCheck(block: FormBlock): FormBlock {
  if (!block.integrity?.attentionCheck) return block;
  return setAttentionCheck(block, null);
}

export interface AppliedAiDraft {
  doc: BuilderDoc;
  /** Attention checks waiting for "Xác nhận" / "Bỏ gợi ý" (13c). */
  pending: AiAttentionSuggestion[];
  /** Blocks written by the assistant ("AI" chip). */
  aiBlockIds: string[];
  /** Blocks the assistant sent that failed `formBlockSchema` (skipped). */
  skipped: number;
}

/**
 * Maps an AI draft onto the builder (13b' "Mở trong Form Builder" → 13c). The
 * draft replaces the current content (the caller keeps the previous document
 * for "Hoàn tác"). Blocks get fresh ids; any attention check the assistant
 * put inside a block is removed; suggestions are kept only when they point at
 * a supported block with a selectable answer.
 */
export function applyAiDraft(current: BuilderDoc, draft: AiDraft, makeId: () => string = generateBlockId): AppliedAiDraft {
  const idMap = new Map<string, string>();
  const blocks: FormBlock[] = [];
  let skipped = 0;
  for (const raw of draft.blocks) {
    const parsed = formBlockSchema.safeParse(raw);
    if (!parsed.success || idMap.has(raw.id)) {
      skipped += 1;
      continue;
    }
    const id = makeId();
    idMap.set(raw.id, id);
    const block = withoutAttentionCheck({ ...parsed.data, id } as FormBlock);
    // A pair pointing at a skipped / renamed block is remapped or dropped.
    const pair = block.integrity?.consistencyPair;
    if (pair) {
      const target = idMap.get(pair.pairedBlockId) ?? null;
      const integrity: BlockIntegrityMetadata = { ...block.integrity };
      if (target) integrity.consistencyPair = { ...pair, pairedBlockId: target };
      else delete integrity.consistencyPair;
      blocks.push({ ...block, integrity } as FormBlock);
    } else {
      blocks.push(block);
    }
  }
  const sections: BuilderSection[] = draft.sections
    .map((section) => ({
      id: `sec-${makeId().slice(-12)}`,
      title: section.title,
      blockIds: section.blockIds.flatMap((id) => (idMap.has(id) ? [idMap.get(id) as string] : [])),
    }))
    .filter((section) => section.blockIds.length > 0);
  const doc = normalizeDoc({
    ...current,
    title: draft.title,
    description: draft.description,
    blocks,
    sections,
  });
  const byId = new Map(doc.blocks.map((block) => [block.id, block]));
  const pending = draft.attentionSuggestions.flatMap((suggestion) => {
    const blockId = idMap.get(suggestion.blockId);
    const block = blockId ? byId.get(blockId) : undefined;
    if (!block || !supportsAttentionCheck(block) || !isValidExpectedValue(block, suggestion.expectedValue)) return [];
    return [{ blockId: block.id, expectedValue: suggestion.expectedValue }];
  });
  return { doc, pending, aiBlockIds: doc.blocks.map((block) => block.id), skipped };
}

/** 13c "Xác nhận": the suggestion becomes an active attention check (answer may be changed first). */
export function confirmAttentionSuggestion(
  doc: BuilderDoc,
  pending: readonly AiAttentionSuggestion[],
  blockId: string,
  expectedValue?: AiAttentionSuggestion["expectedValue"],
): { doc: BuilderDoc; pending: AiAttentionSuggestion[] } {
  const suggestion = pending.find((item) => item.blockId === blockId);
  const index = doc.blocks.findIndex((block) => block.id === blockId);
  if (!suggestion || index < 0) return { doc, pending: [...pending] };
  const block = doc.blocks[index];
  const answer = expectedValue ?? suggestion.expectedValue;
  if (!isValidExpectedValue(block, answer)) return { doc, pending: [...pending] };
  const blocks = [...doc.blocks];
  blocks[index] = setAttentionCheck(block, answer);
  return { doc: { ...doc, blocks }, pending: pending.filter((item) => item.blockId !== blockId) };
}

/** 13c "Bỏ gợi ý": the question stays as a normal question. */
export function dismissAttentionSuggestion(
  pending: readonly AiAttentionSuggestion[],
  blockId: string,
): AiAttentionSuggestion[] {
  return pending.filter((item) => item.blockId !== blockId);
}

/** Suggestions whose block was deleted or changed so the answer no longer fits are dropped. */
export function prunePendingSuggestions(doc: BuilderDoc, pending: readonly AiAttentionSuggestion[]): AiAttentionSuggestion[] {
  const byId = new Map(doc.blocks.map((block) => [block.id, block]));
  const next = pending.filter((item) => {
    const block = byId.get(item.blockId);
    return block !== undefined && isValidExpectedValue(block, item.expectedValue);
  });
  return next.length === pending.length ? (pending as AiAttentionSuggestion[]) : next;
}

/** Label of an expected answer ("Đồng ý một phần", "5 sao"…). */
export function expectedAnswerLabel(block: FormBlock, expected: AiAttentionSuggestion["expectedValue"]): string {
  if (block.type === "single_choice" || block.type === "multiple_choice") {
    const values = Array.isArray(expected) ? expected : [expected];
    return values
      .map((value) => block.options.find((option) => option.value === value)?.label ?? String(value))
      .join(", ");
  }
  if (block.type === "rating") return `${String(expected)} sao`;
  return String(expected);
}
