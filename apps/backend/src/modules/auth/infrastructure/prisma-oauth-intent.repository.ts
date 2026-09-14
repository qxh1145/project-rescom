import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  OAuthIntentRepositoryPort,
  CreateOAuthIntentParams,
} from '../application/ports/oauth-intent-repository.port';
import { OAuthIntent } from '../domain/oauth-intent.entity';

@Injectable()
export class PrismaOAuthIntentRepository implements OAuthIntentRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async createIntent(intent: CreateOAuthIntentParams): Promise<void> {
    await this.prisma.oAuthIntent.create({
      data: {
        id: intent.id,
        flowType: intent.flowType,
        targetUserId: intent.targetUserId,
        stateDigest: intent.stateDigest,
        nonceDigest: intent.nonceDigest,
        browserBindingDigest: intent.browserBindingDigest,
        pkceVerifierEncrypted: intent.pkceVerifierEncrypted,
        expiresAt: intent.expiresAt,
        consumedAt: intent.consumedAt,
        failedAt: intent.failedAt,
        createdAt: intent.createdAt,
      },
    });
  }

  async findById(id: string): Promise<OAuthIntent | null> {
    const found = await this.prisma.oAuthIntent.findUnique({
      where: { id },
    });
    return found ? new OAuthIntent(found as any) : null;
  }

  async consumeIntent(
    id: string,
    now: Date = new Date(),
  ): Promise<OAuthIntent | null> {
    const updated = await this.prisma.oAuthIntent.updateMany({
      where: {
        id,
        consumedAt: null,
        failedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        consumedAt: now,
      },
    });

    if (updated.count === 0) {
      return null;
    }

    return this.findById(id);
  }

  async markFailed(id: string, now: Date = new Date()): Promise<void> {
    await this.prisma.oAuthIntent.updateMany({
      where: { id },
      data: {
        failedAt: now,
      },
    });
  }

  async invalidatePriorIntents(params: {
    browserBindingDigest?: string;
    targetUserId?: string;
  }): Promise<void> {
    const orConditions: any[] = [];
    if (params.browserBindingDigest) {
      orConditions.push({ browserBindingDigest: params.browserBindingDigest });
    }
    if (params.targetUserId) {
      orConditions.push({ targetUserId: params.targetUserId });
    }

    if (orConditions.length === 0) return;

    await this.prisma.oAuthIntent.updateMany({
      where: {
        OR: orConditions,
        consumedAt: null,
        failedAt: null,
      },
      data: {
        failedAt: new Date(),
      },
    });
  }

  async deleteExpired(now: Date = new Date()): Promise<number> {
    const res = await this.prisma.oAuthIntent.deleteMany({
      where: {
        expiresAt: { lte: now },
      },
    });
    return res.count;
  }
}
