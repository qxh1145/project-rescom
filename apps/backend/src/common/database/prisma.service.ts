import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ImmutableAuditLogException } from '../../modules/admin/application/exceptions/audit-log.exceptions';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  // @Optional: Nest injects undefined at boot; tests pass explicit options.
  constructor(@Optional() options?: Prisma.PrismaClientOptions) {
    super(options);
    this.registerImmutabilityMiddleware();
  }

  private registerImmutabilityMiddleware() {
    this.$use(async (params, next) => {
      if (
        params.model === 'IdentityAuditLog' &&
        ['update', 'updateMany', 'delete', 'deleteMany', 'upsert'].includes(
          params.action,
        )
      ) {
        throw new ImmutableAuditLogException(params.action);
      }
      return next(params);
    });
  }

  async onModuleInit() {
    await this.$connect();
    await this.checkSessionTimeZone();
  }

  /**
   * Story IR.2b review: in `onApplicationShutdown`, i.e. after every
   * `onModuleDestroy` (the scheduler finishes its in-flight run and releases
   * its lease there), so the pool is never closed under a running job.
   */
  async onApplicationShutdown() {
    await this.$disconnect();
  }

  /**
   * The lease / claim / deadline SQL compares `timestamp` columns with
   * parameters; a non-UTC session time zone would shift them. Logged, not
   * fatal (set `?options=-c%20timezone%3DUTC` on DATABASE_URL to fix).
   */
  private async checkSessionTimeZone() {
    try {
      const [row] =
        await this.$queryRawUnsafe<Array<{ TimeZone: string }>>(
          'SHOW TimeZone',
        );
      const zone = row?.TimeZone;
      if (zone && !['UTC', 'Etc/UTC', 'GMT'].includes(zone)) {
        new Logger('PrismaService').error(
          `DB_SESSION_TIMEZONE_NOT_UTC ${JSON.stringify({ timeZone: zone })}: set ?options=-c%20timezone%3DUTC on DATABASE_URL`,
        );
      }
    } catch {
      // Best effort: a failed probe never blocks boot.
    }
  }
}
