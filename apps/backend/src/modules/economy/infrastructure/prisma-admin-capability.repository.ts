import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { runInTransaction } from '../../../common/database/prisma-unit-of-work';
import {
  ActorCapability,
  AdminCapabilityPort,
} from '../application/ports/admin-capability.port';

/**
 * Reads the actor's current Identity role/status for financial Admin commands
 * (AD-16). `FOR SHARE` inside the ambient Unit of Work blocks a concurrent
 * demotion/lock (which takes `FOR UPDATE` on admin rows) until the decision
 * commits, so the capability cannot change mid-approval.
 */
@Injectable()
export class PrismaAdminCapabilityRepository implements AdminCapabilityPort {
  constructor(private readonly prisma: PrismaService) {}

  async findCurrentCapability(userId: string): Promise<ActorCapability | null> {
    return runInTransaction(this.prisma, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; role: string; status: string }>
      >`
        SELECT "id", "role"::text AS "role", "status"::text AS "status"
        FROM "users"
        WHERE "id" = ${userId}::uuid
        FOR SHARE
      `;
      const row = rows[0];
      return row
        ? { userId: row.id, role: row.role, status: row.status }
        : null;
    });
  }
}
