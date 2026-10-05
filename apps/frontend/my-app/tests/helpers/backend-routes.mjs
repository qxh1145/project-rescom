import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared by `route-diff.test.mjs` and `contract-callsites.test.mjs`: reads the
 * NestJS route decorators from source (nothing is started).
 */

export const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
export const BACKEND_SRC = fileURLToPath(new URL("../../../../backend/src/", import.meta.url));
export const BACKEND_TEST = fileURLToPath(new URL("../../../../backend/test/", import.meta.url));

export const where = (file, line) => `${relative(REPO_ROOT, file)}:${line}`;

/** `METHOD /path`, ignoring `:param` names and duplicate or trailing slashes. */
export function routeKey(method, path) {
  const clean = `/${path}`
    .replace(/\/{2,}/g, "/")
    .replace(/(.)\/$/, "$1")
    .replace(/:[A-Za-z_]\w*/g, ":param");
  return `${method.toUpperCase()} ${clean}`;
}

/** A route decorator at the start of a line; `@Controller([...])` may span lines. */
const DECORATOR = /^[ \t]*@(Controller|Get|Post|Patch|Put|Delete)\(([^)]*)\)/gm;
/** First line of a method or class declaration (decorators start with `@`, so they never match). */
const DECLARATION = /^[ \t]*(?:export\s+)?(?:async\s+|class\s+)?[A-Za-z_]\w*\s*[(<{ ]/m;
const ACCESS_DECORATOR = /^[ \t]*@(Public|Roles|UseGuards)\(([^)]*)\)/gm;

/** `()` → "", `('x')` → "x", `(['x', 'api/x'])` → "x" (the alias without `api/`). */
function decoratorPath(args, location) {
  if (args.trim() === "") return "";
  const literal = args.match(/^\s*\[?\s*(['"])(.*?)\1/s);
  if (!literal) throw new Error(`route-diff: unsupported decorator argument (${args.trim()}) at ${location}`);
  return literal[2];
}

/** `@Public`, `@Roles(…)` and the guard names a block of decorator lines carries. */
function accessOf(block) {
  const access = { public: false, roles: [], guards: [] };
  for (const match of block.matchAll(ACCESS_DECORATOR)) {
    const args = match[2].replace(/['"\s]/g, "");
    if (match[1] === "Public") access.public = true;
    else if (match[1] === "Roles") access.roles.push(...args.split(",").filter(Boolean));
    else access.guards.push(...args.split(",").filter(Boolean));
  }
  return access;
}

/**
 * `METHOD /path` → `{ location, file, access }` for every NestJS route
 * (`*.controller.ts`). `access` merges the class decorators with the ones
 * between the previous declaration and the route's own method.
 */
export function backendRouteDetails() {
  const routes = new Map();
  for (const name of readdirSync(BACKEND_SRC, { recursive: true }).sort()) {
    if (!name.endsWith(".controller.ts")) continue;
    const file = join(BACKEND_SRC, name);
    const source = readFileSync(file, "utf8");
    const decorators = [...source.matchAll(DECORATOR)];
    let prefix = null;
    let classAccess = { public: false, roles: [], guards: [] };
    let blockStart = 0;
    for (const match of decorators) {
      const location = where(file, source.slice(0, match.index).split("\n").length);
      const path = decoratorPath(match[2], location);
      const afterDecorator = match.index + match[0].length;
      const declaration = source.slice(afterDecorator).search(DECLARATION);
      const declarationEnd = declaration < 0 ? source.length : afterDecorator + declaration;
      if (match[1] === "Controller") {
        prefix = path;
        classAccess = accessOf(source.slice(blockStart, declarationEnd));
        blockStart = declarationEnd;
        continue;
      }
      if (prefix === null) throw new Error(`route-diff: @${match[1]} before any @Controller at ${location}`);
      const method = accessOf(source.slice(blockStart, declarationEnd));
      routes.set(routeKey(match[1], `${prefix}/${path}`), {
        location,
        file: relative(REPO_ROOT, file),
        access: {
          public: method.public || classAccess.public,
          roles: [...classAccess.roles, ...method.roles],
          guards: [...classAccess.guards, ...method.guards],
        },
      });
      blockStart = declarationEnd;
    }
  }
  return routes;
}

/** `METHOD /path` → `file:line` for every NestJS route (`*.controller.ts`). */
export function backendRoutes() {
  return new Map([...backendRouteDetails()].map(([key, { location }]) => [key, location]));
}

/**
 * `METHOD /path` → backend e2e specs (`apps/backend/test/*.e2e-spec.ts`) that
 * call it through supertest with a literal path (`.get("/x")`, template
 * literals included; a `/api` prefix is ignored). Calls that build the path
 * differently are not seen: the matrix shows `—` for those.
 */
export function backendSpecCoverage() {
  const coverage = new Map();
  // supertest `.get("/x")`, local helpers `get(`/x`, who)` / `get(admin, "/x")`, harness
  // `send("post", "/x", …)`; an optional `${prefix}` (the `api/` alias loop) is dropped.
  const call =
    /(?:\.|\b|send\(\s*["'])(get|post|patch|put|delete)(?:["']\s*,|\()\s*(?:\w+\s*,\s*)?(["'`])((?:\$\{prefix\})?\/[^"'`\n]*?)\2/g;
  for (const name of readdirSync(BACKEND_TEST).sort()) {
    if (!name.endsWith(".e2e-spec.ts")) continue;
    const source = readFileSync(join(BACKEND_TEST, name), "utf8");
    for (const match of source.matchAll(call)) {
      const path = match[3].replace(/^\$\{prefix\}/, "").replace(/^\/api(?=\/)/, "").replace(/\$\{[^}]*\}/g, ":param").split("?")[0];
      const key = routeKey(match[1], path);
      if (!coverage.has(key)) coverage.set(key, new Set());
      coverage.get(key).add(name);
    }
  }
  return coverage;
}
