import test from "node:test";
import assert from "node:assert/strict";
import { enclosingFunctions, readSource, sourceFiles, stripComments } from "./helpers/source-scan.mjs";

/**
 * Story IR.5 B1 (AC 2): shell, notification, feedback, onboarding and legacy
 * respondent screens read no mock data. `app/`, `lib/` and `components/` import
 * nothing from `mocks/` and never name `mockRepository`; the one exception is
 * the MSW bootstrap, a dynamic import that only runs when mocking is switched on.
 */

const MOCK_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'`])([^"'`]*(?:^|\/)mocks(?:\/[^"'`]*)?)\1/g;
const MOCK_REPOSITORY = /\bmockRepository\b/g;
const MSW_PROVIDER = "components/providers/MswProvider.tsx";

/** `file:line what` for each import of `mocks/` or mention of `mockRepository` outside comments. */
function violationsOf(file, source) {
  const code = stripComments(source);
  const lineOf = (index) => code.slice(0, index).split("\n").length;
  return [
    ...[...code.matchAll(MOCK_IMPORT)].map((m) => ({ index: m.index, what: `imports "${m[2]}"` })),
    ...[...code.matchAll(MOCK_REPOSITORY)].map((m) => ({ index: m.index, what: "references mockRepository" })),
  ].map(({ index, what }) => ({ file, index, line: lineOf(index), what, code }));
}

test("the detector flags a static import, a dynamic import and mockRepository (it is not vacuous)", () => {
  assert.equal(violationsOf("x.ts", 'import { db } from "@/mocks/db/session";').length, 1);
  assert.equal(violationsOf("x.ts", 'const m = await import("../../mocks/browser");').length, 1);
  assert.equal(violationsOf("x.ts", "mockRepository.reset();").length, 1);
  assert.equal(violationsOf("x.ts", '// import "@/mocks/db"\nconst mocking = "mock";').length, 0);
});

test("app, lib and components import nothing from mocks/ except the guarded MSW bootstrap", () => {
  const files = ["app", "lib", "components"].flatMap(sourceFiles);
  assert.ok(files.length > 200, `only ${files.length} files scanned`);
  const found = files.flatMap((file) => violationsOf(file, readSource(file))).filter((v) => v.file !== MSW_PROVIDER);
  assert.deepEqual(
    found.map((v) => `${v.file}:${v.line} ${v.what}`),
    [],
    "direct mock consumers outside components/providers/MswProvider.tsx",
  );
});

test("MswProvider imports mocks/browser dynamically, only inside the enabled-or-hybrid branch", () => {
  const [violation, ...rest] = violationsOf(MSW_PROVIDER, readSource(MSW_PROVIDER));
  assert.ok(violation, "MswProvider no longer starts MSW: update this test");
  assert.deepEqual(rest, []);
  assert.equal(violation.what, 'imports "@/mocks/browser"');
  assert.match(violation.code.slice(violation.index, violation.index + 8), /^import\s*\(/, "must be a dynamic import()");
  const [fn] = enclosingFunctions(violation.code, violation.index);
  const before = violation.code.slice(fn.start, violation.index);
  // Literal env reads (not the config flags), import() inside the positive branch: webpack keeps
  // the chunk after a constant early return (IR.5 review), a dead branch is dropped by every bundler.
  assert.match(
    before,
    /if \(process\.env\.NEXT_PUBLIC_API_MOCKING === "enabled" \|\| process\.env\.NEXT_PUBLIC_API_MOCKING === "hybrid"\) \{\s*workerStart \?\?= $/,
    "the import must sit directly inside the enabled-or-hybrid branch",
  );
});
