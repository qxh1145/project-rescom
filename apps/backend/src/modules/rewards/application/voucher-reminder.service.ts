import { randomUUID } from 'crypto';
import { TicketWritePort } from './ports/ticket-write.port';
import { VoucherRepositoryPort } from './ports/voucher-repository.port';
import { UnitOfWorkPort } from '../../../common/database/unit-of-work.port';
import { dueReminderWindow } from '../domain/reminder-plan';

export interface VoucherReminderServiceDependencies {
  ticketWrite: TicketWritePort;
  vouchers: VoucherRepositoryPort;
  unitOfWork: UnitOfWorkPort;
}

export class VoucherReminderService {
  constructor(private readonly deps: VoucherReminderServiceDependencies) {}

  async runDue(
    now: Date,
    limit: number,
    logger?: { error: (msg: string, ...args: any[]) => void },
  ): Promise<{ emitted: number; skipped: number; errored: number }> {
    let emitted = 0;
    let skipped = 0;
    let errored = 0;

    const candidates = await this.deps.ticketWrite.findReminderCandidates(
      now,
      limit,
    );

    for (const candidate of candidates) {
      try {
        const window = dueReminderWindow(
          {
            status: 'SUCCEEDED',
            used: false,
            refunded: false,
            redeemedAt: candidate.redeemedAt,
            expiresAt: candidate.expiresAt,
          },
          now.getTime(),
        );

        if (!window) {
          skipped++;
          continue;
        }

        const inserted = await this.deps.unitOfWork.run(
          `voucher-reminder:${candidate.redemptionId}:${window}`,
          async () => {
            const locked = await this.deps.ticketWrite.lockRedemption(
              candidate.redemptionId,
            );
            if (
              !locked ||
              dueReminderWindow(
                {
                  status: locked.status,
                  used: !!locked.usedAt,
                  refunded: locked.refunded,
                  redeemedAt: locked.createdAt,
                  expiresAt: locked.codeExpiresAt,
                },
                now.getTime(),
              ) !== window
            ) {
              return false;
            }
            const recorded = await this.deps.ticketWrite.recordReminderSent(
              candidate.redemptionId,
              window,
              now,
            );

            if (!recorded) {
              return false;
            }

            await this.deps.vouchers.appendAudit({
              id: randomUUID(),
              idempotencyKey: `rewards:voucher-reminder:${candidate.redemptionId}:${window}`,
              eventType: 'REWARDS_VOUCHER_EXPIRY_REMINDER',
              producer: 'voucher-reminder-service',
              aggregateType: 'Redemption',
              aggregateId: candidate.redemptionId,
              aggregateVersion: 1,
              correlationId: randomUUID(),
              payload: {
                redemptionId: candidate.redemptionId,
                userId: candidate.userId,
                voucherId: candidate.voucherId,
                window,
                expiresAt: new Date(candidate.expiresAt).toISOString(),
              },
            });

            return true;
          },
        );

        if (inserted) {
          emitted++;
        } else {
          skipped++;
        }
      } catch (err) {
        errored++;
        logger?.error(
          `Failed to process voucher expiry reminder for redemption ${candidate.redemptionId}`,
          err,
        );
      }
    }

    return { emitted, skipped, errored };
  }
}
