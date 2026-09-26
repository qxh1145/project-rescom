"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formMutationFetch } from "../forms-api";

export default function NewFormPage() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function createDraft() {
      try {
        const response = await formMutationFetch("/api/forms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Untitled Survey",
            type: "INTERNAL",
            rewardPerResponse: 10,
            expectedCompletions: 50,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.data?.id) {
          throw new Error(payload?.error?.message || "Failed to create draft");
        }
        router.replace(`/forms/${payload.data.id}/edit`);
      } catch (caught: unknown) {
        setError(caught instanceof Error ? caught.message : "Failed to create draft");
      }
    }

    void createDraft();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        {error ? (
          <>
            <h1 className="font-semibold text-red-700 dark:text-red-300">
              Could not create survey
            </h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{error}</p>
            <Link href="/forms" className="mt-4 inline-block text-indigo-600 underline">
              Back to surveys
            </Link>
          </>
        ) : (
          <p className="text-sm text-gray-500 animate-pulse">Creating your draft…</p>
        )}
      </div>
    </div>
  );
}
