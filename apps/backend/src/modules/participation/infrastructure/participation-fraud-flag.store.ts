import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { currentClient } from '../../../common/database/prisma-unit-of-work';
import {
  PARTICIPATION_REPOSITORY_PORT,
  ParticipationRepositoryPort,
} from '../application/ports/participation-repository.port';
import { FraudFlagReadPort } from '../../rewards/application/ports/account-standing.port';
import {
  FraudFlagPort,
  RecordFlashAfterTopUpParams,
} from '../../rewards/application/ports/fraud-flag.port';

/**
 * FraudLog access for Rewards. Participation owns `fraud_logs`: writes reuse its
 * append-only `recordFraudLog` (dedupe key, `ON CONFLICT DO NOTHING`, root client
 * so a duplicate never aborts the redemption transaction).
 */
@Injectable()
export class ParticipationFraudFlagStore
  implements FraudFlagReadPort, FraudFlagPort
{
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PARTICIPATION_REPOSITORY_PORT)
    private readonly participation: ParticipationRepositoryPort,
  ) {}

  /** Any flag since `since` blocks, except the non-blocking FLASH_AFTER_TOPUP. */
  async hasBlockingFraudFlag(userId: string, since: Date): Promise<boolean> {
    const flag = await currentClient(this.prisma).fraudLog.findFirst({
      where: {
        userId,
        createdAt: { gte: since },
        type: { not: 'FLASH_AFTER_TOPUP' },
      },
      select: { id: true },
    });
    return flag !== null;
  }

  async recordFlashAfterTopUp(
    params: RecordFlashAfterTopUpParams,
  ): Promise<void> {
    await this.participation.recordFraudLog(
      params.userId,
      'FLASH_AFTER_TOPUP',
      { redemptionId: params.redemptionId, voucherId: params.voucherId },
      `flash-after-topup:${params.redemptionId}`,
    );
  }
}
