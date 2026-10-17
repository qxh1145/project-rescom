"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AdminPage } from "@/components/layout/admin/AdminPage";
import { getAdminTopUpTabCounts } from "@/lib/admin/payos-top-up-admin-service";
import { TopUpTabs, type ConsoleTab } from "./TopUpTabs";
import { PayosTopUpsPanel } from "./PayosTopUpsPanel";
import { ActionRequiredPanel } from "./ActionRequiredPanel";
import { ManualTopUpsPanel } from "./ManualTopUpsPanel";
import { RefundRequestsPanel } from "./RefundRequestsPanel";
export function TopUpConsoleScreen() {
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const tab: ConsoleTab = params.get("tab") === "manual" ? "manual" : params.get("tab") === "action" ? "action" : params.get("tab") === "refunds" ? "refunds" : "payos";
  const [counts, setCounts] = useState<{ payos: number; manual: number; actionRequired: number; refunds: number } | null>(null);
  const [countsFailed, setCountsFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => { const controller = new AbortController(); getAdminTopUpTabCounts(controller.signal).then(value => { setCounts(value); setCountsFailed(false); }).catch(() => { if (!controller.signal.aborted) setCountsFailed(true); }); return () => controller.abort(); }, [revision, tab]);
  function select(next: ConsoleTab) { const query = new URLSearchParams(params.toString()); query.set("tab", next); if (next === "payos") query.delete("id"); if (next !== tab) query.delete("request"); router.replace(`${pathname}?${query}`); }
  return <AdminPage title="Nạp điểm" meta="PayOS tự cộng Điểm · hoàn tiền thủ công, hạn 3 ngày làm việc">
    <div className="space-y-5"><TopUpTabs active={tab} counts={counts} failed={countsFailed} onSelect={select} />
      {tab === "payos" ? <PayosTopUpsPanel onChanged={refresh} /> : tab === "action" ? <section role="tabpanel" id="top-ups-action-panel" aria-labelledby="top-ups-action-tab"><ActionRequiredPanel onChanged={refresh} /></section> : tab === "refunds" ? <section role="tabpanel" id="top-ups-refunds-panel" aria-labelledby="top-ups-refunds-tab"><RefundRequestsPanel onChanged={refresh} /></section> : <section role="tabpanel" id="top-ups-manual-panel" aria-labelledby="top-ups-manual-tab"><ManualTopUpsPanel onChanged={refresh} /></section>}
    </div>
  </AdminPage>;
}
