"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useFormAutosave } from "../../use-form-autosave";
import type {
  FormBlock,
  FormBlockType,
  FormDetailDto,
  FormIntegrityMetadata,
  FormSettings,
  FormTypeEnum,
  SurveyTargetingCriteria,
} from "@rescom/schemas";
import {
  createDefaultBlock,
  reindexBlocks,
  reorderBlocks,
  moveBlockUp,
  moveBlockDown,
  duplicateBlock,
  deleteBlock,
  updateBlockInList,
  surveyTargetingSchema,
  formBlockSchema,
  parseFormDefinitionDraft,
} from "@rescom/schemas";
import { Toolbox } from "../../components/Toolbox";
import { BuilderCanvas } from "../../components/BuilderCanvas";
import { BlockPropertiesPanel } from "../../components/BlockPropertiesPanel";
import { GenerateWithAiModal } from "./generate-with-ai-modal";
import { PublishConfirmationModal } from "./PublishConfirmationModal";
import { NewVersionConfirmationModal } from "./NewVersionConfirmationModal";
import { RotateCompletionCodeModal } from "./RotateCompletionCodeModal";
import { TargetingPanel } from "./TargetingPanel";
import { TargetingAudienceSummary } from "./TargetingAudienceSummary";
import {
  PreviewControlBar,
  type ViewportMode,
} from "../../components/preview/PreviewControlBar";
import { FormRenderer } from "../../components/renderer/FormRenderer";
import { fetchInProgressAttempts, formMutationFetch } from "../../forms-api";
import {
  describePricingBand,
  pricingPublishErrorMessage,
} from "../../pricing-band";
import {
  describeReservationWindow,
  interruptedAttemptsNotice,
  reservationWindowPublishErrorMessage,
} from "../../attempt-window";
import {
  formStatusBadgeClass,
  formStatusLabel,
  isAwaitingModeration,
} from "../../form-status";

interface PageProps {
  params: Promise<{ id: string }>;
}

const EXTERNAL_CODE_REQUIRED_MESSAGE =
  "Khảo sát bên ngoài cần có mã hoàn thành trước khi xuất bản. Hãy bấm “Rotate Completion Code” để tạo mã mới, dán mã vào tin nhắn xác nhận của Google Form, rồi xuất bản lại.";

export default function FormDraftEditorPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const formId = resolvedParams.id;

  const [loading, setLoading] = useState(true);
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [rewardPerResponse, setRewardPerResponse] = useState<number>(10);
  const [expectedCompletions, setExpectedCompletions] = useState<number>(50);
  // Decision E6-D2: picks the FR-14 reward pricing band checked at publish.
  const [estimatedDurationMinutes, setEstimatedDurationMinutes] = useState<
    number | null
  >(null);
  const [formType, setFormType] = useState<FormTypeEnum>("INTERNAL");
  const [blocks, setBlocks] = useState<FormBlock[]>([]);
  const [settings, setSettings] = useState<FormSettings>({
    shuffleBlocks: false,
    progressBar: true,
    requireAuth: false,
    allowPublicAccess: true,
    submitButtonText: "Submit",
  });
  const [metadata, setMetadata] = useState<FormIntegrityMetadata>({
    expectedEffortSeconds: 60,
    minTimeBarrierSeconds: 15,
  });
  const [formStatus, setFormStatus] = useState<string>("DRAFT");
  const [versionNumber, setVersionNumber] = useState<number>(1);
  const [targeting, setTargeting] = useState<SurveyTargetingCriteria | null>(null);
  const [isTargetingExpanded, setIsTargetingExpanded] = useState<boolean>(false);
  const [targetingErrors, setTargetingErrors] = useState<Record<string, string>>({});
  const [selectedBlockIndex, setSelectedBlockIndex] = useState<number | null>(null);
  const [isPropertiesPanelOpen, setIsPropertiesPanelOpen] = useState<boolean>(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [previewViewport, setPreviewViewport] = useState<ViewportMode>("desktop");

  const [isPublishModalOpen, setIsPublishModalOpen] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishPrecheckError, setPublishPrecheckError] = useState<string | null>(null);
  const [previewResetKey, setPreviewResetKey] = useState(0);

  const [isNewVersionModalOpen, setIsNewVersionModalOpen] = useState<boolean>(false);
  const [isCreatingVersion, setIsCreatingVersion] = useState<boolean>(false);
  const [newVersionError, setNewVersionError] = useState<string | null>(null);
  // Decision E5-D4: respondents a new version would cut off.
  const [inProgressAttempts, setInProgressAttempts] = useState<number | null>(
    null,
  );
  const [isLoadingImpact, setIsLoadingImpact] = useState<boolean>(false);

  const [externalUrl, setExternalUrl] = useState<string | null>(null);
  const [hasCompletionCode, setHasCompletionCode] = useState<boolean>(false);
  const [isRotateModalOpen, setIsRotateModalOpen] = useState<boolean>(false);

  const [actionNotification, setActionNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [isClosing, setIsClosing] = useState<boolean>(false);
  const [copiedPublicLink, setCopiedPublicLink] = useState<boolean>(false);

  function handleCopyPublicLink() {
    const url = typeof window !== "undefined" ? `${window.location.origin}/f/${formId}` : `/f/${formId}`;
    navigator.clipboard.writeText(url);
    setCopiedPublicLink(true);
    setTimeout(() => setCopiedPublicLink(false), 2000);
  }

  const isReadOnly = formStatus !== "DRAFT";
  const pricingBand = describePricingBand({
    type: formType,
    rewardPerResponse,
    estimatedDurationMinutes,
    definition: { blocks, metadata },
    // Internal forms only get a version above 1 through "Create New Version"
    // on a published form, whose reward is then frozen (review F3).
    frozenReward: formType === "INTERNAL" && versionNumber > 1,
  });

  const autosave = useFormAutosave({
    formId,
    debounceMs: 1000,
    onSaveError: (err: Error & { code?: string; details?: unknown }) => {
      if (err.code === "TARGETING_VALIDATION_ERROR") {
        if (Array.isArray(err.details)) {
          const fieldErrors: Record<string, string> = {};
          for (const issue of err.details as Array<{ path: string[]; message: string }>) {
            const key = issue.path[0] || "targeting";
            fieldErrors[key] = issue.message;
          }
          setTargetingErrors(fieldErrors);
          return;
        }
      }
      if (err.code === "CONCURRENCY_CONFLICT") {
        setActionNotification({
          type: "error",
          message:
            "Conflict detected: another edit committed before your changes could be saved. Please reload to see the latest version.",
        });
        return;
      }
      setActionNotification({
        type: "error",
        message: err.message || "Failed to autosave changes.",
      });
    },
    onSaveSuccess: () => {
      setTargetingErrors({});
    },
  });
  const { setServerUpdatedAt: setAutosaveServerUpdatedAt } = autosave;

  useEffect(() => {
    async function loadForm() {
      try {
        setLoading(true);
        const res = await fetch(`/api/forms/${formId}`);
        if (!res.ok) {
          throw new Error("Failed to load form details");
        }
        const json = await res.json();
        const data: FormDetailDto = json.data;

        setTitle(data.title);
        setDescription(data.description || "");
        setRewardPerResponse(data.rewardPerResponse);
        setExpectedCompletions(data.expectedCompletions);
        setEstimatedDurationMinutes(data.estimatedDurationMinutes ?? null);
        setFormType(data.type || "INTERNAL");
        setExternalUrl(data.currentVersion?.externalUrl || null);
        setHasCompletionCode(Boolean(data.currentVersion?.hasCompletionCode));
        const parsedDefinition = parseFormDefinitionDraft(
          data.currentVersion.schemaJson,
        );
        if (!parsedDefinition.success) {
          throw new Error(
            parsedDefinition.errors.issues[0]?.message || "Invalid form definition",
          );
        }
        const definition = parsedDefinition.data;
        setBlocks(definition.blocks);
        setSettings(definition.settings);
        setMetadata(definition.metadata);
        setFormStatus(data.status);
        setVersionNumber(data.currentVersion?.versionNumber || 1);
        setTargeting(data.currentVersion?.targetingJson || null);
        setAutosaveServerUpdatedAt(data.updatedAt);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to load form";
        setInitialLoadError(message);
      } finally {
        setLoading(false);
      }
    }

    loadForm();
  }, [formId, setAutosaveServerUpdatedAt]);

  function handleOpenPublishModal() {
    if (formType !== "EXTERNAL" && blocks.length === 0) {
      setPublishPrecheckError("Add at least one question before publishing.");
      return;
    }
    // Epic 4 review P2: an External version without a completion-code
    // verifier cannot be published (the backend answers 422
    // EXTERNAL_COMPLETION_CODE_REQUIRED). Rotating issues a code and shows it
    // once, so the publisher can paste it into the Google Form first.
    if (formType === "EXTERNAL" && !hasCompletionCode) {
      setPublishPrecheckError(EXTERNAL_CODE_REQUIRED_MESSAGE);
      return;
    }
    // Decision E6-D2: the backend refuses a rewarded survey without a
    // duration or with a reward outside the FR-14 band (drafts still save).
    if (pricingBand.blocksPublish) {
      setPublishPrecheckError(pricingBand.message);
      return;
    }
    // Decision E5-D2: a survey that cannot be finished inside the 30-minute
    // attempt reservation is refused by the backend (422).
    const reservationWindow = describeReservationWindow({
      type: formType,
      definition: { blocks, metadata },
      estimatedDurationMinutes,
    });
    if (reservationWindow.blocksPublish) {
      setPublishPrecheckError(reservationWindow.message);
      return;
    }
    setPublishPrecheckError(null);
    setPublishError(null);
    setIsPublishModalOpen(true);
  }

  async function handleConfirmPublish() {
    try {
      setIsPublishing(true);
      setPublishError(null);
      await autosave.saveNow();

      const res = await formMutationFetch(`/api/forms/${formId}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const json = await res.json();
      if (!res.ok) {
        if (json?.error?.code === "EXTERNAL_COMPLETION_CODE_REQUIRED") {
          setHasCompletionCode(false);
          throw new Error(EXTERNAL_CODE_REQUIRED_MESSAGE);
        }
        const pricingMessage = pricingPublishErrorMessage(
          json?.error?.code,
          json?.error?.details,
        );
        if (pricingMessage) {
          throw new Error(pricingMessage);
        }
        const windowMessage = reservationWindowPublishErrorMessage(
          json?.error?.code,
          json?.error?.details,
        );
        if (windowMessage) {
          throw new Error(windowMessage);
        }
        throw new Error(json?.error?.message || "Failed to publish form");
      }

      setFormStatus(json.data.status);
      setIsPublishModalOpen(false);
      setActionNotification({
        type: "success",
        message: isAwaitingModeration(json.data.status)
          ? "Đã gửi khảo sát để kiểm duyệt. Khảo sát sẽ xuất hiện trên Marketplace sau khi Admin phê duyệt."
          : `Survey published successfully! Current status: ${formStatusLabel(json.data.status)}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to publish form";
      setPublishError(msg);
    } finally {
      setIsPublishing(false);
    }
  }

  function handleOpenNewVersionModal() {
    setNewVersionError(null);
    setIsNewVersionModalOpen(true);
    // Decision E5-D4: warn with the live count of in-progress respondents.
    setInProgressAttempts(null);
    setIsLoadingImpact(true);
    fetchInProgressAttempts(formId)
      .then((impact) => setInProgressAttempts(impact.inProgressAttempts))
      .catch(() => setInProgressAttempts(null))
      .finally(() => setIsLoadingImpact(false));
  }

  async function handleConfirmCreateNewVersion() {
    try {
      setIsCreatingVersion(true);
      setNewVersionError(null);

      const res = await formMutationFetch(`/api/forms/${formId}/versions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message || "Failed to create new version");
      }

      const updatedData: FormDetailDto & { interruptedAttempts?: number } =
        json.data;
      setTitle(updatedData.title);
      setDescription(updatedData.description || "");
      setRewardPerResponse(updatedData.rewardPerResponse);
      setExpectedCompletions(updatedData.expectedCompletions);
      setEstimatedDurationMinutes(updatedData.estimatedDurationMinutes ?? null);
      setFormType(updatedData.type || "INTERNAL");
      const parsedDefinition = parseFormDefinitionDraft(
        updatedData.currentVersion.schemaJson,
      );
      if (!parsedDefinition.success) {
        throw new Error(
          parsedDefinition.errors.issues[0]?.message || "Invalid form definition",
        );
      }
      const definition = parsedDefinition.data;
      setBlocks(definition.blocks);
      setSettings(definition.settings);
      setMetadata(definition.metadata);
      setFormStatus(updatedData.status);
      setVersionNumber(updatedData.currentVersion?.versionNumber || 1);
      setTargeting(updatedData.currentVersion.targetingJson || null);
      setExternalUrl(updatedData.currentVersion?.externalUrl || null);
      // A new External version starts without a verifier (P2): the publisher
      // must rotate before re-publishing.
      setHasCompletionCode(Boolean(updatedData.currentVersion?.hasCompletionCode));
      autosave.setServerUpdatedAt(updatedData.updatedAt);

      setIsNewVersionModalOpen(false);
      setActionNotification({
        type: "success",
        message: interruptedAttemptsNotice(
          updatedData.currentVersion?.versionNumber ?? versionNumber + 1,
          updatedData.interruptedAttempts,
        ),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create new version";
      setNewVersionError(msg);
    } finally {
      setIsCreatingVersion(false);
    }
  }

  async function handleCloseSurvey() {
    if (
      !confirm(
        "Are you sure you want to close this survey? No further responses will be accepted.",
      )
    ) {
      return;
    }
    try {
      setIsClosing(true);
      const res = await formMutationFetch(`/api/forms/${formId}/close`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message || "Failed to close survey");
      }
      setFormStatus(json.data.status);
      setActionNotification({
        type: "success",
        message: "Survey has been closed.",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to close survey";
      setActionNotification({
        type: "error",
        message: msg,
      });
    } finally {
      setIsClosing(false);
    }
  }

  function handleFieldChange(updates: {
    newTitle?: string;
    newDescription?: string;
    newReward?: number;
    newExpected?: number;
    newEstimatedDuration?: number | null;
    newBlocks?: FormBlock[];
    newTargeting?: SurveyTargetingCriteria | null;
  }) {
    if (isReadOnly) return;
    const updatedTitle = updates.newTitle !== undefined ? updates.newTitle : title;
    const updatedDesc =
      updates.newDescription !== undefined ? updates.newDescription : description;
    const updatedReward =
      updates.newReward !== undefined ? updates.newReward : rewardPerResponse;
    const updatedExpected =
      updates.newExpected !== undefined ? updates.newExpected : expectedCompletions;
    const updatedDuration =
      updates.newEstimatedDuration !== undefined
        ? updates.newEstimatedDuration
        : estimatedDurationMinutes;
    const updatedBlocks = updates.newBlocks !== undefined ? updates.newBlocks : blocks;
    const updatedTargeting =
      updates.newTargeting !== undefined ? updates.newTargeting : targeting;

    if (updates.newTitle !== undefined) setTitle(updatedTitle);
    if (updates.newDescription !== undefined) setDescription(updatedDesc);
    if (updates.newReward !== undefined) setRewardPerResponse(updatedReward);
    if (updates.newExpected !== undefined) setExpectedCompletions(updatedExpected);
    if (updates.newEstimatedDuration !== undefined) {
      setEstimatedDurationMinutes(updatedDuration);
    }
    if (updates.newBlocks !== undefined) setBlocks(updatedBlocks);
    if (updates.newTargeting !== undefined) {
      setTargeting(updatedTargeting);
      // Validate client-side for immediate per-field feedback
      if (updatedTargeting != null) {
        const result = surveyTargetingSchema.safeParse(updatedTargeting);
        if (!result.success) {
          const fieldErrors: Record<string, string> = {};
          for (const issue of result.error.issues) {
            const field = (issue.path[0] as string) || "general";
            fieldErrors[field] = issue.message;
          }
          setTargetingErrors(fieldErrors);
        } else {
          setTargetingErrors({});
        }
      } else {
        setTargetingErrors({});
      }
    }

    autosave.triggerAutosave({
      title: updatedTitle,
      description: updatedDesc,
      rewardPerResponse: updatedReward,
      expectedCompletions: updatedExpected,
      estimatedDurationMinutes: updatedDuration,
      targetingJson: updatedTargeting,
      schema: {
        schemaVersion: 1,
        title: updatedTitle,
        description: updatedDesc,
        blocks: updatedBlocks,
        settings,
        metadata,
      },
    });
  }

  function handleSelectBlock(index: number) {
    if (isReadOnly) return;
    setSelectedBlockIndex(index);
    setIsPropertiesPanelOpen(true);
  }

  function handleCloseProperties() {
    setIsPropertiesPanelOpen(false);
    setSelectedBlockIndex(null);
  }

  function handleAddBlockAtIndex(type: FormBlockType, targetIndex: number) {
    if (isReadOnly) return;
    const newBlock = createDefaultBlock(type, targetIndex);
    const updated = [...blocks];
    updated.splice(targetIndex, 0, newBlock);
    const reindexed = reindexBlocks(updated);
    handleFieldChange({ newBlocks: reindexed });
    setSelectedBlockIndex(targetIndex);
    setIsPropertiesPanelOpen(true);
  }

  function handleAddBlock(type: FormBlockType) {
    if (isReadOnly) return;
    handleAddBlockAtIndex(type, blocks.length);
  }

  function handleUpdateBlock(index: number, updatedBlock: FormBlock) {
    if (isReadOnly) return;
    const validation = formBlockSchema.safeParse(updatedBlock);
    if (!validation.success) {
      setActionNotification({
        type: "error",
        message: validation.error.issues[0]?.message || "Invalid question settings",
      });
      return;
    }
    const next = updateBlockInList(blocks, index, updatedBlock);
    handleFieldChange({ newBlocks: next });
  }

  function handleDeleteBlock(index: number) {
    if (isReadOnly) return;
    const next = deleteBlock(blocks, index);
    handleFieldChange({ newBlocks: next });
    if (selectedBlockIndex === index) {
      setSelectedBlockIndex(null);
      setIsPropertiesPanelOpen(false);
    } else if (selectedBlockIndex !== null && selectedBlockIndex > index) {
      setSelectedBlockIndex(selectedBlockIndex - 1);
    }
  }

  function handleDuplicateBlock(index: number) {
    if (isReadOnly) return;
    const { updatedBlocks, newBlockIndex } = duplicateBlock(blocks, index);
    handleFieldChange({ newBlocks: updatedBlocks });
    setSelectedBlockIndex(newBlockIndex);
    setIsPropertiesPanelOpen(true);
  }

  function handleMoveUp(index: number) {
    if (isReadOnly) return;
    const updated = moveBlockUp(blocks, index);
    handleFieldChange({ newBlocks: updated });
    if (selectedBlockIndex === index) {
      setSelectedBlockIndex(index - 1);
    } else if (selectedBlockIndex === index - 1) {
      setSelectedBlockIndex(index);
    }
  }

  function handleMoveDown(index: number) {
    if (isReadOnly) return;
    const updated = moveBlockDown(blocks, index);
    handleFieldChange({ newBlocks: updated });
    if (selectedBlockIndex === index) {
      setSelectedBlockIndex(index + 1);
    } else if (selectedBlockIndex === index + 1) {
      setSelectedBlockIndex(index);
    }
  }

  function handleReorderBlock(fromIndex: number, toIndex: number) {
    if (isReadOnly) return;
    const updated = reorderBlocks(blocks, fromIndex, toIndex);
    handleFieldChange({ newBlocks: updated });
    if (selectedBlockIndex === fromIndex) {
      setSelectedBlockIndex(toIndex);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-16 text-center text-gray-500 animate-pulse">
        Loading form editor...
      </div>
    );
  }

  if (initialLoadError) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <div className="p-4 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 rounded-lg border border-red-200 dark:border-red-900">
          {initialLoadError}
        </div>
        <Link
          href="/forms"
          className="mt-4 inline-block text-sm text-indigo-600 dark:text-indigo-400 underline"
        >
          &larr; Back to my surveys
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-20">
      {/* Top Navigation & Live Autosave Feedback Bar */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-200 dark:border-gray-800 px-6 py-3.5">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/forms"
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-sm"
            >
              &larr; Surveys
            </Link>
            <span className="text-gray-300 dark:text-gray-700">|</span>
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${formStatusBadgeClass(formStatus)}`}
              title={formStatus}
            >
              {formStatusLabel(formStatus)}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-semibold border border-gray-200 dark:border-gray-700">
              v{versionNumber}
            </span>
          </div>

          {/* Action & Status Feedback Bar */}
          <div className="flex items-center gap-3 text-xs">
            {!isReadOnly && (
              <>
                <div
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full border transition-colors ${
                    autosave.status === "saving"
                      ? "bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-300"
                      : autosave.status === "saved"
                        ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300"
                        : autosave.status === "unsaved"
                          ? "bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300"
                          : autosave.status === "error"
                            ? "bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300"
                            : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"
                  }`}
                >
                  {autosave.status === "saving" && (
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                  )}
                  {autosave.status === "saved" && (
                    <span className="text-emerald-600 font-bold">&check;</span>
                  )}
                  {autosave.status === "unsaved" && (
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                  )}
                  {autosave.status === "error" && (
                    <span className="text-red-600 font-bold">&times;</span>
                  )}
                  <span>{autosave.statusText}</span>
                </div>

                {autosave.status === "error" && (
                  <button
                    type="button"
                    onClick={() => autosave.saveNow()}
                    className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs transition-colors"
                  >
                    Retry
                  </button>
                )}

                {formType !== "EXTERNAL" && (
                  <button
                    type="button"
                    onClick={() => setIsAiModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded text-xs font-medium shadow-sm transition-all"
                  >
                    <span>✨</span>
                    <span>Generate with AI</span>
                  </button>
                )}
              </>
            )}

            {formType === "EXTERNAL" && formStatus !== "CLOSED" && (
              <button
                type="button"
                onClick={() => setIsRotateModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-xs font-semibold shadow-sm transition-all cursor-pointer"
              >
                <span>🔄</span>
                <span>Rotate Code</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setViewMode(viewMode === "edit" ? "preview" : "edit")}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium border shadow-sm transition-all cursor-pointer ${
                viewMode === "preview"
                  ? "bg-indigo-600 border-indigo-600 text-white"
                  : "bg-white hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700"
              }`}
            >
              <svg
                className={`w-3.5 h-3.5 ${viewMode === "preview" ? "text-white" : "text-indigo-500"}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <span>{viewMode === "preview" ? "Exit Preview" : "Preview"}</span>
            </button>

            {!isReadOnly && (
              <>
                <button
                  type="button"
                  onClick={() => autosave.saveNow()}
                  disabled={autosave.status === "saving"}
                  className="px-3 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs transition-colors disabled:opacity-50"
                >
                  Save Now
                </button>

                <button
                  type="button"
                  onClick={handleOpenPublishModal}
                  disabled={
                    (formType !== "EXTERNAL" && blocks.length === 0) ||
                    autosave.status === "saving"
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                >
                  <span>🚀</span>
                  <span>Publish</span>
                </button>
              </>
            )}

            {isReadOnly && formStatus === "PUBLISHED" && (
              <>
                <button
                  type="button"
                  onClick={handleCopyPublicLink}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs font-medium border border-gray-200 dark:border-gray-700 shadow-2xs transition-colors cursor-pointer"
                >
                  {copiedPublicLink ? (
                    <>
                      <span className="text-emerald-600 font-bold">&check;</span>
                      <span className="text-emerald-600">Copied!</span>
                    </>
                  ) : (
                    <>
                      <span>🔗</span>
                      <span>Copy Public Link</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleOpenNewVersionModal}
                  disabled={isCreatingVersion}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                >
                  <span>✨</span>
                  <span>Create New Version</span>
                </button>

                <button
                  type="button"
                  onClick={handleCloseSurvey}
                  disabled={isClosing}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-medium shadow-sm transition-all disabled:opacity-50"
                >
                  <span>🔒</span>
                  <span>{isClosing ? "Closing..." : "Close Survey"}</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Public Form Shareable Banner for Published Forms */}
      {isReadOnly && formStatus === "PUBLISHED" && (
        <div className="bg-indigo-50/80 dark:bg-indigo-950/40 border-b border-indigo-100 dark:border-indigo-900/50 px-6 py-2">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-indigo-900 dark:text-indigo-200">
                Public Guest Link:
              </span>
              <a
                href={`/f/${formId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-indigo-600 dark:text-indigo-400 hover:underline bg-white dark:bg-gray-900 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800 flex items-center gap-1"
              >
                <span>/f/{formId}</span>
                <span className="text-[10px]">↗</span>
              </a>
              <span className="hidden sm:inline text-indigo-600/75 dark:text-indigo-400/75 text-[11px]">
                (Open for unauthenticated guest responses with bot protection)
              </span>
            </div>

            <button
              type="button"
              onClick={handleCopyPublicLink}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-white dark:bg-gray-900 hover:bg-indigo-50 dark:hover:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium rounded-lg border border-indigo-200 dark:border-indigo-800 text-xs shadow-2xs transition-colors cursor-pointer"
            >
              {copiedPublicLink ? (
                <>
                  <span className="text-emerald-600 font-bold">&check;</span>
                  <span className="text-emerald-600 font-semibold">Copied to Clipboard!</span>
                </>
              ) : (
                <>
                  <span>📋</span>
                  <span>Copy Link</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Live Form Preview Mode */}
      {viewMode === "preview" ? (
        <div>
          <PreviewControlBar
            viewport={previewViewport}
            onViewportChange={setPreviewViewport}
            onExitPreview={() => setViewMode("edit")}
            onResetAnswers={() => setPreviewResetKey((value) => value + 1)}
          />

          <div className="py-8 px-4 flex justify-center">
            <div
              className={`transition-all duration-300 w-full ${
                previewViewport === "desktop"
                  ? "max-w-3xl"
                  : previewViewport === "tablet"
                    ? "max-w-xl shadow-2xl rounded-3xl p-3 bg-gray-200 dark:bg-gray-800"
                    : "max-w-sm shadow-2xl rounded-[2.5rem] p-3 border-4 border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800"
              }`}
            >
              <FormRenderer
                key={previewResetKey}
                formId={formId}
                title={title}
                description={description}
                rewardPerResponse={rewardPerResponse}
                blocks={blocks}
                settings={settings}
                metadata={metadata}
                isPreviewMode={true}
                onExitPreview={() => setViewMode("edit")}
              />
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Main Form Builder Editor Workspace */}
          <main className="max-w-6xl mx-auto px-4 pt-8 space-y-4">
            {/* Action Feedback Banner */}
            {actionNotification && (
              <div
                className={`p-3 rounded-xl flex items-center justify-between text-sm ${
                  actionNotification.type === "success"
                    ? "bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200"
                    : "bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-red-800 dark:text-red-200"
                }`}
              >
                <span>{actionNotification.message}</span>
                <button
                  type="button"
                  onClick={() => setActionNotification(null)}
                  className="text-xs font-semibold underline ml-2 hover:opacity-80"
                >
                  Dismiss
                </button>
              </div>
            )}

            {publishPrecheckError && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm">
                {publishPrecheckError}
              </div>
            )}

            {/* Story 8.1: awaiting Admin moderation */}
            {isAwaitingModeration(formStatus) && (
              <div
                role="status"
                className="bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 rounded-xl p-4 flex items-start gap-3 shadow-xs"
              >
                <span className="text-xl" aria-hidden="true">⏳</span>
                <div>
                  <h4 className="text-sm font-semibold text-violet-900 dark:text-violet-200">
                    Khảo sát đang chờ kiểm duyệt
                  </h4>
                  <p className="text-xs text-violet-700 dark:text-violet-300 mt-0.5">
                    Điểm thưởng đã được giữ trong ký quỹ. Khảo sát chỉ xuất hiện trên Marketplace sau khi Admin phê duyệt; nếu bị từ chối, bạn sẽ nhận thông báo kèm lý do và toàn bộ điểm ký quỹ được hoàn lại.
                  </p>
                </div>
              </div>
            )}

            {/* Permanent Immutability / Lock Banner */}
            {isReadOnly && (
              <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-start gap-3 shadow-xs">
                <span className="text-xl">🔒</span>
                <div>
                  <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    Form Schema is Permanently Locked ({formStatusLabel(formStatus)})
                  </h4>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                    This form is no longer a draft. Questions, choices, and reward settings are frozen to guarantee auditability and data integrity for all respondents.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left Column: Draggable Question Toolbox or External Survey Status */}
              <div className="lg:col-span-4 lg:sticky lg:top-20 z-20 space-y-4">
                {formType === "EXTERNAL" ? (
                  <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm space-y-4">
                    <div className="flex items-center gap-2.5">
                      <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-bold text-sm">
                        📋
                      </span>
                      <div>
                        <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                          Google Forms Survey
                        </h3>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                          External Platform
                        </p>
                      </div>
                    </div>

                    {externalUrl && (
                      <div>
                        <span className="text-[11px] font-semibold text-gray-400 block mb-1">
                          Destination Link
                        </span>
                        <a
                          href={externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-mono text-indigo-600 dark:text-indigo-400 hover:underline break-all block p-2.5 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700"
                        >
                          {externalUrl} ↗
                        </a>
                      </div>
                    )}

                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-xs space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-emerald-900 dark:text-emerald-200">
                        <span>🛡️</span>
                        <span>Security & Verification</span>
                      </div>
                      <p className="text-[11px] text-emerald-800 dark:text-emerald-300">
                        {hasCompletionCode
                          ? "Keyed HMAC-SHA256 verifier active. Plaintext code is protected and never stored."
                          : "Phiên bản này chưa có mã hoàn thành. Hãy bấm “Rotate Completion Code” để tạo mã trước khi xuất bản."}
                      </p>
                    </div>

                    {formStatus !== "CLOSED" && (
                      <button
                        type="button"
                        onClick={() => setIsRotateModalOpen(true)}
                        className="w-full py-2.5 px-3 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-800 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
                      >
                        <span>🔄</span>
                        <span>Rotate Completion Code</span>
                      </button>
                    )}
                  </div>
                ) : isReadOnly ? (
                  <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                      <span>🔒</span>
                      <span>Toolbox Locked</span>
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                      Questions cannot be added, reordered, or modified while the form status is <span className="font-semibold text-gray-700 dark:text-gray-300">{formStatusLabel(formStatus)}</span>.
                    </p>
                  </div>
                ) : (
                  <Toolbox onAddBlock={handleAddBlock} />
                )}
              </div>

              {/* Right Column: Canvas Workspace & Survey Configuration */}
              <div className="lg:col-span-8 space-y-6">
                {/* Survey Title & Settings Card */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => handleFieldChange({ newTitle: e.target.value })}
                    disabled={isReadOnly}
                    placeholder="Untitled Survey"
                    className="w-full text-2xl font-bold text-gray-900 dark:text-white bg-transparent border-none focus:outline-none focus:ring-0 placeholder:text-gray-300 dark:placeholder:text-gray-700 mb-3 disabled:opacity-75 disabled:cursor-not-allowed"
                  />
                  <textarea
                    value={description}
                    onChange={(e) =>
                      handleFieldChange({ newDescription: e.target.value })
                    }
                    disabled={isReadOnly}
                    placeholder="Form description (optional)..."
                    rows={2}
                    className="w-full text-sm text-gray-600 dark:text-gray-300 bg-transparent border-none focus:outline-none focus:ring-0 placeholder:text-gray-400 dark:placeholder:text-gray-600 resize-none disabled:opacity-75 disabled:cursor-not-allowed"
                  />

                  <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Reward Points per Response
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={10000}
                        value={rewardPerResponse}
                        onChange={(e) =>
                          handleFieldChange({ newReward: Number(e.target.value) })
                        }
                        disabled={isReadOnly}
                        className="w-full px-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Target Response Quota
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={100000}
                        value={expectedCompletions}
                        onChange={(e) =>
                          handleFieldChange({ newExpected: Number(e.target.value) })
                        }
                        disabled={isReadOnly}
                        className="w-full px-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>

                  {/* Decision E6-D2: estimated duration -> FR-14 pricing band */}
                  <div className="mt-4">
                    <label
                      htmlFor="estimated-duration-minutes"
                      className="block text-xs font-medium text-gray-500 mb-1"
                    >
                      Thời gian hoàn thành dự kiến (phút)
                    </label>
                    <input
                      id="estimated-duration-minutes"
                      type="number"
                      min={1}
                      max={1440}
                      step={1}
                      value={estimatedDurationMinutes ?? ""}
                      onChange={(e) => {
                        const parsed = Math.trunc(Number(e.target.value));
                        handleFieldChange({
                          newEstimatedDuration:
                            e.target.value === "" || !Number.isFinite(parsed)
                              ? null
                              : Math.min(1440, Math.max(1, parsed)),
                        });
                      }}
                      disabled={isReadOnly}
                      aria-describedby="pricing-band-hint"
                      className="w-full sm:w-1/2 px-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                    <p
                      id="pricing-band-hint"
                      role="status"
                      className={`text-xs mt-1 ${
                        pricingBand.tone === "error"
                          ? "text-red-600 dark:text-red-400"
                          : pricingBand.tone === "warning"
                            ? "text-amber-700 dark:text-amber-400"
                            : "text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      {pricingBand.message}
                    </p>
                  </div>
                </div>

                {/* Distribution Targeting Settings Card */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">🎯</span>
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                          Distribution & Audience Targeting
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          Specify demographic criteria for marketplace distribution
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsTargetingExpanded(!isTargetingExpanded)}
                      className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      <span>{isTargetingExpanded ? "Collapse" : "Configure"}</span>
                      <span className="text-[10px]">{isTargetingExpanded ? "▲" : "▼"}</span>
                    </button>
                  </div>

                  {/* Summary Bar */}
                  <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                    <TargetingAudienceSummary targeting={targeting} />
                  </div>

                  {/* Expanded Targeting Controls */}
                  {isTargetingExpanded && (
                    <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
                      <TargetingPanel
                        targeting={targeting}
                        onChange={(newTargeting) =>
                          handleFieldChange({ newTargeting })
                        }
                        readOnly={isReadOnly}
                        errors={targetingErrors}
                      />
                    </div>
                  )}
                </div>

                {/* Builder Canvas with Drop Zones and Block Renderers (or External Google Form Overview) */}
                {formType === "EXTERNAL" ? (
                  <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm space-y-4">
                    <div className="flex items-center gap-3 pb-3 border-b border-gray-100 dark:border-gray-800">
                      <span className="text-2xl">📋</span>
                      <div>
                        <h3 className="text-base font-bold text-gray-900 dark:text-white">
                          External Google Form Overview
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Questions and choices are hosted on Google Forms. RESCOM manages distribution, demographic targeting, escrow, and completion verification.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3 text-xs text-gray-600 dark:text-gray-300">
                      <div className="p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl space-y-2">
                        <p className="font-semibold text-blue-950 dark:text-blue-100">
                          How Completion Code Verification Works:
                        </p>
                        <ol className="list-decimal list-inside space-y-1.5 pl-1 text-blue-900 dark:text-blue-200 leading-relaxed">
                          <li>Respondents discover your survey on the RESCOM Marketplace.</li>
                          <li>They click &ldquo;Take Survey&rdquo; and are directed to your Google Form.</li>
                          <li>Upon submission, Google Forms reveals your Completion Code on the confirmation screen.</li>
                          <li>The respondent enters this code into RESCOM to verify completion and release points.</li>
                        </ol>
                      </div>

                      <div className="p-4 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-xl space-y-2">
                        <p className="font-semibold text-gray-900 dark:text-white">
                          Form Version & Rotation Policy:
                        </p>
                        <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
                          Completion codes are strictly immutable per version. Rotating a completion code automatically creates a new immutable version <strong>(v{versionNumber + 1})</strong>.
                          Prior respondent submissions remain valid under their respective version verifiers.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <BuilderCanvas
                    blocks={blocks}
                    readOnly={isReadOnly}
                    selectedIndex={selectedBlockIndex}
                    onSelectBlock={handleSelectBlock}
                    onOpenSettings={handleSelectBlock}
                    onAddBlockAtIndex={handleAddBlockAtIndex}
                    onUpdateBlock={handleUpdateBlock}
                    onDeleteBlock={handleDeleteBlock}
                    onDuplicateBlock={handleDuplicateBlock}
                    onMoveUpBlock={handleMoveUp}
                    onMoveDownBlock={handleMoveDown}
                    onReorderBlock={handleReorderBlock}
                  />
                )}
              </div>
            </div>
          </main>

          {/* Block Properties Slide-Over Panel */}
          {formType !== "EXTERNAL" && (
            <BlockPropertiesPanel
              block={
                selectedBlockIndex !== null && blocks[selectedBlockIndex]
                  ? blocks[selectedBlockIndex]
                  : null
              }
              isOpen={
                !isReadOnly &&
                isPropertiesPanelOpen &&
                selectedBlockIndex !== null &&
                blocks[selectedBlockIndex] !== undefined
              }
              onClose={handleCloseProperties}
              onUpdate={(updated) => {
                if (selectedBlockIndex !== null) {
                  handleUpdateBlock(selectedBlockIndex, updated);
                }
              }}
              onDelete={() => {
                if (selectedBlockIndex !== null) {
                  handleDeleteBlock(selectedBlockIndex);
                }
              }}
              onDuplicate={() => {
                if (selectedBlockIndex !== null) {
                  handleDuplicateBlock(selectedBlockIndex);
                }
              }}
            />
          )}
        </>
      )}

      <GenerateWithAiModal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        formId={formId}
      />

      <PublishConfirmationModal
        isOpen={isPublishModalOpen}
        onClose={() => setIsPublishModalOpen(false)}
        onConfirm={handleConfirmPublish}
        title={title}
        formType={formType}
        blocksCount={blocks.length}
        rewardPerResponse={rewardPerResponse}
        expectedCompletions={expectedCompletions}
        estimatedDurationMinutes={estimatedDurationMinutes}
        pricingBandMessage={pricingBand.message}
        isPublishing={isPublishing}
        error={publishError}
      />

      <NewVersionConfirmationModal
        isOpen={isNewVersionModalOpen}
        onClose={() => setIsNewVersionModalOpen(false)}
        onConfirm={handleConfirmCreateNewVersion}
        currentVersionNumber={versionNumber}
        isCreating={isCreatingVersion}
        error={newVersionError}
        inProgressAttempts={inProgressAttempts}
        isLoadingImpact={isLoadingImpact}
      />

      <RotateCompletionCodeModal
        isOpen={isRotateModalOpen}
        onClose={() => setIsRotateModalOpen(false)}
        formId={formId}
        currentVersionNumber={versionNumber}
        onRotated={(newVer, updatedAt) => {
          setVersionNumber(newVer);
          setHasCompletionCode(true);
          // Rotation bumps Form.updatedAt; refresh the autosave concurrency
          // token so the next autosave does not fail with a 409 (P17).
          if (updatedAt) autosave.setServerUpdatedAt(updatedAt);
          setPublishPrecheckError(null);
          setActionNotification({
            type: "success",
            message: `Completion code rotated successfully. Form updated to version v${newVer}.`,
          });
        }}
      />
    </div>
  );
}
