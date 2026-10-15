import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { currentClient } from '../../../common/database/prisma-unit-of-work';
import { AccountFundingPort } from '../../rewards/application/ports/account-standing.port';

/** Read-only Economy facts for Rewards eligibility (never creates rows). */
@Injectable()
export class PrismaAccountFundingReader implements AccountFundingPort {
  constructor(private readonly prisma: PrismaService) {}

  /** Activated = the `starter-unlock:{userId}` journal exists. */
  async isActivated(userId: string): Promise<boolean> {
    const unlockJournal = await currentClient(
      this.prisma,
    ).ledgerJournal.findUnique({
      where: { idempotencyKey: `starter-unlock:${userId}` },
      select: { id: true },
    });
    return unlockJournal !== null;
  }

  async hasApprovedTopUpSince(userId: string, since: Date): Promise<boolean> {
    const topUp = await currentClient(this.prisma).topUpRequest.findFirst({
      where: { userId, status: 'APPROVED', reviewedAt: { gte: since } },
      select: { id: true },
    });
    return topUp !== null;
  }
}
