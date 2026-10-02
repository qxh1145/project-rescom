"use client";

import { useState } from "react";
import { DemoDataTag } from "@/components/ui/DemoDataTag";
import { AdminPage } from "@/components/layout/admin/AdminPage";
import { Mascot } from "@/components/brand/Mascot";
import { Alert } from "@/components/ui/Alert";
import { disputeListErrorMessage } from "@/lib/admin/disputes-messages";
import { EMPTY_TAB_COPY, queueChipLabel, resolvedMessage } from "@/lib/admin/disputes-view";
import { useDisputeQueue } from "../hooks/use-dispute-queue";
import { CaseDetail } from "./CaseDetail";
import { MissingCodeReportList } from "./MissingCodeReportList";
import { DISPUTE_PANEL_ID, DisputeTabs, disputeTabId } from "./DisputeTabs";
import { RespondentCard } from "./RespondentCard";

/**
 * `/admin/disputes` — Figma 11c "Khiếu nại & báo lỗi" (62:1609, desktop 1440).
 * Main case card (627px) + respondent column (448px), 20px apart.
 * ASSUMED below lg: the two columns stack.
 */
export function DisputesScreen() {
  const queue = useDisputeQueue();
  const [notice, setNotice] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const { selected } = queue;

  return (
    <AdminPage
      title="Khiếu nại & báo lỗi"
      actions={<DemoDataTag />}
      meta={
        <DisputeTabs
          active={queue.tab}
          counts={queue.counts}
          onSelect={(kind) => {
            queue.selectTab(kind);
            setNotice(null);
          }}
        />
      }
    >
      <div id={DISPUTE_PANEL_ID} role="tabpanel" aria-labelledby={disputeTabId(queue.tab)} className="flex flex-col gap-4">
        {notice ? (
          <Alert tone={notice.tone} onDismiss={() => setNotice(null)}>
            {notice.text}
          </Alert>
        ) : null}

        {queue.loading ? (
          <div aria-busy="true" className="grid gap-5 lg:grid-cols-[minmax(0,627fr)_minmax(0,448fr)]">
            <span className="sr-only">Đang tải danh sách khiếu nại…</span>
            <div className="h-176 animate-pulse rounded-[22px] bg-surface-subtle" />
            <div className="h-75.5 animate-pulse rounded-[22px] bg-surface-subtle" />
          </div>
        ) : queue.error ? (
          <Alert tone="danger">
            {disputeListErrorMessage(queue.error)}{" "}
            <button type="button" onClick={queue.reload} className="font-bold underline">
              Thử lại
            </button>
          </Alert>
        ) : queue.tab === "MISSING_CODE" && queue.reports ? (
          <MissingCodeReportList reports={queue.reports} total={queue.counts?.MISSING_CODE ?? queue.reports.length} />
        ) : !selected ? (
          // ASSUMED empty state (not drawn).
          <section className="flex flex-col items-center gap-4 rounded-[22px] border border-line bg-surface px-6 py-12 text-center">
            <Mascot name="cheer" height={120} />
            <p className="text-body font-semibold text-ink">{EMPTY_TAB_COPY[queue.tab]}</p>
          </section>
        ) : (
          <>
            {queue.cases.length > 1 ? (
              // ASSUMED: Figma draws one case per tab; several open cases get a chooser.
              <nav aria-label="Các mục đang chờ" className="flex flex-wrap gap-2">
                {queue.cases.map((item) => {
                  const current = item.id === selected.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={current}
                      onClick={() => queue.selectCase(item.id)}
                      className={[
                        "h-9 rounded-full border px-3.5 text-[13px] font-semibold transition-colors",
                        current
                          ? "border-primary bg-tone-green-bg text-primary-strong"
                          : "border-line bg-surface text-ink hover:bg-surface-subtle",
                      ].join(" ")}
                    >
                      {queueChipLabel(item, queue.now)}
                    </button>
                  );
                })}
              </nav>
            ) : null}
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,627fr)_minmax(0,448fr)]">
              <CaseDetail
                key={selected.id}
                item={selected}
                now={queue.now}
                onResolved={(resolved, outcome) => {
                  queue.removeCase(resolved);
                  setNotice({ tone: "info", text: resolvedMessage(selected, outcome) });
                }}
                onStale={(message) => {
                  queue.reloadAll();
                  setNotice({ tone: "danger", text: message });
                }}
              />
              <RespondentCard item={selected} />
            </div>
          </>
        )}
      </div>
    </AdminPage>
  );
}
