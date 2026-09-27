"use client";

import { useState } from "react";
import { disputeResolveErrorMessage, isStaleCaseError } from "@/lib/admin/disputes-messages";
import {
  resetCompletionCodeLimit,
  resolveDisputeCase,
  type DisputeCase,
  type DisputeCaseOutcome,
} from "@/lib/admin/disputes-service";
import { validateDecisionNote, type CaseAction } from "@/lib/admin/disputes-view";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

interface DecisionCallbacks {
  onResolved: (resolved: DisputeCase, outcome: DisputeCaseOutcome) => void;
  /** The case was decided elsewhere or vanished: the message to show, then the queue reloads. */
  onStale: (message: string) => void;
}

/**
 * Decision note + confirm dialog of one case (mount per case: `key={case.id}`).
 * "Mở lại giới hạn mã" calls the VERIFIED reset route first, then records the
 * ASSUMED `CODE_LIMIT_RESET` resolution; a retry after a failed second step
 * resets again (0 forgiven) and resolves.
 */
export function useCaseDecision(item: DisputeCase, { onResolved, onStale }: DecisionCallbacks) {
  const [note, setNote] = useState("");
  const [showNoteError, setShowNoteError] = useState(false);
  const [pending, setPending] = useState<CaseAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  useSessionLossRedirect(failure);

  const noteError = showNoteError ? validateDecisionNote(note) : null;

  /** Validates the note, then opens the confirm dialog. Returns false when the note is invalid. */
  function request(action: CaseAction): boolean {
    if (validateDecisionNote(note)) {
      setShowNoteError(true);
      return false;
    }
    setError(null);
    setPending(action);
    return true;
  }

  async function confirm() {
    if (!pending || busy) return;
    const text = note.trim();
    setBusy(true);
    setError(null);
    try {
      if (pending.outcome === "CODE_LIMIT_RESET") {
        await resetCompletionCodeLimit({
          respondentId: item.respondent.id,
          formVersionId: item.attempt.formVersionId,
          reason: text,
        });
      }
      const resolved = await resolveDisputeCase(item.id, { outcome: pending.outcome, note: text });
      setPending(null);
      onResolved(resolved, pending.outcome);
    } catch (cause) {
      setFailure(cause);
      if (isStaleCaseError(cause)) {
        setPending(null);
        onStale(disputeResolveErrorMessage(cause));
      } else {
        setError(disputeResolveErrorMessage(cause));
      }
    } finally {
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
