import {
  RedemptionRepositoryPort,
  RedemptionQuoteRecord,
  RedemptionRecord,
  ClaimedVoucherCode,
} from '../application/ports/redemption-repository.port';

export class InMemoryRedemptionRepository implements RedemptionRepositoryPort {
  readonly quotes = new Map<string, RedemptionQuoteRecord>();
  readonly redemptions = new Map<string, RedemptionRecord>();
  readonly codes = new Map<
    string,
    { id: string; voucherId: string; code: string; redemptionId: string | null }
  >();
  dailyPointsLimit = 500;

  async insertQuote(
    quote: RedemptionQuoteRecord,
  ): Promise<RedemptionQuoteRecord> {
    this.quotes.set(quote.id, structuredClone(quote));
    return structuredClone(quote);
  }

  async findQuoteById(id: string): Promise<RedemptionQuoteRecord | null> {
    const q = this.quotes.get(id);
    return q ? structuredClone(q) : null;
  }

  async findRedemptionByUserAndKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<RedemptionRecord | null> {
    for (const r of this.redemptions.values()) {
      if (r.userId === userId && r.idempotencyKey === idempotencyKey) {
        return structuredClone(r);
      }
    }
    return null;
  }

  async findSucceededRedemptionByQuoteId(
    quoteId: string,
  ): Promise<RedemptionRecord | null> {
    for (const r of this.redemptions.values()) {
      if (r.quoteId === quoteId && r.status === 'SUCCEEDED') {
        return structuredClone(r);
      }
    }
    return null;
  }

  async insertRedemption(
    redemption: RedemptionRecord,
  ): Promise<RedemptionRecord> {
    for (const r of this.redemptions.values()) {
      const target =
        r.reference === redemption.reference
          ? ['reference']
          : r.userId === redemption.userId &&
              r.idempotencyKey === redemption.idempotencyKey
            ? ['user_id', 'idempotency_key']
            : redemption.status === 'SUCCEEDED' &&
                r.status === 'SUCCEEDED' &&
                r.quoteId !== null &&
                r.quoteId === redemption.quoteId
              ? ['quote_id']
              : null;
      if (target) {
        // Same shape as Prisma's P2002 so services see one error contract.
        throw Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target },
        });
      }
    }
    this.redemptions.set(redemption.id, structuredClone(redemption));
    return structuredClone(redemption);
  }

  async claimCode(voucherId: string): Promise<ClaimedVoucherCode | null> {
    for (const code of this.codes.values()) {
      if (code.voucherId === voucherId && code.redemptionId === null) {
        return {
          id: code.id,
          code: code.code,
        };
      }
    }
    return null;
  }

  async linkCodeToRedemption(
    codeId: string,
    redemptionId: string,
  ): Promise<void> {
    const code = this.codes.get(codeId);
    if (code) {
      code.redemptionId = redemptionId;
    }
  }

  async findCodeById(id: string): Promise<ClaimedVoucherCode | null> {
    const code = this.codes.get(id);
    if (!code) return null;
    return { id: code.id, code: code.code };
  }

  async countVoucherRedemptionsInWindow(
    userId: string,
    voucherId: string,
    since: Date,
  ): Promise<number> {
    let count = 0;
    const sinceMs = since.getTime();
    for (const r of this.redemptions.values()) {
      if (
        r.userId === userId &&
        r.voucherId === voucherId &&
        r.status === 'SUCCEEDED' &&
        new Date(r.createdAt).getTime() >= sinceMs
      ) {
        count++;
      }
    }
    return count;
  }

  async countTodayRedeemedPoints(
    userId: string,
    startOfDay: Date,
    endOfDay: Date,
  ): Promise<number> {
    let total = 0;
    const startMs = startOfDay.getTime();
    const endMs = endOfDay.getTime();
    for (const r of this.redemptions.values()) {
      const createdMs = new Date(r.createdAt).getTime();
      if (
        r.userId === userId &&
        r.status === 'SUCCEEDED' &&
        createdMs >= startMs &&
        createdMs < endMs
      ) {
        total += r.pricePoints;
      }
    }
    return total;
  }

  async countFlashItemRedemptionsForUser(
    userId: string,
    flashSaleItemId: string,
  ): Promise<number> {
    let count = 0;
    for (const r of this.redemptions.values()) {
      if (
        r.userId === userId &&
        r.flashSaleItemId === flashSaleItemId &&
        r.status === 'SUCCEEDED'
      ) {
        count++;
      }
    }
    return count;
  }

  async getDailyPointsLimit(): Promise<number> {
    return this.dailyPointsLimit;
  }

  async setDailyPointsLimit(limit: number): Promise<void> {
    this.dailyPointsLimit = limit;
  }
}
