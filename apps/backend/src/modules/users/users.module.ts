import { Module } from '@nestjs/common';
import { USER_REPOSITORY_PORT } from './application/ports/user.repository.port';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';

@Module({
  providers: [
    {
      provide: USER_REPOSITORY_PORT,
      useClass: PrismaUserRepository,
    },
  ],
  exports: [USER_REPOSITORY_PORT],
})
export class UsersModule {}
