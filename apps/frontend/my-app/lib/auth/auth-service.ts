import { demographicProfileStatusSchema, sanitizedUserSchema } from "@rescom/schemas";
import { apiRequest, resetCsrfToken, type ResponseSchema } from "../api/client.ts";
import { POST_ONBOARDING_DEFAULT_PATH } from "../onboarding.ts";
import { browserSessionStorage, clearAllOnboardingDrafts } from "../onboarding/onboarding-draft.ts";
import { resolvePostLoginPath } from "./post-login-redirect.ts";
import type {
  AuthSessionResponse,
  AuthUser,
  DemoAccount,
  GoogleLinkStartResponse,
  LoginRequest,
  PasswordResetRequest,
  RegisterRequest,
} from "./types.ts";

/**
 * The only auth module UI code talks to. Contracts are VERIFIED against
 * `apps/backend/src/modules/auth/presentation/*.controller.ts`, except
 * `completeMockGoogleSignIn` (MOCK-ONLY) and `requestPasswordReset`
 * (ASSUMED API CONTRACT).
 */

/** `data` of login/register: `{ user }`, validated with the shared user schema. */
const authSessionSchema: ResponseSchema<AuthSessionResponse> = {
  safeParse(value) {
    const user = sanitizedUserSchema.safeParse(
      typeof value === "object" && value !== null ? (value as { user?: unknown }).user : undefined,
    );
    return user.success ? { success: true, data: { user: user.data } } : { success: false };
  },
};

/** POST /auth/login — 200 `{ user }` + httpOnly session cookies. */
export async function login(input: LoginRequest, signal?: AbortSignal): Promise<AuthUser> {
  const { user } = await apiRequest("/auth/login", {
    method: "POST",
    csrf: false,
    body: input,
    schema: authSessionSchema,
    signal,
  });
  return user;
}

/** POST /auth/register — 201 `{ user }` + httpOnly session cookies. */
export async function register(input: RegisterRequest, signal?: AbortSignal): Promise<AuthUser> {
  const { user } = await apiRequest("/auth/register", {
    method: "POST",
    csrf: false,
    body: input,
    schema: authSessionSchema,
    signal,
  });
  return user;
}

/**
 * ASSUMED API CONTRACT: POST /auth/password/forgot `{ email }` → 202, same
 * generic answer whether or not the account exists (no enumeration). Guest
 * route, so no CSRF. The backend has no password-reset module yet.
 */
export async function requestPasswordReset(
  input: PasswordResetRequest,
  signal?: AbortSignal,
): Promise<void> {
  await apiRequest("/auth/password/forgot", { method: "POST", csrf: false, body: input, signal });
}

const googleLinkStartSchema: ResponseSchema<GoogleLinkStartResponse> = {
  safeParse(value) {
    const url =
      typeof value === "object" && value !== null
        ? (value as { authorizationUrl?: unknown }).authorizationUrl
        : undefined;
    return typeof url === "string" && url.length > 0
      ? { success: true, data: { authorizationUrl: url } }
      : { success: false };
  },
};

/**
 * VERIFIED: POST /auth/google/link/start `{ currentPassword }` — needs a signed-in
 * session + CSRF (sent by `apiRequest`). With `Accept: application/json` the
 * backend answers 200 `{ authorizationUrl }` instead of a 303, and the caller
 * navigates there. Errors: 401 AUTH_INVALID_CREDENTIALS (wrong password),
 * 409 AUTH_GOOGLE_IDENTITY_CONFLICT (already linked).
 */
export async function startGoogleLink(currentPassword: string, signal?: AbortSignal): Promise<string> {
  const { authorizationUrl } = await apiRequest("/auth/google/link/start", {
    method: "POST",
    body: { currentPassword },
    schema: googleLinkStartSchema,
    signal,
  });
  return authorizationUrl;
}

/** The signed-in user if there is a session for `email`, else null (401, other user, failure). */
async function currentSessionFor(email: string, signal?: AbortSignal): Promise<AuthUser | null> {
  try {
    const me = await getCurrentUser(signal);
    return me.email.toLowerCase() === email.toLowerCase() ? me : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

/**
 * 15d. Google sign-in stopped with AUTH_GOOGLE_LINK_REQUIRED, so the visitor has
 * no session: sign in with the Rescom password first (VERIFIED POST /auth/login),
 * then start the link with the same password as recent-auth proof. Returns the
 * Google authorization URL; Google then lands on `/auth/callback`.
 * A retry after `link/start` failed reuses the session the first attempt
 * created (`GET /auth/me` for the same email) instead of logging in again —
 * a second login would replace that session (one session per user).
 */
export async function signInAndStartGoogleLink(
  input: LoginRequest,
  signal?: AbortSignal,
): Promise<string> {
  if (!(await currentSessionFor(input.email, signal))) await login(input, signal);
  return startGoogleLink(input.password, signal);
}

/** GET /auth/me — `data` is the user itself (not wrapped in `{ user }`). */
export function getCurrentUser(signal?: AbortSignal): Promise<AuthUser> {
  return apiRequest("/auth/me", { schema: sanitizedUserSchema, signal });
}

/**
 * MOCK-ONLY: POST /auth/google/mock-complete. Exists because MSW cannot
 * intercept the full-page redirect to Google. Only reachable in mock mode
 * (see `getGoogleSignInUrl`); the real backend has no such route.
 */
export async function completeMockGoogleSignIn(signal?: AbortSignal): Promise<AuthUser> {
  const { user } = await apiRequest("/auth/google/mock-complete", {
    method: "POST",
    csrf: false,
    body: {},
    schema: authSessionSchema,
    signal,
  });
  return user;
}

/**
 * Onboarding gate after sign-in, from GET /demographics (VERIFIED). If the profile cannot be read we fall back to
 * the default page — the onboarding guard on earning pages checks again.
 */
export async function resolvePostLoginDestination(
  returnTo: string | null,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const status = await apiRequest("/demographics", {
      schema: demographicProfileStatusSchema,
      signal,
    });
    return resolvePostLoginPath({ isProfileComplete: status.isComplete, returnTo });
  } catch {
    return POST_ONBOARDING_DEFAULT_PATH;
  }
}

function isDemoAccount(value: unknown): value is DemoAccount {
  if (typeof value !== "object" || value === null) return false;
  const account = value as Record<string, unknown>;
  return ["email", "password", "name", "description"].every(
    (key) => typeof account[key] === "string",
  );
}

const demoAccountsSchema: ResponseSchema<DemoAccount[]> = {
  safeParse(value) {
    return Array.isArray(value) && value.every(isDemoAccount)
      ? { success: true, data: value }
      : { success: false };
  },
};

/** MOCK-ONLY: GET /mock/demo-accounts. Call only when `isApiMockingEnabled`. */
export function listMockDemoAccounts(signal?: AbortSignal): Promise<DemoAccount[]> {
  return apiRequest("/mock/demo-accounts", { schema: demoAccountsSchema, signal });
}

/** VERIFIED: POST /auth/logout → 204. Needs CSRF (sent by `apiRequest`). */
export async function logout(): Promise<void> {
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } finally {
    resetCsrfToken();
    clearAllOnboardingDrafts(browserSessionStorage());
  }
}
