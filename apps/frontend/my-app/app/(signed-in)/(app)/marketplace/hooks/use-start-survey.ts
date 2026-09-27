"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { startOrResumeSurvey, type SurveyKind } from "@/lib/participation/start-flow";

export interface StartNotice {
  tone: "info" | "danger";
  message: string;
}

/** "Bắt đầu" on a card: one start at a time, inline notice when it cannot start. */
export function useStartSurvey() {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<StartNotice | null>(null);
  const busy = useRef(false);

  const start = useCallback(
    async (survey: { id: string; type: SurveyKind }) => {
      if (busy.current) return;
      busy.current = true;
      setPendingId(survey.id);
      setNotice(null);
      const decision = await startOrResumeSurvey(survey);
      if (decision.kind === "navigate") {
        // Stay busy until the next page replaces this one.
        router.push(decision.href);
        return;
      }
      busy.current = false;
      setPendingId(null);
      setNotice({ tone: decision.tone, message: decision.message });
    },
    [router],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  return { start, pendingId, notice, dismissNotice };
}
