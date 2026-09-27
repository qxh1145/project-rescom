"use client";

import { useState } from "react";
import { mockRepository } from "@/lib/mock/repository.ts";

interface ResetDemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResetComplete?: () => void;
}

export function ResetDemoModal({
  isOpen,
  onClose,
  onResetComplete,
}: ResetDemoModalProps) {
  const [isResetting, setIsResetting] = useState(false);
  const [activePersona, setActivePersona] = useState<string>("user-new-001");
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationMessage, setSimulationMessage] = useState<string | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isBusy = isResetting || isSimulating;

  // The modal stays mounted while hidden: never show a previous run's result.
  function handleClose() {
    setSimulationMessage(null);
    setSimulationError(null);
    onClose();
  }

  /**
   * Demo-only control (decision E7-DN1): the 48-hour External review rule is
   * kept, but the mock cannot wait 48 hours — the repository ages the signed-in
   * user's External completions under review and applies the release/unlock.
   */
  async function handleSimulateReviewElapsed() {
    setIsSimulating(true);
    setSimulationMessage(null);
    setSimulationError(null);
    try {
      const result = await mockRepository.simulateExternalReviewElapsed();
      if (result.maturedCount > 0) {
        onResetComplete?.();
        onClose();
        // Reload so the wallet, activation card and notifications all refresh.
        window.location.reload();
        return;
      }
      setSimulationMessage(result.message);
    } catch (err) {
      setSimulationError(
        err instanceof Error ? err.message : "Không thể mô phỏng. Vui lòng thử lại.",
      );
    } finally {
      setIsSimulating(false);
    }
  }

  async function handleReset() {
    setIsResetting(true);
    try {
      await mockRepository.resetDemo();
      if (activePersona !== "user-new-001") {
        await mockRepository.switchDemoUser(activePersona);
      }
      onResetComplete?.();
      onClose();
      // Reload page to reflect fresh state everywhere
      window.location.reload();
    } catch (err) {
      console.error("Reset failed:", err);
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl text-left">
        <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 flex items-center justify-center text-2xl mb-4">
          🔄
        </div>

        <h3
          id="reset-modal-title"
          className="text-lg font-bold text-slate-900 dark:text-white mb-1.5"
        >
          Đặt lại Dữ liệu Thử nghiệm
        </h3>

        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
          Hành động này sẽ xóa toàn bộ tiến trình làm bài, khảo sát đã nộp và số dư tích lũy hiện tại trong bộ nhớ trình duyệt, đưa hệ thống về trạng thái ban đầu để kiểm thử hành trình mới.
        </p>

        <section
          aria-labelledby="simulate-review-title"
          className="mb-5 p-3.5 rounded-2xl border border-dashed border-purple-300 dark:border-purple-800 bg-purple-50/60 dark:bg-purple-950/20"
        >
          <p className="text-[10px] font-bold uppercase tracking-wide text-purple-700 dark:text-purple-300">
            Chỉ dành cho bản demo
          </p>
          <h4
            id="simulate-review-title"
            className="text-xs font-bold text-slate-900 dark:text-white mt-1"
          >
            Mô phỏng hết 48 giờ đối soát
          </h4>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
            Khảo sát Google Forms cần 48 giờ đối soát trước khi điểm Chờ duyệt chuyển sang Khả dụng và được tính để kích hoạt tài khoản. Bản demo không thể chờ 48 giờ, nên nút này coi như thời gian đối soát của tài khoản đang đăng nhập đã kết thúc (không đặt lại dữ liệu).
          </p>
          <button
            type="button"
            onClick={handleSimulateReviewElapsed}
            disabled={isBusy}
            className="mt-2.5 px-3 py-1.5 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-60 rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600"
          >
            {isSimulating ? "Đang mô phỏng..." : "⏩ Mô phỏng hết 48 giờ đối soát"}
          </button>
          {simulationMessage && (
            <p role="status" className="mt-2 text-[11px] text-purple-900 dark:text-purple-200">
              {simulationMessage}
            </p>
          )}
          {simulationError && (
            <p role="alert" className="mt-2 text-[11px] text-rose-700 dark:text-rose-300">
              {simulationError}
            </p>
          )}
        </section>

        <div className="space-y-2 mb-6">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Chọn tài khoản mẫu khởi tạo sau khi đặt lại:
          </label>
          <div className="grid grid-cols-1 gap-2">
            {[
              {
                id: "user-new-001",
                name: "Nguyễn Văn Mới (Tân thủ)",
                desc: "100 điểm khóa, chưa điền nhân khẩu học",
              },
              {
                id: "user-onboarding-003",
                name: "Trần Mai Linh (Onboarding dở dang)",
                desc: "100 điểm khóa, đã lưu nháp bước 2",
              },
              {
                id: "user-active-002",
                name: "Lê Nhật Minh (Đã kích hoạt)",
                desc: "115 điểm khả dụng, 20 điểm chờ, chuỗi 3 ngày",
              },
            ].map((p) => (
              <label
                key={p.id}
                className={`flex items-start gap-3 p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                  activePersona === p.id
                    ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 text-slate-900 dark:text-white"
                    : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-600 dark:text-slate-400"
                }`}
              >
                <input
                  type="radio"
                  name="persona"
                  checked={activePersona === p.id}
                  onChange={() => setActivePersona(p.id)}
                  className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                />
                <div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                    {p.name}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {p.desc}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={handleClose}
            disabled={isBusy}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl transition-colors"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={isBusy}
            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
          >
            {isResetting ? "Đang xử lý..." : "Xác nhận Đặt lại"}
          </button>
        </div>
      </div>
    </div>
  );
}
