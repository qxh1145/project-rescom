import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { EnvService } from '../../../common/config/env.service';

@Injectable()
export class RewardsEnabledGuard implements CanActivate {
  constructor(private readonly env: EnvService) {}

  canActivate(): boolean {
    if (!this.env.rewardsEnabled) throw new NotFoundException();
    return true;
  }
}
