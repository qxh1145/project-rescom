import { HttpResponse, http } from "msw";
import { googleLinkStartSchema, loginSchema, registerSchema } from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import { mockRepository } from "@/lib/mock/repository.ts";
import {
  DEMO_ACCOUNTS,
  expectedPassword,
  nameFromEmail,
  rememberPassword,
  toSanitizedUser,
} from "../data/auth";
import { fail, ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";

/**
 * Mirrors `apps/backend/src/modules/auth/presentation/auth.controller.ts`.
 * Session state is delegated to the legacy demo store so pages that still read
 * `mockRepository` see the same signed-in user.
 */

const invalidCredentials = () => fail(401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password.");

/** ASSUMED API CONTRACT body of POST /auth/password/forgot (same email rule as login). */
const passwordForgotSchema = loginSchema.pick({ email: true });

/** MOCK-ONLY: where link/start "sends" the browser instead of Google. The session already exists. */
const MOCK_GOOGLE_LINK_CALLBACK = "/auth/callback?provider=mock-google-link";

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export const authHandlers = [
  http.post(apiUrl("/auth/login"), async ({ request }) => {
    const forced = await applyScenario("login");
    if (forced) return forced;

    const parsed = loginSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return fail(400, "AUTH_INVALID_LOGIN_INPUT", parsed.error.errors[0]?.message ?? "Validation failed", {
        details: parsed.error.format(),
      });
    }

    const { email, password } = parsed.data;
    if (password !== expectedPassword(email)) return invalidCredentials();

    try {
      const { user } = await mockRepository.login({ email });
      return ok({ user: toSanitizedUser(user) });
    } catch {
      return invalidCredentials();
    }
  }),

  http.post(apiUrl("/auth/register"), async ({ request }) => {
    const forced = await applyScenario("register");
    if (forced) return forced;

    const parsed = registerSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return fail(
        400,
        "AUTH_INVALID_REGISTRATION_INPUT",
        parsed.error.errors[0]?.message ?? "Validation failed",
        { details: parsed.error.format() },
      );
    }

    const { email, password } = parsed.data;
    try {
      const { user } = await mockRepository.register({
        email,
        password,
        name: nameFromEmail(email),
      });
      rememberPassword(email, password);
      return ok({ user: toSanitizedUser(user) }, 201);
    } catch (error) {
      // The legacy store only reports failures as Vietnamese messages.
      if (error instanceof Error && error.message.includes("đã được sử dụng")) {
        return fail(409, "AUTH_EMAIL_ALREADY_REGISTERED", "An account with this email already exists.");
      }
      return fail(500, "INTERNAL_SERVER_ERROR", "Internal server error");
    }
  }),

  http.get(apiUrl("/auth/me"), async () => {
    const forced = await applyScenario("me");
    if (forced) return forced;

    const user = await mockRepository.getCurrentUser();
    return user ? ok(toSanitizedUser(user)) : unauthorized();
  }),

  /** MOCK-ONLY: stands in for the Google redirect round-trip. Signs in the new-student persona. */
  http.post(apiUrl("/auth/google/mock-complete"), async () => {
    const forced = await applyScenario("google");
    if (forced) return forced;

    const user = await mockRepository.switchDemoUser("user-new-001");
    return ok({ user: toSanitizedUser(user) });
  }),

  /**
   * ASSUMED API CONTRACT: POST /auth/password/forgot `{ email }` → 202 with the
   * same empty answer whether or not the account exists. Guest route (no CSRF).
   */
  http.post(apiUrl("/auth/password/forgot"), async ({ request }) => {
    const forced = await applyScenario("password-forgot");
    if (forced) return forced;

    const parsed = passwordForgotSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return fail(400, "AUTH_INVALID_INPUT", parsed.error.errors[0]?.message ?? "Validation failed", {
        details: parsed.error.format(),
      });
    }
    return ok(null, 202);
  }),

  /**
   * VERIFIED contract: POST /auth/google/link/start `{ currentPassword }` with a
   * session + CSRF → 200 `{ authorizationUrl }` (JSON clients). The URL itself is
   * MOCK-ONLY: it skips Google and lands on the callback, which confirms the session.
   */
  http.post(apiUrl("/auth/google/link/start"), async ({ request }) => {
    const forced = await applyScenario("google-link-start");
    if (forced) return forced;

    const session = await mockRepository.getCurrentSession();
    if (!session?.user) return unauthorized();
    if (!request.headers.get("X-CSRF-Token")) {
      return fail(403, "AUTH_INVALID_CSRF_TOKEN", "Invalid or missing CSRF token.");
    }

    const parsed = googleLinkStartSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return fail(400, "AUTH_INVALID_INPUT", parsed.error.errors[0]?.message ?? "Validation failed", {
        details: parsed.error.format(),
      });
    }
    if (parsed.data.currentPassword !== expectedPassword(session.user.email)) return invalidCredentials();

    return ok({ authorizationUrl: MOCK_GOOGLE_LINK_CALLBACK });
  }),

  /** MOCK-ONLY: demo credentials shown on the login page in mock mode. */
  // VERIFIED: GET /auth/csrf → { csrfToken } for a signed-in session.
  http.get(apiUrl("/auth/csrf"), async () => {
    const session = await mockRepository.getCurrentSession();
    return session?.user ? ok({ csrfToken: "mock-csrf-token" }) : unauthorized();
  }),

  /**
   * VERIFIED: POST /auth/refresh (refresh cookie + `X-CSRF-Token`) → 200
   * `{ csrfToken }`; rotates the cookies and the CSRF token. 401
   * `AUTH_INVALID_REFRESH_TOKEN` without a session, 403 `AUTH_INVALID_CSRF_TOKEN`
   * without the header. The mock token never changes (see GET /auth/csrf).
   */
  http.post(apiUrl("/auth/refresh"), async ({ request }) => {
    const forced = await applyScenario("refresh");
    if (forced) return forced;

    if (!request.headers.get("X-CSRF-Token")) {
      return fail(403, "AUTH_INVALID_CSRF_TOKEN", "Invalid or missing CSRF token.");
    }
    const session = await mockRepository.getCurrentSession();
    if (!session?.user) {
      return fail(401, "AUTH_INVALID_REFRESH_TOKEN", "Refresh token is invalid or has been replayed.");
    }
    return ok({ csrfToken: "mock-csrf-token" });
  }),

  // VERIFIED: POST /auth/logout → 204, clears the session cookies.
  http.post(apiUrl("/auth/logout"), async () => {
    await mockRepository.logout();
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(apiUrl("/mock/demo-accounts"), () => ok(DEMO_ACCOUNTS)),
];
