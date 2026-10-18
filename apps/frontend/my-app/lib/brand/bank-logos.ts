/**
 * Bank logos and NAPAS BIN mappings (Story 13.13, AC 7).
 *
 * Pilot set of 10 major Vietnamese banks:
 * - VCB (970436): Vietcombank
 * - BIDV (970418): BIDV
 * - VietinBank (970415): VietinBank
 * - Agribank (970405): Agribank
 * - Techcombank (970407): Techcombank
 * - MB (970422): MBBank
 * - ACB (970416): ACB
 * - VPBank (970432): VPBank
 * - TPBank (970423): TPBank
 * - Sacombank (970403): Sacombank
 *
 * Assets: official files supplied by Owner in Part B (Decision D4).
 * Until official files are added to public/brand/banks/, AVAILABLE_BANK_LOGOS stays empty
 * and BankLogo falls back to generic Icon name="bank".
 */

export interface BankInfo {
  code: string;
  name: string;
}

export const BANK_BIN_MAP: Record<string, BankInfo> = {
  "970436": { code: "vcb", name: "Vietcombank" },
  "970418": { code: "bidv", name: "BIDV" },
  "970415": { code: "vietinbank", name: "VietinBank" },
  "970405": { code: "agribank", name: "Agribank" },
  "970407": { code: "techcombank", name: "Techcombank" },
  "970422": { code: "mb", name: "MBBank" },
  "970416": { code: "acb", name: "ACB" },
  "970432": { code: "vpbank", name: "VPBank" },
  "970423": { code: "tpbank", name: "TPBank" },
  "970403": { code: "sacombank", name: "Sacombank" },
};

/** Codes of bank logos that actually exist in public/brand/banks/ (empty until Part B). */
export const AVAILABLE_BANK_LOGOS = new Set<string>();

/** Resolves the bank code for a known BIN, or null for unknown / missing. */
export function getBankCodeByBin(bin?: string | null): string | null {
  if (!bin) return null;
  const match = BANK_BIN_MAP[bin.trim()];
  return match ? match.code : null;
}

/** Resolves full BankInfo for a known BIN, or null. */
export function getBankInfoByBin(bin?: string | null): BankInfo | null {
  if (!bin) return null;
  return BANK_BIN_MAP[bin.trim()] ?? null;
}

/** Returns the asset path if an official file exists, else null. */
export function getBankLogoSrc(bin?: string | null): string | null {
  const code = getBankCodeByBin(bin);
  if (!code || !AVAILABLE_BANK_LOGOS.has(code)) return null;
  return `/brand/banks/${code}.png`;
}
