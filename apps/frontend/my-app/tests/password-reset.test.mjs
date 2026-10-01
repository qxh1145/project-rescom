import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Plan 5.4: the MSW password reset handlers parse with the shared
 * `@rescom/schemas` contracts the backend controller uses and answer like it
 * (the backend half is `apps/backend/test/password-reset.e2e-spec.ts`).
 * Same loader set-up as `admin-contract.test.mjs`.
 */
// The mock keeps passwords and tokens in localStorage: a Map-backed stand-in.
const stored = new Map();
globalThis.window ??= globalThis;
globalThis.localStorage ??= {
  getItem: (key) => (stored.has(key) ? stored.get(key) : null),
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key),
};

const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

const HOOKS = `
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let appRoot = "";
let replacements = {};

export function initialize(data) {
  appRoot = data.appRoot;
  replacements = data.replacements;
}

function asFile(candidate) {
  for (const file of [candidate, candidate + ".ts", path.join(candidate, "index.ts")]) {
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let file = null;
  if (specifier.startsWith("@/")) {
    file = asFile(path.join(appRoot, specifier.slice(2)));
  } else if (/^\\.\\.?\\//.test(specifier) && context.parentURL?.startsWith("file:")) {
    const parent = fileURLToPath(context.parentURL);
    if (parent.startsWith(appRoot + path.sep) && !parent.includes(path.sep + "node_modules" + path.sep)) {
      file = asFile(path.resolve(path.dirname(parent), specifier));
    }
  }
  if (!file) return nextResolve(specifier, context);
  const replacement = replacements[path.relative(appRoot, file)];
  return { url: replacement ?? pathToFileURL(file).href, shortCircuit: true };
}
`;

const SCENARIOS_STAND_IN = `
export async function applyScenario() {
  return undefined;
}
`;

const REPOSITORY_STAND_IN = `
export const mockRepository = {
  async getCurrentUser() {
    return globalThis.__resetSignedIn ?? null;
  },
  async logout() {
    globalThis.__resetSignedIn = null;
  },
};
`;

register(dataModule(HOOKS), import.meta.url, {
  data: {
    appRoot,
    replacements: {
      [path.join("mocks", "scenarios.ts")]: dataModule(SCENARIOS_STAND_IN),
      [path.join("mocks", "legacy", "repository.ts")]: dataModule(REPOSITORY_STAND_IN),
    },
  },
});

const { getResponse } = await import("msw");
const { passwordResetHandlers } = await import("../mocks/handlers/password-reset.ts");
const { expectedPassword } = await import("../mocks/data/auth.ts");
const schemas = await import("@rescom/schemas");

const ORIGIN = "http://localhost";

async function post(route, body) {
  const response = await getResponse(
    passwordResetHandlers,
    new Request(`${ORIGIN}/api${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { baseUrl: ORIGIN },
  );
  assert.ok(response, `a handler answers POST ${route}`);
  return { status: response.status, body: await response.json() };
}

/** The mock prints the link (there is no mailbox); read the token back from it. */
async function requestLink(email) {
  const logged = [];
  const original = console.info;
  console.info = (line) => logged.push(line);
  try {
    const result = await post("/auth/password/forgot", { email });
    assert.equal(result.status, 202);
    assert.deepEqual(schemas.forgotPasswordResultSchema.parse(result.body.data), { accepted: true });
  } finally {
    console.info = original;
  }
  const match = /\/reset-password\?token=([A-Za-z0-9_-]+)/.exec(logged.at(-1) ?? "");
  assert.ok(match, "the reset link is printed");
  return match[1];
}

test("forgot answers 202 { accepted: true } for any address and validates like the backend", async () => {
  await requestLink("nobody@example.com");
  const bad = await post("/auth/password/forgot", { email: "not-an-email" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "AUTH_INVALID_INPUT");
  const extra = await post("/auth/password/forgot", { email: "a@b.co", extra: 1 });
  assert.equal(extra.status, 400);
});

test("reset sets the new password once and signs the account out", async () => {
  globalThis.__resetSignedIn = { email: "minh.le@fpt.edu.vn" };
  const token = await requestLink("minh.le@fpt.edu.vn");
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);

  const weak = await post("/auth/password/reset", { token, newPassword: "short" });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.error.code, "AUTH_INVALID_INPUT");

  const done = await post("/auth/password/reset", { token, newPassword: "mật khẩu mới đủ dài" });
  assert.equal(done.status, 200);
  assert.deepEqual(schemas.resetPasswordResultSchema.parse(done.body.data), { passwordReset: true });
  assert.equal(expectedPassword("minh.le@fpt.edu.vn"), "mật khẩu mới đủ dài");
  assert.equal(globalThis.__resetSignedIn, null);

  const reused = await post("/auth/password/reset", { token, newPassword: "mật khẩu mới đủ dài" });
  assert.equal(reused.status, 400);
  assert.equal(reused.body.error.code, schemas.PASSWORD_RESET_TOKEN_INVALID);
});

test("older links stay valid until one is redeemed; unknown tokens answer the same code", async () => {
  const first = await requestLink("linh.onboarding@fpt.edu.vn");
  const second = await requestLink("linh.onboarding@fpt.edu.vn");
  const ok = await post("/auth/password/reset", { token: first, newPassword: "mật khẩu mới đủ dài" });
  assert.equal(ok.status, 200);
  for (const token of [second, "never-issued"]) {
    const result = await post("/auth/password/reset", { token, newPassword: "mật khẩu mới đủ dài" });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, "PASSWORD_RESET_TOKEN_INVALID");
  }
});
