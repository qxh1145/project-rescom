import {
  formStatusEnum,
  formTypeEnum,
  parseFormDefinitionDraft,
  type PublishFormInput,
  type UpdateFormDraftInput,
} from "@rescom/schemas";
import { z } from "zod";
import { apiRequest } from "../api/client.ts";
import {
  aiConversationSchema,
  aiSuggestedBlockSchema,
  type AiConversation,
  type AiMessageInput,
  type AiSuggestedBlock,
} from "./builder-ai.ts";
import { emptyDoc, normalizeDoc, toDraftDefinition, UNTITLED_FORM, type BuilderDoc, type BuilderSection } from "./builder-blocks.ts";

/**
 * Form Builder endpoints.
 *
 * VERIFIED (`forms.controller.ts` + `packages/schemas/src/forms`):
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

export const builderFormSchema = z
  .object({
    id: z.string().uuid(),
    type: formTypeEnum,
    status: formStatusEnum,
    title: z.string(),
    description: z.string().nullable().optional(),
    rewardPerResponse: z.number().int(),
    expectedCompletions: z.number().int(),
    estimatedDurationMinutes: z.number().int().nullable().optional(),
    currentVersion: z
      .object({
        versionNumber: z.number().int(),
        schemaJson: z.unknown(),
        targetingJson: z.unknown().nullable().optional(),
      })
      .passthrough(),
    updatedAt: z.string(),
  })
  .passthrough();
export type BuilderForm = z.infer<typeof builderFormSchema>;

export const pricingQuoteSchema = z
  .object({
    type: formTypeEnum,
    expectedCompletions: z.number().int(),
    baseRewardPerResponse: z.number(),
    effectiveRewardPerResponse: z.number(),
    baseCost: z.number(),
    effectiveCost: z.number(),
    discountPercent: z.number(),
    discountAmount: z.number(),
    estimatedDurationMinutes: z.number().nullable(),
    pricingBand: z
      .object({ min: z.number(), max: z.number(), suggested: z.number(), durationBand: z.string() })
      .nullable(),
    bandCheck: z.enum(["EXEMPT", "DURATION_REQUIRED", "OUT_OF_BAND", "WITHIN_BAND"]),
  })
  .passthrough();
export type PricingQuote = z.infer<typeof pricingQuoteSchema>;

const recentFormsSchema = z
  .object({ forms: z.array(z.object({ id: z.string(), title: z.string(), type: formTypeEnum }).passthrough()) })
  .passthrough();

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
export function createBuilderDraft({ title, signal }: { title?: string; signal?: AbortSignal } = {}): Promise<BuilderForm> {
  return apiRequest("/forms", {
    method: "POST",
    body: { title: title?.trim() || UNTITLED_FORM, type: "INTERNAL" },
    schema: builderFormSchema,
    signal,
  });
}

export function getBuilderForm(formId: string, signal?: AbortSignal): Promise<BuilderForm> {
  return apiRequest(`/forms/${encodeURIComponent(formId)}`, { schema: builderFormSchema, signal });
}

export function saveBuilderDraft(
  formId: string,
  payload: DraftPayload & Partial<Pick<UpdateFormDraftInput, "rewardPerResponse" | "expectedCompletions" | "estimatedDurationMinutes" | "targetingJson">>,
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
  const result = await apiRequest("/forms?limit=5&type=INTERNAL", { schema: recentFormsSchema, signal });
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

export function suggestAiBlock(formId: string, sectionTitle: string | null, signal?: AbortSignal): Promise<AiSuggestedBlock> {
  return apiRequest(`/forms/${encodeURIComponent(formId)}/ai/suggest-block`, {
    method: "POST",
    body: sectionTitle ? { sectionTitle } : {},
    schema: aiSuggestedBlockSchema,
    signal,
  });
}
