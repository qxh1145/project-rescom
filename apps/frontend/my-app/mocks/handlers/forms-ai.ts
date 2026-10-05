import { delay, http, type RequestHandler } from "msw";
import { z } from "zod";
import { apiUrl } from "@/lib/api/config";
import { aiAdoptConversationInputSchema, aiMessageInputSchema, type AiConversation } from "@/lib/forms/builder-ai";
import { cannedAssistantTurn, cannedSuggestedBlock } from "../data/form-ai-canned";
import { createCollection, mockId } from "../db/store";
import { fail, missingCsrf, ok } from "../envelope";
import { applyScenario } from "../scenarios";

/**
 * ASSUMED API CONTRACT (`lib/forms/builder-ai.ts`): "Soạn bằng AI", Epic 3 —
 * deferred, so it stays on MSW in the hybrid mode of gate G while
 * `POST /forms` and the session are real. These handlers are therefore
 * self-contained: their own conversations keyed by form id (any UUID, the
 * mock form store is never read) and no mock session. CSRF is still
 * required on writes, like every other POST.
 */

/** Mock latency of an AI reply (ms): long enough to watch the thought line (canvas 13b₁) play. */
const AI_REPLY_DELAY_MS = 7000;

type StoredConversation = Omit<AiConversation, "formId">;

/** Conversations attached to a form, by form id. */
const conversations = createCollection<Record<string, StoredConversation>>("ai-conversations", () => ({}));
/** First answers of new chats waiting for their draft, by conversation id. */
const pendingChats = createCollection<Record<string, StoredConversation>>("ai-pending-chats", () => ({}));

const formIdSchema = z.string().uuid();

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function formIdOf(raw: unknown): string | null {
  const parsed = formIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const notFound = () => fail(404, "AI_CONVERSATION_NOT_FOUND", "No AI conversation for this form yet.");
const formNotFound = () => fail(404, "FORM_NOT_FOUND", "Form not found.");

export const formsAiHandlers: RequestHandler[] = [
  // ASSUMED API CONTRACT: POST /forms/ai/messages — first prompt of a new chat, no draft yet (Phase 6).
  http.post(apiUrl("/forms/ai/messages"), async ({ request }) => {
    const forced = await applyScenario("forms-builder");
    if (forced) return forced;
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const parsed = aiMessageInputSchema.safeParse(await readJson(request));
    if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid AI message.", { details: parsed.error.format() });
    await delay(AI_REPLY_DELAY_MS);
    const ai = cannedAssistantTurn(null, parsed.data.message, parsed.data.options);
    const conversationId = mockId();
    pendingChats.update((all) => {
      all[conversationId] = ai;
    });
    return ok({ conversationId, ...ai });
  }),

  // ASSUMED API CONTRACT: GET /forms/:id/ai/conversation (404 AI_CONVERSATION_NOT_FOUND = none yet).
  http.get(apiUrl("/forms/:id/ai/conversation"), async ({ params }) => {
    const forced = await applyScenario("forms-builder");
    if (forced) return forced;
    const formId = formIdOf(params.id);
    if (!formId) return formNotFound();
    const conversation = conversations.get()[formId];
    return conversation ? ok({ formId, ...conversation }) : notFound();
  }),

  // ASSUMED API CONTRACT: POST /forms/:id/ai/conversation { conversationId } — attach a new chat to its draft.
  http.post(apiUrl("/forms/:id/ai/conversation"), async ({ params, request }) => {
    const forced = await applyScenario("forms-builder");
    if (forced) return forced;
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const formId = formIdOf(params.id);
    if (!formId) return formNotFound();
    const parsed = aiAdoptConversationInputSchema.safeParse(await readJson(request));
    if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid conversation id.", { details: parsed.error.format() });
    if (conversations.get()[formId]) return fail(409, "AI_CONVERSATION_EXISTS", "This form already has an AI conversation.");
    const pending = pendingChats.get()[parsed.data.conversationId];
    if (!pending) return fail(404, "AI_CONVERSATION_NOT_FOUND", "No pending AI conversation with this id.");
    conversations.update((all) => {
      all[formId] = pending;
    });
    pendingChats.update((all) => {
      delete all[parsed.data.conversationId];
    });
    return ok({ formId, ...pending });
  }),

  // ASSUMED API CONTRACT: POST /forms/:id/ai/messages — canned Vietnamese replies.
  http.post(apiUrl("/forms/:id/ai/messages"), async ({ params, request }) => {
    const forced = await applyScenario("forms-builder");
    if (forced) return forced;
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const formId = formIdOf(params.id);
    if (!formId) return formNotFound();
    const parsed = aiMessageInputSchema.safeParse(await readJson(request));
    if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid AI message.", { details: parsed.error.format() });
    await delay(AI_REPLY_DELAY_MS);
    const ai = cannedAssistantTurn(conversations.get()[formId] ?? null, parsed.data.message, parsed.data.options);
    conversations.update((all) => {
      all[formId] = ai;
    });
    return ok({ formId, ...ai });
  }),

  // ASSUMED API CONTRACT: POST /forms/:id/ai/suggest-block (13f "Để AI gợi ý câu hỏi").
  http.post(apiUrl("/forms/:id/ai/suggest-block"), async ({ params, request }) => {
    const forced = await applyScenario("forms-builder");
    if (forced) return forced;
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const formId = formIdOf(params.id);
    if (!formId) return formNotFound();
    const blocks = conversations.get()[formId]?.draft?.blocks.length ?? 0;
    return ok({ block: cannedSuggestedBlock(blocks), attentionSuggestion: null });
  }),
];
