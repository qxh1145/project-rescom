import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { PayosAvailability } from '../application/payos-availability';

@Injectable()
export class PayosCheckoutEnabledGuard implements CanActivate {
  constructor(private readonly availability: PayosAvailability) {}
  canActivate(): boolean {
    if (!this.availability.isCheckoutOpen()) throw new NotFoundException();
    return true;
  }
}

@Injectable()
export class ManualCheckoutEnabledGuard implements CanActivate {
  constructor(private readonly availability: PayosAvailability) {}
  canActivate(): boolean {
    if (this.availability.isCheckoutOpen()) throw new NotFoundException();
    return true;
  }
}
