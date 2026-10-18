"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AdminPage } from "@/components/layout/admin/AdminPage";
import { Icon } from "@/components/ui/Icon";
import { getAdminTopUpTabCounts } from "@/lib/admin/payos-top-up-admin-service";
import { headerMeta, manualTabReadOnly } from "@/lib/admin/payos-switch";
import { useWalletTopUpMode } from "@/lib/wallet/use-wallet-top-up-mode";
import { TopUpTabs, type ConsoleTab } from "./TopUpTabs";
import { PayosTopUpsPanel } from "./PayosTopUpsPanel";
import { ActionRequiredPanel } from "./ActionRequiredPanel";
import { ManualTopUpsPanel } from "./ManualTopUpsPanel";
import { RefundRequestsPanel } from "./RefundRequestsPanel";
import { PayosSwitchCard } from "./PayosSwitchCard";

export function TopUpConsoleScreen() {
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const tab: ConsoleTab = params.get("tab") === "manual" ? "manual" : params.get("tab") === "action" ? "action" : params.get("tab") === "refunds" ? "refunds" : "payos";
  const { mode: payosMode, reload: reloadPayosMode } = useWalletTopUpMode();
  const [counts, setCounts] = useState<{ payos: number; manual: number; actionRequired: number; refunds: number } | null>(null);
  const [countsFailed, setCountsFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    getAdminTopUpTabCounts(controller.signal)
      .then(value => { setCounts(value); setCountsFailed(false); })
      .catch(() => { if (!controller.signal.aborted) setCountsFailed(true); });
    return () => controller.abort();
  }, [revision, tab]);

  function select(next: ConsoleTab) {
    const query = new URLSearchParams(params.toString());
    query.set("tab", next);
    if (next === "payos") query.delete("id");
    if (next !== tab) query.delete("request");
    router.replace(`${pathname}?${query}`);
  }

  const metaContent = payosMode === "loading" ? null : (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{headerMeta(payosMode)}</span>
      {payosMode === "payos" ? (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-subtle px-2 py-0.5 text-caption font-semibold text-ink"
          aria-label="PayOS: Bật"
        >
          <Icon name="lock" size={12} className="text-ink-muted" />
          PayOS: Bật
        </span>
      ) : null}
    </span>
  );

  return (
    <AdminPage title="Nạp điểm" meta={metaContent}>
      <div className="space-y-5">
        {(payosMode === "manual" || payosMode === "error") && (
          <PayosSwitchCard
            mode={payosMode}
            manualTotal={counts?.manual ?? null}
            onChanged={refresh}
            onRetryMode={reloadPayosMode}
          />
        )}
        <TopUpTabs active={tab} counts={counts} failed={countsFailed} onSelect={select} />
        {tab === "payos" ? (
          <PayosTopUpsPanel onChanged={refresh} />
        ) : tab === "action" ? (
          <section role="tabpanel" id="top-ups-action-panel" aria-labelledby="top-ups-action-tab">
            <ActionRequiredPanel onChanged={refresh} />
          </section>
        ) : tab === "refunds" ? (
          <section role="tabpanel" id="top-ups-refunds-panel" aria-labelledby="top-ups-refunds-tab">
            <RefundRequestsPanel onChanged={refresh} />
          </section>
        ) : (
          <section role="tabpanel" id="top-ups-manual-panel" aria-labelledby="top-ups-manual-tab">
            {/* Keyed on readOnly so the initial status filter follows the resolved mode. */}
            {payosMode === "loading" ? null : (
              <ManualTopUpsPanel
                key={String(manualTabReadOnly(payosMode))}
                readOnly={manualTabReadOnly(payosMode)}
                onChanged={refresh}
              />
            )}
          </section>
        )}
      </div>
    </AdminPage>
  );
}

