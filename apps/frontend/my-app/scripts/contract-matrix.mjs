// Story IR.5 A4: regenerates the contract matrix of the G3 evidence pack from
// the call-site scan (`tests/helpers/frontend-callsites.mjs`). Run from
// apps/frontend/my-app: `node scripts/contract-matrix.mjs`.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../tests/helpers/backend-routes.mjs";
import { matrixMarkdown } from "../tests/helpers/frontend-callsites.mjs";

const out = path.join(REPO_ROOT, "_bmad-output/implementation-artifacts/ir-5-g3/contract-matrix.md");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, matrixMarkdown());
console.log(`wrote ${path.relative(REPO_ROOT, out)}`);
