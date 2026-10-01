/**
 * Plan 2.3 (decision A): Research's command that closes a survey whose sample
 * target is met (close kind `QUOTA`) and refunds its leftover Escrow through
 * the normal close path. Participation calls it inside the transaction of the
 * submission / code verification that may have filled the last slot; it
 * joins that Unit of Work and is a no-op while the target is not met.
 */
export interface SurveyQuotaClosePort {
  closeFormIfQuotaMet(
    formId: string,
    at: Date,
  ): Promise<{ closed: boolean; refundAmount: number }>;
}
