import { isApiError } from "../api/api-error.ts";
import { chatTitleFromPrompt, type AiConversation, type AiMessageOptions, type AiNewChat } from "./builder-ai.ts";

/**
 * First prompt of a new "Soạn bằng AI" chat (mock-off Phase 6 fix: "chat AI
 * mới tạo bản nháp mồ côi"). The draft is created only once the assistant
 * has answered:
 *
 * 1. `startChat` — `POST /forms/ai/messages`, no draft exists yet. A failure,
 *    or "Dừng", leaves nothing behind.
 * 2. `createDraft` — `POST /forms` (VERIFIED), titled after the prompt, with an
 *    `Idempotency-Key` derived from the chat: a retry after a lost response
 *    gets the same draft back.
 * 3. `adopt` — `POST /forms/:id/ai/conversation` attaches the answer to it,
 *    never aborted once the draft exists; a 404/409 (attached by a request
 *    whose response was lost) reads the conversation back instead.
 *
 * A failure in 2 or 3 keeps the answered chat (and the created draft id) in
 * `NewChatError.pending`; passing it back retries only the missing steps, so
 * a retry never asks the assistant again nor creates a second draft.
 */

export interface PendingNewChat {
  /** The first prompt the assistant answered. */
  message: string;
  chat: AiNewChat;
  /** Set once `POST /forms` succeeded. */
  formId: string | null;
}

export interface NewChatDeps {
  startChat(input: { message: string; options: AiMessageOptions }, signal?: AbortSignal): Promise<AiNewChat>;
  createDraft(input: { title: string; idempotencyKey: string }): Promise<{ id: string }>;
  adopt(formId: string, conversationId: string): Promise<AiConversation>;
  getConversation(formId: string): Promise<AiConversation>;
}

/** `Idempotency-Key` of the draft a pending chat creates: retries never make a second draft. */
export function draftIdempotencyKey(conversationId: string): string {
  return `ai-chat:${conversationId.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 100)}`.padEnd(8, "0");
}

export type NewChatStage = "ai" | "create";

export class NewChatError extends Error {
  readonly stage: NewChatStage;
  readonly failure: unknown;
  /** What already succeeded: pass it back to retry (null when the assistant did not answer). */
  readonly pending: PendingNewChat | null;

  constructor(stage: NewChatStage, failure: unknown, pending: PendingNewChat | null) {
    super(failure instanceof Error ? failure.message : "New AI chat failed");
    this.name = "NewChatError";
    this.stage = stage;
    this.failure = failure;
    this.pending = pending;
  }
}

function aborted(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

export async function sendNewChatPrompt(
  input: { message: string; options: AiMessageOptions; pending?: PendingNewChat | null; signal?: AbortSignal },
  deps: NewChatDeps,
): Promise<{ formId: string; conversation: AiConversation; pending: PendingNewChat }> {
  const { message, options, signal } = input;
  let state = input.pending ?? null;
  if (!state) {
    let chat: AiNewChat;
    try {
      chat = await deps.startChat({ message, options }, signal);
    } catch (failure) {
      throw new NewChatError("ai", failure, null);
    }
    state = { message, chat, formId: null };
  }
  // Stopped while the assistant was answering: no draft for an answer nobody waited for.
  if (signal?.aborted) throw aborted();

  let formId = state.formId;
  if (!formId) {
    try {
      formId = (
        await deps.createDraft({
          title: chatTitleFromPrompt(state.message) || state.chat.draft?.title || "",
          idempotencyKey: draftIdempotencyKey(state.chat.conversationId),
        })
      ).id;
    } catch (failure) {
      throw new NewChatError("create", failure, state);
    }
    state = { ...state, formId };
  }

  // The draft exists: attaching is finished even if "Dừng" is pressed now.
  try {
    const conversation = await deps.adopt(formId, state.chat.conversationId);
    return { formId, conversation, pending: state };
  } catch (failure) {
    // Already attached by a request whose response was lost: read it back.
    if (isApiError(failure) && (failure.status === 404 || failure.status === 409)) {
      try {
        const conversation = await deps.getConversation(formId);
        return { formId, conversation, pending: state };
      } catch {
        // Fall through: report the attach failure.
      }
    }
    throw new NewChatError("create", failure, state);
  }
}
