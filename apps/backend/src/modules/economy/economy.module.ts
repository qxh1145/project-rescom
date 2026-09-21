import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module';
import { AuthModule } from '../auth/auth.module';
import {
  LEDGER_REPOSITORY_PORT,
  LedgerRepositoryPort,
} from './application/ports/ledger-repository.port';
import { PrismaLedgerRepository } from './infrastructure/prisma-ledger.repository';
import { LedgerService } from './application/ledger.service';
import { LedgerController } from './presentation/ledger.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [LedgerController],
  providers: [
    {
      provide: LEDGER_REPOSITORY_PORT,
      useClass: PrismaLedgerRepository,
    },
    {
      provide: LedgerService,
      useFactory: (repo: LedgerRepositoryPort) => new LedgerService(repo),
      inject: [LEDGER_REPOSITORY_PORT],
    },
  ],
  exports: [LedgerService, LEDGER_REPOSITORY_PORT],
})
export class EconomyModule {}
