"use client";

import { useState, type SyntheticEvent } from "react";
import { isApiMockingEnabled } from "@/lib/api/config";
import { listMockDemoAccounts } from "@/lib/auth/auth-service";
import type { DemoAccount, EmailAuthFormValues } from "@/lib/auth/types";

type LoadState =
  | { status: "idle" | "loading" | "error" }
  | { status: "ready"; accounts: DemoAccount[] };

interface DemoAccountsHintProps {
  disabled: boolean;
  onPick: (credentials: EmailAuthFormValues) => void;
}

/**
 * MOCK-ONLY dev affordance (not in Figma): lists the MSW demo personas and
 * fills their credentials. Renders nothing when mocking is disabled.
 */
export function DemoAccountsHint({ disabled, onPick }: DemoAccountsHintProps) {
  const [state, setState] = useState<LoadState>({ status: "idle" });

  if (!isApiMockingEnabled) return null;

  async function load() {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", accounts: await listMockDemoAccounts() });
    } catch {
      setState({ status: "error" });
    }
  }

  function handleToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (event.currentTarget.open && (state.status === "idle" || state.status === "error")) {
      void load();
    }
  }

  return (
    <details onToggle={handleToggle} className="text-caption text-ink-muted">
      <summary className="cursor-pointer select-none">
        Tài khoản demo (chế độ mock)
      </summary>
      <div className="mt-2">
        {state.status === "loading" ? <p>Đang tải…</p> : null}
        {state.status === "error" ? <p>Không tải được danh sách tài khoản demo.</p> : null}
        {state.status === "ready" ? (
          <ul className="flex flex-col gap-1.5">
            {state.accounts.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick({ email: account.email, password: account.password })}
                  className="w-full rounded-field border border-line bg-surface px-3 py-2 text-left hover:border-primary disabled:opacity-60"
                >
                  <span className="block font-semibold text-ink">
                    {account.name} · {account.email}
                  </span>
                  <span className="block">{account.description}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
