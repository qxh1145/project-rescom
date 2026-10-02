import {
  formDetailSchema,
  formListSchema,
  parseFormDefinitionDraft,
  pricingQuoteSchema,
  type FormDetail,
  type PricingQuote,
  type PublishFormInput,
  type UpdateFormDraftInput,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";
import {
  aiConversationSchema,
  aiNewChatSchema,
  aiSuggestedBlockSchema,
  type AiConversation,
  type AiMessageInput,
  type AiNewChat,
  type AiSuggestedBlock,
} from "./builder-ai.ts";
import { emptyDoc, normalizeDoc, toDraftDefinition, UNTITLED_FORM, type BuilderDoc, type BuilderSection } from "./builder-blocks.ts";

/**
 * Form Builder endpoints.
 *
 * VERIFIED (`forms.controller.ts` + shared `@rescom/schemas` `publisher-form.schema`):
 * - `POST /forms` (`createFormDraftSchema`) → 201 `FormDetailDto`
 * - `GET /forms/:id` → `FormDetailDto` (owner or admin)
 * - `PATCH /forms/:id/draft` (`updateFormDraftSchema`, `clientUpdatedAt` optimistic lock) → `FormDetailDto`;
 *   409 `FORM_EDIT_CONFLICT`, 400 `INVALID_FORM_DRAFT` / `VALIDATION_ERROR`, 409 `FORM_NOT_IN_DRAFT_STATUS`
 * - `GET /forms/:id/pricing-quote` → `PricingQuoteDto`
 * - `POST /forms/:id/publish` (`publishFormSchema`) → `FormDetailDto` with status `MODERATION_QUEUE`
 *   (escrow reserved in the same unit of work); 422/400 `PRICING_REWARD_OUT_OF_BAND`, 409 `INSUFFICIENT_BALANCE`…
 * - `GET /forms?limit=` → `{ forms: FormSummaryDto[] }` (AI sidebar "Gần đây")
 *
 * Sections are stored in `currentVersion.schemaJson`. The AI routes remain
 * ASSUMED API CONTRACTS documented in `builder-ai.ts`.
 */

export const builderFormSchema = formDetailSchema;
export type BuilderForm = FormDetail;
export { pricingQuoteSchema };
export type { PricingQuote };

const PLACEHOLDER_TITLES = new Set([UNTITLED_FORM, "Untitled Survey"]);

/** Builder document of a loaded form (invalid stored JSON → an empty document). */
export function docFromForm(form: BuilderForm): { doc: BuilderDoc; valid: boolean } {
  const parsed = parseFormDefinitionDraft(form.currentVersion.schemaJson ?? {});
  if (!parsed.success) return { doc: { ...emptyDoc(), title: PLACEHOLDER_TITLES.has(form.title) ? "" : form.title }, valid: false };
  const definition = parsed.data;
  const sections: BuilderSection[] = definition.sections ?? [];
  return {
    doc: normalizeDoc({
      // The placeholder names ("Khảo sát chưa có tên", the schema default) show as an empty title.
      title: PLACEHOLDER_TITLES.has(definition.title.trim()) ? "" : definition.title,
      description: definition.description ?? "",
      blocks: definition.blocks,
      sections,
      settings: definition.settings,
      minTimeBarrierSeconds: definition.metadata.minTimeBarrierSeconds,
    }),
    valid: true,
  };
}

/** PATCH body without `clientUpdatedAt` (the autosave controller adds it). */
export type DraftPayload = Omit<UpdateFormDraftInput, "clientUpdatedAt">;

export function draftPayloadOf(doc: BuilderDoc): DraftPayload {
  const schema = toDraftDefinition(doc);
  return {
    title: schema.title,
    description: schema.description ?? null,
    schema,
  };
}

/** `title` names the draft (e.g. from the first AI prompt); blank → "Khảo sát chưa có tên". */
/** With `idempotencyKey`, a retry after a lost response returns the same draft (never a second one). */
export function createBuilderDraft({
  title,
  signal,
  idempotencyKey,
}: { title?: string; signal?: AbortSignal; idempotencyKey?: string } = {}): Promise<BuilderForm> {
  return apiRequest("/forms", {
    method: "POST",
    body: { title: title?.trim() || UNTITLED_FORM, type: "INTERNAL" },
    schema: builderFormSchema,
    signal,
    ...(idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : {}),
  });
}

export function getBuilderForm(formId: string, signal?: AbortSignal): Promise<BuilderForm> {
  return apiRequest(`/forms/${encodeURIComponent(formId)}`, { schema: builderFormSchema, signal });
}

export function saveBuilderDraft(
  formId: string,
  payload: DraftPayload &
    Partial<
      Pick<
        UpdateFormDraftInput,
        "rewardPerResponse" | "expectedCompletions" | "estimatedDurationMinutes" | "targetingJson" | "topic" | "deadlineAt"
      >
    >,
  clientUpdatedAt: string,
): Promise<BuilderForm> {
  return apiRequest(`/forms/${encodeURIComponent(formId)}/draft`, {
    method: "PATCH",
    body: { ...payload, clientUpdatedAt },
    schema: builderFormSchema,
  });
}

export function getPricingQuote(formId: string, signal?: AbortSignal): Promise<PricingQuote> {
  return apiRequest(`/forms/${encodeURIComponent(formId)}/pricing-quote`, { schema: pricingQuoteSchema, signal });
}

export function publishBuilderForm(formId: string, body: PublishFormInput): Promise<BuilderForm> {
  return apiRequest(`/forms/${encodeURIComponent(formId)}/publish`, {
    method: "POST",
    body,
    schema: builderFormSchema,
  });
}

export async function listRecentForms(signal?: AbortSignal): Promise<{ id: string; title: string }[]> {
  const result = await apiRequest("/forms?limit=5&type=INTERNAL", { schema: formListSchema, signal });
  return result.forms.map((item) => ({ id: item.id, title: item.title }));
}

// --- ASSUMED API CONTRACT: AI drafting (see builder-ai.ts) ---

export function getAiConversation(formId: string, signal?: AbortSignal): Promise<AiConversation> {
  return apiRequest(`/forms/${encodeURIComponent(formId)}/ai/conversation`, { schema: aiConversationSchema, signal });
}

export function sendAiMessage(formId: string, input: AiMessageInput, signal?: AbortSignal): Promise<AiConversation> {
  return apiRequest(`/forms/${encodeURIComponent(formId)}/ai/messages`, {
    method: "POST",
    body: input,
    schema: aiConversationSchema,
    signal,
  });
}

/** First prompt of a new chat: no draft is created for it (see `ai-new-chat.ts`). */
export function startAiChat(input: AiMessageInput, signal?: AbortSignal): Promise<AiNewChat> {
  return apiRequest("/forms/ai/messages", {
    method: "POST",
    body: input,
    schema: aiNewChatSchema,
    signal,
  });
}

/** Attaches the new chat's conversation to the draft created after its first answer. */
export function adoptAiConversation(formId: string, conversationId: string): Promise<AiConversation> {
  return apiRequest(`/forms/${encodeURIComponent(formId)}/ai/conversation`, {
    method: "POST",
    body: { conversationId },
    schema: aiConversationSchema,
  });
}

export function suggestAiBlock(formId: string, sectionTitle: string | null, signal?: AbortSignal): Promise<AiSuggestedBlock> {
  return apiRequest(`/forms/${encodeURIComponent(formId)}/ai/suggest-block`, {
    method: "POST",
    body: sectionTitle ? { sectionTitle } : {},
    schema: aiSuggestedBlockSchema,
    signal,
  });
}
