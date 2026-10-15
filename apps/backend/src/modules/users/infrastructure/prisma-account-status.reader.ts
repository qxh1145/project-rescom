import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { currentClient } from '../../../common/database/prisma-unit-of-work';
import { AccountStatusPort } from '../../rewards/application/ports/account-standing.port';

/** Read-only `users.status` fact for Rewards eligibility (never creates rows). */
@Injectable()
export class PrismaAccountStatusReader implements AccountStatusPort {
  constructor(private readonly prisma: PrismaService) {}

  async isActive(userId: string): Promise<boolean> {
    const user = await currentClient(this.prisma).user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    return user?.status === 'ACTIVE';
  }
}
