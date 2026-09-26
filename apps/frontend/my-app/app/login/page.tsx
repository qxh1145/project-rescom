"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { mockRepository } from "@/lib/mock/repository.ts";
import { PublicShell } from "@/components/layout/PublicShell";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [userSelectedTab, setUserSelectedTab] = useState<"login" | "register" | null>(null);
  const activeTab = userSelectedTab ?? (tabParam === "register" ? "register" : "login");

  const [loading, setLoading] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Login form state
  const [loginEmail, setLoginEmail] = useState("student@fpt.edu.vn");
  const [loginPassword, setLoginPassword] = useState("Password123!");

  // Register form state
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function handleSelectDemoPersona(email: string, tab: "login" = "login") {
    setUserSelectedTab(tab);
    setLoginEmail(email);
    setLoginPassword("Password123!");
    setGeneralError(null);
  }

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGeneralError(null);
    setLoading(true);

    try {
      const result = await mockRepository.login({
        email: loginEmail,
        password: loginPassword,
      });
      router.push(result.redirectUrl);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Đăng nhập không thành công. Vui lòng thử lại.";
      setGeneralError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleRegisterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    const errors: Record<string, string> = {};
    if (!regName.trim() || regName.trim().length < 2) {
      errors.name = "Vui lòng nhập họ và tên (tối thiểu 2 ký tự).";
    }
    if (!regEmail.trim() || !regEmail.includes("@")) {
      errors.email = "Vui lòng nhập email hợp lệ.";
    }
    if (!regPassword || regPassword.length < 6) {
      errors.password = "Mật khẩu phải có ít nhất 6 ký tự.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setLoading(true);
    try {
      const result = await mockRepository.register({
        email: regEmail,
        password: regPassword,
        name: regName,
      });
      router.push(result.redirectUrl);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Đăng ký không thành công. Vui lòng thử lại.";
      if (msg.includes("email")) {
        setFieldErrors({ email: msg });
      } else {
        setGeneralError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setLoading(true);
    setGeneralError(null);
    try {
      // Simulate Google OAuth login with student google email
      const user = await mockRepository.switchDemoUser("user-new-001");
      if (!user.isOnboarded) {
        router.push("/onboarding");
      } else {
        router.push("/dashboard");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Đăng nhập Google thất bại.";
      setGeneralError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="py-12 px-4 sm:px-6 flex justify-center">
      <div className="w-full max-w-md">
        {/* Documented Demo Credentials Box */}
        <div className="mb-6 p-4 rounded-3xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/60 text-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
              <span>🔑</span> Tài khoản mẫu thử nghiệm (Demo)
            </span>
            <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">
              Bấm để tự điền
            </span>
          </div>

          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => handleSelectDemoPersona("student@fpt.edu.vn")}
              className="w-full text-left p-2 rounded-xl bg-white dark:bg-slate-900 border border-emerald-100 dark:border-emerald-900/40 hover:border-emerald-400 transition-colors flex items-center justify-between"
            >
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  Tân thủ:
                </span>{" "}
                <span className="text-slate-600 dark:text-slate-400">
                  student@fpt.edu.vn
                </span>
              </div>
              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                100 điểm khóa
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectDemoPersona("linh.onboarding@fpt.edu.vn")}
              className="w-full text-left p-2 rounded-xl bg-white dark:bg-slate-900 border border-emerald-100 dark:border-emerald-900/40 hover:border-emerald-400 transition-colors flex items-center justify-between"
            >
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  Lưu nháp:
                </span>{" "}
                <span className="text-slate-600 dark:text-slate-400">
                  linh.onboarding@fpt.edu.vn
                </span>
              </div>
              <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                Bước 2 Onboarding
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectDemoPersona("minh.le@fpt.edu.vn")}
              className="w-full text-left p-2 rounded-xl bg-white dark:bg-slate-900 border border-emerald-100 dark:border-emerald-900/40 hover:border-emerald-400 transition-colors flex items-center justify-between"
            >
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  Đã kích hoạt:
                </span>{" "}
                <span className="text-slate-600 dark:text-slate-400">
                  minh.le@fpt.edu.vn
                </span>
              </div>
              <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                115 điểm khả dụng
              </span>
            </button>
          </div>
        </div>

        {/* Auth Card */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm">
          {/* Tab buttons */}
          <div className="flex border-b border-slate-200 dark:border-slate-800 mb-6" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "login"}
              onClick={() => {
                setUserSelectedTab("login");
                setGeneralError(null);
              }}
              className={`flex-1 pb-3 text-center text-xs font-bold transition-all relative ${
                activeTab === "login"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              }`}
            >
              Đăng nhập
              {activeTab === "login" && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600 dark:bg-emerald-400 rounded-full" />
              )}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "register"}
              onClick={() => {
                setUserSelectedTab("register");
                setGeneralError(null);
              }}
              className={`flex-1 pb-3 text-center text-xs font-bold transition-all relative ${
                activeTab === "register"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              }`}
            >
              Đăng ký mới (+100 điểm)
              {activeTab === "register" && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600 dark:bg-emerald-400 rounded-full" />
              )}
            </button>
          </div>

          {/* Non-destructive alert */}
          {generalError && (
            <div
              role="alert"
              className="mb-5 p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between"
            >
              <span>{generalError}</span>
              <button
                type="button"
                onClick={() => setGeneralError(null)}
                className="text-rose-500 hover:text-rose-700 ml-2 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* Login Form */}
          {activeTab === "login" ? (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="login-email"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Email đăng nhập
                </label>
                <input
                  id="login-email"
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="name@fpt.edu.vn"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Mật khẩu
                  </label>
                  <span className="text-[11px] text-slate-400">
                    Mặc định: Password123!
                  </span>
                </div>
                <input
                  id="login-password"
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Đang đăng nhập...</span>
                  </>
                ) : (
                  <span>Đăng nhập</span>
                )}
              </button>
            </form>
          ) : (
            /* Register Form */
            <form onSubmit={handleRegisterSubmit} className="space-y-4">
              <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800 text-[11px] text-emerald-800 dark:text-emerald-300 leading-relaxed">
                🎁 <strong>Ưu đãi thành viên mới:</strong> Đăng ký thành công nhận ngay <strong>100 Điểm Khóa</strong>. Hoàn thành hồ sơ nhân khẩu học và 1 khảo sát đầu tiên để mở khóa toàn bộ!
              </div>

              <div>
                <label
                  htmlFor="reg-name"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Họ và tên
                </label>
                <input
                  id="reg-name"
                  type="text"
                  required
                  value={regName}
                  onChange={(e) => {
                    setRegName(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, name: "" }));
                  }}
                  placeholder="Ví dụ: Nguyễn Văn An"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
                {fieldErrors.name && (
                  <p className="text-[11px] text-rose-500 mt-1">{fieldErrors.name}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="reg-email"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Địa chỉ Email
                </label>
                <input
                  id="reg-email"
                  type="email"
                  required
                  value={regEmail}
                  onChange={(e) => {
                    setRegEmail(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, email: "" }));
                  }}
                  placeholder="your.email@fpt.edu.vn"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
                {fieldErrors.email && (
                  <p className="text-[11px] text-rose-500 mt-1">{fieldErrors.email}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="reg-password"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Mật khẩu
                </label>
                <input
                  id="reg-password"
                  type="password"
                  required
                  value={regPassword}
                  onChange={(e) => {
                    setRegPassword(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, password: "" }));
                  }}
                  placeholder="Tối thiểu 6 ký tự"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
                {fieldErrors.password && (
                  <p className="text-[11px] text-rose-500 mt-1">
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Đang tạo tài khoản...</span>
                  </>
                ) : (
                  <span>Tạo tài khoản & Nhận 100 điểm khóa</span>
                )}
              </button>
            </form>
          )}

          {/* Social OAuth divider */}
          <div className="my-5 flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
            <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
              Hoặc
            </span>
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
          </div>

          {/* Google Button */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
              />
            </svg>
            <span>Tiếp tục với Google (@fpt.edu.vn)</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <PublicShell>
      <Suspense
        fallback={
          <div className="py-24 text-center text-xs text-slate-400">
            Đang tải trang đăng nhập...
          </div>
        }
      >
        <LoginContent />
      </Suspense>
    </PublicShell>
  );
}
