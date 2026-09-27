"use client";

import Link from "next/link";
import { AdminPage } from "@/components/layout/admin/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { fieldClassName } from "@/components/ui/TextField";
import { fraudLogLoadErrorMessage } from "@/lib/admin/fraud-log-messages";
import { FRAUD_TYPE_OPTIONS, FRAUD_WINDOW_OPTIONS, repeatBannerOf } from "@/lib/admin/fraud-log-view";
import { useFraudLog } from "../hooks/use-fraud-log";
import { FraudLogTable } from "./FraudLogTable";

const LABEL = "text-caption font-semibold text-ink-muted";

/**
 * `/admin/fraud-log` — Figma 11e "FraudLog (chỉ đọc)" (62:2195, desktop only).
 * Read only: no edit/delete. The only decision path is the user's profile
 * ("Xem hồ sơ & quyết định" → `/admin/users?id=…`, lock via the users service).
 */
export function FraudLogScreen({ urlUserId }: { urlUserId: string | null }) {
  const state = useFraudLog(urlUserId);
  const items = state.data?.items ?? [];
  const repeatAccounts = state.data?.accounts.filter((account) => account.repeated) ?? [];

  const readOnlyChip = (
    <span className="inline-flex h-6.5 items-center gap-1 rounded-full bg-surface-subtle px-2.5 text-[12px] font-bold text-ink-strong">
      <Icon name="lock" size={14} />
      Chỉ đọc · không sửa, không xoá
    </span>
  );

  return (
    <AdminPage title="FraudLog" meta={readOnlyChip}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex w-full flex-col gap-1.5 sm:w-55">
          <label htmlFor="fraud-log-user" className={LABEL}>
            Người dùng
          </label>
          <input
            id="fraud-log-user"
            type="search"
            value={state.userText}
            onChange={(event) => state.setUserText(event.target.value)}
            placeholder="#mã, tên hoặc email"
            className={fieldClassName(false, "h-11")}
          />
        </div>
        <div className="flex w-full flex-col gap-1.5 sm:w-50">
          <label htmlFor="fraud-log-window" className={LABEL}>
            Thời gian
          </label>
          <Select
            id="fraud-log-window"
            height={44}
            options={FRAUD_WINDOW_OPTIONS}
            value={state.windowValue}
            onChange={(event) => state.setWindowValue(event.target.value)}
          />
        </div>
        <div className="flex w-full flex-col gap-1.5 sm:w-60">
          <label htmlFor="fraud-log-type" className={LABEL}>
            Loại vi phạm
          </label>
          <Select
            id="fraud-log-type"
            height={44}
            options={FRAUD_TYPE_OPTIONS}
            value={state.type}
            onChange={(event) => state.setType(event.target.value)}
          />
        </div>
        <p className="ml-auto pb-3 text-body-sm text-ink-muted" aria-live="polite">
          {state.data ? `${state.data.total} mục` : null}
        </p>
      </div>

      {state.error ? (
        <Alert tone="danger" className="mt-4 items-center">
          <span className="flex flex-wrap items-center gap-3">
            {fraudLogLoadErrorMessage(state.error)}
            <Button variant="secondary" size="sm" onClick={state.reload}>
              Thử lại
            </Button>
          </span>
        </Alert>
      ) : null}

      <section aria-label="Nhật ký vi phạm" className="mt-4 rounded-[22px] border border-line bg-surface px-6 pt-3 pb-3.5">
        <FraudLogTable items={items} loading={state.loading} />
        {state.data && state.data.total > items.length ? (
          <p className="border-t border-line-subtle pt-3 text-caption text-ink-muted">
            Hiển thị {items.length} mục mới nhất — thu hẹp bộ lọc để xem các mục cũ hơn.
          </p>
        ) : null}
      </section>

      {repeatAccounts.map((account) => {
        const banner = repeatBannerOf(account, state.data?.windowDays ?? null);
        return (
          <div
            key={account.userId}
            className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-danger-soft px-4.5 py-3.5"
          >
            <Icon name="alert-circle" size={20} className="text-danger" />
            <p className="min-w-0 flex-1 text-body-sm">
              <span className="font-bold text-danger-strong">{banner.lead}</span>
              <span className="text-ink">{banner.rest}</span>
            </p>
            <Link
              href={`/admin/users?id=${encodeURIComponent(account.userId)}`}
              className="inline-flex h-11.5 items-center rounded-field border border-danger bg-surface px-4 text-label font-bold text-danger hover:bg-danger-soft/60"
            >
              Xem hồ sơ &amp; quyết định
            </Link>
          </div>
        );
      })}
      {state.data && repeatAccounts.length === 0 ? (
        // ASSUMED: policy note when no account is flagged (copy from the overview, 62:4179).
        <p className="mt-4 text-caption-relaxed text-ink-muted">
          Hệ thống chỉ gắn cờ tài khoản vi phạm lặp lại. Khoá tài khoản luôn do Admin quyết định.
        </p>
      ) : null}
    </AdminPage>
  );
}
