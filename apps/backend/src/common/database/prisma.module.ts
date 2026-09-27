import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { UNIT_OF_WORK_PORT } from './unit-of-work.port';
import { PrismaUnitOfWork } from './prisma-unit-of-work';

@Global()
@Module({
  providers: [
    PrismaService,
    {
      provide: UNIT_OF_WORK_PORT,
      useFactory: (prisma: PrismaService) => new PrismaUnitOfWork(prisma),
      inject: [PrismaService],
    },
  ],
  exports: [PrismaService, UNIT_OF_WORK_PORT],
})
export class PrismaModule {}
