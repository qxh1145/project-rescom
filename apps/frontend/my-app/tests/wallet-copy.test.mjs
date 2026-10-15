import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("Task 3.1 & 3.3: BalanceCard renders cash-withdrawal disclaimer", () => {
  const file = path.resolve(__dirname, "../app/(signed-in)/(app)/wallet/components/BalanceCard.tsx");
  const content = fs.readFileSync(file, "utf8");
  assert.ok(
    content.includes("Điểm chỉ dùng trong Rescom, không bao giờ rút ra thành tiền mặt."),
    "wallet balance card must include the cash-withdrawal disclaimer copy",
  );
});
