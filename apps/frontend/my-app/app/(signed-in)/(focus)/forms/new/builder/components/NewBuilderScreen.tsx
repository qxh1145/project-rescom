"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { createDraftErrorMessage } from "@/lib/forms/builder-messages";
import { createBuilderDraft } from "@/lib/forms/builder-service";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

/** Creates the draft once (a ref guards the Strict Mode double effect), then replaces the URL. */
export function NewBuilderScreen() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const sessionLost = useSessionLossRedirect(error);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    createBuilderDraft()
      .then((form) => router.replace(`/forms/${form.id}/builder`))
      .catch((cause: unknown) => {
        started.current = false;
        setError(cause);
      });
  }, [router, attempt]);

  if (error && !sessionLost) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-4 px-4">
        <Alert tone="danger">{createDraftErrorMessage(error)}</Alert>
        <div className="flex gap-3">
          <Button
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Thử lại
          </Button>
          <Link href="/forms" className="inline-flex h-11 items-center px-4 text-label font-bold text-primary">
            Về Khảo sát của tôi
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-surface-muted" role="status">
      <Spinner className="size-8 text-primary" />
      <p className="text-body-sm text-ink-muted">Đang tạo bản nháp…</p>
    </div>
  );
}
