"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mockRepository, NOTIFICATIONS_CHANGED_EVENT } from "@/lib/mock/repository.ts";
import type { MockUser } from "@/lib/mock/types.ts";
import type { StarterPointsStatusDto, WalletBalanceDto } from "@rescom/schemas";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { ResetDemoModal } from "./ResetDemoModal";
import { BrandLogo } from "./BrandLogo";
import { NotificationBell } from "./NotificationBell";

interface PortalShellProps {
  children: React.ReactNode;
}

export function PortalShell({ children }: PortalShellProps) {
  const router = useRouter();
  const [user, setUser] = useState<MockUser | null>(null);
  const [wallet, setWallet] = useState<WalletBalanceDto | null>(null);
  const [activationStatus, setActivationStatus] = useState<StarterPointsStatusDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  // Code review P3: the Sidebar's activation block comes from the activation
  // status (non-fatal: on error or AUTH_REQUIRED the block is hidden).
  const loadActivationStatus = useCallback(async (): Promise<StarterPointsStatusDto | null> => {
    try {
      return (await mockRepository.getActivationStatus()).status;
    } catch {
      return null;
    }
  }, []);

  const refreshUserData = useCallback(async () => {
    try {
      const currentUser = await mockRepository.getCurrentUser();
      setUser(currentUser);
      const walletDetails = await mockRepository.getWalletDetails();
      setWallet(walletDetails.balance);
      setActivationStatus(await loadActivationStatus());
    } catch (err) {
      console.error("Failed to refresh portal session:", err);
    }
  }, [loadActivationStatus]);

  useEffect(() => {
    let active = true;
    async function loadInitial() {
      try {
        const currentUser = await mockRepository.getCurrentUser();
        if (!active) return;
        if (!currentUser) {
          const defaultUser = await mockRepository.switchDemoUser("user-new-001");
          if (!active) return;
          setUser(defaultUser);
        } else {
          setUser(currentUser);
        }

        const walletDetails = await mockRepository.getWalletDetails();
        if (!active) return;
        setWallet(walletDetails.balance);
        const status = await loadActivationStatus();
        if (!active) return;
        setActivationStatus(status);
      } catch (err) {
        console.error("Failed to load portal session:", err);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadInitial();

    // Activation/expiry and completions publish notifications; refresh the
    // Sidebar block the same way ActivationCard does.
    const refreshActivation = () => {
      void loadActivationStatus().then((status) => {
        if (active) setActivationStatus(status);
      });
    };
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refreshActivation);

    return () => {
      active = false;
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refreshActivation);
    };
  }, [loadActivationStatus]);

  async function handleLogout() {
    await mockRepository.logout();
    router.push("/login");
  }

  async function handleSwitchPersona(userId: string) {
    setIsLoading(true);
    await mockRepository.switchDemoUser(userId);
    await refreshUserData();
    window.location.reload();
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6">
        <div className="w-10 h-10 border-3 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mb-3"></div>
        <div className="text-xs font-semibold text-slate-500">Đang tải không gian làm việc RESCOM...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <Sidebar
        user={user}
        activationStatus={activationStatus}
        onOpenResetModal={() => setIsResetModalOpen(true)}
      />

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-30 h-16 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between gap-3">
          {/* Left: Mobile brand logo */}
          <div className="flex items-center gap-3">
            <div className="md:hidden">
              <BrandLogo size="sm" showSubtitle={false} href="/dashboard" />
            </div>

            {/* Quick Demo Selector */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              <span className="text-[11px] font-semibold text-slate-500 px-2">Demo:</span>
              <button
                type="button"
                onClick={() => handleSwitchPersona("user-new-001")}
                className={`px-2 py-1 rounded-lg font-medium transition-all ${
                  user?.id === "user-new-001"
                    ? "bg-white dark:bg-slate-700 text-emerald-700 dark:text-emerald-300 font-bold shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                Tân thủ
              </button>
              <button
                type="button"
                onClick={() => handleSwitchPersona("user-onboarding-003")}
                className={`px-2 py-1 rounded-lg font-medium transition-all ${
                  user?.id === "user-onboarding-003"
                    ? "bg-white dark:bg-slate-700 text-emerald-700 dark:text-emerald-300 font-bold shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                Nháp hồ sơ
              </button>
              <button
                type="button"
                onClick={() => handleSwitchPersona("user-active-002")}
                className={`px-2 py-1 rounded-lg font-medium transition-all ${
                  user?.id === "user-active-002"
                    ? "bg-white dark:bg-slate-700 text-emerald-700 dark:text-emerald-300 font-bold shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                Đã kích hoạt
              </button>
            </div>
          </div>

          {/* Right: Badges & Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Streak Counter */}
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-900/60 text-xs font-bold"
              title="Chuỗi ngày tham gia khảo sát liên tiếp"
            >
              <span aria-hidden="true">🔥</span>
              <span>
                {user?.streak ?? 0}
                <span className="hidden sm:inline"> ngày</span>
              </span>
            </div>

            {/* Wallet Balance Pill */}
            <Link
              href="/wallet"
              className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80 text-xs font-bold hover:bg-emerald-100 transition-colors"
              title="Xem chi tiết ví điểm"
            >
              <span>🪙</span>
              <span>{wallet?.available ?? 0}</span>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-normal">
                {wallet && wallet.pending > 0 ? `(+${wallet.pending} chờ)` : "pts"}
              </span>
            </Link>

            {/* In-app notifications (Story 9.6) */}
            <NotificationBell />

            {/* Reset demo trigger */}
            <button
              type="button"
              onClick={() => setIsResetModalOpen(true)}
              className="p-1.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Đặt lại dữ liệu demo"
            >
              🔄
            </button>

            {/* Logout button */}
            <button
              type="button"
              onClick={handleLogout}
              className="p-1.5 text-xs text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Đăng xuất"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </header>

        {/* Content Viewport */}
        <main className="flex-1 pb-20 md:pb-8">{children}</main>
      </div>

      {/* Mobile Navigation Bar */}
      <MobileNav />

      {/* Reset Modal */}
      <ResetDemoModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        onResetComplete={refreshUserData}
      />
    </div>
  );
}
