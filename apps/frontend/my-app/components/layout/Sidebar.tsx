"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MockUser } from "@/lib/mock/types.ts";
import type { StarterPointsStatusDto } from "@rescom/schemas";
import { sidebarActivationView } from "@/lib/activation.ts";
import { BrandLogo } from "./BrandLogo";

interface SidebarProps {
  user: MockUser | null;
  /** Story 7.2 activation status (code review P3); `null` hides the block. */
  activationStatus: StarterPointsStatusDto | null;
  onOpenResetModal: () => void;
}

const SIDEBAR_BADGE_TONE: Record<"success" | "pending" | "expired", string> = {
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  expired: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export function Sidebar({ user, activationStatus, onOpenResetModal }: SidebarProps) {
  const pathname = usePathname();

  const navItems = [
    {
      label: "Bảng điều khiển",
      href: "/dashboard",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
    },
    {
      label: "Chợ khảo sát",
      href: "/marketplace",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      ),
    },
    {
      label: "Ví điểm thưởng",
      href: "/wallet",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      ),
    },
    {
      label: "Nạp điểm",
      href: "/wallet/top-up",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" />
        </svg>
      ),
    },
    {
      label: "Hồ sơ nhân khẩu học",
      href: "/onboarding",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
    {
      label: "Tạo khảo sát",
      href: "/forms",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
  ];

  // Code review P3: driven by the activation state only (never re-derived here).
  const activation = sidebarActivationView(activationStatus);

  return (
    <aside className="w-64 shrink-0 hidden md:flex flex-col justify-between border-r border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 h-screen sticky top-0 px-4 py-5 overflow-y-auto">
      <div>
        {/* Brand */}
        <div className="px-2 mb-6">
          <BrandLogo size="md" href="/dashboard" />
        </div>

        {/* Navigation links */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                  isActive
                    ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 shadow-xs border border-emerald-200 dark:border-emerald-800/80"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/80 dark:hover:bg-slate-800/50"
                }`}
              >
                <span className={isActive ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-slate-500"}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Activation status (Story 7.2) — data-driven, hidden when there is nothing to activate */}
        {activation && (
          <div
            className="mt-6 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-xs"
            aria-label="Trạng thái kích hoạt tài khoản"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-bold text-slate-800 dark:text-slate-200 text-[11px] uppercase tracking-wider">
                {activation.title}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${SIDEBAR_BADGE_TONE[activation.tone]}`}>
                {activation.badge}
              </span>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              {activation.description}
            </p>
            {activation.steps && (
              <ul className="mt-2 space-y-1.5 text-[11px]">
                {activation.steps.map((step) => (
                  <li key={step.label} className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={
                        step.status === "done"
                          ? "text-emerald-600 font-bold"
                          : step.status === "pending"
                            ? "text-amber-600 font-bold"
                            : "text-slate-400"
                      }
                    >
                      {step.status === "done" ? "✓" : step.status === "pending" ? "⏳" : "○"}
                    </span>
                    <span
                      className={
                        step.status === "todo"
                          ? "text-slate-500"
                          : "text-slate-700 dark:text-slate-300"
                      }
                    >
                      <span className="sr-only">
                        {step.status === "done"
                          ? "Đã xong: "
                          : step.status === "pending"
                            ? "Đang chờ: "
                            : "Chưa xong: "}
                      </span>
                      {step.label}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Footer / User card */}
      <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
              {user?.name ? user.name.charAt(0).toUpperCase() : "U"}
            </div>
            <div className="overflow-hidden">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                {user?.name || "Người dùng"}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                {user?.email || "student@fpt.edu.vn"}
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenResetModal}
          className="w-full py-1.5 px-2.5 text-[11px] font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 rounded-xl transition-colors flex items-center justify-center gap-1.5"
        >
          <span>🔄</span>
          <span>Đặt lại Dữ liệu Demo</span>
        </button>
      </div>
    </aside>
  );
}
