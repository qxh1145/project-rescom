import { backendRouteDetails, backendSpecCoverage, routeKey } from "./backend-routes.mjs";
import { readSource, skipBraces, skipString, sourceFiles, stripComments, topLevelFunctionName } from "./source-scan.mjs";

/**
 * Story IR.5 A1: every API path the frontend source calls, read from
 * `app/`, `lib/` and `components/` (not `mocks/`, `tests/`), matched against
 * the NestJS routes. Used by `contract-callsites.test.mjs` and by
 * `scripts/contract-matrix.mjs` (the A4 report).
 */

const SCAN_DIRS = ["app", "lib", "components"];

/**
 * Calls the scan cannot resolve to a path, on purpose: generic transports that
 * take the path as a parameter (their callers are scanned) and the telemetry
 * `fetch(url)` (its `/api/…` literal lives in `telemetry-buffer.mjs`).
 */
const TRANSPORT_FILES = new Set([
  "lib/api/client.ts",
  "app/forms/forms-api.ts",
  "app/forms/hooks/useSurveyTelemetry.ts",
  "lib/forms/resubmit-service.ts",
]);

/** A bare `/api/…` literal carries no method: the file's calls use this one. */
const LITERAL_METHOD = { "app/forms/hooks/telemetry-buffer.mjs": "POST" };

/**
 * Frontend calls that no NestJS route serves, each with why that is allowed.
 * `deferred-hidden`: the call is only reachable from a screen of
 * `PILOT_HIDDEN_ROUTES`, behind a `results-scope.ts` flag or `isHybridMocking`
 * that are all false in the pilot build (tests/pilot-scope.test.mjs checks the
 * guards); the route must also be a `DEFERRED_KEEP_MOCK` entry. `out-of-api`:
 * not a call to the RESCOM API in the pilot (full-page navigation, the
 * presigned object-storage PUT, a mock-only route).
 */
export const CALL_ALLOWLIST = {
  "POST /forms/:id/attempts/:attemptId/disputes": { reason: "deferred-hidden", note: "publisher complaint (Story 8.5), /forms/[id]/complaints hidden" },
  "GET /admin/disputes": { reason: "deferred-hidden", note: "only requested when isHybridMocking (disputes-service.ts); pilot shows the missing-code tab only" },
  "POST /admin/disputes/:id/resolve": { reason: "deferred-hidden", note: "needs a case from GET /admin/disputes (hybrid only)" },
  "GET /integrity/reliability/me": { reason: "deferred-hidden", note: "/account/trust hidden (Epic 10)" },
  "GET /admin/quality-reviews": { reason: "deferred-hidden", note: "/admin/quality hidden (Epic 10)" },
  "POST /admin/quality-reviews/:param/decision": { reason: "deferred-hidden", note: "/admin/quality hidden (Epic 10)" },
  "GET /forms/:id/quality": { reason: "deferred-hidden", note: "/forms/[id]/quality hidden; SURVEY_QUALITY_ENABLED false (Epic 10)" },
  "GET /forms/:id/ai/conversation": { reason: "deferred-hidden", note: "AI builder hidden (Epic 3)" },
  "POST /forms/:id/ai/messages": { reason: "deferred-hidden", note: "AI builder hidden (Epic 3)" },
  "POST /forms/:id/ai/suggest-block": { reason: "deferred-hidden", note: "AI builder hidden (Epic 3)" },
  "POST /forms/ai/messages": { reason: "deferred-hidden", note: "AI builder hidden (Epic 3)" },
  "POST /forms/:id/ai/conversation": { reason: "deferred-hidden", note: "AI builder hidden (Epic 3)" },
  "GET /engagement/me": { reason: "deferred-hidden", note: "/account/streak and /account/tier hidden (Stories 7.4-7.6)" },
  "GET /engagement/leaderboard": { reason: "deferred-hidden", note: "/leaderboard hidden (Stories 7.4-7.6)" },
  "POST /auth/google/mock-complete": { reason: "out-of-api", note: "mock-only; isApiMockingEnabled is false in the pilot" },
  "GET /mock/demo-accounts": { reason: "out-of-api", note: "mock-only demo account list; isApiMockingEnabled is false in the pilot" },
  "PUT <presigned-url>": { reason: "out-of-api", note: "browser PUT to the presigned object-storage URL (outside /api)" },
  "HEAD <page-url>": { reason: "out-of-api", note: "offline screen probes its own page URL" },
};

/** Declarations like `const formPath = (id) => \`/forms/${…}\`` → `{ formPath: "/forms/:param" }`. */
function pathHelpers(source) {
  const helpers = {};
  for (const m of source.matchAll(/const (\w+Path) = \([^)]*\)(?::[^=]+)? => `([^`]*)`/g)) {
    helpers[m[1]] = normalize(`\`${m[2]}\``, {});
  }
  return helpers;
}

/** Text of the argument list starting after `(` at `start` (strings and templates skipped), split on top-level commas. */
function callArguments(source, start) {
  const args = [];
  let depth = 0;
  let current = "";
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(source, i);
      current += source.slice(i, end);
      i = end - 1;
      continue;
    }
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) {
      if (depth === 0) {
        args.push(current.trim());
        return args;
      }
      depth -= 1;
    } else if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  return args;
}

/** A path expression (literal, template or `helper(x)`) → `/a/:param/b`; null when it is none of those. */
function normalize(expression, helpers) {
  const helper = expression.match(/^(\w+Path)\(/);
  if (helper && helpers[helper[1]]) return helpers[helper[1]];
  const literal = expression.match(/^(["'`])([\s\S]*)\1$/);
  if (!literal) return null;
  let out = "";
  const text = literal[2];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "$" && text[i + 1] === "{") {
      const end = skipBraces(text, i + 1);
      const inner = text.slice(i + 2, end - 1).trim();
      const prior = out;
      if (prior.endsWith("/") || prior === "") out += helpers[inner.match(/^(\w+Path)\(/)?.[1]] ?? ":param";
      // a `${query}` glued to the path (`/x${suffix}`) is a query string, not a segment
      i = end - 1;
    } else out += text[i];
  }
  return out.split("?")[0].replace(/^\/api(?=\/)/, "");
}

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

const CALL = /\b(apiRequest|fetch|fetchImpl|optionalCsrfMutationFetch|formMutationFetch|apiUrl)\(/g;
const API_LITERAL = /(["'`])(\/api\/[^"'`\n]*)\1/g;

/**
 * Every frontend API call: `{ method, path, file, line, schema }`, plus
 * `unresolved` calls (path not a literal, template or `…Path()` helper) that
 * are not in `TRANSPORT_FILES`.
 */
export function scanCallsites() {
  const calls = [];
  const unresolved = [];
  for (const file of SCAN_DIRS.flatMap(sourceFiles)) {
    const source = stripComments(readSource(file));
    const helpers = pathHelpers(source);
    const seen = new Set();
    for (const match of source.matchAll(CALL)) {
      const name = match[1];
      const args = callArguments(source, match.index + match[0].length);
      const location = `${file}:${lineOf(source, match.index)}`;
      let expression = args[0] ?? "";
      let method = "GET";
      const options = args[1] ?? "";
      if (name === "fetch" && /^apiUrl\(/.test(expression)) {
        // `fetch(apiUrl("/x"), { … })`: the path is the inner argument; the inner `apiUrl(` match is skipped.
        seen.add(match.index + match[0].length + "apiUrl(".length);
        expression = callArguments(expression, "apiUrl(".length)[0];
      }
      if (name === "apiUrl" && (seen.has(match.index + match[0].length) || !/^["'`]/.test(expression))) continue;
      const verb = options.match(/\bmethod:\s*["'](\w+)["']/);
      if (verb) method = verb[1].toUpperCase();
      if (name === "fetch" && /XMLHttpRequest|window\.location/.test(expression)) continue;
      const resolved = normalize(expression, helpers);
      if (resolved === null || (name !== "apiRequest" && name !== "apiUrl" && !resolved.startsWith("/"))) {
        if (!TRANSPORT_FILES.has(file)) unresolved.push(`${location} ${name}(${expression})`);
        continue;
      }
      const schema = options.match(/\bschema:\s*([\w.]+(?:\([^)]*\))?)/)?.[1] ?? null;
      calls.push({ method, path: resolved, file, line: lineOf(source, match.index), schema, via: name, fn: topLevelFunctionName(source, match.index), index: match.index });
    }
    // `/api/…` literals returned by helpers (telemetry) rather than passed to a call.
    for (const match of source.matchAll(API_LITERAL)) {
      const resolved = normalize(match[0], helpers);
      const before = source.slice(Math.max(0, match.index - 80), match.index);
      if (/(fetch|fetchImpl|MutationFetch|apiRequest|apiUrl)\(\s*$/.test(before)) continue;
      const method = LITERAL_METHOD[file];
      if (!method) {
        unresolved.push(`${file}:${lineOf(source, match.index)} bare ${match[0]}`);
        continue;
      }
      calls.push({ method, path: resolved, file, line: lineOf(source, match.index), schema: null, via: "literal" });
    }
    if (/new XMLHttpRequest\(\)/.test(source)) calls.push({ method: "PUT", path: "<presigned-url>", file, line: lineOf(source, source.indexOf("new XMLHttpRequest()")), schema: null, via: "XMLHttpRequest" });
    if (/fetch\(window\.location\.href,\s*\{\s*method:\s*"HEAD"/.test(source)) calls.push({ method: "HEAD", path: "<page-url>", file, line: lineOf(source, source.indexOf("fetch(window.location.href")), schema: null, via: "fetch" });
  }
  return { calls, unresolved };
}

/** The call-site matrix: one row per `METHOD path`, with every call site folded into it. */
export function buildMatrix() {
  const { calls, unresolved } = scanCallsites();
  const backend = backendRouteDetails();
  const specs = backendSpecCoverage();
  const rows = new Map();
  for (const call of calls) {
    const key = call.path.startsWith("<") ? `${call.method} ${call.path}` : routeKey(call.method, call.path);
    const row = rows.get(key) ?? { key, sites: [], schemas: new Set() };
    row.sites.push(`${call.file}:${call.line}`);
    if (call.schema) row.schemas.add(call.schema);
    rows.set(key, row);
  }
  const matrix = [...rows.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((row) => {
      const route = backend.get(row.key);
      const allowed = CALL_ALLOWLIST[row.key] ?? Object.entries(CALL_ALLOWLIST).find(([k]) => routeKey(...k.split(" ")) === row.key)?.[1];
      const access = route
        ? [route.access.public ? "Public" : null, route.access.roles.length ? `Roles ${route.access.roles.join(",")}` : null, route.access.guards.length ? route.access.guards.join(", ") : null]
            .filter(Boolean)
            .join("; ") || "—"
        : "—";
      return {
        key: row.key,
        sites: row.sites,
        schemas: [...row.schemas],
        controller: route?.location ?? null,
        status: route ? "matched" : allowed ? `allowlisted (${allowed.reason})` : "UNMATCHED",
        note: route ? "" : (allowed?.note ?? ""),
        access,
        specs: route ? [...(specs.get(row.key) ?? [])] : [],
      };
    });
  return { matrix, unresolved };
}

/** Markdown of `buildMatrix()` for the G3 evidence pack (A4). */
export function matrixMarkdown() {
  const { matrix } = buildMatrix();
  const count = (status) => matrix.filter((row) => row.status.startsWith(status)).length;
  const cell = (value) => (value === null || value === "" ? "—" : String(value).replace(/\|/g, "\\|"));
  const lines = [
    "# IR.5 contract matrix (frontend call site → backend)",
    "",
    "Generated by `node apps/frontend/my-app/scripts/contract-matrix.mjs` from `tests/helpers/frontend-callsites.mjs`; do not edit by hand.",
    "",
    `Distinct calls ${matrix.length}: matched ${count("matched")}, allowlisted ${count("allowlisted")}, unmatched ${count("UNMATCHED")}.`,
    "",
    "Schema = the zod schema passed to `apiRequest` at the first call site. Access = decorators read from the controller (`@Public`, `@Roles`, `@UseGuards`). Spec = backend e2e files that call the path with a literal supertest path. `—` = not derivable from source.",
    "",
    "| Frontend call | Call sites | Controller | Schema | Access | Backend e2e spec | Status |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const row of matrix) {
    const sites = row.sites.length > 2 ? `${row.sites.slice(0, 2).join("<br>")}<br>+${row.sites.length - 2}` : row.sites.join("<br>");
    lines.push(
      `| \`${row.key}\` | ${sites} | ${cell(row.controller)} | ${cell(row.schemas.join(", "))} | ${cell(row.access)} | ${cell(row.specs.join(", "))} | ${cell(row.status)}${row.note ? ` — ${cell(row.note)}` : ""} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}
