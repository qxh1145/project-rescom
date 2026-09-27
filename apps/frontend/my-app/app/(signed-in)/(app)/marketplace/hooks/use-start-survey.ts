"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { startOrResumeSurvey, type SurveyKind } from "@/lib/participation/start-flow";
import { useSession } from "@/lib/session/SessionProvider";

export interface StartNotice {
  tone: "info" | "danger";
  message: string;
  /** "Báo Admin" hint (completion-code limit on this survey). */
  support?: boolean;
}

/** "Bắt đầu" on a card: one start at a time, inline notice when it cannot start. */
export function useStartSurvey() {
  const router = useRouter();
  const { refresh } = useSession();
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
      // Session ended: `SessionGate` sends the user to login once the session is re-checked.
      if (decision.kind === "session") {
        refresh();
        return;
      }
      setNotice({ tone: decision.tone, message: decision.message, support: decision.support });
    },
    [refresh, router],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  return { start, pendingId, notice, dismissNotice };
}
