import { HttpResponse, delay } from "msw";
import { fail, unauthorized } from "./envelope";

/**
 * Runtime scenario switch — no rebuild needed. Open any page with
 * `?msw=<scenario>`; the choice is kept in localStorage until `?msw=default`.
 */
export const MOCK_SCENARIOS = [
  "default",
  "slow",
  "invalid-credentials",
  "locked",
  "validation",
  "email-taken",
  "rate-limited",
  "server-error",
  "network-error",
  "profile-incomplete",
  "unauthenticated",
  // Mock Google sign-in → AUTH_GOOGLE_LINK_REQUIRED (opens /auth/link-google, 15d):
  "google-link-required",
  // Data endpoints (every endpoint except login/register/me/refresh/google):
  "api-error",
  "api-offline",
  // Google Forms flow: no time barrier, the code can be confirmed at once (demos).
  "gform-no-barrier",
  // Khám phá: empty feed (3b) / starter points expiring in 3 days (15f).
  "marketplace-empty",
  "starter-expiring",
  // In-Rescom survey: submit → network failure (4b) / reward held for quality review (17c).
  "submit-offline",
  "integrity-hold",
  // MOCK-ONLY: every Google Forms reward in its 48h review is released on the next wallet/status read.
  "release-pending",
] as const;

export type MockScenario = (typeof MOCK_SCENARIOS)[number];

/** Auth endpoints have dedicated scenarios; every other handler passes its domain name. */
export type MockEndpoint =
  | "login"
  | "register"
  | "me"
  | "refresh"
  | "google"
  | "password-forgot"
  | "demographics"
  | (string & {});

/** Untouched by the data scenarios `api-error` / `api-offline` (a refresh failure would end the session). */
const AUTH_ENDPOINTS = new Set(["login", "register", "me", "refresh", "google"]);

/** Guest routes: callable without a session, so `unauthenticated` leaves them alone. */
const GUEST_ENDPOINTS = new Set(["login", "register", "google", "password-forgot", "public-surveys"]);

/** localStorage key of the remembered scenario (cleared by `?msw-reset=1`). */
export const SCENARIO_STORAGE_KEY = "rescom:msw-scenario";
const STORAGE_KEY = SCENARIO_STORAGE_KEY;
const SLOW_LATENCY_MS = 2500;

function isScenario(value: string | null): value is MockScenario {
  return value !== null && (MOCK_SCENARIOS as readonly string[]).includes(value);
}

export function getActiveScenario(): MockScenario {
  const fromUrl = new URLSearchParams(window.location.search).get("msw");
  try {
    if (isScenario(fromUrl)) {
      if (fromUrl === "default") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isScenario(stored) ? stored : "default";
  } catch {
    return isScenario(fromUrl) ? fromUrl : "default";
  }
}

function realisticLatency(): number {
  return 400 + Math.round(Math.random() * 300);
}

const isCredentialEndpoint = (endpoint: MockEndpoint) =>
  endpoint === "login" || endpoint === "register";

/**
 * Applies latency, then returns a forced error response for the active
 * scenario, or `undefined` to let the handler run its normal logic.
 */
export async function applyScenario(endpoint: MockEndpoint): Promise<Response | undefined> {
  const scenario = getActiveScenario();
  await delay(scenario === "slow" ? SLOW_LATENCY_MS : realisticLatency());

  switch (scenario) {
    case "invalid-credentials":
      return endpoint === "login"
        ? fail(401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password.")
        : undefined;
    case "locked":
      return endpoint === "login"
        ? fail(403, "AUTH_USER_LOCKED", "User account is locked.")
        : undefined;
    case "validation":
      return isCredentialEndpoint(endpoint)
        ? fail(
            400,
            endpoint === "login" ? "AUTH_INVALID_LOGIN_INPUT" : "AUTH_INVALID_REGISTRATION_INPUT",
            "Invalid email address format",
            { details: { _errors: [], email: { _errors: ["Invalid email address format"] } } },
          )
        : undefined;
    case "email-taken":
      return endpoint === "register"
        ? fail(409, "AUTH_EMAIL_ALREADY_REGISTERED", "An account with this email already exists.")
        : undefined;
    case "rate-limited":
      return isCredentialEndpoint(endpoint)
        ? fail(429, "RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", {
            headers: { "Retry-After": "45" },
          })
        : undefined;
    case "server-error":
      return isCredentialEndpoint(endpoint)
        ? fail(500, "INTERNAL_SERVER_ERROR", "Internal server error")
        : undefined;
    case "network-error":
      return isCredentialEndpoint(endpoint) ? HttpResponse.error() : undefined;
    case "unauthenticated":
      return GUEST_ENDPOINTS.has(endpoint) ? undefined : unauthorized();
    case "google-link-required":
      // MOCK-ONLY: the real backend redirects to `/auth/error?error=…` and never sends the email.
      return endpoint === "google"
        ? fail(409, "AUTH_GOOGLE_LINK_REQUIRED", "An account with this email already exists.", {
            details: { email: "minh.le@fpt.edu.vn" },
          })
        : undefined;
    case "api-error":
      return AUTH_ENDPOINTS.has(endpoint) ? undefined : fail(500, "INTERNAL_SERVER_ERROR", "Internal server error");
    case "api-offline":
      return AUTH_ENDPOINTS.has(endpoint) ? undefined : HttpResponse.error();
    default:
      return undefined;
  }
}
