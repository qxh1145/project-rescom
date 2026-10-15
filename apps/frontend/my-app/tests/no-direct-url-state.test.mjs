import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const FRONTEND_ROOT = path.resolve(import.meta.dirname, "..");

const FILES_TO_CHECK = [
  "app/(signed-in)/(app)/wallet/components/WalletScreen.tsx",
  "app/(signed-in)/(focus)/wallet/top-up/components/PayosCheckoutScreen.tsx",
  "app/(signed-in)/(focus)/wallet/top-up/components/PayosTopUpScreen.tsx",
  "app/(signed-in)/(focus)/wallet/top-up/components/TopUpRouter.tsx",
  "app/(signed-in)/(focus)/wallet/top-up/[id]/page.tsx",
  "lib/wallet/payos-top-up-service.ts",
  "lib/wallet/use-payos-polling.ts",
  "mocks/handlers/top-up.ts",
];

test("no-direct-url-state regression check (NFR-31)", () => {
  for (const relativePath of FILES_TO_CHECK) {
    const fullPath = path.join(FRONTEND_ROOT, relativePath);
    assert.ok(fs.existsSync(fullPath), `${relativePath} is listed but missing`);

    const content = fs.readFileSync(fullPath, "utf8");
    // Assert that payment truth is never read from search params or window.location.search
    assert.equal(
      /useSearchParams/.test(content),
      false,
      `${relativePath} must not use useSearchParams for payment state`,
    );
    assert.equal(
      /window\.location\.search/.test(content),
      false,
      `${relativePath} must not use window.location.search for payment state`,
    );
  }
});
