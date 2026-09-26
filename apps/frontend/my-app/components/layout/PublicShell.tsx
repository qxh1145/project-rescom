"use client";

import React, { useState } from "react";
import Link from "next/link";
import { BrandLogo } from "./BrandLogo";
import { ResetDemoModal } from "./ResetDemoModal";

interface PublicShellProps {
  children: React.ReactNode;
}

export function PublicShell({ children }: PublicShellProps) {
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Navigation Header */}
      <header className="sticky top-0 z-40 w-full border-b border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <BrandLogo size="md" href="/" />

          <nav className="hidden sm:flex items-center gap-6 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <Link
              href="/#features"
              className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
            >
              Giới thiệu
            </Link>
            <Link
              href="/marketplace"
              className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
            >
              Chợ khảo sát
            </Link>
            <Link
              href="/forms"
              className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
            >
              Tạo biểu mẫu
            </Link>
          </nav>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setIsResetModalOpen(true)}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1"
              title="Đặt lại trạng thái demo"
            >
              <span>🔄</span>
              <span className="hidden md:inline">Đặt lại Demo</span>
            </button>

            <Link
              href="/login"
              className="px-3.5 py-1.5 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Đăng nhập
            </Link>

            <Link
              href="/login?tab=register"
              className="px-3.5 py-1.5 text-xs font-semibold rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm shadow-emerald-600/20 transition-all"
            >
              Đăng ký nhận 100 điểm
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      {/* Public Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800 dark:text-slate-200">
              RESCOM
            </span>
            <span>—</span>
            <span>Nền tảng Trao đổi Khảo sát Học thuật Sinh viên FPT</span>
          </div>

          <div className="flex items-center gap-4 text-[11px]">
            <span>Đề tài Nghiên cứu Sinh viên FPTU ĐN</span>
            <span>•</span>
            <button
              type="button"
              onClick={() => setIsResetModalOpen(true)}
              className="text-emerald-600 hover:underline cursor-pointer"
            >
              Thiết lập lại Demo
            </button>
          </div>
        </div>
      </footer>

      <ResetDemoModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
      />
    </div>
  );
}
