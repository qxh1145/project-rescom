"use client";

import { useRef, useState } from "react";
import type { MissingCodeReport } from "@rescom/schemas";
import {
  disputeResolveErrorMessage,
  isStaleReportError,
} from "@/lib/admin/disputes-messages";
import {
  resetCompletionCodeLimit,
  resolveMissingCodeReport,
} from "@/lib/admin/disputes-service";
import {
  validateDecisionNote,
  type CaseAction,
} from "@/lib/admin/disputes-view";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

interface MissingCodeResolutionCallbacks {
  onResolved: (outcome: string, points: number) => void;
  onStale: (message: string) => void;
}

/**
 * Story 14.1 (AC 8): Decision note, double-submit guard and execution for a missing-code report.
 */
export function useMissingCodeResolution(
  report: MissingCodeReport,
  { onResolved, onStale }: MissingCodeResolutionCallbacks,
) {
  const [note, setNote] = useState("");
  const [showNoteError, setShowNoteError] = useState(false);
  const [pending, setPending] = useState<CaseAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const sending = useRef(false);

  useSessionLossRedirect(failure);

  const noteError = showNoteError
    ? validateDecisionNote(note, {
        min: 10,
        max: 500,
        audience: "người trả lời",
      })
    : null;

  function request(action: CaseAction): boolean {
    if (
      validateDecisionNote(note, {
        min: 10,
        max: 500,
        audience: "người trả lời",
      })
    ) {
      setShowNoteError(true);
      return false;
    }
    setError(null);
    setPending(action);
    return true;
  }

  async function confirm() {
    if (!pending || sending.current || busy) return;
    const text = note.trim();
    sending.current = true;
    setBusy(true);
    setError(null);

    try {
      if (pending.outcome === "CODE_LIMIT_RESET") {
        if (!report.respondent) {
          throw new Error("Không thể mở lại giới hạn cho lượt làm của khách.");
        }
        await resetCompletionCodeLimit({
          respondentId: report.respondent.id,
          formVersionId: report.formVersionId,
          reason: text,
        });
      } else if (
        pending.outcome === "CREDIT_RESPONDENT" ||
        pending.outcome === "DISMISSED"
      ) {
        await resolveMissingCodeReport(report.attemptId, {
          outcome: pending.outcome,
          note: text,
        });
      }
      setPending(null);
      onResolved(pending.outcome, report.rewardPerResponse);
    } catch (cause) {
      setFailure(cause);
      if (isStaleReportError(cause)) {
        setPending(null);
        onStale(disputeResolveErrorMessage(cause));
      } else {
        setError(disputeResolveErrorMessage(cause));
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return {
    note,
    setNote,
    noteError,
    pending,
    request,
    cancel: () => {
      if (busy) return;
      setPending(null);
      setError(null);
    },
    confirm,
    busy,
    error,
  };
}
