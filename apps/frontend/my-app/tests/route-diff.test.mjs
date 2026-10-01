import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Route-diff gate (mock-off plan 0.4): every endpoint the MSW handlers serve
 * either exists in the NestJS controllers or is listed, with its reason, in
 * `mocks/route-allowlist.ts`. Read from source, nothing is started.
 */

const { ROUTE_ALLOWLIST } = await import("../mocks/route-allowlist.ts");

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const BACKEND_SRC = fileURLToPath(new URL("../../../backend/src/", import.meta.url));
const MSW_HANDLERS = fileURLToPath(new URL("../mocks/handlers/", import.meta.url));

const where = (file, line) => `${relative(REPO_ROOT, file)}:${line}`;

/** `METHOD /path`, ignoring `:param` names and duplicate or trailing slashes. */
function routeKey(method, path) {
  const clean = `/${path}`
    .replace(/\/{2,}/g, "/")
    .replace(/(.)\/$/, "$1")
    .replace(/:[A-Za-z_]\w*/g, ":param");
  return `${method.toUpperCase()} ${clean}`;
}

/** A route decorator at the start of a line; `@Controller([...])` may span lines. */
const DECORATOR = /^[ \t]*@(Controller|Get|Post|Patch|Put|Delete)\(([^)]*)\)/gm;

/** `()` → "", `('x')` → "x", `(['x', 'api/x'])` → "x" (the alias without `api/`). */
function decoratorPath(args, location) {
  if (args.trim() === "") return "";
  const literal = args.match(/^\s*\[?\s*(['"])(.*?)\1/s);
  if (!literal) throw new Error(`route-diff: unsupported decorator argument (${args.trim()}) at ${location}`);
  return literal[2];
}

/** `METHOD /path` → `file:line` for every NestJS route (`*.controller.ts`). */
function backendRoutes() {
  const routes = new Map();
  for (const name of readdirSync(BACKEND_SRC, { recursive: true }).sort()) {
    if (!name.endsWith(".controller.ts")) continue;
    const file = join(BACKEND_SRC, name);
    const source = readFileSync(file, "utf8");
    let prefix = null;
    for (const match of source.matchAll(DECORATOR)) {
      const location = where(file, source.slice(0, match.index).split("\n").length);
      const path = decoratorPath(match[2], location);
      if (match[1] === "Controller") prefix = path;
      else if (prefix === null) throw new Error(`route-diff: @${match[1]} before any @Controller at ${location}`);
      else routes.set(routeKey(match[1], `${prefix}/${path}`), location);
    }
  }
  return routes;
}

/** `http.<method>(apiUrl("<path>")`, the path possibly a template literal. */
const HANDLER = /\bhttp\.(get|post|patch|put|delete)\(\s*apiUrl\(\s*(["'`])(.*?)\2\s*\)/;
const HANDLER_CALL = /\bhttp\.[a-z]+\(/;

/** Every MSW handler of `mocks/handlers/*.ts`; one it cannot read fails the run. */
function mswHandlers() {
  const handlers = [];
  for (const name of readdirSync(MSW_HANDLERS).filter((entry) => entry.endsWith(".ts")).sort()) {
    const file = join(MSW_HANDLERS, name);
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        const code = line.trim();
        if (!HANDLER_CALL.test(code) || code.startsWith("//") || code.startsWith("*")) return;
        const location = where(file, index + 1);
        const match = code.match(HANDLER);
        if (!match) throw new Error(`route-diff: cannot read the MSW handler at ${location}`);
        handlers.push({ key: routeKey(match[1], match[3]), endpoint: `${match[1].toUpperCase()} ${match[3]}`, location });
      });
  }
  return handlers;
}

/** Normalised key → `{ category, endpoint }` of every allowlist entry. */
function allowlistEntries() {
  const entries = new Map();
  for (const [category, endpoints] of Object.entries(ROUTE_ALLOWLIST)) {
    for (const endpoint of Object.keys(endpoints)) {
      const parts = endpoint.match(/^(GET|POST|PATCH|PUT|DELETE) (\/\S*)$/);
      assert.ok(parts, `malformed allowlist key "${endpoint}" in ${category}`);
      const key = routeKey(parts[1], parts[2]);
      const previous = entries.get(key);
      assert.equal(previous, undefined, `"${endpoint}" is listed twice (${previous?.category}, ${category})`);
      entries.set(key, { category, endpoint });
    }
  }
  return entries;
}

const backend = backendRoutes();
const handlers = mswHandlers();
const allowlist = allowlistEntries();
const mswOnly = new Map();
for (const handler of handlers) {
  if (!backend.has(handler.key) && !mswOnly.has(handler.key)) mswOnly.set(handler.key, handler);
}

test("route-diff reads both sides and summarises the MSW-only endpoints per category", (t) => {
  // A shared route proves both parsers still find what they look for.
  assert.ok(backend.has("GET /auth/me"), "no GET /auth/me among the backend routes: parser out of date?");
  assert.ok(handlers.some((handler) => handler.key === "GET /auth/me"), "no GET /auth/me MSW handler");

  t.diagnostic(`MSW handlers ${handlers.length}, backend routes ${backend.size}, MSW-only ${mswOnly.size}`);
  for (const [category, endpoints] of Object.entries(ROUTE_ALLOWLIST)) {
    const listed = Object.keys(endpoints);
    t.diagnostic(`${category} (${listed.length}): ${listed.join(", ")}`);
  }
});

test("every MSW-only endpoint is in a category of mocks/route-allowlist.ts", () => {
  const untracked = [...mswOnly.values()]
    .filter((handler) => !allowlist.has(handler.key))
    .map((handler) => `${handler.endpoint} (${handler.location})`);
  assert.deepEqual(
    untracked,
    [],
    `MSW-only endpoints in no category: implement them in the backend or list them with a reason:\n  ${untracked.join("\n  ")}`,
  );
});

test("no allowlist entry is served by the backend", () => {
  const served = [...allowlist]
    .filter(([key]) => backend.has(key))
    .map(([key, entry]) => `${entry.endpoint} (${entry.category}; backend ${backend.get(key)})`);
  assert.deepEqual(served, [], `The backend now serves these allowlisted endpoints, delete them:\n  ${served.join("\n  ")}`);
});

test("every allowlist entry still has its MSW handler", () => {
  const mswKeys = new Set(handlers.map((handler) => handler.key));
  const orphaned = [...allowlist]
    .filter(([key]) => !mswKeys.has(key))
    .map(([, entry]) => `${entry.endpoint} (${entry.category})`);
  assert.deepEqual(orphaned, [], `These allowlisted endpoints have no MSW handler left, delete them:\n  ${orphaned.join("\n  ")}`);
});

test("gate G: only MOCK_ONLY (3) and DEFERRED_KEEP_MOCK (14) remain; every other MSW route is a backend route", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(ROUTE_ALLOWLIST).map(([category, endpoints]) => [category, Object.keys(endpoints).length])),
    { MOCK_ONLY: 3, DEFERRED_KEEP_MOCK: 14, PLANNED: 0, REMOVE: 0 },
  );
  const outside = [...new Set(handlers.map((handler) => handler.key))]
    .filter((key) => !backend.has(key) && !["MOCK_ONLY", "DEFERRED_KEEP_MOCK"].includes(allowlist.get(key)?.category))
    .map((key) => mswOnly.get(key)?.location ?? key);
  assert.deepEqual(outside, [], `MSW routes outside the gate-G allowlist that no @Controller serves:\n  ${outside.join("\n  ")}`);
});
