import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { StorageController } from './presentation/storage.controller';
import { StorageService } from './application/storage.service';
import {
  STORAGE_REPOSITORY_PORT,
  StorageRepositoryPort,
} from './application/ports/storage-repository.port';
import { PrismaStorageRepository } from './infrastructure/prisma-storage.repository';
import {
  OBJECT_STORAGE_PORT,
  ObjectStoragePort,
} from './application/ports/object-storage.port';
import { S3ObjectStorageService } from './infrastructure/s3-object-storage.service';
import {
  MALWARE_SCANNER_PORT,
  MalwareScannerPort,
} from './application/ports/malware-scanner.port';
import { ClamAvMalwareScannerService } from './infrastructure/clamav-malware-scanner.service';
import {
  STORAGE_OWNER_AUTHORIZATION_PORT,
  StorageOwnerAuthorizationPort,
} from './application/ports/storage-owner-authorization.port';
import { PrismaStorageOwnerAuthorizationService } from './infrastructure/prisma-storage-owner-authorization.service';
import { EnvService } from '../../common/config/env.service';
import { StorageCleanupService } from './infrastructure/storage-cleanup.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [StorageController],
  providers: [
    {
      provide: STORAGE_REPOSITORY_PORT,
      useClass: PrismaStorageRepository,
    },
    StorageCleanupService,
    {
      provide: OBJECT_STORAGE_PORT,
      useClass: S3ObjectStorageService,
    },
    {
      provide: MALWARE_SCANNER_PORT,
      useClass: ClamAvMalwareScannerService,
    },
    {
      provide: STORAGE_OWNER_AUTHORIZATION_PORT,
      useClass: PrismaStorageOwnerAuthorizationService,
    },
    S3ObjectStorageService,
    {
      provide: StorageService,
      useFactory: (
        storageRepo: StorageRepositoryPort,
        objectStorage: ObjectStoragePort,
        scanner: MalwareScannerPort,
        ownerAuthorization: StorageOwnerAuthorizationPort,
        envService: EnvService,
      ) =>
        new StorageService(
          storageRepo,
          objectStorage,
          scanner,
          ownerAuthorization,
          envService,
        ),
      inject: [
        STORAGE_REPOSITORY_PORT,
        OBJECT_STORAGE_PORT,
        MALWARE_SCANNER_PORT,
        STORAGE_OWNER_AUTHORIZATION_PORT,
        EnvService,
      ],
    },
  ],
  exports: [
    StorageService,
    STORAGE_REPOSITORY_PORT,
    OBJECT_STORAGE_PORT,
    MALWARE_SCANNER_PORT,
    STORAGE_OWNER_AUTHORIZATION_PORT,
    S3ObjectStorageService,
  ],
})
export class StorageModule {}
