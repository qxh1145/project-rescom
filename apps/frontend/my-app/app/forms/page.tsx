"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormSummaryDto } from "@rescom/schemas";
import { formMutationFetch } from "./forms-api";
import { CreateExternalSurveyModal } from "./components/CreateExternalSurveyModal";
import { formStatusBadgeClass, formStatusLabel } from "./form-status";

export default function FormsListPage() {
  const router = useRouter();
  const [forms, setForms] = useState<FormSummaryDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [creating, setCreating] = useState<boolean>(false);
  const [isExternalModalOpen, setIsExternalModalOpen] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function handleCopyPublicLink(e: React.MouseEvent, formId: string) {
    e.preventDefault();
    e.stopPropagation();
    const url = typeof window !== "undefined" ? `${window.location.origin}/f/${formId}` : `/f/${formId}`;
    navigator.clipboard.writeText(url);
    setCopiedId(formId);
    setTimeout(() => {
      setCopiedId((current) => (current === formId ? null : current));
    }, 2000);
  }

  useEffect(() => {
    async function fetchForms() {
      try {
        setLoading(true);
        const res = await fetch("/api/forms?page=1&limit=20");
        if (!res.ok) {
          throw new Error("Failed to load surveys");
        }
        const json = await res.json();
        setForms(json.data?.forms || []);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Could not load surveys";
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    fetchForms();
  }, []);

  async function handleCreateNewSurvey() {
    try {
      setCreating(true);
      setError(null);
      const res = await formMutationFetch("/api/forms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "Untitled Survey",
          type: "INTERNAL",
          rewardPerResponse: 10,
          expectedCompletions: 50,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || "Failed to create draft");
      }

      const json = await res.json();
      const newFormId = json.data?.id;
      if (newFormId) {
        router.push(`/forms/${newFormId}/edit`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create new survey";
      setError(message);
      setCreating(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-200 dark:border-gray-800">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              My Surveys & Drafts
            </h1>
            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
              Publisher
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage your surveys, drafts, and responses.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/marketplace"
            className="inline-flex items-center px-3.5 py-2 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg shadow-sm transition-colors"
          >
            Marketplace
          </Link>
          <Link
            href="/wallet"
            className="inline-flex items-center px-3.5 py-2 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg shadow-sm transition-colors"
          >
            My Wallet
          </Link>
          <button
            type="button"
            onClick={() => setIsExternalModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 text-sm font-medium rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            <span>📋</span>
            <span>+ External Survey (Google Forms)</span>
          </button>
          <button
            type="button"
            onClick={handleCreateNewSurvey}
            disabled={creating}
            className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50"
          >
            {creating ? "Creating Draft..." : "+ Create New Survey"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-gray-400 animate-pulse">
          Loading your surveys...
        </div>
      ) : forms.length === 0 ? (
        <div className="text-center py-16 px-4 rounded-xl border border-dashed border-gray-300 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          <p className="text-gray-500 dark:text-gray-400 font-medium">
            No surveys or drafts yet.
          </p>
          <p className="text-xs text-gray-400 mt-1 mb-4">
            Start by creating an internal survey or linking your Google Form.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleCreateNewSurvey}
              disabled={creating}
              className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg shadow-sm transition-colors"
            >
              Create Internal Survey
            </button>
            <button
              type="button"
              onClick={() => setIsExternalModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-xs font-medium rounded-lg shadow-sm transition-colors"
            >
              <span>📋</span>
              <span>+ External Survey (Google Forms)</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {forms.map((form) => (
            <Link
              key={form.id}
              href={`/forms/${form.id}/edit`}
              className="p-5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm hover:border-indigo-400 dark:hover:border-indigo-600 transition-all block group"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${formStatusBadgeClass(form.status)}`}
                    title={form.status}
                  >
                    {formStatusLabel(form.status)}
                  </span>
                  {form.type === "EXTERNAL" && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 flex items-center gap-1">
                      <span>📋</span> Google Forms
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-400">
                  v{form.latestVersionNumber}
                </span>
              </div>
              <h2 className="font-semibold text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-1">
                {form.title}
              </h2>
              {form.description && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                  {form.description}
                </p>
              )}
              <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-xs text-gray-500">
                <span>{form.rewardPerResponse} pts / response</span>
                <span>{form.expectedCompletions} slots</span>
              </div>

              {form.status === "PUBLISHED" && (
                <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-800/60 flex items-center justify-between">
                  <span className="text-[11px] text-gray-400 font-mono">/f/{form.id.slice(0, 8)}...</span>
                  <button
                    type="button"
                    onClick={(e) => handleCopyPublicLink(e, form.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg transition-colors cursor-pointer"
                  >
                    {copiedId === form.id ? (
                      <>
                        <span className="text-emerald-600 font-bold">&check;</span>
                        <span className="text-emerald-600">Copied!</span>
                      </>
                    ) : (
                      <>
                        <span>🔗</span>
                        <span>Copy Link</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* External Survey Creation Stepper Modal */}
      <CreateExternalSurveyModal
        isOpen={isExternalModalOpen}
        onClose={() => {
          setIsExternalModalOpen(false);
          // Refresh forms list after creation. A failed refresh keeps the
          // current list (never wipes it) and surfaces the page error.
          fetch("/api/forms?page=1&limit=20")
            .then((res) =>
              res.ok ? res.json() : Promise.reject(new Error("Failed to refresh surveys")),
            )
            .then((json) => {
              setForms(json.data?.forms || []);
              setError(null);
            })
            .catch((err: unknown) => {
              setError(
                err instanceof Error ? err.message : "Failed to refresh surveys",
              );
            });
        }}
      />
    </div>
  );
}
