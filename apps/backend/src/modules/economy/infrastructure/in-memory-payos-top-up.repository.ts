import {
  CreateProcessingResult,
  PayosTopUp,
  PayosTopUpRepositoryPort,
  TopUpStatusEvent,
} from '../application/ports/payos-top-up-repository.port';

export class InMemoryPayosTopUpRepository implements PayosTopUpRepositoryPort {
  readonly rows = new Map<string, PayosTopUp>();
  readonly events: TopUpStatusEvent[] = [];
  manualPending = 0;
  private nextCode = 1_000_000_000;
  async createProcessing(
    input: Pick<
      PayosTopUp,
      'id' | 'userId' | 'amountVnd' | 'points' | 'expiresAt' | 'createdAt'
    >,
    options: { limit: number; windowMs: number; now: Date },
  ): Promise<CreateProcessingResult> {
    const rows = [...this.rows.values()].filter(
      (row) => row.userId === input.userId,
    );
    const existing = rows.find((row) => row.status === 'PROCESSING');
    if (existing) return { outcome: 'ALREADY_PROCESSING', topUp: existing };
    const recent = rows
      .filter(
        (row) =>
          row.createdAt.getTime() > options.now.getTime() - options.windowMs,
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (recent.length >= options.limit)
      return {
        outcome: 'RATE_LIMITED',
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            (recent[0].createdAt.getTime() +
              options.windowMs -
              options.now.getTime()) /
              1000,
          ),
        ),
      };
    const row: PayosTopUp = {
      ...input,
      orderCode: this.nextCode++,
      status: 'PROCESSING',
      paymentLinkId: null,
      checkoutUrl: null,
      cancelledAt: null,
      paidAt: null,
    };
    this.rows.set(row.id, row);
    return { outcome: 'CREATED', topUp: row };
  }
  async attachPaymentLink(
    id: string,
    link: { paymentLinkId: string; checkoutUrl: string },
  ): Promise<PayosTopUp> {
    const row = this.rows.get(id)!;
    if (!row.paymentLinkId) Object.assign(row, link);
    return row;
  }
  async markCancelled(
    id: string,
    cancelledAt: Date,
    event: TopUpStatusEvent | null,
  ): Promise<{ changed: boolean; topUp: PayosTopUp }> {
    const row = this.rows.get(id)!;
    if (row.status !== 'PROCESSING') return { changed: false, topUp: row };
    row.status = 'CANCELLED';
    row.cancelledAt = cancelledAt;
    if (event) this.events.push(event);
    return { changed: true, topUp: row };
  }
  async findOwned(id: string, userId: string): Promise<PayosTopUp | null> {
    const row = this.rows.get(id);
    return row?.userId === userId ? row : null;
  }
  async countManualPending(): Promise<number> {
    return this.manualPending;
  }
}
