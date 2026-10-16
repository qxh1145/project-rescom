import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PayosTopUpService } from '../application/payos-top-up.service';

@Controller(['economy/top-ups/payos', 'api/economy/top-ups/payos'])
export class PayosWebhookController {
  constructor(private readonly service: PayosTopUpService) {}
  // signature is the only auth; no cookie, no CSRF
  @Post('webhook')
  @HttpCode(200)
  @SkipThrottle({ default: true, auth: true })
  async webhook(@Body() body: unknown): Promise<{ received: true }> {
    await this.service.handleWebhook(body);
    return { received: true };
  }
}
