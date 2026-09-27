# Plan: Route guard — login → onboarding → /marketplace

## Hiện trạng (đã kiểm tra trong code)
- `SessionGate` (components/layout/app/SessionGate.tsx) bọc mọi route `(signed-in)`: chưa đăng nhập → `/login?returnTo=…`. ✅ đã có.
- Sau login/register/Google callback: `resolvePostLoginDestination` gọi `GET /demographics` → chưa xong hồ sơ → `/onboarding?required=1`, xong rồi → `returnTo` hoặc `/marketplace`. ✅ đã có.
- **Thiếu 1:** user mới (hồ sơ chưa xong) gõ thẳng `/wallet`, `/account`, `/leaderboard`… vẫn vào được; chỉ marketplace/start survey mới đẩy về onboarding (qua lỗi `DEMOGRAPHIC_PROFILE_REQUIRED`).
- **Thiếu 2:** user đã xong onboarding vẫn mở được `/onboarding`.
- **Thiếu 3:** user đã đăng nhập mở `/login`, `/register` vẫn thấy form.
- `SessionProvider` không biết trạng thái onboarding (chỉ có user/profile/balance/unread).

## Thay đổi
1. **`lib/session/SessionProvider.tsx`** — thêm `onboarding: "loading" | "complete" | "incomplete" | "unknown"`.
   User không phải ADMIN: gọi `GET /demographics` (`getDemographics`) ngay sau `/auth/me`. Lỗi không phải 401 → `"unknown"` (fail-open, backend vẫn chặn bằng `DEMOGRAPHIC_PROFILE_REQUIRED`). `refresh()` giữ giá trị cũ cho tới khi có giá trị mới (không nháy spinner).
2. **Pure rule `onboardingGateRedirect()`** trong `lib/session/session-status.ts` (unit test được):
   - ADMIN → không áp dụng.
   - `incomplete` và path ≠ `/onboarding` → `buildOnboardingRedirect(currentPath)` (giữ `returnTo`).
   - `loading` → chờ (spinner); `unknown`/`complete` → cho qua.
3. **`SessionGate`** áp dụng rule trên cho `(app)` + `(focus)`.
4. **Chặn `/onboarding` khi đã xong** — đặt trong `use-onboarding-flow.ts` (nơi có draft), quyết định **một lần khi vào trang**:
   - `complete` và KHÔNG phải (`step=done` + draft của tab này có `submitted`) → `router.replace("/marketplace")`.
   - Lý do chỉ quyết định lúc vào: ngay sau khi bấm "Hoàn tất", `refresh()` làm trạng thái thành `complete` — nếu kiểm tra liên tục thì màn "done" và bước kích hoạt `/marketplace?activation=1` (FR-7) sẽ bị cắt; nút "Sửa" trên màn done cũng bị đá ra.
   - Admin mở `/onboarding` → `/admin`.
5. **(Tùy chọn Q2)** `/login`, `/register`: đã đăng nhập → `resolvePostLoginDestination(returnTo)` (onboarding hoặc marketplace).
6. **Tests** (`tests/*.test.mjs`, node --test): rule `onboardingGateRedirect`, rule chặn onboarding (entry decision), login redirect. Chạy `npm test`, `npm run typecheck`, `npm run lint`; kiểm tra trên browser ở mock mode với tài khoản demo mới + đã onboard.

## Không đổi
- `/` (landing) — theo yêu cầu. Lưu ý: `app/page.tsx` vẫn tự redirect bằng `lib/mock` cũ (`/dashboard`→`/marketplace`); không động tới.
- Trang public: auth (`/login`, `/register`, `/forgot-password`, `/auth/*`), trang lỗi (`/offline`, `/server-error`, `/forbidden`, `/maintenance`, `/rate-limited`, `/surveys/[id]/full`), form chia sẻ công khai `/f/[id]` (có captcha, cho người ẩn danh trả lời).
- Guard vẫn là client-side (như hiện tại). Không dùng `proxy.ts` (Next 16) vì mock mode (MSW) không có cookie thật ở server.
- Sửa hồ sơ sau này đi qua `/account/profile` (đã có).
