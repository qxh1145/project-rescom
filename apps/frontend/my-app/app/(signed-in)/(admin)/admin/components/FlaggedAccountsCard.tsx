import Link from "next/link";
import { OVERVIEW_FLAGGED_EMPTY } from "@/lib/admin/overview-messages";
import type { FlaggedAccountView } from "@/lib/admin/overview-view";

/** Figma 62:4177 "Tài khoản cần xem · FraudLog": 61px account rows, "Lặp lại" tag. */
export function FlaggedAccountsCard({ accounts }: { accounts: FlaggedAccountView[] }) {
  return (
    <section aria-labelledby="admin-flagged-title" className="rounded-[22px] border border-line bg-surface px-6 pt-5 pb-6">
      <h2 id="admin-flagged-title" className="text-[17px] font-extrabold text-ink">
        Tài khoản cần xem · FraudLog
      </h2>
      <p className="mt-3 text-caption-relaxed text-ink-muted">
        Hệ thống chỉ gắn cờ tài khoản vi phạm lặp lại. Khoá tài khoản luôn do Admin quyết định.
      </p>
      {accounts.length === 0 ? (
        <p className="mt-4 text-body-sm text-ink-muted">{OVERVIEW_FLAGGED_EMPTY}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {accounts.map((account) => (
            <li key={account.userId}>
              <Link
                href={account.href}
                className={`flex min-h-15.25 items-center gap-3 rounded-[14px] px-3.5 py-2.5 transition-colors ${
                  account.repeated ? "bg-danger-soft hover:bg-danger-soft/70" : "bg-surface-muted hover:bg-surface-subtle"
                }`}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-body font-bold text-ink">{account.title}</span>
                  <span className="truncate text-caption text-ink-muted">{account.subtitle}</span>
                </span>
                {account.repeated ? (
                  <span className="inline-flex h-6.5 shrink-0 items-center rounded-full bg-surface px-2.5 text-[12px] font-bold text-danger-strong">
                    Lặp lại
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href="/admin/fraud-log" className="mt-3 inline-block text-label font-bold text-primary hover:underline">
        Xem toàn bộ FraudLog →
      </Link>
    </section>
  );
}
