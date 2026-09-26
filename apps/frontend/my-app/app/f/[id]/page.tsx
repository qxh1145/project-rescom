"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PublicFormDetailsDto } from "@rescom/schemas";
import { FormRenderer } from "../../forms/components/renderer/FormRenderer";
import { CaptchaWidget } from "../components/CaptchaWidget";

interface PublicFormPageProps {
  params: Promise<{ id: string }>;
}

export default function PublicFormPage({ params }: PublicFormPageProps) {
  const resolvedParams = use(params);
  const formId = resolvedParams.id;

  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<PublicFormDetailsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    startTimeRef.current = Date.now();

    async function fetchPublicForm() {
      try {
        setLoading(true);
        setError(null);
        setStatusCode(null);

        const res = await fetch(`/api/public/forms/${formId}`);
        if (!res.ok) {
          setStatusCode(res.status);
          const errorData = await res.json().catch(() => null);
          const message =
            errorData?.error?.message ||
            errorData?.message ||
            `Failed to load survey (${res.status})`;
          throw new Error(message);
        }

        const json = await res.json();
        setForm(json.data);
        startTimeRef.current = Date.now();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to load public survey";
        setError(msg);
      } finally {
        setLoading(false);
      }
    }

    fetchPublicForm();
  }, [formId]);

  async function handleGuestSubmit(answers: Record<string, unknown>) {
    if (!captchaToken) {
      throw new Error("Please complete the security CAPTCHA verification before submitting.");
    }

    const start = startTimeRef.current ?? Date.now();
    const timeSpentSeconds = Math.max(1, Math.round((Date.now() - start) / 1000));

    const payload = {
      answers,
      captchaToken,
      telemetry: {
        timeSpentSeconds,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      },
    };

    const res = await fetch(`/api/public/forms/${formId}/submissions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      const message =
        errorData?.error?.message ||
        errorData?.message ||
        `Submission failed with status ${res.status}`;
      throw new Error(message);
    }
  }

  // Loading Skeleton
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center p-6">
        <div className="max-w-xl w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-8 shadow-xs animate-pulse text-center">
          <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-950/60 rounded-xl mx-auto mb-4" />
          <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded w-2/3 mx-auto mb-3" />
          <div className="h-3 bg-gray-100 dark:bg-gray-800/60 rounded w-1/2 mx-auto" />
          <div className="mt-8 space-y-4">
            <div className="h-16 bg-gray-50 dark:bg-gray-800/40 rounded-xl" />
            <div className="h-16 bg-gray-50 dark:bg-gray-800/40 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  // 404: Not Found or Not Published
  if (statusCode === 404) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-8 shadow-sm">
          <div className="w-16 h-16 bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center mx-auto mb-5 text-2xl font-bold">
            🔍
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            Survey Not Found
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
            This survey is either unavailable, has ended, or does not exist. Please check the URL and try again.
          </p>
          <Link
            href="/"
            className="inline-flex items-center px-4 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 text-xs font-semibold rounded-xl transition-colors"
          >
            Go to RESCOM Home
          </Link>
        </div>
      </div>
    );
  }

  // 403: Forbidden / Public Access Disabled
  if (statusCode === 403) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-8 shadow-sm">
          <div className="w-16 h-16 bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-2xl flex items-center justify-center mx-auto mb-5 text-2xl font-bold">
            🔒
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            Survey Access Restricted
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
            Public guest access has been disabled by the survey author. An authenticated RESCOM account is required to participate.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/login"
              className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition-colors shadow-xs"
            >
              Sign In to RESCOM
            </Link>
            <Link
              href="/"
              className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 text-xs font-medium rounded-xl transition-colors"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Generic Error
  if (error || !form) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-8 shadow-sm">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 rounded-2xl flex items-center justify-center mx-auto mb-5 text-2xl font-bold">
            ⚠️
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            Failed to Load Survey
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
            {error || "An unexpected error occurred while loading this survey."}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4 sm:px-6 lg:px-8 flex flex-col items-center">
      {/* Public Header Bar */}
      <header className="w-full max-w-3xl mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-bold text-base tracking-tight text-gray-900 dark:text-white">
            RESCOM
          </span>
          <span className="text-gray-300 dark:text-gray-700">•</span>
          <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
            Guest Form
          </span>
        </div>

        <div className="text-xs text-gray-400 dark:text-gray-500">
          Anonymous response
        </div>
      </header>

      {/* Main Form Container */}
      <main className="w-full max-w-3xl">
        <FormRenderer
          formId={form.id}
          title={form.title}
          description={form.description ?? undefined}
          rewardPerResponse={0}
          blocks={form.blocks}
          settings={form.settings}
          metadata={form.metadata}
          isPreviewMode={false}
          isGuestMode={true}
          renderBeforeSubmit={
            <div className="pt-2">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Security Verification <span className="text-rose-500">*</span>
              </label>
              <CaptchaWidget
                onVerify={(tok) => setCaptchaToken(tok)}
                onExpire={() => setCaptchaToken(null)}
              />
            </div>
          }
          onSubmitResponse={handleGuestSubmit}
        />
      </main>

      {/* Public Footer */}
      <footer className="mt-12 text-center text-xs text-gray-400 dark:text-gray-500 max-w-md">
        <p>
          Powered by <strong>RESCOM Research Engine</strong>. Responses are submitted anonymously without collecting personal account information.
        </p>
      </footer>
    </div>
  );
}
