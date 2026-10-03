import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared source scanning of `contract-callsites`, `no-direct-mocks` and
 * `pilot-scope`: file walk, comment stripping and the enclosing-function
 * lookup that makes a "guard" check mean "in the same function", not "somewhere
 * in the file". Text based (no parser): it understands strings, template
 * literals and braces, which is all the frontend source needs.
 */

export const APP_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

export const readSource = (file) => readFileSync(path.join(APP_ROOT, file), "utf8");

/** Source files (`.ts`, `.tsx`, `.mjs`) of `dir`, relative to the app root. */
export function sourceFiles(dir) {
  return readdirSync(path.join(APP_ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(APP_ROOT, rel)).isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx|mjs)$/.test(name) ? [rel] : [];
  });
}

/** Block comments and whole-line `//` comments blanked out; the line structure is kept. */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line.replace(/(^|\s)\/\/.*$/, "$1")))
    .join("\n");
}

/** Index after the string or template literal opening at `start`. */
export function skipString(source, start) {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i += 1) {
    if (source[i] === "\\") i += 1;
    else if (quote === "`" && source[i] === "$" && source[i + 1] === "{") i = skipBraces(source, i + 1) - 1;
    else if (source[i] === quote) return i + 1;
  }
  return source.length;
}

/** Index after the `{ … }` opening at `start`. */
export function skipBraces(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") i = skipString(source, i) - 1;
    else if (ch === "{") depth += 1;
    else if (ch === "}" && (depth -= 1) === 0) return i + 1;
  }
  return source.length;
}

/** Every `{…}` block as `{ open, close }`, template `${…}` and JSX containers included. */
function blocks(source) {
  const found = [];
  const stack = [];
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'") i = skipString(source, i) - 1;
    else if (ch === "`") {
      // Template literals are skipped whole, but their `${…}` expressions can hold callbacks: scan them too.
      const end = skipString(source, i);
      for (let j = i + 1; j < end; j += 1) {
        if (source[j] === "\\") j += 1;
        else if (source[j] === "$" && source[j + 1] === "{") {
          found.push(...blocks(source.slice(j + 2, skipBraces(source, j + 1) - 1)).map((b) => ({ open: b.open + j + 2, close: b.close + j + 2 })));
          j = skipBraces(source, j + 1) - 1;
        }
      }
      i = end - 1;
    } else if (ch === "{") stack.push(i);
    else if (ch === "}" && stack.length) found.push({ open: stack.pop(), close: i });
  }
  return found;
}

const CONTROL = /\b(?:if|for|while|switch|catch|with)\s*$/;

/**
 * What kind of function body, if any, the block opening at `open` is:
 * `"named"` (`function f(…) {`, `const f = (…) => {`), `"callback"` (an arrow or
 * `function` passed as an argument) or `null` (object literal, JSX container,
 * `if`/`for`/… block).
 */
function functionKind(source, open) {
  let before = source.slice(0, open).trimEnd();
  // `function f(…): Promise<{ id: string }[]> {`: cut a TypeScript return type back to the parameter list.
  const typed = before.slice(-400).match(/\)\s*:\s*[\w.<>\[\],\s|&{}:;?"'-]*$/);
  if (typed && !before.endsWith("=>")) before = before.slice(0, before.length - typed[0].length + 1);
  if (before.endsWith("=>")) {
    // `=> {`: named when the arrow's parameters are assigned (`= (…)` / `= async (…)` / `= x`), else a callback.
    const params = before.slice(0, -2).trimEnd();
    const head = params.endsWith(")") ? params.slice(0, matchingOpen(params, params.length - 1)).trimEnd() : params.replace(/\w+$/, "").trimEnd();
    const head2 = head.replace(/\basync$/, "").trimEnd();
    return /[=]$/.test(head2) && !/[=!<>]=$/.test(head2) ? "named" : "callback";
  }
  if (before.endsWith(")")) {
    const head = before.slice(0, matchingOpen(before, before.length - 1)).trimEnd();
    if (CONTROL.test(head)) return null;
    if (/\bfunction\s*\*?\s*\w*$/.test(head)) return /\bfunction\s*\*?\s*\w+$/.test(head) ? "named" : "callback";
  }
  return null;
}

/** Index of the `(` matching the `)` at `close` (strings skipped backwards by a coarse scan). */
function matchingOpen(source, close) {
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    const ch = source[i];
    if (ch === ")") depth += 1;
    else if (ch === "(" && (depth -= 1) === 0) return i;
  }
  return 0;
}

/**
 * Function bodies enclosing `index`, innermost first, up to and including the
 * first `named` one: `{ text, start, end, name }`. A guard "in the same
 * function" is looked for in these (callbacks pass through to the function
 * that declares them).
 */
export function enclosingFunctions(source, index) {
  const chain = [];
  const enclosing = blocks(source)
    .filter((block) => block.open < index && index < block.close)
    .sort((a, b) => b.open - a.open);
  for (const block of enclosing) {
    const kind = functionKind(source, block.open);
    if (!kind) continue;
    chain.push({ start: block.open, end: block.close, kind, text: source.slice(block.open, block.close) });
    if (kind === "named") break;
  }
  return chain;
}

/** Body text of the outermost function declaring the code at `index`, or null. */
export function topLevelFunctionBody(source, index) {
  const outer = blocks(source)
    .filter((block) => block.open < index && index < block.close && functionKind(source, block.open))
    .sort((a, b) => a.open - b.open)[0];
  return outer ? source.slice(outer.open, outer.close) : null;
}

/** Name of the outermost function declaring the code at `index` (`export function f`, `const f = …`), or null. */
export function topLevelFunctionName(source, index) {
  const outer = blocks(source)
    .filter((block) => block.open < index && index < block.close && functionKind(source, block.open))
    .sort((a, b) => a.open - b.open)[0];
  if (!outer) return null;
  const lines = source.slice(0, outer.open).split("\n");
  const header = lines.slice(lines.findLastIndex((line) => /^\S/.test(line) && !/^[)\]}]/.test(line))).join("\n");
  return header.match(/\bfunction\s*\*?\s*(\w+)/)?.[1] ?? header.match(/^(?:export\s+)?(?:const|let)\s+(\w+)/)?.[1] ?? null;
}

/**
 * True when `token` (a regex source) appears before `index` in the function
 * that declares the code at `index`, looking through callbacks to the first
 * named function. Other nested functions of that body (a sibling callback that
 * happens to hold the token) do not count.
 */
export function guardedInFunction(source, index, token) {
  const re = new RegExp(`\\b(?:${token})\\b`);
  const nested = blocks(source).filter((block) => functionKind(source, block.open));
  return enclosingFunctions(source, index).some((fn) => {
    let text = source.slice(fn.start, index);
    for (const inner of nested) {
      if (inner.open > fn.start && inner.close < index) {
        text = text.slice(0, inner.open - fn.start) + " ".repeat(inner.close - inner.open) + text.slice(inner.close - fn.start);
      }
    }
    return re.test(text);
  });
}

/**
 * True when `token` appears before `index` in the same top-level statement
 * (module-level code such as a nav config array), from the last line that
 * starts a declaration at column 0.
 */
export function guardedInStatement(source, index, token) {
  const lines = source.slice(0, index).split("\n");
  const start = lines.findLastIndex((line) => /^(?:export |const |let |function |type |interface )/.test(line));
  return new RegExp(`\\b(?:${token})\\b`).test(lines.slice(Math.max(start, 0)).join("\n"));
}
