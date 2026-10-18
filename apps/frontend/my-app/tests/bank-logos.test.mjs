import test from "node:test";
import assert from "node:assert/strict";
import { getBankCodeByBin, getBankInfoByBin, getBankLogoSrc } from "../lib/brand/bank-logos.ts";

test("bank-logos mapping: known BIN → code, unknown → null, null → null", () => {
  // Known BINs return matching bank code
  assert.equal(getBankCodeByBin("970436"), "vcb");
  assert.equal(getBankCodeByBin("970418"), "bidv");
  assert.equal(getBankCodeByBin("970415"), "vietinbank");
  assert.equal(getBankCodeByBin("970405"), "agribank");
  assert.equal(getBankCodeByBin("970407"), "techcombank");
  assert.equal(getBankCodeByBin("970422"), "mb");
  assert.equal(getBankCodeByBin("970416"), "acb");
  assert.equal(getBankCodeByBin("970432"), "vpbank");
  assert.equal(getBankCodeByBin("970423"), "tpbank");
  assert.equal(getBankCodeByBin("970403"), "sacombank");

  // Tolerates whitespace
  assert.equal(getBankCodeByBin(" 970436 "), "vcb");

  // Unknown BIN returns null
  assert.equal(getBankCodeByBin("000000"), null);
  assert.equal(getBankCodeByBin("999999"), null);
  assert.equal(getBankCodeByBin("invalid"), null);

  // Null and undefined return null
  assert.equal(getBankCodeByBin(null), null);
  assert.equal(getBankCodeByBin(undefined), null);
  assert.equal(getBankCodeByBin(""), null);

  // getBankInfoByBin returns full info or null
  assert.deepEqual(getBankInfoByBin("970436"), { code: "vcb", name: "Vietcombank" });
  assert.equal(getBankInfoByBin("000000"), null);
  assert.equal(getBankInfoByBin(null), null);

  // Asset fallback when files not yet provided
  assert.equal(getBankLogoSrc("970436"), null);
});
