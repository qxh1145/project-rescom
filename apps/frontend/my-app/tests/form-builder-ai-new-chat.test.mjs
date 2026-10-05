import assert from "node:assert/strict";
import test from "node:test";

/**
 * Mock-off Phase 6 fix: a new "Soạn bằng AI" chat creates its draft only
 * after the assistant answered (`lib/forms/ai-new-chat.ts`). A failed or
 * stopped first prompt leaves no orphan draft; a retry after a failed
 * create/attach reuses the answer and the draft instead of duplicating them.
 */
const { NewChatError, draftIdempotencyKey, sendNewChatPrompt } = await import("../lib/forms/ai-new-chat.ts");
const { ApiError } = await import("../lib/api/api-error.ts");
const { idempotencyKeySchema } = await import("@rescom/schemas");
const ai = await import("../lib/forms/builder-ai.ts");
const { cannedAssistantTurn } = await import("../mocks/data/form-ai-canned.ts");

const OPTIONS = { duration: "UNDER_5", suggestAttentionChecks: true };
const FORM_ID = "11111111-1111-4111-8111-111111111111";
const PROMPT = "Khảo sát mức độ hài lòng với căng tin trường của sinh viên năm nhất";

function newChat() {
  return ai.aiNewChatSchema.parse({ conversationId: "conv-1", ...cannedAssistantTurn(null, PROMPT, OPTIONS) });
}

function recorder(overrides = {}) {
  const calls = [];
  const deps = {
    startChat: async (input) => {
      calls.push(["startChat", input.message]);
      return newChat();
    },
    createDraft: async (input) => {
      calls.push(["createDraft", input.title, input.idempotencyKey]);
      return { id: FORM_ID };
    },
    adopt: async (formId, conversationId) => {
      calls.push(["adopt", formId, conversationId]);
      return ai.aiConversationSchema.parse({ ...newChat(), formId });
    },
    getConversation: async (formId) => {
      calls.push(["getConversation", formId]);
      return ai.aiConversationSchema.parse({ ...newChat(), formId });
    },
    ...overrides,
  };
  return { calls, deps };
}

test("the assistant answers before any draft exists; then the draft is created and the chat attached", async () => {
  const { calls, deps } = recorder();
  const result = await sendNewChatPrompt({ message: PROMPT, options: OPTIONS }, deps);
  assert.deepEqual(
    calls.map(([name]) => name),
    ["startChat", "createDraft", "adopt"],
  );
  assert.equal(calls[1][1], ai.chatTitleFromPrompt(PROMPT));
  assert.deepEqual(calls[2].slice(1), [FORM_ID, "conv-1"]);
  assert.equal(result.formId, FORM_ID);
  assert.equal(result.conversation.formId, FORM_ID);
  assert.ok(result.conversation.messages.some((message) => message.role === "ASSISTANT"));
});

test("a failed first answer creates no draft (no orphan)", async () => {
  const { calls, deps } = recorder({
    startChat: async () => {
      throw new Error("AI down");
    },
  });
  await assert.rejects(
    sendNewChatPrompt({ message: PROMPT, options: OPTIONS }, deps),
    (error) => error instanceof NewChatError && error.stage === "ai" && error.pending === null,
  );
  assert.deepEqual(calls, []);
});

test("“Dừng” while the assistant answers creates no draft", async () => {
  const controller = new AbortController();
  const { calls, deps } = recorder({
    startChat: async () => {
      controller.abort();
      return newChat();
    },
  });
  await assert.rejects(
    sendNewChatPrompt({ message: PROMPT, options: OPTIONS, signal: controller.signal }, deps),
    (error) => error.name === "AbortError",
  );
  assert.deepEqual(calls.map(([name]) => name), []);
});

test("a failed POST /forms keeps the answer: the retry creates the draft without asking the assistant again", async () => {
  let fail = true;
  const { calls, deps } = recorder({
    createDraft: async (input) => {
      calls.push(["createDraft", input.title]);
      if (fail) throw new Error("500");
      return { id: FORM_ID };
    },
  });
  const error = await sendNewChatPrompt({ message: PROMPT, options: OPTIONS }, deps).catch((caught) => caught);
  assert.ok(error instanceof NewChatError);
  assert.equal(error.stage, "create");
  assert.equal(error.pending.formId, null);
  assert.equal(error.pending.chat.conversationId, "conv-1");

  fail = false;
  calls.length = 0;
  const result = await sendNewChatPrompt({ message: PROMPT, options: OPTIONS, pending: error.pending }, deps);
  assert.deepEqual(calls.map(([name]) => name), ["createDraft", "adopt"]);
  assert.equal(result.formId, FORM_ID);
});

test("a failed attach keeps the created draft: the retry only attaches (never a second draft)", async () => {
  let fail = true;
  const { calls, deps } = recorder({
    adopt: async (formId, conversationId) => {
      calls.push(["adopt", formId, conversationId]);
      if (fail) throw new Error("network");
      return ai.aiConversationSchema.parse({ ...newChat(), formId });
    },
  });
  const error = await sendNewChatPrompt({ message: PROMPT, options: OPTIONS }, deps).catch((caught) => caught);
  assert.equal(error.stage, "create");
  assert.equal(error.pending.formId, FORM_ID);

  fail = false;
  calls.length = 0;
  await sendNewChatPrompt({ message: "câu khác", options: OPTIONS, pending: error.pending }, deps);
  assert.deepEqual(calls.map(([name]) => name), ["adopt"]);
});

test("the mock's first answer and the attach input follow the shared AI contract", () => {
  assert.equal(ai.aiNewChatSchema.safeParse(newChat()).success, true);
  // A new chat has no form yet: a `formId` is not part of its answer.
  assert.equal("formId" in newChat(), false);
  assert.equal(ai.aiAdoptConversationInputSchema.safeParse({ conversationId: "conv-1" }).success, true);
  assert.equal(ai.aiAdoptConversationInputSchema.safeParse({ conversationId: "conv-1", formId: FORM_ID }).success, false);
});

test("the draft is created with an Idempotency-Key derived from the chat (a lost response never makes a second draft)", async () => {
  const { calls, deps } = recorder();
  await sendNewChatPrompt({ message: PROMPT, options: OPTIONS }, deps);
  const key = calls.find(([name]) => name === "createDraft")[2];
  assert.equal(key, draftIdempotencyKey("conv-1"));
  assert.equal(idempotencyKeySchema.safeParse(key).success, true);
});

test("once the draft exists, “Dừng” no longer stops the attach", async () => {
  const controller = new AbortController();
  const { calls, deps } = recorder({
    createDraft: async () => {
      controller.abort();
      return { id: FORM_ID };
    },
  });
  const result = await sendNewChatPrompt({ message: PROMPT, options: OPTIONS, signal: controller.signal }, deps);
  assert.equal(result.formId, FORM_ID);
  assert.ok(calls.some(([name]) => name === "adopt"));
});

test("an attach answered 404/409 (already attached by a lost response) reads the conversation back", async () => {
  for (const status of [404, 409]) {
    const { calls, deps } = recorder({
      adopt: async () => {
        throw new ApiError({ kind: "http", status, code: "AI_CONVERSATION_EXISTS", message: "x" });
      },
    });
    const result = await sendNewChatPrompt({ message: PROMPT, options: OPTIONS }, deps);
    assert.equal(result.conversation.formId, FORM_ID);
    assert.deepEqual(calls.at(-1), ["getConversation", FORM_ID]);
  }
  const { deps } = recorder({
    adopt: async () => {
      throw new ApiError({ kind: "http", status: 500, code: null, message: "x" });
    },
  });
  await assert.rejects(sendNewChatPrompt({ message: PROMPT, options: OPTIONS }, deps), (error) => error.stage === "create" && error.pending.formId === FORM_ID);
});
