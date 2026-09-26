"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { mockRepository } from "@/lib/mock/repository.ts";
import { PublicShell } from "@/components/layout/PublicShell";

export default function Home() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    let active = true;
    async function checkSession() {
      try {
        const session = await mockRepository.getCurrentSession();
        if (!active) return;
        if (session?.user) {
          if (!session.user.isOnboarded) {
            router.push("/onboarding");
          } else {
            router.push("/dashboard");
          }
          return;
        }
      } catch (err) {
        console.error("Session check error:", err);
      } finally {
        if (active) setCheckingAuth(false);
      }
    }
    void checkSession();
    return () => {
      active = false;
    };
  }, [router]);

  async function handleQuickLogin(userId: string) {
    try {
      const user = await mockRepository.switchDemoUser(userId);
      if (!user.isOnboarded) {
        router.push("/onboarding");
      } else {
        router.push("/dashboard");
      }
    } catch (err) {
      console.error("Quick login failed:", err);
    }
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-10 h-10 border-3 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mb-4" />
        <p className="text-xs font-semibold text-slate-500">Đang khởi tạo ứng dụng RESCOM...</p>
      </div>
    );
  }

  return (
    <PublicShell>
      {/* Hero Section */}
      <section className="relative overflow-hidden py-16 sm:py-24 border-b border-slate-200/60 dark:border-slate-800/60">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80 text-xs font-bold mb-6 animate-in fade-in slide-in-from-top-3">
            <span>✨</span>
            <span>Cộng đồng Khảo sát Học thuật Sinh viên</span>
            <span>•</span>
            <span className="text-emerald-600 font-extrabold">+100 Điểm Tân Thủ</span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-slate-900 dark:text-white max-w-4xl mx-auto leading-tight mb-6">
            Nhận hỗ trợ thu thập dữ liệu —{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 via-teal-500 to-sky-600">
              Đóng góp lại cho cộng đồng
            </span>
          </h1>

          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-2xl mx-auto mb-8 leading-relaxed">
            Giải pháp thay thế việc chia sẻ khảo sát trên mạng xã hội. Trả lời khảo sát của sinh viên khác để tích lũy điểm và dùng điểm đó phân phối khảo sát nghiên cứu của bạn đến đúng đối tượng mục tiêu.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 mb-12">
            <Link
              href="/login?tab=register"
              className="px-6 py-3 text-sm font-bold rounded-2xl text-white bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-600/25 transition-all transform hover:-translate-y-0.5"
            >
              Bắt đầu ngay — Nhận 100 Điểm Khóa
            </Link>

            <Link
              href="/login"
              className="px-6 py-3 text-sm font-bold rounded-2xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Đăng nhập tài khoản
            </Link>
          </div>

          {/* Quick Demo Credentials Strip */}
          <div className="max-w-3xl mx-auto p-4 sm:p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl shadow-slate-900/5 text-left">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <span>⚡</span> Kiểm thử nhanh hành trình (One-Click Demo Personas):
              </span>
              <span className="text-[10px] text-slate-400">Không cần gõ mật khẩu</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => handleQuickLogin("user-new-001")}
                className="p-3 rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 text-left hover:border-emerald-500 transition-all cursor-pointer group"
              >
                <div className="text-xs font-bold text-emerald-800 dark:text-emerald-300 group-hover:underline">
                  Tài khoản Tân thủ
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  100 điểm khóa • Đi thẳng đến Onboarding wizard
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin("user-onboarding-003")}
                className="p-3 rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/20 text-left hover:border-amber-500 transition-all cursor-pointer group"
              >
                <div className="text-xs font-bold text-amber-800 dark:text-amber-300 group-hover:underline">
                  Onboarding dở dang
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Khôi phục bước 2 từ nháp lưu trữ
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin("user-active-002")}
                className="p-3 rounded-2xl border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20 text-left hover:border-blue-500 transition-all cursor-pointer group"
              >
                <div className="text-xs font-bold text-blue-800 dark:text-blue-300 group-hover:underline">
                  Tài khoản Đã kích hoạt
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  115 điểm khả dụng • Chuỗi 3 ngày • Vào Dashboard
                </div>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Pillars */}
      <section id="features" className="py-16 max-w-6xl mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mb-2">
            Hệ sinh thái Nghiên cứu Sinh viên Toàn diện
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Minh bạch, bảo đảm liêm chính học thuật và vận hành trên nền tảng kinh tế điểm thưởng
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-2xl mb-4">
              🎯
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">
              Chợ Khảo sát Cá nhân hóa
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Tự động phân phối khảo sát đến đúng đối tượng theo chuyên ngành, độ tuổi, khu vực thông qua thuật toán so khớp nhân khẩu học.
            </p>
          </div>

          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="w-12 h-12 rounded-2xl bg-teal-100 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 flex items-center justify-center text-2xl mb-4">
              📝
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">
              Khảo sát Nội bộ & Google Forms
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Linh hoạt tích hợp biểu mẫu sẵn có từ Google Forms hoặc trải nghiệm trực tiếp bộ Form Builder nội bộ với chi phí điểm thưởng tối ưu.
            </p>
          </div>

          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="w-12 h-12 rounded-2xl bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center text-2xl mb-4">
              🪙
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">
              Sổ cái Điểm Kép Minh bạch
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Mọi biến động điểm số đều được lưu trữ bất biến. 100 điểm tân thủ được mở khóa công bằng ngay sau khi hoàn thành hồ sơ và 1 khảo sát.
            </p>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
