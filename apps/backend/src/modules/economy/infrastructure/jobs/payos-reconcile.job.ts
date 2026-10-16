import { PAYOS_RECONCILE_JOB } from '../../../../common/scheduler/scheduler.constants';
import {
  JobRunContext,
  JobRunSummary,
  ScheduledJob,
  assertNotAllFailed,
} from '../../../../common/scheduler/scheduled-job';
import {
  TopUpAdminAlertCondition,
  TOP_UP_MISMATCH_SLA_BUSINESS_DAYS,
  addBusinessDays,
} from '@rescom/schemas';
import {
  PaymentProviderPort,
  PaymentProviderUnavailableError,
  ProviderPaymentSnapshot,
} from '../../application/ports/payment-provider.port';
import {
  PayosTopUp,
  PayosTopUpRepositoryPort,
} from '../../application/ports/payos-top-up-repository.port';
import { PayosTopUpService } from '../../application/payos-top-up.service';
import {
  TopUpAdminAlertDetails,
  TopUpAdminAlerts,
} from '../../application/top-up-admin-alerts';

export type PayosReconcileService = Pick<
  PayosTopUpService,
  'applySnapshot' | 'expireTopUp' | 'closeFromProvider'
>;

/**
 * Story 13.5 Task 5: PayOS reconciliation job (AC 1, 2, 4, 7).
 * Scans PROCESSING, AMOUNT_MISMATCH, and CANCELLED/EXPIRED rows within 24h.
 * Reconciles status with payOS provider and raises deduplicated alerts.
 */
export class PayosReconcileJob implements ScheduledJob {
  readonly name = PAYOS_RECONCILE_JOB.name;
  readonly intervalMs = PAYOS_RECONCILE_JOB.intervalMs;
  readonly leaseTtlMs = PAYOS_RECONCILE_JOB.leaseTtlMs;

  private cursor: string | undefined;
  private consecutiveAllFailedRuns = 0;
  private episodeStartedAt: Date | null = null;

  constructor(
    private readonly service: PayosReconcileService,
    private readonly repository: Pick<
      PayosTopUpRepositoryPort,
      'listReconcileCandidates' | 'findPayosById'
    >,
    private readonly provider: PaymentProviderPort,
    private readonly alerts: TopUpAdminAlerts,
    // ponytail: id-cursor sweep; add per-row lastCheckedAt priority if candidates routinely exceed 200/min.
    private readonly maxBatches = 4,
    private readonly batchSize: number = PAYOS_RECONCILE_JOB.batchSize,
  ) {}

  private async raiseAlert(
    ctx: JobRunContext,
    counts: Record<string, number>,
    condition: TopUpAdminAlertCondition,
    subject: string,
    details?: TopUpAdminAlertDetails,
  ): Promise<void> {
    try {
      if (await this.alerts.raise(condition, subject, details)) {
        counts.alertsRaisedCount++;
      }
    } catch (alertErr) {
      ctx.logger.error(`Alert ${condition} failed for ${subject}: ${alertErr}`);
    }
  }

  /** Expires the row; best-effort provider cancel only when this call applied the expiry. */
  private async expireRow(
    ctx: JobRunContext,
    counts: Record<string, number>,
    row: PayosTopUp,
  ): Promise<boolean> {
    try {
      const res = await this.service.expireTopUp(row.id, ctx.now);
      if (res.outcome !== 'APPLIED') return false;
      counts.expiredCount++;
      await this.provider
        .cancelPayment(row.orderCode, 'Hết hạn')
        .catch((cancelErr) => {
          ctx.logger.warn(
            `Failed best-effort cancel for expired order ${row.orderCode}: ${cancelErr}`,
          );
        });
      return true;
    } catch (err) {
      counts.failedCount++;
      ctx.logger.error(`expireTopUp failed for ${row.id}: ${err}`);
      return false;
    }
  }

  async run(ctx: JobRunContext): Promise<JobRunSummary> {
    const counts: Record<string, number> = {
      scannedCount: 0,
      creditedCount: 0,
      mismatchCount: 0,
      expiredCount: 0,
      closedCount: 0,
      providerFailedCount: 0,
      failedCount: 0,
      alertsRaisedCount: 0,
    };

    let after = this.cursor;
    let hasMore = false;
    let providerAttempted = 0;
    let providerFailed = 0;
    let anyProviderSuccess = false;
    let stoppedEarly = false;

    for (let batch = 0; batch < this.maxBatches; batch++) {
      if (batch > 0 && !(await ctx.shouldContinue())) {
        stoppedEarly = true;
        hasMore = true;
        break;
      }

      const rows: PayosTopUp[] = await this.repository.listReconcileCandidates({
        now: ctx.now,
        after,
        limit: this.batchSize,
      });

      if (rows.length === 0) {
        hasMore = false;
        after = undefined;
        break;
      }

      hasMore = rows.length === this.batchSize;

      for (const row of rows) {
        if (!(await ctx.shouldContinue())) {
          stoppedEarly = true;
          hasMore = true;
          break;
        }

        counts.scannedCount++;

        try {
          let snapshot: ProviderPaymentSnapshot | null = null;

          try {
            providerAttempted++;
            snapshot = await this.provider.getPayment(
              row.orderCode,
              row.amountVnd,
            );
            anyProviderSuccess = true;
          } catch (err) {
            providerFailed++;
            counts.providerFailedCount++;
            if (err instanceof PaymentProviderUnavailableError) {
              if (row.status === 'PROCESSING' && row.expiresAt <= ctx.now) {
                await this.expireRow(ctx, counts, row);
              }

              if (
                row.status === 'AMOUNT_MISMATCH' &&
                row.paidAt &&
                ctx.now.getTime() >=
                  addBusinessDays(
                    row.paidAt,
                    TOP_UP_MISMATCH_SLA_BUSINESS_DAYS,
                  ).getTime()
              ) {
                await this.raiseAlert(
                  ctx,
                  counts,
                  'MISMATCH_SLA_BREACHED',
                  row.id,
                  {
                    topUpId: row.id,
                    orderCode: row.orderCode,
                    amountVnd: row.amountVnd,
                    amountPaidVnd: row.amountPaidVnd ?? undefined,
                  },
                );
              }
            } else {
              counts.failedCount++;
              ctx.logger.error(
                `Unexpected provider error for order ${row.orderCode}: ${err}`,
              );
            }
            after = row.id;
            continue;
          }

          let postStatus = row.status;

          if (
            snapshot.effect === 'CREDIT' ||
            snapshot.effect === 'AMOUNT_MISMATCH' ||
            row.status !== 'PROCESSING'
          ) {
            // Non-PROCESSING rows (CANCELLED, EXPIRED, AMOUNT_MISMATCH) always go through applySnapshot.
            try {
              const res = await this.service.applySnapshot(row.id, snapshot);
              if (res.outcome === 'APPLIED') {
                if (snapshot.effect === 'CREDIT') {
                  counts.creditedCount++;
                  postStatus = 'SUCCESSFUL';
                } else {
                  counts.mismatchCount++;
                  postStatus = 'AMOUNT_MISMATCH';
                }
              } else {
                // A concurrent webhook/recheck may already have moved the row.
                postStatus =
                  (await this.repository.findPayosById(row.id))?.status ??
                  postStatus;
              }
            } catch (err) {
              counts.failedCount++;
              ctx.logger.error(`applySnapshot failed for ${row.id}: ${err}`);
            }
          } else if (row.status === 'PROCESSING') {
            if (
              (snapshot.effect === 'CANCELLED' ||
                snapshot.effect === 'EXPIRED') &&
              row.expiresAt > ctx.now
            ) {
              try {
                const res = await this.service.closeFromProvider(
                  row.id,
                  snapshot.effect,
                  ctx.now,
                );
                if (res.outcome === 'APPLIED') {
                  counts.closedCount++;
                  postStatus = snapshot.effect;
                }
              } catch (err) {
                counts.failedCount++;
                ctx.logger.error(
                  `closeFromProvider failed for ${row.id}: ${err}`,
                );
              }
            } else if (
              row.expiresAt <= ctx.now &&
              (await this.expireRow(ctx, counts, row))
            ) {
              // C1: an expired row closed at the provider is still locally EXPIRED.
              postStatus = 'EXPIRED';
            }
          }

          // Step 4: Alerts
          // 4a. UNCREDITED_AFTER_PAYMENT
          if (snapshot.effect === 'CREDIT' && postStatus !== 'SUCCESSFUL') {
            const paidInstant =
              snapshot.facts.paidAt ?? row.paidAt ?? row.createdAt;
            if (ctx.now.getTime() - paidInstant.getTime() >= 30 * 60_000) {
              await this.raiseAlert(
                ctx,
                counts,
                'UNCREDITED_AFTER_PAYMENT',
                row.id,
                {
                  topUpId: row.id,
                  orderCode: row.orderCode,
                  amountVnd: row.amountVnd,
                  amountPaidVnd:
                    snapshot.facts.amountPaidVnd ??
                    row.amountPaidVnd ??
                    undefined,
                  paidAt: paidInstant.toISOString(),
                },
              );
            }
          }

          // 4b. PAID_ON_CLOSED_LINK (C5)
          if (
            (snapshot.effect === 'CANCELLED' ||
              snapshot.effect === 'EXPIRED') &&
            snapshot.facts.amountPaidVnd > 0
          ) {
            await this.raiseAlert(ctx, counts, 'PAID_ON_CLOSED_LINK', row.id, {
              topUpId: row.id,
              orderCode: row.orderCode,
              amountVnd: row.amountVnd,
              amountPaidVnd: snapshot.facts.amountPaidVnd,
            });
          }

          // 4c. MISMATCH_SLA_BREACHED (C3: stored first paidAt is the anchor)
          if (postStatus === 'AMOUNT_MISMATCH') {
            const paidInstant = row.paidAt ?? snapshot.facts.paidAt;
            if (
              paidInstant &&
              ctx.now.getTime() >=
                addBusinessDays(
                  paidInstant,
                  TOP_UP_MISMATCH_SLA_BUSINESS_DAYS,
                ).getTime()
            ) {
              await this.raiseAlert(
                ctx,
                counts,
                'MISMATCH_SLA_BREACHED',
                row.id,
                {
                  topUpId: row.id,
                  orderCode: row.orderCode,
                  amountVnd: row.amountVnd,
                  amountPaidVnd:
                    snapshot.facts.amountPaidVnd ??
                    row.amountPaidVnd ??
                    undefined,
                  paidAt: paidInstant.toISOString(),
                },
              );
            }
          }

          after = row.id;
        } catch (rowErr) {
          counts.failedCount++;
          ctx.logger.error(
            `Unexpected failure processing row ${row.id}: ${rowErr}`,
          );
          after = row.id;
        }
      }

      if (stoppedEarly || !hasMore) {
        break;
      }
    }

    if (!hasMore) {
      this.cursor = undefined;
    } else {
      this.cursor = after;
    }

    // Provider-failure episode (C6)
    // ponytail: in-memory episode counter; a restart may re-alert once, acceptable for one VPS instance.
    if (anyProviderSuccess) {
      this.consecutiveAllFailedRuns = 0;
      this.episodeStartedAt = null;
    } else if (providerAttempted > 0 && providerFailed === providerAttempted) {
      if (this.consecutiveAllFailedRuns === 0) {
        this.episodeStartedAt = ctx.now;
      }
      this.consecutiveAllFailedRuns++;
      if (this.consecutiveAllFailedRuns >= 3 && this.episodeStartedAt) {
        await this.raiseAlert(
          ctx,
          counts,
          'PROVIDER_FAILURE',
          this.episodeStartedAt.toISOString(),
        );
      }
    }

    assertNotAllFailed(
      this.name,
      counts.failedCount + counts.providerFailedCount,
      counts.scannedCount,
    );

    return {
      status:
        counts.failedCount > 0 || counts.providerFailedCount > 0
          ? 'PARTIAL'
          : 'SUCCEEDED',
      counts,
      hasMore,
    };
  }
}
