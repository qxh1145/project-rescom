import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ImmutableAuditLogException } from '../../modules/admin/application/exceptions/audit-log.exceptions';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
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
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
