"use client";

import { PILOT_BUILD } from "@/lib/pilot-scope";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FormBlockType } from "@rescom/schemas";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";
import { autosaveLabel } from "@/lib/forms/builder-autosave";
import {
  addSection,
  canMoveBy,
  duplicateBlockById,
  hasIssues,
  insertBlock,
  insertPreparedBlock,
  moveBlockBy,
  publishIssueSummary,
  removeBlock,
  summarizeDoc,
  toDraftDefinition,
} from "@/lib/forms/builder-blocks";
import { blockTypeInfo } from "@/lib/forms/builder-catalog";
import {
  PENDING_ATTENTION_BLOCKER,
  aiErrorMessage,
  loadFormErrorMessage,
  saveDraftErrorMessage,
} from "@/lib/forms/builder-messages";
import { internalPriceHint } from "@/lib/forms/builder-publish";
import { getAiConversation, sendAiMessage, suggestAiBlock } from "@/lib/forms/builder-service";
import { useBuilderEditor } from "../hooks/use-builder-editor";
import { usePaletteDrag } from "../hooks/use-palette-drag";
import { AddQuestionSheet } from "./AddQuestionSheet";
import { AiReviewBanner } from "./AiReviewBanner";
import { BuilderHeader } from "./BuilderHeader";
import { ToolButton } from "./BuilderBits";
import { Canvas } from "./Canvas";
import { MobileBlockList } from "./MobileBlockList";
import { PropertiesPanel } from "./PropertiesPanel";
import { Toolbox } from "./Toolbox";

const timeFormat = new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" });

/**
 * Form Builder (Figma 13 · 63:4221 empty, 72:78 dragging, 63:690 AI draft
 * review; mobile 69:78 reorder, 63:1229 add sheet). Full screen in the
 * `(focus)` group; `?review=ai` applies the assistant's draft (13b' → 13c).
 */
export function BuilderScreen() {
  const params = useParams<{ id: string }>();
  const formId = params.id;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const editor = useBuilderEditor(formId);
  const { doc, form } = editor;

  const canvasListRef = useRef<HTMLDivElement>(null);
  const palette = usePaletteDrag(canvasListRef, (type, target) => {
    let created = "";
    editor.change((current) => {
      const result = insertBlock(current, type, { sectionId: target.sectionId, index: target.index });
      created = result.blockId;
      return result.doc;
    }, `Đã thêm câu ${blockTypeInfo(type).label} vào vị trí câu ${target.number}.`);
    if (created) editor.select(created);
    return created || null;
  });
  const [continueError, setContinueError] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetAiBusy, setSheetAiBusy] = useState(false);
  const [mobileEditId, setMobileEditId] = useState<string | null>(null);

  const sessionLost = useSessionLossRedirect(editor.loadError, editor.autosave.error);

  // 13b' "Mở trong Form Builder" → apply the AI draft once.
  const reviewApplied = useRef(false);
  const wantsReview = !PILOT_BUILD && searchParams.get("review") === "ai";
  useEffect(() => {
    if (!wantsReview || !form || reviewApplied.current || editor.readOnly) return;
    reviewApplied.current = true;
    editor
      .applyAiFromConversation()
      .catch((error: unknown) => setAiError(aiErrorMessage(error)))
      .finally(() => router.replace(pathname));
  }, [wantsReview, form, editor, router, pathname]);

  // "Tiếp tục" in the builder, and `?continue=1` (preview "Tiếp tục", or the publish
  // step refusing unsaved / invalid work): publish rules → save → publish step.
  const onContinue = async () => {
    setContinueError(null);
    if (editor.pending.length > 0) {
      setContinueError(PENDING_ATTENTION_BLOCKER);
      editor.select(editor.pending[0].blockId);
      return;
    }
    const issues = editor.checkForPublish();
    if (hasIssues(issues)) {
      const firstBlock = editor.doc.blocks.find((block) => issues.blocks[block.id]?.length)?.id;
      setContinueError(publishIssueSummary(editor.doc, issues) ?? "Một số câu hỏi chưa hoàn chỉnh. Hãy sửa các câu được đánh dấu đỏ.");
      if (firstBlock) editor.select(firstBlock);
      return;
    }
    setContinuing(true);
    try {
      const saved = await editor.saveNow();
      if (saved.status === "conflict" || saved.status === "error" || saved.status === "offline") {
        setContinueError(saveDraftErrorMessage(saved.error));
        return;
      }
      router.push(`/forms/${formId}/builder/publish?checked=1`);
    } finally {
      setContinuing(false);
    }
  };

  const continueApplied = useRef(false);
  const wantsContinue = searchParams.get("continue") === "1";
  useEffect(() => {
    if (!wantsContinue || !form || continueApplied.current || editor.readOnly) return;
    continueApplied.current = true;
    router.replace(pathname);
    if (editor.restoreOffer) return; // The publisher picks a version first (banner).
    void Promise.resolve().then(onContinue);
  });

  if (editor.loading || sessionLost) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-muted" role="status">
        <Spinner className="size-8 text-primary" />
        <span className="sr-only">Đang tải form…</span>
      </div>
    );
  }

  if (editor.loadError || !form) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-4 px-4">
        <Alert tone="danger">{loadFormErrorMessage(editor.loadError)}</Alert>
        <div className="flex gap-3">
          <Button onClick={editor.reload}>Thử lại</Button>
          <Link href="/forms" className="inline-flex h-11 items-center px-4 text-label font-bold text-primary">
            Về Khảo sát của tôi
          </Link>
        </div>
      </main>
    );
  }

  const summary = summarizeDoc(doc);
  const hint = internalPriceHint(summary.minutes, toDraftDefinition(doc));
  const invalid = editor.draftInvalid;
  const statusLine = `Bản nháp v${form.currentVersion.versionNumber} · ${autosaveLabel(editor.autosave, invalid, (iso) => timeFormat.format(new Date(iso)))}`;
  const selectedSection = editor.selectedId ? doc.sections.find((s) => s.blockIds.includes(editor.selectedId as string)) : undefined;
  const targetSection = selectedSection ?? doc.sections.at(-1);
  const targetSectionLabel = targetSection ? `Phần ${doc.sections.indexOf(targetSection) + 1}` : null;

  const addBlock = (type: FormBlockType) => {
    let created = "";
    editor.change((current) => {
      const result = insertBlock(current, type, { sectionId: targetSection?.id ?? null });
      created = result.blockId;
      return result.doc;
    }, `Đã thêm câu ${blockTypeInfo(type).label} vào cuối ${targetSectionLabel ?? "form"}.`);
    editor.select(created);
    return created;
  };

  const addSectionAtEnd = () => editor.change((current) => addSection(current).doc, "Đã thêm phần mới ở cuối form.");

  // C4: flush the autosave so the preview (and its "Tiếp tục") starts from saved work.
  const openPreview = async () => {
    if (!editor.readOnly) await editor.saveNow();
    router.push(`/forms/${formId}/builder/preview`);
  };

  const regenerate = async () => {
    if (PILOT_BUILD) return;
    setRegenerating(true);
    setAiError(null);
    try {
      const conversation = await getAiConversation(formId);
      await sendAiMessage(formId, { message: "Tạo lại", options: conversation.options });
      await editor.applyAiFromConversation();
    } catch (error) {
      setAiError(aiErrorMessage(error));
    } finally {
      setRegenerating(false);
    }
  };

  const suggestIntoSheet = async () => {
    if (PILOT_BUILD) return;
    setSheetAiBusy(true);
    setAiError(null);
    try {
      const suggestion = await suggestAiBlock(formId, targetSection?.title ?? null);
      let created = "";
      editor.change((current) => {
        const result = insertPreparedBlock(current, suggestion.block, { sectionId: targetSection?.id ?? null });
        created = result.blockId;
        return result.doc;
      }, "Đã thêm câu hỏi do AI gợi ý.");
      editor.addAiBlock(created, suggestion.attentionSuggestion ? { ...suggestion.attentionSuggestion, blockId: created } : null);
      editor.select(created);
      setSheetOpen(false);
      setMobileEditId(created);
    } catch (error) {
      setAiError(aiErrorMessage(error));
    } finally {
      setSheetAiBusy(false);
    }
  };

  const banners = (
    <>
      {editor.readOnly ? (
        <Alert tone="info">
          Khảo sát đã gửi duyệt nên không sửa được nữa.{" "}
          <Link href={`/forms/${formId}`} className="font-bold text-primary underline">
            Xem trạng thái
          </Link>
        </Alert>
      ) : null}
      {editor.restoreOffer ? (
        <div className="flex flex-col gap-3 rounded-[14px] border border-tone-amber-strong bg-tone-amber-bg p-4" role="alert">
          <p className="text-body-sm text-tone-amber-ink">
            <b className="text-ink">Có bản chưa lưu trên máy này.</b> Form cũng đã được sửa ở nơi khác sau đó. Bạn muốn dùng bản nào?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" radius="field" onClick={editor.acceptRestore}>
              Dùng bản trên máy này
            </Button>
            <Button size="sm" radius="field" variant="secondary" onClick={editor.rejectRestore}>
              Giữ bản đã lưu
            </Button>
          </div>
        </div>
      ) : null}
      {editor.autosave.status === "conflict" ? (
        <div className="flex flex-col gap-3 rounded-[14px] border border-danger/30 bg-danger-soft p-4" role="alert">
          <p className="text-body-sm text-danger">{saveDraftErrorMessage(editor.autosave.error)} Thay đổi của bạn chưa được lưu.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" radius="field" variant="secondary" onClick={() => void editor.reloadFromServer()}>
              Tải bản mới nhất
            </Button>
            <Button size="sm" radius="field" variant="danger" onClick={() => void editor.overwriteServer()}>
              Ghi đè bằng bản này
            </Button>
          </div>
        </div>
      ) : null}
      {editor.autosave.status === "offline" || editor.autosave.status === "error" ? (
        <Alert tone={editor.autosave.status === "error" ? "danger" : "info"}>
          {saveDraftErrorMessage(editor.autosave.error)}{" "}
          <button type="button" className="font-bold text-primary underline" onClick={() => void editor.saveNow()}>
            Lưu lại
          </button>
        </Alert>
      ) : null}
      {aiError ? (
        <Alert tone="danger" onDismiss={() => setAiError(null)}>
          {aiError}
        </Alert>
      ) : null}
      {editor.aiReviewActive && !editor.readOnly ? (
        <AiReviewBanner
          questionCount={summary.questionCount}
          sectionCount={summary.sectionCount}
          pendingCount={editor.pending.length}
          regenerating={regenerating}
          onRegenerate={() => void regenerate()}
          onUndo={editor.undoAi}
        />
      ) : null}
      {continueError ? (
        <Alert tone="danger" onDismiss={() => setContinueError(null)}>
          {continueError}
        </Alert>
      ) : null}
    </>
  );

  const mobileBlock = mobileEditId ? doc.blocks.find((b) => b.id === mobileEditId) : undefined;
  const mobileNumber = mobileBlock ? doc.blocks.indexOf(mobileBlock) + 1 : 0;

  return (
    <div className="min-h-dvh bg-surface-muted">
      <p className="sr-only" aria-live="polite" role="status">
        {editor.announcement}
      </p>
      <BuilderHeader
        formId={formId}
        title={doc.title}
        statusLine={statusLine}
        saving={editor.autosave.status === "saving"}
        onContinue={() => void onContinue()}
        onPreview={() => void openPreview()}
        continueBusy={continuing}
        readOnly={editor.readOnly}
      />

      {/* Desktop: toolbox · canvas · properties (lg+); mobile: the middle column only. */}
      <div className="lg:flex">
        <aside className="sticky top-17 hidden h-[calc(100dvh-68px)] w-68 shrink-0 overflow-y-auto border-r border-line bg-surface lg:block">
          <Toolbox
            disabled={editor.readOnly}
            draggingType={palette.draggingType}
            onAdd={(type) => void addBlock(type)}
            onAddSection={addSectionAtEnd}
            itemProps={palette.itemProps}
          />
        </aside>
        <div className="min-w-0 flex-1 lg:bg-surface-subtle">
          {/* Rendered once (not per breakpoint): keeps a single announced alert per message.
              Inside the canvas column so the side panels start right under the header. */}
          <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3 px-4 pt-3.5 empty:hidden lg:px-0 lg:pt-6">{banners}</div>
          <main className="hidden lg:block">
            <Canvas
              editor={editor}
              formId={formId}
              listRef={canvasListRef}
              paletteDragging={palette.draggingType !== null}
              paletteTarget={palette.target}
            />
          </main>

          {/* Mobile (13e / 13f). */}
          <main className="flex flex-col gap-3 px-4 pt-3.5 pb-40 lg:hidden">
            {doc.blocks.length > 0 ? (
              <p className="flex items-start gap-2 rounded-[12px] bg-surface-subtle px-3 py-2.5 text-caption leading-[18.9px] text-ink-strong">
                <Icon name="grip-dots" size={16} className="mt-0.5 text-ink-muted" />
                Nhấn giữ nút kéo để đổi thứ tự. Chạm vào câu để sửa.
              </p>
            ) : (
              <div className="rounded-[16px] border-2 border-dashed border-line-strong bg-surface px-5 py-8 text-center">
                <p className="text-lead font-extrabold text-ink">Form chưa có câu hỏi</p>
                <p className="mt-1.5 text-body-sm text-ink-muted">{PILOT_BUILD ? "Thêm câu hỏi đầu tiên." : "Thêm câu đầu tiên hoặc để AI soạn bản nháp."}</p>
              </div>
            )}
            <MobileBlockList editor={editor} onOpen={(id) => {
              editor.select(id);
              setMobileEditId(id);
            }} />
            {!editor.readOnly ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSheetOpen(true)}
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-field border border-dashed border-line-strong bg-surface text-body-sm font-bold text-ink"
                >
                  <Icon name="plus" size={18} />
                  Thêm câu hỏi
                </button>
                {PILOT_BUILD ? null : (
                  <Link
                    href={`/forms/${formId}/builder/ai`}
                    className="flex h-12 items-center justify-center gap-2 rounded-field border border-dashed border-line-strong bg-surface px-4 text-body-sm font-bold text-ink"
                  >
                    <Icon name="sparkles" size={18} />
                    AI
                  </Link>
                )}
              </div>
            ) : null}
          </main>
        </div>
        <aside
          aria-label="Thuộc tính câu hỏi"
          data-tour="builder-properties"
          className="sticky top-17 hidden h-[calc(100dvh-68px)] w-85 shrink-0 overflow-y-auto border-l border-line bg-surface lg:block"
        >
          <PropertiesPanel key={editor.selectedId ?? "none"} editor={editor} />
        </aside>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] lg:hidden">
        <p className="text-center text-[12px] text-ink-muted">
          {summary.questionCount} câu · khoảng {summary.minutes} phút · Giá gợi ý {hint.label} · {hint.paidLabel}
        </p>
        <Button fullWidth size="xl" radius="field" className="mt-2 gap-2" loading={continuing} onClick={() => void onContinue()}>
          Tiếp tục: chọn đối tượng
          <Icon name="arrow-right" size={18} />
        </Button>
      </div>

      <AddQuestionSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        sectionLabel={targetSectionLabel}
        onAdd={(type) => {
          const created = addBlock(type);
          setSheetOpen(false);
          setMobileEditId(created);
        }}
        onAddSection={() => {
          addSectionAtEnd();
          setSheetOpen(false);
        }}
        onAiSuggest={PILOT_BUILD ? undefined : () => void suggestIntoSheet()}
        aiBusy={sheetAiBusy}
        aiError={sheetOpen ? aiError : null}
      />

      <Dialog
        open={mobileBlock !== undefined}
        onClose={() => setMobileEditId(null)}
        labelledBy="mobile-edit-title"
        width={430}
        className="lg:hidden"
      >
        {mobileBlock ? (
          <div className="flex max-h-[calc(100dvh-32px)] flex-col">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <h2 id="mobile-edit-title" className="text-body font-extrabold text-ink">
                Sửa câu {mobileNumber}
              </h2>
              <div className="flex items-center">
                <ToolButton icon="chevron-down" rotate label={`Chuyển câu ${mobileNumber} lên`} disabled={!canMoveBy(doc, mobileBlock.id, -1)} onClick={() => editor.change((c) => moveBlockBy(c, mobileBlock.id, -1), `Đã chuyển lên, giờ là câu ${mobileNumber - 1}.`)} />
                <ToolButton icon="chevron-down" label={`Chuyển câu ${mobileNumber} xuống`} disabled={!canMoveBy(doc, mobileBlock.id, 1)} onClick={() => editor.change((c) => moveBlockBy(c, mobileBlock.id, 1), `Đã chuyển xuống, giờ là câu ${mobileNumber + 1}.`)} />
                <ToolButton icon="copy" label={`Nhân bản câu ${mobileNumber}`} onClick={() => {
                  let created = "";
                  editor.change((c) => {
                    const result = duplicateBlockById(c, mobileBlock.id);
                    created = result.blockId;
                    return result.doc;
                  }, `Đã nhân bản câu ${mobileNumber}.`);
                  setMobileEditId(created);
                  editor.select(created);
                }} />
                <ToolButton icon="trash" danger label={`Xoá câu ${mobileNumber}`} onClick={() => {
                  editor.change((c) => removeBlock(c, mobileBlock.id), `Đã xoá câu ${mobileNumber}.`);
                  setMobileEditId(null);
                }} />
                <ToolButton icon="x" label="Đóng" onClick={() => setMobileEditId(null)} />
              </div>
            </div>
            <div className="overflow-y-auto">
              <PropertiesPanel key={mobileBlock.id} editor={editor} />
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
