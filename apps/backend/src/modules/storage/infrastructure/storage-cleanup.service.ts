import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { StorageService } from '../application/storage.service';

@Injectable()
export class StorageCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(private readonly storageService: StorageService) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => void this.storageService.cleanupExpired(),
      60 * 60 * 1000,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
