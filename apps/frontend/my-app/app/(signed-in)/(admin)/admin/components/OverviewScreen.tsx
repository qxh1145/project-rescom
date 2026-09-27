"use client";

import { AdminPage } from "@/components/layout/admin/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { overviewLoadErrorMessage } from "@/lib/admin/overview-messages";
import { useAdminOverview } from "../hooks/use-admin-overview";
import { FlaggedAccountsCard } from "./FlaggedAccountsCard";
import { StatCards } from "./StatCards";
import { TodoCard } from "./TodoCard";

/**
 * Figma 11 "Tổng quan" (62:4070): 4 stat link-cards, "Việc cần làm" (645px)
 * + "Tài khoản cần xem · FraudLog" (430px). ASSUMED below lg: cards 2 per
 * row, sections stacked.
 */
export function OverviewScreen() {
  const { today, view, error, loading, reload } = useAdminOverview();

  return (
    <AdminPage title="Tổng quan" meta={today}>
      {error && !view ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Alert tone="danger" className="flex-1">
            {overviewLoadErrorMessage(error)}
          </Alert>
          <Button variant="secondary" size="base" radius="field" onClick={reload}>
            Thử lại
          </Button>
        </div>
      ) : !view ? (
        <p className="flex items-center gap-3 py-16 text-body text-ink-muted" role="status" aria-busy={loading}>
          <Spinner className="size-5 text-primary" />
          Đang tải số liệu tổng quan…
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <StatCards cards={view.cards} />
          <div className="grid gap-5 lg:grid-cols-[minmax(0,645fr)_minmax(0,430fr)] lg:items-start">
            <TodoCard rows={view.todo} />
            <FlaggedAccountsCard accounts={view.flagged} />
          </div>
        </div>
      )}
    </AdminPage>
  );
}
