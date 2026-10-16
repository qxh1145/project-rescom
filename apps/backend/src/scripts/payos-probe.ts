/**
 * Create one 10,000 VND live top-up without opening public checkout.
 * npx ts-node src/scripts/payos-probe.ts
 * node dist/apps/backend/src/scripts/payos-probe.js
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { payosTransferContent, topUpCreditKey } from '@rescom/schemas';
import { EnvService } from '../common/config/env.service';
import { PrismaService } from '../common/database/prisma.service';
import { PayosTopUpService } from '../modules/economy/application/payos-top-up.service';
import { PayosTopUpAlreadyProcessingException } from '../modules/economy/application/exceptions/economy.exceptions';
import {
  PAYMENT_PROVIDER_PORT,
  PaymentProviderPort,
} from '../modules/economy/application/ports/payment-provider.port';
import { redactPayosPayload } from '../modules/economy/application/payos-redact';
import { probePreflight, webhookUrlFor } from './payos-probe-preflight';

dotenv.config();

async function main(): Promise<void> {
  const reasons = probePreflight({
    credentials: process.env,
    payosEnabled: process.env.PAYOS_ENABLED === 'true',
    probeEmail: process.env.PROBE_USER_EMAIL,
  });
  if (reasons.length) throw new Error(reasons.join('; '));
  process.env.SCHEDULER_ENABLED = 'false';
  const { AppModule } = await import('../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const env = app.get(EnvService);
    if (env.payosEnabled)
      throw new Error(
        'PAYOS_ENABLED=true: close public checkout before probing',
      );
    const provider = app.get<PaymentProviderPort>(PAYMENT_PROVIDER_PORT);
    const confirmed = await provider.confirmWebhook(
      process.env.WEBHOOK_URL?.trim() || webhookUrlFor(env.emailAppBaseUrl),
    );
    console.log('payOS webhook confirmed', confirmed);
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findUnique({
      where: { email: process.env.PROBE_USER_EMAIL!.trim() },
    });
    if (!user || user.status !== 'ACTIVE')
      throw new Error('PROBE_USER_EMAIL must identify an ACTIVE user');
    const service = app.get(PayosTopUpService);
    let checkout;
    try {
      checkout = await service.checkout(user.id, { amountVnd: 10_000 });
    } catch (error) {
      if (error instanceof PayosTopUpAlreadyProcessingException)
        throw new Error(
          `Existing top-up ${error.topUpId}; cancel it in app or wait for expiry`,
        );
      throw error;
    }
    const { topUp, checkoutUrl } = checkout;
    console.log(
      `topUpId=${topUp.id} orderCode=${topUp.orderCode} amountVnd=${topUp.amountVnd} points=${topUp.points} checkoutUrl=${checkoutUrl} expiresAt=${topUp.expiresAt}`,
    );
    console.log('Pay 10,000 VND from Owner bank account within 5 minutes.');
    const deadline = new Date(topUp.expiresAt).getTime() + 120_000;
    let status = topUp.status;
    while (status === 'PROCESSING' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      try {
        status = (await service.getOwned(user.id, topUp.id)).status;
      } catch (error) {
        // A transient DB error after payment must not abort evidence capture.
        console.warn(
          'poll failed, retrying:',
          error instanceof Error ? error.message : error,
        );
      }
    }
    console.log(`status=${status}`);
    const journal = await prisma.ledgerJournal.findUnique({
      where: { idempotencyKey: topUpCreditKey(topUp.id) },
      include: { entries: true },
    });
    const pointsCredited = (journal?.entries ?? [])
      .filter((entry) => entry.amount > 0)
      .reduce((sum, entry) => sum + entry.amount, 0);
    console.log(
      `creditJournalExists=${journal !== null} pointsCredited=${pointsCredited}`,
    );
    try {
      printPaymentRecord(
        await provider.getPaymentRecord(topUp.orderCode),
        payosTransferContent(topUp.orderCode),
      );
    } catch (error) {
      console.error(
        'payOS GET failed:',
        error instanceof Error ? error.message : error,
      );
    }
    console.log(
      'Check webhook path: docker compose -f docker-compose.hostinger.yml --env-file .env.prod logs backend --since 15m | grep -E "payOS webhook (credited|capture)|SCHEDULER_JOB_RUN.*payos-reconcile"',
    );
    if (status !== 'SUCCESSFUL')
      throw new Error(
        status === 'PROCESSING'
          ? 'Probe timed out; check webhook/reconcile logs'
          : `Probe ended ${status}`,
      );
    if (!journal) throw new Error('SUCCESSFUL top-up has no credit journal');
  } finally {
    await app.close();
  }
}

function printPaymentRecord(raw: unknown, expectedDescription: string): void {
  console.log(
    'Redacted payOS GET:',
    JSON.stringify(redactPayosPayload(raw), null, 2),
  );
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.error('payOS GET did not return a payment record');
    return;
  }
  const record = raw as Record<string, unknown>;
  const transactions = Array.isArray(record.transactions)
    ? (record.transactions as Record<string, unknown>[])
    : [];
  console.log(
    `CHECK amount=${record.amount} amountPaid=${record.amountPaid} status=${record.status} transactions=${transactions.length}`,
  );
  console.log(
    `CHECK description=${record.description} expectedDescription=${expectedDescription} descriptionAccepted=${record.description === expectedDescription} descriptionLength=${expectedDescription.length}`,
  );
  for (const [index, tx] of transactions.entries()) {
    console.log(
      `CHECK transaction[${index}] transactionDateTime=${tx.transactionDateTime}`,
    );
    for (const key of [
      'counterAccountBankId',
      'counterAccountBankName',
      'counterAccountName',
      'counterAccountNumber',
    ])
      console.log(
        `CHECK transaction[${index}] ${key}Present=${tx[key] != null}`,
      );
  }
}

main().catch((error) => {
  console.error(
    'payOS probe failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
