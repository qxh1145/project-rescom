import test from "node:test";
import assert from "node:assert/strict";

const { resolvePostLoginPath } = await import("../lib/auth/post-login-redirect.ts");
const { validateCredentials } = await import("../lib/auth/validate-credentials.ts");
const { AUTH_MESSAGES } = await import("../lib/auth/auth-error-messages.ts");

test("resolvePostLoginPath", () => {
  assert.equal(resolvePostLoginPath({ isProfileComplete: true, returnTo: null }), "/marketplace");
  assert.equal(
    resolvePostLoginPath({ isProfileComplete: true, returnTo: "/wallet?tab=history" }),
    "/wallet?tab=history",
  );
  assert.equal(
    resolvePostLoginPath({ isProfileComplete: true, returnTo: "//evil.example" }),
    "/marketplace",
  );
  for (const authPage of [
    "/login",
    "/login?mode=register",
    "/register",
    "/forgot-password/sent",
    "/auth/callback",
    "/auth/link-google",
    "/auth",
  ]) {
    assert.equal(
      resolvePostLoginPath({ isProfileComplete: true, returnTo: authPage }),
      "/marketplace",
      authPage,
    );
  }
  // Dot segments that collapse into a protocol-relative `//host` after resolution.
  for (const openRedirect of [
    "/.//evil.com",
    "/a/..//evil.com",
    "/%2e%2e//evil.com",
    "/%2E%2E//evil.com/path?x=1",
    "/./%2e/..//evil.com",
    "/\\evil.com",
  ]) {
    assert.equal(
      resolvePostLoginPath({ isProfileComplete: true, returnTo: openRedirect }),
      "/marketplace",
      openRedirect,
    );
    assert.equal(
      resolvePostLoginPath({ isProfileComplete: false, returnTo: openRedirect }),
      "/onboarding?required=1",
      openRedirect,
    );
  }
  // Item 18: never land on a system error page after signing in.
  for (const errorPage of [
    "/server-error",
    "/offline?from=/wallet",
    "/rate-limited",
    "/forbidden",
    "/maintenance",
  ]) {
    assert.equal(
      resolvePostLoginPath({ isProfileComplete: true, returnTo: errorPage }),
      "/marketplace",
      errorPage,
    );
  }
  assert.equal(
    resolvePostLoginPath({ isProfileComplete: true, returnTo: "/offline-guide" }),
    "/offline-guide",
  );
  assert.equal(
    resolvePostLoginPath({ isProfileComplete: true, returnTo: "/a/b/../c?x=1#top" }),
    "/a/c?x=1#top",
  );
  assert.equal(
    resolvePostLoginPath({ isProfileComplete: true, returnTo: "/login-help" }),
    "/login-help",
  );
  assert.equal(
    resolvePostLoginPath({ isProfileComplete: false, returnTo: "/login" }),
    "/onboarding?required=1",
  );
  assert.equal(
    resolvePostLoginPath({ isProfileComplete: false, returnTo: null }),
    "/onboarding?required=1",
  );
  assert.equal(
    resolvePostLoginPath({ isProfileComplete: false, returnTo: "/forms/new" }),
    "/onboarding?required=1&returnTo=%2Fforms%2Fnew",
  );
});

test("validateCredentials mirrors the shared backend schemas", () => {
  assert.deepEqual(
    validateCredentials({ email: "  Minh.Le@FPT.edu.vn ", password: "Password123!" }, "login"),
    { ok: true, data: { email: "minh.le@fpt.edu.vn", password: "Password123!" } },
  );
  assert.deepEqual(validateCredentials({ email: "", password: "" }, "login"), {
    ok: false,
    fields: { email: AUTH_MESSAGES.emailRequired, password: AUTH_MESSAGES.passwordRequired },
  });
  assert.deepEqual(validateCredentials({ email: "khong-hop-le", password: "x" }, "login"), {
    ok: false,
    fields: { email: AUTH_MESSAGES.emailInvalid },
  });
  assert.deepEqual(
    validateCredentials({ email: "an.nguyen22@fpt.edu.vn", password: "Ngan123" }, "register"),
    { ok: false, fields: { password: AUTH_MESSAGES.passwordTooShort } },
  );
  assert.equal(
    validateCredentials({ email: "an.nguyen22@fpt.edu.vn", password: "MatKhauManh2026" }, "register").ok,
    true,
  );
});

test("resolveAdminPostLoginPath sends admins to the console", async () => {
  const { resolveAdminPostLoginPath, ADMIN_HOME_PATH } = await import("../lib/auth/post-login-redirect.ts");
  assert.equal(ADMIN_HOME_PATH, "/admin");
  assert.equal(resolveAdminPostLoginPath(null), "/admin");
  assert.equal(resolveAdminPostLoginPath("/marketplace"), "/admin");
  assert.equal(resolveAdminPostLoginPath("/admin/top-ups?status=pending"), "/admin/top-ups?status=pending");
  assert.equal(resolveAdminPostLoginPath("/administrator"), "/admin");
  assert.equal(resolveAdminPostLoginPath("/.//evil.example"), "/admin");
});
