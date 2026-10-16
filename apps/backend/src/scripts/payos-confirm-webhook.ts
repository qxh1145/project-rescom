/**
 * Confirm live payOS webhook while checkout remains closed.
 * npx ts-node src/scripts/payos-confirm-webhook.ts
 * node dist/apps/backend/src/scripts/payos-confirm-webhook.js
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { EnvService } from '../common/config/env.service';
import {
  PAYMENT_PROVIDER_PORT,
  PaymentProviderPort,
} from '../modules/economy/application/ports/payment-provider.port';
import { webhookUrlFor } from './payos-probe-preflight';

dotenv.config();

async function main(): Promise<void> {
  for (const key of [
    'PAYOS_CLIENT_ID',
    'PAYOS_API_KEY',
    'PAYOS_CHECKSUM_KEY',
  ]) {
    if (!process.env[key]?.trim()) throw new Error(`${key} is missing`);
  }
  process.env.SCHEDULER_ENABLED = 'false';
  const { AppModule } = await import('../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const env = app.get(EnvService);
    const url =
      process.env.WEBHOOK_URL?.trim() || webhookUrlFor(env.emailAppBaseUrl);
    const result = await app
      .get<PaymentProviderPort>(PAYMENT_PROVIDER_PORT)
      .confirmWebhook(url);
    console.log('payOS webhook confirmed', result);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(
    'payOS confirm failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
