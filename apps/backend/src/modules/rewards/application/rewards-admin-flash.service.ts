import { randomUUID } from 'crypto';
import {
  adminFlashEndReasonSchema,
  AdminFlashSaleDto,
  AdminFlashSaleInputDto,
  adminFlashSaleInputSchema,
} from '@rescom/schemas';
import { z } from 'zod';

export type AdminFlashEndReason = z.infer<typeof adminFlashEndReasonSchema>;
import { UnitOfWorkPort } from '../../../common/database/unit-of-work.port';
import { AdminCapabilityPort } from '../../economy/application/ports/admin-capability.port';
import { AdminUserDirectoryPort } from '../../users/application/ports/admin-user-directory.port';
import { nextFlashSaleCode } from '../domain/flash-sale-code';
import {
  AdminFlashStatus,
  adminFlashStatus,
  flashConflicts,
  flashItemState,
  flashProgress,
} from '../domain/flash-sale-rules';
import { settlementPlan } from '../domain/flash-sale-settlement';
import {
  RewardsErrorCode,
  RewardsException,
} from './exceptions/rewards.exceptions';
import { FlashSaleRepositoryPort } from './ports/flash-sale-repository.port';
import { FlashSaleRecord } from './ports/flash-sale-read.port';
import {
  VoucherRecord,
  VoucherRepositoryPort,
} from './ports/voucher-repository.port';

export interface RewardsAdminFlashDependencies {
  flashSales?: FlashSaleRepositoryPort;
  flashRepo?: FlashSaleRepositoryPort;
  vouchers?: VoucherRepositoryPort;
  voucherRepo?: VoucherRepositoryPort;
  unitOfWork: UnitOfWorkPort;
  adminCapability: AdminCapabilityPort;
  userDirectory?: AdminUserDirectoryPort;
  now: () => Date;
  generateId?: () => string;
}

export class RewardsAdminFlashService {
  private readonly flashSales: FlashSaleRepositoryPort;
  private readonly vouchers: VoucherRepositoryPort;
  private readonly generateId: () => string;

  constructor(private readonly deps: RewardsAdminFlashDependencies) {
    this.flashSales = (deps.flashSales ?? deps.flashRepo)!;
    this.vouchers = (deps.vouchers ?? deps.voucherRepo)!;
    (deps as any).flashSales = this.flashSales;
    (deps as any).vouchers = this.vouchers;
    this.generateId = deps.generateId ?? randomUUID;
  }

  private async authorize(adminId: string): Promise<void> {
    const actor =
      await this.deps.adminCapability.findCurrentCapability(adminId);
    if (!actor || actor.role !== 'ADMIN' || actor.status !== 'ACTIVE') {
      throw new RewardsException(
        'REWARDS_ADMIN_CAPABILITY_REQUIRED',
        'Admin capability required',
      );
    }
  }

  private async formatRow(
    flash: FlashSaleRecord,
    vouchers: VoucherRecord[],
    nowMs: number,
    creatorName?: string,
  ): Promise<AdminFlashSaleDto> {
    const status = adminFlashStatus(flash, nowMs);
    const progress = flashProgress(flash, nowMs);
    const voucherMap = new Map(vouchers.map((v) => [v.id, v]));

    const items = flash.items.map((item, index) => {
      const voucher = voucherMap.get(item.voucherId);
      const regularPoints = voucher
        ? (voucher.promoPoints ?? voucher.basePoints)
        : item.flashPoints;
      const basePoints = voucher?.basePoints ?? item.flashPoints;
      const discountPercent =
        basePoints > 0
          ? Math.round((1 - item.flashPoints / basePoints) * 100)
          : 0;

      return {
        id: item.id,
        flashSaleId: item.flashSaleId,
        voucherId: item.voucherId,
        voucherTitle: voucher?.title ?? '',
        brand: voucher?.brand ?? { id: 'unknown', name: 'Unknown' },
        category: voucher?.category ?? ('COFFEE' as const),
        valueVnd: voucher?.valueVnd ?? 0,
        basePoints,
        regularPoints,
        flashPoints: item.flashPoints,
        quota: item.quota,
        sold: item.sold,
        perUserCap: item.perUserCap,
        discountPercent,
        state: flashItemState(flash, item, nowMs),
        unsold: item.quota - item.sold,
        pointsSpent: item.sold * item.flashPoints,
        soldOutAt: progress[index]?.soldOutAt ?? null,
        perMinute: progress[index]?.perMinute ?? 0,
        etaAt: progress[index]?.etaAt ?? null,
      };
    });

    const succeededCount = items.reduce((sum, item) => sum + item.sold, 0);
    const pointsSpent = items.reduce((sum, item) => sum + item.pointsSpent, 0);

    const stats = await this.flashSales.getMonitoringStats(
      flash.id,
      flash.items.map((i) => i.id),
      succeededCount,
    );

    let name = creatorName;
    if (!name && this.deps.userDirectory) {
      const labels = await this.deps.userDirectory.findLabels([
        flash.createdById,
      ]);
      const l = labels.get(flash.createdById);
      name = l?.displayName || l?.email;
    }

    return {
      id: flash.id,
      code: flash.code,
      title: flash.title,
      createdBy: {
        id: flash.createdById,
        name: name || 'Admin',
      },
      rules: {
        requireRecentSurvey: flash.rules?.requireRecentSurvey ?? false,
        blockFlagged: flash.rules?.blockFlagged ?? false,
        remindBefore10m: flash.rules?.remindBefore10m ?? false,
      },
      remindCount: 0,
      endReason: adminFlashEndReasonSchema.safeParse(flash.endReason).success
        ? (flash.endReason as AdminFlashEndReason)
        : null,
      succeededCount,
      participants: stats.participants,
      failures: stats.failures,
      afterTopUp: stats.afterTopUp,
      startsAt: flash.startsAt,
      endsAt: flash.endsAt,
      status,
      endedEarlyAt: flash.endedEarlyAt,
      items,
      pointsSpent,
    };
  }

  async list(adminId: string, query?: { status?: AdminFlashStatus }) {
    await this.authorize(adminId);
    const now = this.deps.now();
    const nowMs = now.getTime();
    const [flashes, vouchers] = await Promise.all([
      this.flashSales.list(),
      this.vouchers.list(),
    ]);

    const items = await Promise.all(
      flashes.map((f) => this.formatRow(f, vouchers, nowMs)),
    );

    const filtered = query?.status
      ? items.filter((f) => f.status === query.status)
      : items;

    const count = (s: AdminFlashStatus) =>
      items.filter((f) => f.status === s).length;

    return {
      items: filtered,
      summary: {
        active: count('ACTIVE'),
        upcoming: count('UPCOMING') + count('SCHEDULED'),
        scheduled: count('SCHEDULED'),
        soldOut: count('SOLD_OUT'),
        ended: count('ENDED'),
      },
      serverTime: now.toISOString(),
    };
  }

  async get(adminId: string, id: string) {
    await this.authorize(adminId);
    const now = this.deps.now();
    const [flash, vouchers] = await Promise.all([
      this.flashSales.findById(id),
      this.vouchers.list(),
    ]);
    if (!flash) {
      throw new RewardsException(
        'FLASH_SALE_NOT_FOUND',
        'Flash sale not found',
      );
    }

    const row = await this.formatRow(flash, vouchers, now.getTime());
    return { flashSale: row };
  }

  async create(
    arg1: string | AdminFlashSaleInputDto,
    arg2: string | { id: string; name?: string } | AdminFlashSaleInputDto,
    correlationId?: string,
  ) {
    const adminId =
      typeof arg1 === 'string'
        ? arg1
        : typeof arg2 === 'string'
          ? arg2
          : (arg2 as any)?.id;
    const rawInput = (
      typeof arg1 === 'string' ? arg2 : arg1
    ) as AdminFlashSaleInputDto;
    const adminName =
      typeof arg2 === 'object' && 'name' in (arg2 as any)
        ? (arg2 as any).name
        : undefined;

    await this.authorize(adminId);
    const input = adminFlashSaleInputSchema.parse(rawInput);
    const now = this.deps.now();
    const nowMs = now.getTime();

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.deps.unitOfWork.run(
          `rewards-admin-flash:create:${correlationId || randomUUID()}`,
          async () => {
            const voucherIds = [
              ...new Set(input.items.map((i) => i.voucherId)),
            ].sort();
            await this.flashSales.lockVouchers(voucherIds);

            const [vouchers, candidates, existingSales] = await Promise.all([
              Promise.all(voucherIds.map((id) => this.vouchers.findById(id))),
              this.flashSales.findOverlapCandidates(voucherIds),
              this.flashSales.list(),
            ]);

            const validVouchers = vouchers.filter(
              (v): v is NonNullable<typeof v> => v !== null,
            );

            const conflicts = flashConflicts(
              input,
              validVouchers,
              candidates,
              nowMs,
            );
            if (conflicts.length > 0) {
              throw new RewardsException(
                conflicts[0].code as RewardsErrorCode,
                conflicts[0].code,
                { conflicts },
              );
            }

            const code = nextFlashSaleCode(
              new Date(input.startsAt),
              existingSales.map((s) => s.code),
            );
            if (!code) {
              throw new RewardsException(
                'FLASH_CODE_EXHAUSTED',
                'Flash sale code limit reached for this day',
              );
            }

            const saleId = this.generateId();
            const created = await this.flashSales.insertSale({
              id: saleId,
              code,
              title: input.title,
              createdById: adminId,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              rules: {
                requireRecentSurvey: input.rules?.requireRecentSurvey ?? false,
                blockFlagged: input.rules?.blockFlagged ?? false,
                remindBefore10m: input.rules?.remindBefore10m ?? false,
              },
              items: input.items.map((item) => ({
                id: this.generateId(),
                voucherId: item.voucherId,
                flashPoints: item.flashPoints,
                quota: item.quota,
                perUserCap: item.perUserCap,
              })),
            });

            await this.flashSales.appendAudit({
              id: randomUUID(),
              idempotencyKey: `rewards:flash:${saleId}:created`,
              eventType: 'REWARDS_FLASH_SALE_CREATED',
              producer: 'rewards-admin-flash',
              aggregateType: 'FlashSale',
              aggregateId: saleId,
              aggregateVersion: 1,
              correlationId: correlationId || saleId,
              payload: {
                id: saleId,
                code,
                title: input.title,
                createdById: adminId,
              },
            });

            const row = await this.formatRow(
              created,
              validVouchers,
              nowMs,
              adminName,
            );
            return { flashSale: row };
          },
        );
      } catch (err: any) {
        const target = err?.meta?.target;
        const targetText = Array.isArray(target)
          ? target.join(',')
          : String(target ?? '');
        // Only a collision on the `code` column is retried (next free letter).
        if (err?.code === 'P2002' && targetText.includes('code')) continue;
        throw err;
      }
    }

    throw new RewardsException(
      'FLASH_CODE_EXHAUSTED',
      'Flash sale code could not be allocated, retry',
    );
  }

  async update(
    id: string,
    arg2: string | { id: string; name?: string } | AdminFlashSaleInputDto,
    arg3?: string | { id: string; name?: string } | AdminFlashSaleInputDto,
    correlationId?: string,
  ) {
    const adminId =
      typeof arg2 === 'string'
        ? arg2
        : typeof arg3 === 'string'
          ? arg3
          : ((arg3 as any)?.id ?? (arg2 as any)?.id);
    const rawInput = (
      typeof arg2 === 'object' && 'items' in (arg2 as any) ? arg2 : arg3
    ) as AdminFlashSaleInputDto;
    const adminName =
      typeof arg3 === 'object' && 'name' in (arg3 as any)
        ? (arg3 as any).name
        : typeof arg2 === 'object' && 'name' in (arg2 as any)
          ? (arg2 as any).name
          : undefined;

    await this.authorize(adminId);
    const input = adminFlashSaleInputSchema.parse(rawInput);
    const now = this.deps.now();
    const nowMs = now.getTime();

    return this.deps.unitOfWork.run(
      `rewards-admin-flash:update:${id}`,
      async () => {
        const existing = await this.flashSales.findById(id);
        if (!existing) {
          throw new RewardsException(
            'FLASH_SALE_NOT_FOUND',
            'Flash sale not found',
          );
        }

        if (nowMs >= Date.parse(existing.startsAt)) {
          throw new RewardsException(
            'FLASH_ALREADY_STARTED',
            'Flash sale has already started',
          );
        }

        const voucherIds = [
          ...new Set([
            ...existing.items.map((i) => i.voucherId),
            ...input.items.map((i) => i.voucherId),
          ]),
        ].sort();

        await this.flashSales.lockVouchers(voucherIds);

        // Re-read under the locks: the lifecycle job may have reserved meanwhile.
        const locked = await this.flashSales.findById(id);
        if (
          !locked ||
          locked.reservedAt !== null ||
          nowMs >= Date.parse(locked.startsAt)
        ) {
          throw new RewardsException(
            locked ? 'FLASH_ALREADY_STARTED' : 'FLASH_SALE_NOT_FOUND',
            locked ? 'Flash sale has already started' : 'Flash sale not found',
          );
        }

        const [vouchers, candidates] = await Promise.all([
          Promise.all(voucherIds.map((vId) => this.vouchers.findById(vId))),
          this.flashSales.findOverlapCandidates(voucherIds),
        ]);

        const validVouchers = vouchers.filter(
          (v): v is NonNullable<typeof v> => v !== null,
        );

        const conflicts = flashConflicts(
          input,
          validVouchers,
          candidates,
          nowMs,
          id,
        );
        if (conflicts.length > 0) {
          throw new RewardsException(
            conflicts[0].code as RewardsErrorCode,
            conflicts[0].code,
            { conflicts },
          );
        }

        const updated = await this.flashSales.updateSale(id, {
          title: input.title,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          rules: {
            requireRecentSurvey: input.rules?.requireRecentSurvey ?? false,
            blockFlagged: input.rules?.blockFlagged ?? false,
            remindBefore10m: input.rules?.remindBefore10m ?? false,
          },
          items: input.items.map((item) => {
            const old = existing.items.find(
              (i) => i.voucherId === item.voucherId,
            );
            return {
              id: old?.id ?? this.generateId(),
              voucherId: item.voucherId,
              flashPoints: item.flashPoints,
              quota: item.quota,
              perUserCap: item.perUserCap,
            };
          }),
        });

        await this.flashSales.appendAudit({
          id: randomUUID(),
          idempotencyKey: `rewards:flash:${id}:updated:${randomUUID()}`,
          eventType: 'REWARDS_FLASH_SALE_UPDATED',
          producer: 'rewards-admin-flash',
          aggregateType: 'FlashSale',
          aggregateId: id,
          aggregateVersion: 1,
          correlationId: correlationId || id,
          payload: {
            id,
            title: input.title,
            updatedById: adminId,
          },
        });

        const row = await this.formatRow(
          updated,
          validVouchers,
          nowMs,
          adminName,
        );
        return { flashSale: row };
      },
    );
  }

  async endEarly(id: string, arg2: any, arg3?: any, correlationId?: string) {
    const adminId =
      typeof arg2 === 'string'
        ? arg2
        : typeof arg3 === 'string'
          ? arg3
          : (arg3?.id ?? arg2?.id);
    const request = (typeof arg2 === 'string' ? arg3 : arg2) as {
      reason: AdminFlashEndReason;
      note?: string;
    };
    const adminName =
      typeof arg3 === 'object' && 'name' in arg3
        ? arg3.name
        : typeof arg2 === 'object' && 'name' in arg2
          ? arg2.name
          : undefined;

    await this.authorize(adminId);
    const now = this.deps.now();
    const nowMs = now.getTime();

    return this.deps.unitOfWork.run(
      `rewards-admin-flash:end:${id}`,
      async () => {
        const existing = await this.flashSales.findById(id);
        if (!existing) {
          throw new RewardsException(
            'FLASH_SALE_NOT_FOUND',
            'Flash sale not found',
          );
        }

        const voucherIds = [
          ...new Set(existing.items.map((i) => i.voucherId)),
        ].sort();
        await this.flashSales.lockVouchers(voucherIds);

        const current = await this.flashSales.findById(id);
        if (!current) {
          throw new RewardsException(
            'FLASH_SALE_NOT_FOUND',
            'Flash sale not found',
          );
        }

        const status = adminFlashStatus(current, nowMs);
        if (status !== 'ACTIVE') {
          throw new RewardsException(
            status === 'ENDED' ? 'FLASH_ALREADY_ENDED' : 'FLASH_NOT_ACTIVE',
            status === 'ENDED'
              ? 'Flash sale has already ended'
              : 'Flash sale is not active',
          );
        }

        const endedEarly = await this.flashSales.markEndedEarly(
          id,
          now,
          request.reason,
        );
        const marked =
          endedEarly &&
          (await this.flashSales.markSettled(id, now, request.reason));
        if (!marked) {
          throw new Error(`Failed to end flash sale ${id} early`);
        }

        for (const item of settlementPlan(current)) {
          if (item.unsold > 0) {
            const ok = await this.flashSales.adjustVoucherStock(
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

        await this.flashSales.appendAudit({
          id: randomUUID(),
          idempotencyKey: `rewards:flash:${id}:ended-early`,
          eventType: 'REWARDS_FLASH_SALE_ENDED_EARLY',
          producer: 'rewards-admin-flash',
          aggregateType: 'FlashSale',
          aggregateId: id,
          aggregateVersion: 1,
          correlationId: correlationId || id,
          payload: {
            id,
            reason: request.reason,
            endedEarlyAt: now.toISOString(),
            endedById: adminId,
          },
        });

        const refreshed = (await this.flashSales.findById(id))!;
        const vouchers = await Promise.all(
          voucherIds.map((vId) => this.vouchers.findById(vId)),
        );
        const validVouchers = vouchers.filter(
          (v): v is NonNullable<typeof v> => v !== null,
        );

        const row = await this.formatRow(
          refreshed,
          validVouchers,
          nowMs,
          adminName,
        );
        return { flashSale: row };
      },
    );
  }
}
