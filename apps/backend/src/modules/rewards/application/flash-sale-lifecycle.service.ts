import { randomUUID } from 'crypto';
import { JobLogger } from '../../../common/scheduler/scheduled-job';
import { UnitOfWorkPort } from '../../../common/database/unit-of-work.port';
import {
  isReserveDue,
  isSettleDue,
  reservationPlan,
  settlementPlan,
} from '../domain/flash-sale-settlement';
import { FlashSaleRepositoryPort } from './ports/flash-sale-repository.port';
import { VoucherRepositoryPort } from './ports/voucher-repository.port';

export interface FlashSaleLifecycleDependencies {
  flashSales: FlashSaleRepositoryPort;
  vouchers: VoucherRepositoryPort;
  unitOfWork: UnitOfWorkPort;
}

export class FlashSaleLifecycleService {
  constructor(private readonly deps: FlashSaleLifecycleDependencies) {}

  async runDue(
    now: Date,
    limit = 20,
    logger?: JobLogger,
  ): Promise<{
    reserved: number;
    settled: number;
    reservationFailed: number;
    errored: number;
  }> {
    let errored = 0;
    let settled = 0;
    let reserved = 0;
    let reservationFailed = 0;

    // 1. Settle first: returned stock is visible to a same-run reservation
    const dueToSettle = await this.deps.flashSales.findDueForSettle(now, limit);
    for (const sale of dueToSettle) {
      try {
        const didSettle = await this.deps.unitOfWork.run(
          `flash-sale:${sale.id}:settle`,
          async () => {
            const voucherIds = [
              ...new Set(sale.items.map((i) => i.voucherId)),
            ].sort();
            await this.deps.flashSales.lockVouchers(voucherIds);

            const current = await this.deps.flashSales.findById(sale.id);
            if (!current) return false;

            const isPastEnd = now.getTime() >= Date.parse(current.endsAt);
            const wasNeverReserved = current.reservedAt === null;

            if (wasNeverReserved && isPastEnd && current.settledAt === null) {
              return this.deps.flashSales.markSettled(
                current.id,
                now,
                current.endReason ?? 'ENDED',
              );
            }

            if (!isSettleDue(current, now)) {
              return false;
            }

            const marked = await this.deps.flashSales.markSettled(
              current.id,
              now,
              current.endReason ??
                (current.items.every((it) => it.sold >= it.quota)
                  ? 'SOLD_OUT'
                  : 'ENDED'),
            );
            if (!marked) {
              return false;
            }

            const plan = settlementPlan(current);
            for (const item of plan) {
              if (item.unsold > 0) {
                const ok = await this.deps.flashSales.adjustVoucherStock(
                  item.voucherId,
                  item.unsold,
                );
                if (!ok) {
                  throw new Error(
                    `Failed to return unsold stock ${item.unsold} to voucher ${item.voucherId}`,
                  );
                }
              }
            }

            await this.deps.flashSales.appendAudit({
              id: randomUUID(),
              idempotencyKey: `rewards:flash:${current.id}:settled`,
              eventType: 'REWARDS_FLASH_SALE_SETTLED',
              producer: 'rewards-flash-sale-lifecycle',
              aggregateType: 'FlashSale',
              aggregateId: current.id,
              aggregateVersion: 1,
              correlationId: current.id,
              payload: {
                flashSaleId: current.id,
                settledAt: now.toISOString(),
                returnedQuota: plan.reduce((s, p) => s + p.unsold, 0),
              },
            });

            return true;
          },
        );
        if (didSettle) settled++;
      } catch (err) {
        // One failing sale must not stop the batch; retried next run
        errored++;
        logger?.error(
          `flash sale ${sale.id} settle failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 2. Reserve second
    const dueToReserve = await this.deps.flashSales.findDueForReserve(
      now,
      limit,
    );
    for (const sale of dueToReserve) {
      try {
        const result = await this.deps.unitOfWork.run(
          `flash-sale:${sale.id}:reserve`,
          async () => {
            const voucherIds = [
              ...new Set(sale.items.map((i) => i.voucherId)),
            ].sort();
            await this.deps.flashSales.lockVouchers(voucherIds);

            const current = await this.deps.flashSales.findById(sale.id);
            if (!current) return null;
            if (!isReserveDue(current, now)) return null;

            const vouchers = await Promise.all(
              voucherIds.map((id) => this.deps.vouchers.findById(id)),
            );
            const validVouchers = vouchers.filter(
              (v): v is NonNullable<typeof v> => v !== null,
            );

            const plan = reservationPlan(current, validVouchers);
            if (!plan.ok) {
              const cancelled =
                await this.deps.flashSales.markReservationFailed(
                  current.id,
                  now,
                );
              if (!cancelled) {
                throw new Error(
                  `Failed to cancel unreservable flash sale ${current.id}`,
                );
              }
              await this.deps.flashSales.appendAudit({
                id: randomUUID(),
                idempotencyKey: `rewards:flash:${current.id}:reservation-failed`,
                eventType: 'REWARDS_FLASH_RESERVATION_FAILED',
                producer: 'rewards-flash-sale-lifecycle',
                aggregateType: 'FlashSale',
                aggregateId: current.id,
                aggregateVersion: 1,
                correlationId: current.id,
                payload: {
                  flashSaleId: current.id,
                  failedAt: now.toISOString(),
                  shortVoucherIds: plan.shortVoucherIds,
                },
              });
              return 'failed' as const;
            }

            for (const item of plan.perVoucher) {
              const ok = await this.deps.flashSales.adjustVoucherStock(
                item.voucherId,
                -item.quota,
              );
              if (!ok) {
                throw new Error(
                  `Failed to deduct quota ${item.quota} from voucher ${item.voucherId}`,
                );
              }
            }

            const marked = await this.deps.flashSales.markReserved(
              current.id,
              now,
            );
            if (!marked) {
              throw new Error(
                `Failed to mark reserved on flash sale ${current.id}`,
              );
            }

            await this.deps.flashSales.appendAudit({
              id: randomUUID(),
              idempotencyKey: `rewards:flash:${current.id}:started`,
              eventType: 'REWARDS_FLASH_SALE_STARTED',
              producer: 'rewards-flash-sale-lifecycle',
              aggregateType: 'FlashSale',
              aggregateId: current.id,
              aggregateVersion: 1,
              correlationId: current.id,
              payload: {
                flashSaleId: current.id,
                startedAt: now.toISOString(),
                reservedQuota: plan.perVoucher.reduce((s, p) => s + p.quota, 0),
              },
            });

            return 'reserved' as const;
          },
        );
        if (result === 'reserved') reserved++;
        else if (result === 'failed') reservationFailed++;
      } catch (err) {
        // One failing sale must not stop the batch; retried next run
        errored++;
        logger?.error(
          `flash sale ${sale.id} reserve failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { reserved, settled, reservationFailed, errored };
  }
}
