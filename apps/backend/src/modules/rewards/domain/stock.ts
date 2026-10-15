import { VoucherInventory, VoucherStock } from './voucher.entity';

export function stockAdjustmentDecision(
  voucher: Pick<VoucherInventory, 'isSharedCode'>,
  stock: VoucherStock,
  nextTotal: number,
) {
  if (nextTotal < stock.issued + stock.flashReserved)
    return {
      ok: false as const,
      status: 409,
      code: 'STOCK_BELOW_COMMITTED',
      details: { minimum: stock.issued + stock.flashReserved },
    };
  if (nextTotal > stock.total && !voucher.isSharedCode)
    return {
      ok: false as const,
      status: 409,
      code: 'STOCK_INCREASE_NEEDS_CODES',
    };
  const removeCodes = stock.total - nextTotal;
  if (!voucher.isSharedCode && removeCodes > stock.codesAvailable)
    return { ok: false as const, status: 409, code: 'STOCK_EXCEEDS_CODES' };
  return { ok: true as const, removeCodes };
}

/** Stored codes belong to current voucher only; commit remains caller's atomic responsibility. */
export function importCodesDecision(codes: string[], stored: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const storedSet = new Set(stored);
  const already = new Set<string>();
  for (const raw of codes) {
    const code = raw.trim();
    if (seen.has(code)) duplicates.add(code);
    if (storedSet.has(code)) already.add(code);
    seen.add(code);
  }
  return {
    received: codes.length,
    accepted: duplicates.size || already.size ? 0 : codes.length,
    duplicatesInFile: [...duplicates],
    alreadyStored: [...already],
    committed: false,
  };
}
