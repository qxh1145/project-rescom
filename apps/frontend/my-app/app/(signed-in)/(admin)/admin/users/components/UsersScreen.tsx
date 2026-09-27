"use client";

import { AdminPage } from "@/components/layout/admin/AdminPage";
import { Icon } from "@/components/ui/Icon";
import { fieldClassName } from "@/components/ui/TextField";
import { userDetailErrorMessage } from "@/lib/admin/users-messages";
import { useAdminUsers, type StatusFilter } from "../hooks/use-admin-users";
import { UserDetailPanel } from "./UserDetailPanel";
import { UsersTable } from "./UsersTable";

/** VERIFIED `status` filter values only (the backend knows ACTIVE / LOCKED). */
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "", label: "Mọi trạng thái" },
  { value: "ACTIVE", label: "Đang hoạt động" },
  { value: "LOCKED", label: "Đã khoá" },
];

/**
 * `/admin/users` — Figma 11d "Người dùng & khoá tài khoản" (63:2212, desktop only).
 * Header filters sit right of the title (360px search, 145px status select);
 * body = 645px table + 430px profile panel, 20px apart. Below lg they stack (ASSUMED).
 */
export function UsersScreen() {
  const state = useAdminUsers();
  const { selected } = state;

  // Phrasing-only markup: AdminPage renders `meta` inside a <p>.
  const filters = (
    <span className="ml-3.5 flex flex-wrap items-center gap-4">
      <span className="relative inline-flex w-full sm:w-90">
        <label htmlFor="admin-users-search" className="sr-only">
          Tìm người dùng
        </label>
        <Icon name="search" size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-muted" />
        <input
          id="admin-users-search"
          type="search"
          value={state.search}
          onChange={(event) => state.setSearch(event.target.value)}
          placeholder="Tìm theo tên, email, mã #"
          className={fieldClassName(false, "h-11 pl-11 focus:pl-[43px]")}
        />
      </span>
      <span className="relative inline-flex w-36.25">
        <label htmlFor="admin-users-status" className="sr-only">
          Trạng thái
        </label>
        <select
          id="admin-users-status"
          value={state.status}
          onChange={(event) => state.setStatus(event.target.value as StatusFilter)}
          className={fieldClassName(false, "h-11 appearance-none pr-8 pl-2.5 focus:pl-[9px]")}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={16} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-ink" />
      </span>
    </span>
  );

  return (
    <AdminPage title="Người dùng" meta={filters}>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,645fr)_minmax(0,430fr)]">
        <UsersTable
          data={state.list.data}
          loading={state.list.loading}
          error={state.list.error}
          onRetry={state.list.reload}
          selectedId={state.selectedId}
          onSelect={state.select}
          page={state.page}
          onPage={state.setPage}
        />
        {selected ? (
          <UserDetailPanel
            key={selected.id}
            user={selected}
            detailError={state.detail.error ? userDetailErrorMessage(state.detail.error) : null}
            onRetryDetail={state.detail.reload}
            onUpdated={state.applyUpdate}
          />
        ) : state.detail.error ? (
          <section aria-label="Hồ sơ người dùng" className="rounded-[22px] border border-line bg-surface p-6">
            <p role="alert" className="text-body-sm text-danger">
              {userDetailErrorMessage(state.detail.error)}
            </p>
          </section>
        ) : state.detail.loading || state.list.loading ? (
          <section aria-label="Hồ sơ người dùng" aria-busy className="rounded-[22px] border border-line bg-surface p-6">
            <span className="block h-5 w-1/2 animate-pulse rounded bg-surface-subtle" />
            <span className="mt-3 block h-4 w-2/3 animate-pulse rounded bg-surface-subtle" />
            <span className="mt-4 block h-15 animate-pulse rounded-field bg-surface-subtle" />
          </section>
        ) : null}
      </div>
    </AdminPage>
  );
}
