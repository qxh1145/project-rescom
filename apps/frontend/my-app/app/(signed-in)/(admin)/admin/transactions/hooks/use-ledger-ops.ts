"use client";

import { useRef, useState } from "react";
import type { LedgerDriftedAccount } from "@rescom/schemas";
import {
  getAccountBalance,
  getLedgerIntegrity,
  reconcileAccount,
  redriveReward,
  releaseMaturedRewards,
  type AccountBalanceVerification,
  type AccountReconciliationResult,
  type LedgerIntegrityReport,
  type MaturedReleaseSummary,
  type RewardSettlementResultDto,
} from "@/lib/admin/ledger-ops-service";
import { ledgerOpsErrorMessage } from "@/lib/admin/ledger-ops-messages";
import {
  parseRedriveId,
  parseReleaseLimit,
  type LedgerOpAction,
  type RedriveTarget,
} from "@/lib/admin/ledger-ops-view";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

export interface ReconcileOutcome {
  account: LedgerDriftedAccount;
  result: AccountReconciliationResult;
}

export interface RedriveOutcome {
  target: RedriveTarget;
  id: string;
  /** `null` = the External settlement is unavailable. */
  result: RewardSettlementResultDto | null;
}

export interface ReleaseOutcome {
  /** The limit this batch ran with, reused by "Chạy tiếp". */
  limit: number | undefined;
  summary: MaturedReleaseSummary;
}

/**
 * Story 14.4: state of the "Vận hành" tab. One confirmed action runs at a time
 * (`pending` → `confirm`, ref-guarded against a double click); integrity and the
 * per-account balance check are read-only and run on click.
 */
export function useLedgerOps() {
  const [failure, setFailure] = useState<unknown>(null);
  useSessionLossRedirect(failure);

  // Integrity + per-account balance check.
  const [report, setReport] = useState<LedgerIntegrityReport | null>(null);
  const [integrityLoading, setIntegrityLoading] = useState(false);
  const [integrityError, setIntegrityError] = useState<string | null>(null);
  const [verifications, setVerifications] = useState<Record<string, AccountBalanceVerification>>({});
  const [verifyErrors, setVerifyErrors] = useState<Record<string, string>>({});
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [reconciled, setReconciled] = useState<ReconcileOutcome[]>([]);
  const integrityRunning = useRef(false);
  const verifying = useRef(false);

  // Re-drive and release forms.
  const [redriveTarget, setRedriveTarget] = useState<RedriveTarget>("internal");
  const [redriveIdText, setRedriveIdText] = useState("");
  const [redriveIdError, setRedriveIdError] = useState<string | null>(null);
  const [redriveOutcome, setRedriveOutcome] = useState<RedriveOutcome | null>(null);
  const [limitText, setLimitText] = useState("");
  const [limitError, setLimitError] = useState<string | null>(null);
  const [releaseOutcome, setReleaseOutcome] = useState<ReleaseOutcome | null>(null);

  // The confirmed action.
  const [pending, setPending] = useState<LedgerOpAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  async function runIntegrity() {
    if (integrityRunning.current) return;
    integrityRunning.current = true;
    setIntegrityLoading(true);
    setIntegrityError(null);
    try {
      setReport(await getLedgerIntegrity());
      // The report is new: earlier balance checks describe a state that may no longer hold.
      setVerifications({});
      setVerifyErrors({});
    } catch (cause) {
      setFailure(cause);
      setIntegrityError(ledgerOpsErrorMessage(cause));
    } finally {
      integrityRunning.current = false;
      setIntegrityLoading(false);
    }
  }

  async function verifyAccount(accountId: string) {
    if (verifying.current) return;
    verifying.current = true;
    setVerifyingId(accountId);
    setVerifyErrors((current) => {
      const next = { ...current };
      delete next[accountId];
      return next;
    });
    try {
      const verification = await getAccountBalance(accountId);
      setVerifications((current) => ({ ...current, [accountId]: verification }));
    } catch (cause) {
      setFailure(cause);
      setVerifyErrors((current) => ({ ...current, [accountId]: ledgerOpsErrorMessage(cause) }));
    } finally {
      verifying.current = false;
      setVerifyingId(null);
    }
  }

  function open(action: LedgerOpAction) {
    if (busy || pending) return;
    setError(null);
    setPending(action);
  }

  function requestReconcile(account: LedgerDriftedAccount) {
    open({ kind: "reconcile", account });
  }

  function requestRedrive() {
    const parsed = parseRedriveId(redriveIdText);
    if ("error" in parsed) {
      setRedriveIdError(parsed.error);
      return;
    }
    setRedriveIdError(null);
    open({ kind: "redrive", target: redriveTarget, id: parsed.id });
  }

  function requestRelease() {
    const parsed = parseReleaseLimit(limitText);
    if ("error" in parsed) {
      setLimitError(parsed.error);
      return;
    }
    setLimitError(null);
    open({ kind: "release", limit: parsed.limit });
  }

  /** "Chạy tiếp": same limit as the batch that just ran, from its `nextCursor`. */
  function requestContinue() {
    const next = releaseOutcome?.summary.nextCursor;
    if (!releaseOutcome || !next) return;
    open({ kind: "release", limit: releaseOutcome.limit, after: next });
  }

  async function confirm() {
    if (!pending || sending.current || busy) return;
    const action = pending;
    sending.current = true;
    setBusy(true);
    setError(null);
    let refreshIntegrity = false;
    try {
      if (action.kind === "reconcile") {
        const result = await reconcileAccount(action.account.accountId);
        setReconciled((current) => [{ account: action.account, result }, ...current]);
        refreshIntegrity = true;
      } else if (action.kind === "redrive") {
        const result = await redriveReward(action.target, action.id);
        setRedriveOutcome({ target: action.target, id: action.id, result });
      } else {
        const summary = await releaseMaturedRewards({ limit: action.limit, after: action.after });
        setReleaseOutcome({ limit: action.limit, summary });
      }
      setPending(null);
    } catch (cause) {
      setFailure(cause);
      setError(ledgerOpsErrorMessage(cause));
    } finally {
      sending.current = false;
      setBusy(false);
    }
    // After a successful reconcile the drift list is stale: run the check once more.
    if (refreshIntegrity) void runIntegrity();
  }

  function cancel() {
    if (busy) return;
    setPending(null);
    setError(null);
  }

  return {
    report,
    integrityLoading,
    integrityError,
    runIntegrity,
    verifications,
    verifyErrors,
    verifyingId,
    verifyAccount,
    reconciled,
    redriveTarget,
    setRedriveTarget: (value: RedriveTarget) => {
      setRedriveTarget(value);
      setRedriveOutcome(null);
    },
    redriveIdText,
    setRedriveIdText: (value: string) => {
      setRedriveIdText(value);
      setRedriveIdError(null);
      setRedriveOutcome(null);
    },
    redriveIdError,
    redriveOutcome,
    requestRedrive,
    limitText,
    setLimitText: (value: string) => {
      setLimitText(value);
      setLimitError(null);
    },
    limitError,
    releaseOutcome,
    requestRelease,
    requestContinue,
    requestReconcile,
    pending,
    busy,
    error,
    confirm,
    cancel,
  };
}
