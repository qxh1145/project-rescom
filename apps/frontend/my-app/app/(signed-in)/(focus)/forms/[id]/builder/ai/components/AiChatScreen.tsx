"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mascot } from "@/components/brand/Mascot";
import { RescomLogo } from "@/components/brand/RescomLogo";
import { Alert } from "@/components/ui/Alert";
import { Avatar, initialsOf } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { IconLink } from "@/components/ui/IconButton";
import { Spinner } from "@/components/ui/Spinner";
import { completeThinking, loadThought, planThinking, saveThought } from "@/lib/forms/ai-thinking";
import { boldRuns, type AiChatMessage, type AiConversation, type AiMessageOptions } from "@/lib/forms/builder-ai";
import { aiConversationLoadOutcome, aiErrorMessage, createDraftErrorMessage } from "@/lib/forms/builder-messages";
import { createBuilderDraft, getAiConversation, listRecentForms, sendAiMessage } from "@/lib/forms/builder-service";
import { useSession } from "@/lib/session/SessionProvider";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";
import { AiComposer } from "./AiComposer";
import { AiDraftPanel } from "./AiDraftPanel";
import { AiDraftSkeleton, IndeterminateBar } from "./AiDraftSkeleton";
import { ThoughtLine } from "./ThoughtLine";
import { useAiThinking } from "../hooks/use-ai-thinking";

/** Entry suggestions (Figma 13b 62:3271…62:3286). */
const TOPIC_SUGGESTIONS = [
  "Mức độ hài lòng với căng tin trường",
  "Thói quen dùng mạng xã hội khi học",
  "Nhu cầu nhà trọ gần trường",
  "Đánh giá một môn học sau học kỳ",
];

const DEFAULT_OPTIONS: AiMessageOptions = { duration: "UNDER_5", suggestAttentionChecks: true };

function Rich({ text }: { text: string }) {
  return (
    <>
      {boldRuns(text).map((run, i) => (run.bold ? <b key={i}>{run.text}</b> : <span key={i}>{run.text}</span>))}
    </>
  );
}

function UserBubble({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <div className="flex justify-end">
      <p
        className={`max-w-[492px] rounded-[18px] rounded-br-[4px] bg-chat-bubble px-4 py-3 text-body leading-[24px] text-ink ${
          muted ? "opacity-70" : ""
        }`}
      >
        {text}
      </p>
    </div>
  );
}

function RecentList({ currentId }: { currentId: string | null }) {
  const [items, setItems] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    listRecentForms(controller.signal)
      .then(setItems)
      .catch(() => undefined); // The history list is optional: hidden when unavailable.
    return () => controller.abort();
  }, []);
  if (items.length === 0) return null;
  return (
    <>
      <p className="mt-5 px-3 text-[12px] font-bold tracking-[0.5px] text-ink-muted">GẦN ĐÂY</p>
      <ul className="mt-2 flex flex-col">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={`/forms/${item.id}/builder/ai`}
              aria-current={item.id === currentId ? "page" : undefined}
              className={`block truncate rounded-[10px] px-3 text-body-sm leading-10 font-medium text-ink hover:bg-surface-subtle ${
                item.id === currentId ? "bg-surface-subtle" : ""
              }`}
            >
              {item.title}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * "Soạn bằng AI": entry (13b 62:3204 / 13g 62:3562) and chat with the draft
 * aside (13b' 62:2333 / 13h 62:2904). All AI routes are ASSUMED API CONTRACT
 * (`lib/forms/builder-ai.ts`). Without `formId` (from "Tạo khảo sát") the
 * first prompt creates the In-Rescom draft (`POST /forms`, VERIFIED).
 */
export function AiChatScreen({ formId }: { formId: string | null }) {
  const router = useRouter();
  const { displayName, balance } = useSession();
  const [conversation, setConversation] = useState<AiConversation | null>(null);
  const [loading, setLoading] = useState(formId !== null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loadMessage, setLoadMessage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState<AiMessageOptions>(DEFAULT_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<unknown>(null);
  /** Which call failed: creating the draft (`POST /forms`) or the AI message. */
  const [sendErrorStage, setSendErrorStage] = useState<"create" | "ai">("ai");
  /** C5: the draft created by the first prompt, reused by every retry (never a second draft). */
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(true);
  /** The prompt the assistant is working on (shown before the server echoes it). */
  const [pendingText, setPendingText] = useState<string | null>(null);
  /** A prompt the publisher stopped waiting for (13b₂ "Người dùng bấm Dừng"). */
  const [stoppedText, setStoppedText] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const thinking = useAiThinking();
  const { restore: restoreThought } = thinking;
  const endRef = useRef<HTMLDivElement>(null);
  const sessionLost = useSessionLossRedirect(loadError, sendError);
  const firstName = displayName.trim().split(/\s+/).at(-1) || "Bạn";

  useEffect(() => {
    if (!formId) return;
    const controller = new AbortController();
    getAiConversation(formId, controller.signal)
      .then((loaded) => {
        setConversation(loaded);
        setOptions(loaded.options);
        // The first prompt of a new survey finished on /forms/new: show its thought collapsed.
        const saved = loadThought(formId);
        const last = [...loaded.messages].reverse().find((m) => m.role === "ASSISTANT");
        if (saved && last && saved.messageId === last.id) restoreThought(saved);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // No conversation yet → the entry screen; a missing AI route → "AI chưa sẵn sàng".
        const outcome = aiConversationLoadOutcome(error);
        if (outcome.kind === "empty") return;
        setLoadError(error);
        setLoadMessage(outcome.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [formId, restoreThought]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [conversation?.messages.length, pendingText, stoppedText]);

  // Leaving the screen cancels a request still in flight.
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const previous = conversation?.draft ?? null;
    const plan = planThinking(message, options, (conversation?.messages.length ?? 0) > 0);
    setBusy(true);
    setSendError(null);
    setStoppedText(null);
    setPendingText(message);
    setPrompt("");
    thinking.start(plan);
    /** Fills the steps from the answer and returns them for the navigation hand-off. */
    const finishWith = (next: AiConversation) => {
      const last = [...next.messages].reverse().find((m) => m.role === "ASSISTANT");
      const steps = completeThinking(plan, next.draft, previous);
      const seconds = thinking.finish(steps, last?.id ?? null);
      return { steps, seconds, lastId: last?.id ?? null };
    };
    try {
      if (!formId) {
        let targetId = createdId;
        if (!targetId) {
          setSendErrorStage("create");
          targetId = (await createBuilderDraft()).id;
          setCreatedId(targetId);
        }
        if (controller.signal.aborted) return;
        setSendErrorStage("ai");
        const next = await sendAiMessage(targetId, { message, options }, controller.signal);
        const { steps, seconds, lastId } = finishWith(next);
        if (lastId) saveThought(targetId, { messageId: lastId, status: "done", seconds, steps });
        router.replace(`/forms/${targetId}/builder/ai`);
        return;
      }
      setSendErrorStage("ai");
      const next = await sendAiMessage(formId, { message, options }, controller.signal);
      finishWith(next);
      setConversation(next);
      setDraftOpen(true);
    } catch (error) {
      if (controller.signal.aborted) return; // `stop` already showed the stopped state.
      thinking.clear();
      setPrompt((current) => current || message);
      setSendError(error);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setPendingText(null);
      setBusy(false);
    }
  };

  /** "Dừng": stop waiting. The prompt goes back to the composer; the draft is untouched here. */
  const stop = () => {
    if (!abortRef.current || !pendingText) return;
    abortRef.current.abort();
    thinking.stop();
    setStoppedText(pendingText);
    setPrompt((current) => current || pendingText);
  };

  // After a failed AI call the created draft is where manual editing continues.
  const ownId = formId ?? createdId;
  const manualHref = ownId ? `/forms/${ownId}/builder` : "/forms/new/builder";
  const messages = conversation?.messages ?? [];
  const draft = conversation?.draft ?? null;
  const lastAssistant = [...messages].reverse().find((m) => m.role === "ASSISTANT");
  const sendErrorText = sendError
    ? sendErrorStage === "create"
      ? createDraftErrorMessage(sendError)
      : aiErrorMessage(sendError)
    : null;

  const sidebar = (
    <aside className="sticky top-0 hidden h-dvh w-66 shrink-0 flex-col border-r border-line bg-surface px-3 lg:flex" aria-label="Lịch sử soạn bằng AI">
      <div className="flex items-center justify-between px-2 pt-6.5">
        <RescomLogo size="sm" />
        <Icon name="sidebar" size={20} className="text-ink-muted" />
      </div>
      <Link
        href="/forms/new/builder/ai"
        className="mt-5 flex h-11 items-center gap-2.5 rounded-field border border-line-strong px-4 text-body-sm font-bold text-ink hover:bg-surface-subtle"
      >
        <Icon name="plus" size={18} />
        Soạn khảo sát mới
      </Link>
      <RecentList currentId={formId} />
      <div className="mt-auto border-t border-line-subtle pt-3 pb-4">
        <Link href={manualHref} className="flex h-10 items-center gap-2 rounded-[10px] px-3 text-body-sm font-medium text-ink hover:bg-surface-subtle">
          <Icon name="form-layout" size={18} />
          Soạn tay trong Form Builder
        </Link>
        <div className="mt-3 flex items-center gap-2.5 px-2">
          <Avatar initials={initialsOf(displayName)} size={38} />
          <div className="min-w-0">
            <p className="truncate text-body-sm font-bold text-ink">{displayName}</p>
            {balance ? <p className="text-[12px] text-ink-muted">{balance.available} điểm</p> : null}
          </div>
        </div>
      </div>
    </aside>
  );

  if (loading || sessionLost) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-muted" role="status">
        <Spinner className="size-8 text-primary" />
        <span className="sr-only">Đang tải…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-4 px-4">
        <Alert tone="danger">{loadMessage ?? aiErrorMessage(loadError)}</Alert>
        <Link href={manualHref} className="text-label font-bold text-primary">
          Soạn tay trong Form Builder
        </Link>
      </main>
    );
  }

  // --- Entry (13b / 13g) --- (until the first prompt is on its way)
  if (messages.length === 0 && !pendingText && !stoppedText) {
    return (
      <div className="flex min-h-dvh bg-surface-muted">
        {sidebar}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 px-4 pt-4 lg:justify-end lg:px-6 lg:pt-5">
            <span className="lg:hidden">
              <IconLink href={formId ? manualHref : "/forms"} icon="chevron-left" label="Quay lại" />
            </span>
            <h1 className="text-lead font-extrabold text-ink lg:hidden">Soạn bằng AI</h1>
            <Link href={manualHref} className="hidden items-center gap-1 text-body-sm font-bold text-primary lg:inline-flex">
              Soạn tay thay vào đó
              <Icon name="arrow-right" size={16} />
            </Link>
          </div>
          <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center px-4 pb-6 lg:pb-24">
            <div className="flex flex-col items-center gap-4 text-center lg:flex-row lg:justify-center">
              <Mascot name="laptop" height={72} />
              <h2 className="text-title leading-[31.2px] font-extrabold text-ink lg:text-[34px] lg:leading-[40.8px] lg:tracking-[-0.7px]">
                {firstName} muốn khảo sát điều gì hôm nay?
              </h2>
            </div>
            <div className="mt-6 hidden lg:block">
              <AiComposer
                variant="entry"
                value={prompt}
                onChange={setPrompt}
                options={options}
                onOptionsChange={setOptions}
                onSubmit={() => void send(prompt)}
                busy={busy}
                placeholder="Mô tả đối tượng, chủ đề và điều bạn muốn đo…"
              />
            </div>
            <ul className="mt-6 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:justify-center">
              {TOPIC_SUGGESTIONS.map((topic) => (
                <li key={topic}>
                  <button
                    type="button"
                    onClick={() => setPrompt(`Tìm hiểu ${topic.charAt(0).toLowerCase()}${topic.slice(1)} của sinh viên.`)}
                    className="flex h-12 w-full items-center gap-2.5 rounded-[14px] border border-line bg-surface px-3.5 text-body-sm font-semibold text-ink-strong lg:h-10 lg:rounded-full"
                  >
                    <Icon name="file-text" size={16} className="text-ink-muted" />
                    {topic}
                  </button>
                </li>
              ))}
            </ul>
            {sendErrorText ? (
              <Alert tone="danger" className="mt-4">
                {sendErrorText}
              </Alert>
            ) : null}
            <p className="mt-6 hidden text-center text-caption leading-[20.2px] text-ink-muted lg:block">
              Trợ lý chỉ soạn bản nháp, bạn xem lại và sửa mọi câu trước khi dùng. Không nhập thông tin cá nhân của ai. Nếu trợ lý không phản hồi, bạn vẫn soạn tay bình thường.
            </p>
          </div>
          <div className="sticky bottom-0 px-3 pb-4 lg:hidden">
            <AiComposer
              variant="chat"
              rows={2}
              value={prompt}
              onChange={setPrompt}
              options={options}
              onOptionsChange={setOptions}
              onSubmit={() => void send(prompt)}
              busy={busy}
              placeholder="Mô tả đối tượng, chủ đề và điều bạn muốn đo…"
            />
          </div>
        </main>
      </div>
    );
  }

  // --- Chat (13b' / 13h), with the thought line of 13b₁ ---
  const thought = thinking.view;
  const renderMessage = (message: AiChatMessage) =>
    message.role === "USER" ? (
      <UserBubble key={message.id} text={message.text} />
    ) : (
      <div key={message.id} className="flex gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-tone-green-bg" aria-hidden="true">
          <Mascot name="wave" height={38} />
        </span>
        <div className="min-w-0 flex-1 text-body leading-[24.8px] text-ink">
          <p className="text-caption font-bold text-ink-muted">Trợ lý Rescom</p>
          {thought && thought.status === "done" && message.id === thought.messageId ? (
            <div className="mt-0.5">
              <ThoughtLine bare steps={thought.steps} status="done" activeIndex={thought.activeIndex} seconds={thought.seconds} />
            </div>
          ) : null}
          <p className="mt-1">
            <Rich text={message.text} />
          </p>
          {message.bullets.length > 0 ? (
            <ul className="mt-2 flex flex-col pl-5">
              {message.bullets.map((bullet) => (
                <li key={bullet}>
                  <Rich text={bullet} />
                </li>
              ))}
            </ul>
          ) : null}
          {message.hasDraft && draft && message.id === lastAssistant?.id ? (
            <>
              <button
                type="button"
                onClick={() => setDraftOpen(true)}
                className="mt-3.5 hidden w-full max-w-[450px] items-center gap-3 rounded-[14px] border border-primary bg-surface px-3.5 py-3 text-left xl:flex"
              >
                <span className="flex size-10 items-center justify-center rounded-[10px] bg-tone-green-bg text-primary">
                  <Icon name="file-text" size={20} />
                </span>
                <span>
                  <span className="block text-body font-extrabold">Bản nháp khảo sát</span>
                  <span className="block text-caption text-ink-muted">
                    {draft.blocks.length} câu · {draft.sections.length} phần · {draftOpen ? "đang mở bên phải" : "bấm để mở"}
                  </span>
                </span>
              </button>
              <Link
                href={`/forms/${formId}/builder?review=ai`}
                className="mt-3.5 flex w-full items-center gap-3 rounded-[14px] border border-primary bg-surface px-3.5 py-3 xl:hidden"
              >
                <span className="flex size-10 items-center justify-center rounded-[10px] bg-tone-green-bg text-primary">
                  <Icon name="file-text" size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-extrabold">Bản nháp khảo sát</span>
                  <span className="block text-caption text-ink-muted">{draft.blocks.length} câu · chạm để mở trong Form Builder</span>
                </span>
                <Icon name="chevron-right" size={18} className="text-ink-muted" />
              </Link>
            </>
          ) : null}
          {message.followUp ? (
            <p className="mt-3">
              <Rich text={message.followUp} />
            </p>
          ) : null}
          {message.id === lastAssistant?.id && message.quickReplies.length > 0 ? (
            <ul className="mt-5 flex flex-wrap gap-2" aria-label="Gợi ý yêu cầu">
              {message.quickReplies.map((reply) => (
                <li key={reply}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void send(reply)}
                    className="h-9 rounded-full border border-line bg-surface px-3 text-caption font-semibold text-ink-strong hover:border-primary disabled:opacity-60"
                  >
                    {reply}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    );

  return (
    <div className="flex min-h-dvh bg-surface-muted">
      {sidebar}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-line bg-surface-muted px-4 py-3 lg:px-6 lg:py-5">
          <span className="lg:hidden">
            <IconLink href={manualHref} icon="chevron-left" label="Về Form Builder" />
          </span>
          <div className="min-w-0 lg:flex lg:items-baseline lg:gap-3.5">
            <h1 className="truncate text-body font-extrabold text-ink lg:text-lead">{draft?.title ?? "Soạn bằng AI"}</h1>
            <p className="text-[12px] text-ink-muted">
              <span className="hidden lg:inline">· </span>
              {busy ? "trợ lý đang soạn" : "bản nháp, chưa gửi duyệt"}
            </p>
          </div>
        </header>
        <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-5 px-4 py-6 lg:px-8" aria-live="polite">
          {messages.map(renderMessage)}
          {pendingText ? <UserBubble text={pendingText} /> : null}
          {stoppedText ? <UserBubble text={stoppedText} muted /> : null}
          {thought && thought.status !== "done" ? (
            <div className="flex flex-col gap-3">
              <ThoughtLine
                steps={thought.steps}
                status={thought.status}
                activeIndex={thought.activeIndex}
                seconds={thought.seconds}
                slow={thought.slow}
                compact
              />
              {thought.status === "running" ? (
                <div className="overflow-hidden rounded-[14px] border border-line bg-surface xl:hidden">
                  <div className="flex items-center gap-3 px-3.5 py-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-tone-green-bg text-primary">
                      <Icon name="file-text" size={20} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-body font-extrabold text-ink">Bản nháp khảo sát</span>
                      <span className="block text-caption text-ink-muted">{draft ? "Đang cập nhật…" : "Đang dựng…"}</span>
                    </span>
                  </div>
                  <IndeterminateBar />
                </div>
              ) : null}
              {thought.status === "stopped" && stoppedText ? (
                <div className="thought-fade pl-11 text-body leading-[24.8px] text-ink">
                  <p>Bạn đã dừng trợ lý. Yêu cầu vẫn nằm trong ô soạn để bạn sửa hoặc gửi lại.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void send(stoppedText)}
                      className="h-11 rounded-field bg-primary px-4.5 text-body-sm font-bold text-surface hover:bg-primary-hover"
                    >
                      Gửi lại
                    </button>
                    <Link
                      href={manualHref}
                      className="inline-flex h-11 items-center rounded-field border border-line-strong bg-surface px-4 text-body-sm font-bold text-ink hover:bg-surface-subtle"
                    >
                      Tự soạn trong Form Builder
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {sendErrorText ? <Alert tone="danger">{sendErrorText}</Alert> : null}
          <div ref={endRef} />
        </div>
        <div className="sticky bottom-0 mx-auto w-full max-w-[640px] px-3 pb-3 lg:px-8">
          <AiComposer
            variant="chat"
            rows={1}
            value={prompt}
            onChange={setPrompt}
            options={options}
            onOptionsChange={setOptions}
            onSubmit={() => void send(prompt)}
            onStop={stop}
            busy={busy}
            placeholder="Yêu cầu chỉnh sửa, ví dụ: thêm câu về thời gian tự học"
          />
          <p className="mt-2 text-center text-[12px] text-ink-muted">Trợ lý có thể soạn sai. Hãy đọc lại từng câu trước khi dùng.</p>
        </div>
      </main>
      {draft && draftOpen && formId ? (
        <div className="sticky top-0 hidden h-dvh w-[521px] shrink-0 border-l border-line xl:block">
          <AiDraftPanel formId={formId} draft={draft} onClose={() => setDraftOpen(false)} />
        </div>
      ) : !draft && thought?.status === "running" ? (
        <div className="sticky top-0 hidden h-dvh w-[521px] shrink-0 border-l border-line xl:block">
          <AiDraftSkeleton />
        </div>
      ) : null}
    </div>
  );
}
