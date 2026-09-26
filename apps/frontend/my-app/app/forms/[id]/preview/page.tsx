"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  FormBlock,
  FormDetailDto,
  FormIntegrityMetadata,
  FormSettings,
} from "@rescom/schemas";
import { parseFormDefinitionDraft } from "@rescom/schemas";
import { FormRenderer } from "../../components/renderer/FormRenderer";
import {
  PreviewControlBar,
  type ViewportMode,
} from "../../components/preview/PreviewControlBar";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function FormStandalonePreviewPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const formId = resolvedParams.id;
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState<string>("Untitled Survey");
  const [description, setDescription] = useState<string>("");
  const [rewardPerResponse, setRewardPerResponse] = useState<number>(10);
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
  const [viewport, setViewport] = useState<ViewportMode>("desktop");
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    async function loadForm() {
      try {
        setLoading(true);
        const res = await fetch(`/api/forms/${formId}`);
        if (!res.ok) {
          throw new Error("Failed to load form for preview");
        }
        const json = await res.json();
        const data: FormDetailDto = json.data;

        setTitle(data.title);
        setDescription(data.description || "");
        setRewardPerResponse(data.rewardPerResponse);
        const parsed = parseFormDefinitionDraft(data.currentVersion.schemaJson);
        if (!parsed.success) {
          throw new Error(
            parsed.errors.issues[0]?.message || "Invalid form definition",
          );
        }
        setBlocks(parsed.data.blocks);
        setSettings(parsed.data.settings);
        setMetadata(parsed.data.metadata);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error loading form";
        setError(msg);
      } finally {
        setLoading(false);
      }
    }

    loadForm();
  }, [formId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-center text-gray-500 animate-pulse text-sm">
          Loading live preview...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center p-4">
        <div className="p-6 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 rounded-2xl border border-red-200 dark:border-red-900 max-w-md w-full text-center">
          <p className="font-semibold mb-2">Preview Error</p>
          <p className="text-sm">{error}</p>
          <Link
            href={`/forms/${formId}/edit`}
            className="mt-4 inline-block text-xs font-semibold text-indigo-600 dark:text-indigo-400 underline"
          >
            &larr; Return to Form Editor
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-950 pb-20">
      <PreviewControlBar
        viewport={viewport}
        onViewportChange={setViewport}
        onExitPreview={() => router.push(`/forms/${formId}/edit`)}
        onResetAnswers={() => setResetKey((value) => value + 1)}
      />

      <div className="py-8 px-4 flex justify-center">
        <div
          className={`transition-all duration-300 w-full ${
            viewport === "desktop"
              ? "max-w-3xl"
              : viewport === "tablet"
                ? "max-w-xl shadow-2xl rounded-3xl p-3 bg-gray-200 dark:bg-gray-800"
                : "max-w-sm shadow-2xl rounded-[2.5rem] p-3 border-4 border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800"
          }`}
        >
          <FormRenderer
            key={resetKey}
            formId={formId}
            title={title}
            description={description}
            rewardPerResponse={rewardPerResponse}
            blocks={blocks}
            settings={settings}
            metadata={metadata}
            isPreviewMode={true}
            onExitPreview={() => router.push(`/forms/${formId}/edit`)}
          />
        </div>
      </div>
    </div>
  );
}
