// Story IR.5 B3 (IR.6 precondition): a pilot build must not ship MSW. Run after
//   NEXT_PUBLIC_PILOT_BUILD=true NEXT_PUBLIC_API_MOCKING=disabled npm run build
// from apps/frontend/my-app: `node scripts/check-pilot-bundle.mjs [static-dir]`.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const staticDir = path.resolve(process.argv[2] ?? path.join(appRoot, ".next/static"));
const FORBIDDEN = ["setupWorker", "msw", "mockServiceWorker"];

if (!existsSync(staticDir)) {
  console.error(`check-pilot-bundle: ${staticDir} does not exist; run the pilot build first.`);
  process.exit(2);
}

const files = readdirSync(staticDir, { recursive: true })
  .map((name) => path.join(staticDir, String(name)))
  .filter((file) => /\.(js|css|map|json|html)$/.test(file));
if (files.length === 0) {
  console.error(`check-pilot-bundle: no build output under ${staticDir}.`);
  process.exit(2);
}

const hits = files.flatMap((file) => {
  const source = readFileSync(file, "utf8");
  return FORBIDDEN.filter((word) => source.includes(word)).map((word) => `${path.relative(appRoot, file)}: ${word}`);
});

if (hits.length > 0) {
  console.error(`check-pilot-bundle: MSW found in the pilot bundle:\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.log(`check-pilot-bundle: ok, ${files.length} files under ${path.relative(appRoot, staticDir)} contain none of ${FORBIDDEN.join(", ")}.`);
